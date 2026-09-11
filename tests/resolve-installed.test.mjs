import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PACKAGE_ROOT } from '../lib/help.mjs';
import {
  browserNotFoundMessage,
  componentNotFoundMessage,
  projectKitNotFoundMessage,
  resolveBrowserBin,
  resolveCaptchaBin,
  resolveComponentBin,
  resolveInstalledComponentDir,
  resolveProjectKitBin,
  resolveProjectLibraryRoot,
} from '../lib/resolve.mjs';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(PKG_ROOT, 'bin', 'webmcp-cli.mjs');

// Fixture component table mirrors the CLI2-6 route → component/bin table.
// mobile (webmcp-adb-kit) is deliberately omitted to exercise typed missing.
const FIXTURE_COMPONENTS = [
  { route: 'browser', id: 'webmcp-browser-kit', bins: { 'webmcp-browser': 'webmcp-browser.mjs', webmcp: 'webmcp.mjs' } },
  { route: 'workflow', id: 'webmcp-workflow-cli', bins: { 'webmcp-workflow-cli': 'webmcp-workflow-cli.js', 'webmcp-workflow': 'webmcp-workflow.js' } },
  { route: 'ai', id: 'webmcp-ai-cli', bins: { 'webmcp-ai': 'webmcp-ai.mjs' } },
  { route: 'site', id: 'webmcp-site-store', bins: { 'webmcp-store': 'webmcp-store.mjs', 'webmcp-site': 'webmcp-site.mjs', 'webmcp-store-cli': 'webmcp-store-cli.mjs' } },
  { route: 'automation', id: 'webmcp-automation-store', bins: { 'webmcp-automation': 'webmcp-automation.mjs' } },
  { route: 'vault', id: 'webmcp-vault-kit', bins: { 'webmcp-vault': 'webmcp-vault.mjs' } },
  { route: 'projectKit', id: 'webmcp-project-kit', bins: { 'webmcp-project-kit': 'webmcp-project-kit.mjs' } },
  { route: 'runner', id: 'webmcp-automation-runner', bins: { 'webmcp-automation-runner': 'webmcp-automation-runner.mjs', 'webmcp-agent-entry': 'webmcp-agent-entry.mjs' } },
];

function writeExecutable(file, body) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
  chmodSync(file, 0o755);
}

function buildFixture(t, { omitIds = [], browserBody = null } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'webmcp-installed-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const components = [];
  for (const comp of FIXTURE_COMPONENTS) {
    if (omitIds.includes(comp.id)) continue;
    const publicBins = {};
    const files = [];
    for (const [binName, target] of Object.entries(comp.bins)) {
      publicBins[binName] = target;
      files.push(`payload/${comp.id}/${target}`);
      let body = `#!/usr/bin/env node\nconsole.log("fixture-${comp.id}-${binName}");\n`;
      if (comp.route === 'browser' && browserBody) body = browserBody;
      writeExecutable(path.join(root, 'payload', comp.id, target), body);
    }
    components.push({ id: comp.id, version: '0.0.0-test', publicBins, files });
  }
  const manifest = { schema: 'webmcp-runtime-release/2', release: 'test-fixture', components };
  const manifestPath = path.join(root, 'release.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { root, manifestPath, manifest };
}

function installedEnv(manifestPath) {
  return { WEBMCP_RUNTIME_MANIFEST: manifestPath };
}

test('installed mode resolves every fixture component inside the release root, ignoring siblings', (t) => {
  const { root, manifestPath } = buildFixture(t);
  const env = installedEnv(manifestPath);
  const opts = { env, cwd: '/tmp', packageRoot: PACKAGE_ROOT };

  // Sanity: sibling checkouts exist next to PACKAGE_ROOT so the test is meaningful.
  assert.ok(
    existsSync(path.resolve(PACKAGE_ROOT, '../webmcp-browser-kit/bin/webmcp-browser.mjs')),
    'expected sibling browser checkout to exist for installed-vs-sibling proof',
  );

  const browser = resolveBrowserBin(opts);
  assert.ok(browser, 'browser must resolve in installed mode');
  assert.ok(browser.startsWith(root + path.sep), `browser must be inside fixture root: ${browser}`);
  assert.ok(browser.includes(`payload${path.sep}webmcp-browser-kit`), browser);
  assert.ok(existsSync(browser));

  const expectations = [
    ['workflow', 'webmcp-workflow-cli'],
    ['ai', 'webmcp-ai-cli'],
    ['site', 'webmcp-site-store'],
    ['automation', 'webmcp-automation-store'],
    ['vault', 'webmcp-vault-kit'],
  ];
  for (const [component, componentId] of expectations) {
    const resolved = resolveComponentBin(component, opts);
    assert.ok(resolved, `${component} must resolve in installed mode`);
    assert.ok(resolved.startsWith(root + path.sep), `${component} must be inside fixture: ${resolved}`);
    assert.ok(resolved.includes(`payload${path.sep}${componentId}`), resolved);
    assert.ok(existsSync(resolved));
  }

  const kit = resolveProjectKitBin(opts);
  assert.ok(kit, 'project-kit must resolve in installed mode');
  assert.ok(kit.startsWith(root + path.sep), `project-kit inside fixture: ${kit}`);
  assert.ok(existsSync(kit));

  const runner = resolveComponentBin('runner', opts);
  assert.ok(runner, 'runner must resolve in installed mode');
  assert.ok(runner.startsWith(root + path.sep), `runner inside fixture: ${runner}`);
  assert.ok(existsSync(runner));

  // First bin in preference wins when both are present.
  assert.ok(path.basename(browser) === 'webmcp-browser.mjs', `browser prefers webmcp-browser: ${browser}`);

  // WEBMCP_RELEASE_ROOT pointing at the root dir must behave identically.
  const env2 = { WEBMCP_RELEASE_ROOT: root };
  const browser2 = resolveBrowserBin({ env: env2, cwd: '/tmp', packageRoot: PACKAGE_ROOT });
  assert.equal(browser2, browser, 'RELEASE_ROOT dir form must normalize to the same payload');
});

test('explicit overrides still win in installed mode', (t) => {
  const { manifestPath } = buildFixture(t);
  const dir = mkdtempSync(path.join(tmpdir(), 'webmcp-installed-override-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const browserOverride = path.join(dir, 'custom-browser.mjs');
  writeExecutable(browserOverride, '#!/usr/bin/env node\nconsole.log("override");\n');
  const aiOverride = path.join(dir, 'custom-ai.mjs');
  writeExecutable(aiOverride, '#!/usr/bin/env node\nconsole.log("override-ai");\n');
  const kitOverride = path.join(dir, 'custom-kit.mjs');
  writeExecutable(kitOverride, '#!/usr/bin/env node\nconsole.log("override-kit");\n');

  const env = {
    WEBMCP_RUNTIME_MANIFEST: manifestPath,
    WEBMCP_BROWSER_BIN: browserOverride,
    WEBMCP_AI_BIN: aiOverride,
    WEBMCP_PROJECT_KIT_BIN: kitOverride,
  };
  assert.equal(resolveBrowserBin({ env, cwd: '/tmp' }), browserOverride);
  assert.equal(resolveComponentBin('ai', { env, cwd: '/tmp' }), aiOverride);
  assert.equal(resolveProjectKitBin({ env, cwd: '/tmp' }), kitOverride);
});

test('absent component returns null with installed-mode message', (t) => {
  const { manifestPath } = buildFixture(t);
  const env = installedEnv(manifestPath);
  const opts = { env, cwd: '/tmp', packageRoot: PACKAGE_ROOT };
  const resolved = resolveComponentBin('mobile', opts);
  assert.equal(resolved, null, 'mobile/adb-kit absent from fixture must be null');
  const msg = componentNotFoundMessage('mobile', { env });
  assert.match(msg, /webmcp-adb-kit/, 'installed message must name the component id');
  assert.match(msg, /installed mode/, 'installed message must say installed mode');
  assert.match(msg, /no source\/npm fallback/, 'installed message must note no fallback');
});

test('invalid and missing manifests resolve null with invalid-manifest message', (t) => {
  // bad JSON
  const badRoot = mkdtempSync(path.join(tmpdir(), 'webmcp-installed-badjson-'));
  t.after(() => rmSync(badRoot, { recursive: true, force: true }));
  const badPath = path.join(badRoot, 'release.json');
  writeFileSync(badPath, '{ not json{{{');
  // wrong schema
  const schemaRoot = mkdtempSync(path.join(tmpdir(), 'webmcp-installed-schema-'));
  t.after(() => rmSync(schemaRoot, { recursive: true, force: true }));
  const schemaPath = path.join(schemaRoot, 'release.json');
  writeFileSync(schemaPath, JSON.stringify({ schema: 'webmcp-runtime-release/1', components: [] }));
  // missing components array
  const noCompRoot = mkdtempSync(path.join(tmpdir(), 'webmcp-installed-nocomp-'));
  t.after(() => rmSync(noCompRoot, { recursive: true, force: true }));
  const noCompPath = path.join(noCompRoot, 'release.json');
  writeFileSync(noCompPath, JSON.stringify({ schema: 'webmcp-runtime-release/2' }));
  // unreadable path
  const missingPath = path.join(tmpdir(), `webmcp-no-such-manifest-${Date.now()}-${Math.random().toString(16).slice(2)}`, 'release.json');

  for (const manifestPath of [badPath, schemaPath, noCompPath, missingPath]) {
    const env = installedEnv(manifestPath);
    const opts = { env, cwd: '/tmp', packageRoot: PACKAGE_ROOT };
    assert.equal(resolveBrowserBin(opts), null, `browser null for ${manifestPath}`);
    assert.equal(resolveComponentBin('ai', opts), null, `ai null for ${manifestPath}`);
    assert.equal(resolveProjectKitBin(opts), null, `kit null for ${manifestPath}`);
    assert.match(
      browserNotFoundMessage({ env }),
      /installed release manifest is invalid/i,
      `browser invalid-manifest message for ${manifestPath}`,
    );
    assert.match(
      componentNotFoundMessage('ai', { env }),
      /installed release manifest is invalid/i,
      `component invalid-manifest message for ${manifestPath}`,
    );
    assert.match(
      projectKitNotFoundMessage({ env }),
      /installed release manifest is invalid/i,
      `kit invalid-manifest message for ${manifestPath}`,
    );
  }
});

test('path-escape manifest entries resolve null', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'webmcp-installed-escape-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Valid browser entry so the manifest itself parses; ai entries are escapes.
  const browserTarget = 'webmcp-browser.mjs';
  writeExecutable(path.join(root, 'payload', 'webmcp-browser-kit', browserTarget), '#!/usr/bin/env node\n');
  const manifest = {
    schema: 'webmcp-runtime-release/2',
    components: [
      {
        id: 'webmcp-browser-kit',
        publicBins: { 'webmcp-browser': browserTarget },
        files: [`payload/webmcp-browser-kit/${browserTarget}`],
      },
      {
        id: 'webmcp-ai-cli',
        publicBins: { 'webmcp-ai': '../../evil.mjs' },
        files: ['payload/webmcp-ai-cli/../../evil.mjs'],
      },
    ],
  };
  const manifestPath = path.join(root, 'release.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const env = installedEnv(manifestPath);
  assert.equal(
    resolveComponentBin('ai', { env, cwd: '/tmp', packageRoot: PACKAGE_ROOT }),
    null,
    'relative escape must be null',
  );

  // Absolute target escape.
  manifest.components[1].publicBins['webmcp-ai'] = '/tmp/evil-absolute.mjs';
  writeFileSync(manifestPath, JSON.stringify(manifest));
  // Bust any per-process manifest cache by using a fresh copy at a new path.
  const root2 = mkdtempSync(path.join(tmpdir(), 'webmcp-installed-escape2-'));
  t.after(() => rmSync(root2, { recursive: true, force: true }));
  writeExecutable(path.join(root2, 'payload', 'webmcp-browser-kit', browserTarget), '#!/usr/bin/env node\n');
  const manifest2 = {
    schema: 'webmcp-runtime-release/2',
    components: [
      {
        id: 'webmcp-browser-kit',
        publicBins: { 'webmcp-browser': browserTarget },
        files: [`payload/webmcp-browser-kit/${browserTarget}`],
      },
      {
        id: 'webmcp-ai-cli',
        publicBins: { 'webmcp-ai': '/tmp/evil-absolute.mjs' },
        files: ['/tmp/evil-absolute.mjs'],
      },
    ],
  };
  const manifestPath2 = path.join(root2, 'release.json');
  writeFileSync(manifestPath2, JSON.stringify(manifest2));
  assert.equal(
    resolveComponentBin('ai', { env: installedEnv(manifestPath2), cwd: '/tmp', packageRoot: PACKAGE_ROOT }),
    null,
    'absolute escape must be null',
  );
});

test('traversal inside the release root is rejected even when the escape destination exists', (t) => {
  function buildTraversalRoot() {
    const root = mkdtempSync(path.join(tmpdir(), 'webmcp-installed-traversal-'));
    writeExecutable(path.join(root, 'payload', 'webmcp-browser-kit', 'webmcp-browser.mjs'), '#!/usr/bin/env node\n');
    // Sibling-component sentinel that EXISTS and is executable.
    writeExecutable(
      path.join(root, 'payload', 'webmcp-browser-kit', 'bin', 'sentinel.mjs'),
      '#!/usr/bin/env node\nconsole.log("sibling-sentinel");\n',
    );
    // Valid file inside the ai component dir (proves dot/empty-segment rejection).
    writeExecutable(
      path.join(root, 'payload', 'webmcp-ai-cli', 'bin', 'valid.mjs'),
      '#!/usr/bin/env node\nconsole.log("valid");\n',
    );
    return root;
  }
  function resolveAiWithTarget(root, target) {
    const manifest = {
      schema: 'webmcp-runtime-release/2',
      components: [
        { id: 'webmcp-browser-kit', publicBins: { 'webmcp-browser': 'webmcp-browser.mjs' } },
        { id: 'webmcp-ai-cli', publicBins: { 'webmcp-ai': target } },
      ],
    };
    const manifestPath = path.join(root, 'release.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    return resolveComponentBin('ai', {
      env: installedEnv(manifestPath),
      cwd: '/tmp',
      packageRoot: PACKAGE_ROOT,
    });
  }
  // Case 1: sibling-payload escape via `..` — destination EXISTS.
  {
    const root = buildTraversalRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const sibling = path.join(root, 'payload', 'webmcp-browser-kit', 'bin', 'sentinel.mjs');
    assert.ok(existsSync(sibling), 'sibling sentinel must exist to prove the guard, not existence');
    // Use a fresh root per case to avoid the per-process manifest cache.
    const caseRoot = buildTraversalRoot();
    t.after(() => rmSync(caseRoot, { recursive: true, force: true }));
    const caseSibling = path.join(caseRoot, 'payload', 'webmcp-browser-kit', 'bin', 'sentinel.mjs');
    assert.ok(existsSync(caseSibling));
    assert.equal(
      resolveAiWithTarget(caseRoot, '../webmcp-browser-kit/bin/sentinel.mjs'),
      null,
      'sibling-payload escape must be null even though the destination exists',
    );
  }
  // Case 2: release-root escape via `../..` — release.json EXISTS.
  {
    const caseRoot = buildTraversalRoot();
    t.after(() => rmSync(caseRoot, { recursive: true, force: true }));
    // Write a placeholder manifest first so release.json exists as an escape destination,
    // then overwrite with the evil target (fresh path per write avoids cache staleness).
    writeFileSync(path.join(caseRoot, 'release.json'), JSON.stringify({ schema: 'webmcp-runtime-release/2', components: [] }));
    assert.ok(existsSync(path.join(caseRoot, 'release.json')), 'release.json sentinel must exist');
    assert.equal(
      resolveAiWithTarget(caseRoot, '../../release.json'),
      null,
      '../../release.json escape must be null even though release.json exists',
    );
  }
  // Case 3: dot / empty-segment targets that resolve inside but must still be rejected.
  {
    const dotTargets = [
      './bin/valid.mjs',
      'bin/./valid.mjs',
      'bin//valid.mjs',
      'sub/../bin/valid.mjs',
    ];
    for (const target of dotTargets) {
      const caseRoot = buildTraversalRoot();
      t.after(() => rmSync(caseRoot, { recursive: true, force: true }));
      const lexicalDest = path.join(caseRoot, 'payload', 'webmcp-ai-cli', 'bin', 'valid.mjs');
      assert.ok(existsSync(lexicalDest), `lexical destination must exist for ${target}`);
      assert.equal(
        resolveAiWithTarget(caseRoot, target),
        null,
        `dot/empty-segment target ${JSON.stringify(target)} must be null even though it resolves to an existing file`,
      );
    }
  }
});

test('symlink escape inside the component payload resolves null', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'webmcp-installed-symlink-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeExecutable(path.join(root, 'payload', 'webmcp-browser-kit', 'webmcp-browser.mjs'), '#!/usr/bin/env node\n');
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'webmcp-installed-outside-'));
  t.after(() => rmSync(outsideDir, { recursive: true, force: true }));
  const outsideEvil = path.join(outsideDir, 'evil.mjs');
  writeExecutable(outsideEvil, '#!/usr/bin/env node\nconsole.log("outside");\n');
  assert.ok(existsSync(outsideEvil));
  const linkPath = path.join(root, 'payload', 'webmcp-ai-cli', 'link-outside');
  mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    symlinkSync(outsideDir, linkPath, 'dir');
  } catch (error) {
    t.skip(`symlink not permitted on this platform: ${error && error.message ? error.message : error}`);
    return;
  }
  const candidateViaLink = path.join(linkPath, 'evil.mjs');
  assert.ok(existsSync(candidateViaLink), 'symlink destination must exist via the link (follows symlink)');
  const manifest = {
    schema: 'webmcp-runtime-release/2',
    components: [
      { id: 'webmcp-browser-kit', publicBins: { 'webmcp-browser': 'webmcp-browser.mjs' } },
      { id: 'webmcp-ai-cli', publicBins: { 'webmcp-ai': 'link-outside/evil.mjs' } },
    ],
  };
  const manifestPath = path.join(root, 'release.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.equal(
    resolveComponentBin('ai', { env: installedEnv(manifestPath), cwd: '/tmp', packageRoot: PACKAGE_ROOT }),
    null,
    'symlink escape must be null even though the linked file exists',
  );
});

test('main() with injected installed env emits typed installed-manifest message, not dev npm advice', async (t) => {
  const { main } = await import('../lib/main.mjs');
  const badRoot = mkdtempSync(path.join(tmpdir(), 'webmcp-installed-mainmsg-'));
  t.after(() => rmSync(badRoot, { recursive: true, force: true }));
  const badPath = path.join(badRoot, 'release.json');
  writeFileSync(badPath, '{ not json{{{');
  const env = { WEBMCP_RUNTIME_MANIFEST: badPath };
  const runChild = async () => { throw new Error('delegate must not run when the bin is missing'); };
  async function captureMain(args) {
    const errors = [];
    const origErr = console.error;
    console.error = (...a) => { errors.push(a.join(' ')); };
    try {
      const code = await main(args, { env, runChild });
      return { code, stderr: errors.join('\n') };
    } finally {
      console.error = origErr;
    }
  }
  const browser = await captureMain(['mcp', '--help']);
  assert.equal(browser.code, 1, 'browser route with invalid manifest must fail');
  assert.match(browser.stderr, /installed release manifest is invalid/i, 'browser must emit installed-manifest message');
  assert.match(browser.stderr, /installed mode/, 'browser must say installed mode');
  assert.doesNotMatch(browser.stderr, /WEBMCP_BROWSER_BIN/, 'browser must not emit dev override advice');
  assert.doesNotMatch(browser.stderr, /install @gyga-browser\/webmcp-browser-automation-kit/, 'browser must not emit dev npm advice');
  const ai = await captureMain(['ai']);
  assert.equal(ai.code, 1, 'ai route with invalid manifest must fail');
  assert.match(ai.stderr, /installed release manifest is invalid/i, 'ai must emit installed-manifest message');
  assert.match(ai.stderr, /installed mode/, 'ai must say installed mode');
  assert.doesNotMatch(ai.stderr, /WEBMCP_AI_BIN/, 'ai must not emit dev override advice');
  const kit = await captureMain(['project-kit']);
  assert.equal(kit.code, 1, 'project-kit route with invalid manifest must fail');
  assert.match(kit.stderr, /installed release manifest is invalid/i, 'kit must emit installed-manifest message');
  assert.match(kit.stderr, /installed mode/, 'kit must say installed mode');
  assert.doesNotMatch(kit.stderr, /WEBMCP_PROJECT_KIT_BIN/, 'kit must not emit dev override advice');
});

test('end-to-end subprocess uses the fixture browser bin in installed mode', (t) => {
  const marker = `INSTALLED_BROWSER_MARKER_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const browserBody = `#!/usr/bin/env node\nconsole.log(${JSON.stringify(marker)});\n`;
  const { root, manifestPath } = buildFixture(t, { browserBody });
  // Ensure the sibling browser bin does not contain our marker (proof of no-sibling use).
  const sibling = path.resolve(PACKAGE_ROOT, '../webmcp-browser-kit/bin/webmcp-browser.mjs');
  if (existsSync(sibling)) {
    const siblingContent = readFileSync(sibling, 'utf8');
    assert.ok(!siblingContent.includes(marker), 'sibling must not contain the fixture marker');
  }
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'WEBMCP_BROWSER_BIN' || key === 'WEBMCP_RELEASE_ROOT' || key === 'WEBMCP_RUNTIME_ROOT') delete env[key];
  }
  env.WEBMCP_RUNTIME_MANIFEST = manifestPath;
  delete env.WEBMCP_BROWSER_BIN;
  const result = spawnSync(process.execPath, [BIN, 'mcp', '--help'], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    timeout: 15000,
    env,
  });
  assert.equal(result.status, 0, `installed mcp --help must exit 0: stderr=${result.stderr}`);
  assert.match(result.stdout, new RegExp(marker), 'fixture stub browser marker must appear (no sibling fallback)');
});

test('dev mode without manifest env keeps existing resolution and messages', (t) => {
  const env = {};
  // Missing root still null in dev mode.
  assert.equal(resolveBrowserBin({ env, packageRoot: '/nonexistent-root-xyz' }), null);
  assert.equal(resolveComponentBin('ai', { env, packageRoot: '/nonexistent-root-xyz' }), null);
  assert.equal(resolveComponentBin('nope', { env }), null);
  assert.equal(resolveProjectKitBin({ env, packageRoot: '/nonexistent-root-xyz' }), null);
  // Sibling fallback still works in dev mode when checkouts exist.
  const devBrowser = resolveBrowserBin({ env, cwd: '/tmp', packageRoot: PACKAGE_ROOT });
  assert.ok(devBrowser, 'dev mode should still find the sibling browser checkout');
  assert.ok(!devBrowser.includes('payload'), 'dev sibling path must not be a release payload');
  // Dev messages byte-identical.
  assert.equal(
    browserNotFoundMessage({ env }),
    'WebMCP Browser executable not found.\nRun from a checkout that provides ../browser/bin/webmcp-browser.mjs, install @gyga-browser/webmcp-browser-automation-kit, or set WEBMCP_BROWSER_BIN.',
  );
  assert.equal(
    componentNotFoundMessage('ai', { env }),
    'WebMCP AI CLI not found.\nInstall @gyga-browser/webmcp-ai, run from the webmcp-automation-kit checkout, or set WEBMCP_AI_BIN.',
  );
  assert.equal(
    projectKitNotFoundMessage({ env }),
    'WebMCP Project Kit CLI not found.\nInstall the Project Kit package, run from a checkout that provides ../project-kit/bin/webmcp-project-kit.mjs, or set WEBMCP_PROJECT_KIT_BIN.\nThe legacy `project` route is unchanged.',
  );
  // captcha keeps env/home resolution even with installed env present (exception).
  const dir = mkdtempSync(path.join(tmpdir(), 'webmcp-captcha-dev-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const captchaBin = path.join(dir, 'captcha-solve');
  writeExecutable(captchaBin, '#!/usr/bin/env node\n');
  const { manifestPath } = buildFixture(t);
  const installedEnvWithCaptcha = { WEBMCP_RUNTIME_MANIFEST: manifestPath, WEBMCP_CAPTCHA_BIN: captchaBin };
  assert.equal(resolveCaptchaBin({ env: installedEnvWithCaptcha, cwd: '/' }), captchaBin);
  assert.equal(resolveComponentBin('captcha', { env: installedEnvWithCaptcha, cwd: '/' }), captchaBin);
});

test('installed component dir returns realpath when the release root is a current symlink', (t) => {
  const base = mkdtempSync(path.join(tmpdir(), 'webmcp-installed-realpath-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const release = path.join(base, 'releases', 'rel_x');
  mkdirSync(path.join(release, 'payload', 'webmcp-project-library'), { recursive: true });
  const manifest = {
    schema: 'webmcp-runtime-release/2',
    release: 'rel_x',
    components: [{ id: 'webmcp-project-library', version: '0.0.0-test' }],
  };
  writeFileSync(path.join(release, 'release.json'), JSON.stringify(manifest));
  const link = path.join(base, 'current');
  try {
    symlinkSync(release, link, 'dir');
  } catch (error) {
    t.skip(`symlink not permitted on this platform: ${error && error.message ? error.message : error}`);
    return;
  }
  const env = { WEBMCP_RUNTIME_ROOT: link };
  const resolved = resolveProjectLibraryRoot({ env, cwd: '/tmp' });
  assert.ok(resolved, 'library root must resolve through the current symlink');
  assert.ok(existsSync(resolved), `resolved library must exist: ${resolved}`);
  assert.ok(!resolved.split(path.sep).includes('current'), `resolved path must not leak current: ${resolved}`);
  assert.equal(realpathSync(resolved), resolved, `resolved path must be a realpath: ${resolved}`);
  const direct = resolveInstalledComponentDir('webmcp-project-library', env, '/tmp');
  assert.equal(direct, resolved, 'component dir and library root must agree');
});

test('installed component dir returns realpath for a normal prefix', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'webmcp-installed-realpath-plain-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'payload', 'webmcp-project-library'), { recursive: true });
  const manifest = {
    schema: 'webmcp-runtime-release/2',
    release: 'plain',
    components: [{ id: 'webmcp-project-library', version: '0.0.0-test' }],
  };
  const manifestPath = path.join(root, 'release.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const env = installedEnv(manifestPath);
  const resolved = resolveInstalledComponentDir('webmcp-project-library', env, '/tmp');
  assert.ok(resolved, 'component dir must resolve');
  assert.ok(existsSync(resolved));
  assert.equal(realpathSync(resolved), resolved, `component dir must be a realpath: ${resolved}`);
});
