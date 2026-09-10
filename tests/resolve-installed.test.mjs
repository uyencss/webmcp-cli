import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
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
  resolveProjectKitBin,
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
