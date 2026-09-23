import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ROUTES } from '../lib/routes.mjs';
import { COMPONENTS, INSTALLED_COMPONENTS, componentNotFoundMessage, resolveComponentBin } from '../lib/resolve.mjs';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(PKG_ROOT, 'bin', 'webmcp-cli.mjs');
const JEV_BIN = path.resolve(PKG_ROOT, '../webmcp-ai-cli/bin/webmcp-jev.mjs');
const PROFILE_PATH = path.join(PKG_ROOT, '..', '..', 'installation', 'runtime-profile.json');

// webmcp-cli is its own repository. When its suite runs from a standalone clone or
// from this package's own CI job, the kit checkout that owns the runtime profile is
// not there, so the profile is read lazily and the one test that needs it skips
// instead of failing every test in this file at import time.
function readRuntimeProfile() {
  if (!existsSync(PROFILE_PATH)) return null;
  return JSON.parse(readFileSync(PROFILE_PATH, 'utf8'));
}

function run(args, env = null) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    timeout: 15000,
    env: env === null ? { ...process.env } : env,
  });
}

function writeExecutable(file, body = '#!/usr/bin/env node\n') {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body, { mode: 0o755 });
  chmodSync(file, 0o755);
}

function buildInstalledFixture(t, { jevTarget = 'webmcp-jev.mjs', jevBody = null } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'webmcp-jev-installed-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const payloadFile = path.join(root, 'payload', 'webmcp-ai-cli', jevTarget);
  if (jevBody !== null) writeExecutable(payloadFile, jevBody);
  const manifest = {
    schema: 'webmcp-runtime-release/2',
    release: 'jev-route-fixture',
    components: [
      {
        id: 'webmcp-ai-cli',
        version: '0.0.0-test',
        publicBins: { 'webmcp-jev': jevTarget },
        files: [`payload/webmcp-ai-cli/${jevTarget}`],
      },
    ],
  };
  const manifestPath = path.join(root, 'release.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { root, manifestPath };
}

test('jev route is an explicit component route, never a Browser route', () => {
  assert.deepEqual(ROUTES.get('jev'), { kind: 'component', component: 'jev' });
  assert.deepEqual(COMPONENTS.jev.envVars, ['WEBMCP_JEV_BIN']);
  assert.deepEqual(COMPONENTS.jev.overrideSubpaths, ['bin/webmcp-jev.mjs']);
  assert.deepEqual(COMPONENTS.jev.siblings, ['../webmcp-ai-cli/bin/webmcp-jev.mjs']);
  assert.deepEqual(COMPONENTS.jev.packages, [
    { name: '@gyga-browser/webmcp-ai', subpaths: ['bin/webmcp-jev.mjs'] },
  ]);
  assert.match(COMPONENTS.jev.installHint, /@gyga-browser\/webmcp-ai/);
  assert.match(COMPONENTS.jev.installHint, /webmcp-jev/);
  assert.deepEqual(INSTALLED_COMPONENTS.jev, { componentId: 'webmcp-ai-cli', bins: ['webmcp-jev'] });
});

test('jev --help resolves the component bin and spawns no provider', () => {
  const result = run(['jev', '--help'], { ...process.env, WEBMCP_JEV_BIN: JEV_BIN });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /webmcp-jev doctor/);
});

test('jev doctor --json resolves in dev mode through the monorepo sibling', () => {
  const env = { ...process.env };
  delete env.WEBMCP_JEV_BIN;
  delete env.WEBMCP_RUNTIME_MANIFEST;
  delete env.WEBMCP_RELEASE_ROOT;
  delete env.WEBMCP_RUNTIME_ROOT;
  const result = run(['jev', 'doctor', '--json'], env);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.route, 'jev');
  assert.equal(payload.provider.authenticated, 'not-probed');
  assert.equal(payload.provider.canary, 'not-probed');
  assert.equal(payload.provider.installed, 'not-probed');
});

test('unknown jev subcommand exits non-zero without Browser fallback', () => {
  const result = run(['jev', 'bogus-subcommand'], { ...process.env, WEBMCP_JEV_BIN: JEV_BIN });
  assert.notEqual(result.status, 0, 'unknown jev subcommand must fail');
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /Browser/);
});

test('missing jev component prints the stable install hint on stderr', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-missing-jev-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const installedKeys = ['WEBMCP_RUNTIME_MANIFEST', 'WEBMCP_RELEASE_ROOT', 'WEBMCP_RUNTIME_ROOT'];
  const childEnv = {
    ...process.env,
    WEBMCP_HOME: home,
    WEBMCP_JEV_BIN: path.join(home, 'no-such-jev-bin.mjs'),
  };
  for (const key of installedKeys) delete childEnv[key];
  const result = run(['jev', '--help'], childEnv);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /WebMCP Jev decision runtime not found/);
  assert.match(result.stderr, /@gyga-browser\/webmcp-ai/);
  assert.match(result.stderr, /webmcp-jev/);
  assert.equal(result.stdout, '', 'missing-component diagnostics must stay on stderr');
  assert.equal(
    componentNotFoundMessage('jev', { WEBMCP_JEV_BIN: path.join(home, 'no-such-jev-bin.mjs') }).split('\n')[0],
    'WebMCP Jev decision runtime not found.',
  );
});

test('installed manifest resolves the jev bin only inside the selected release', (t) => {
  const PROFILE = readRuntimeProfile();
  if (!PROFILE) {
    t.skip('installation/runtime-profile.json is not present outside the kit checkout');
    return;
  }
  const publicBins = PROFILE.components['webmcp-ai-cli'].publicBins;
  assert.ok(publicBins?.['webmcp-jev'], 'profile must advertise the webmcp-jev bin');
  assert.equal(publicBins['webmcp-jev'], 'bin/webmcp-jev.mjs');
  const root = mkdtempSync(path.join(tmpdir(), 'webmcp-jev-installed-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const marker = `JEV_INSTALLED_MARKER_${Date.now()}`;
  const files = [];
  for (const target of Object.values(publicBins)) {
    const payloadFile = path.join(root, 'payload', 'webmcp-ai-cli', target);
    writeExecutable(payloadFile, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(marker)});\n`);
    files.push(`payload/webmcp-ai-cli/${target}`);
  }
  const manifest = {
    schema: 'webmcp-runtime-release/2',
    release: 'jev-route-fixture',
    components: [
      {
        id: 'webmcp-ai-cli',
        version: '0.0.0-test',
        publicBins,
        files,
      },
    ],
  };
  const manifestPath = path.join(root, 'release.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const env = { WEBMCP_RUNTIME_MANIFEST: manifestPath };
  const resolved = resolveComponentBin('jev', { env, cwd: '/tmp', packageRoot: PKG_ROOT });
  assert.ok(resolved, 'jev must resolve from the installed manifest');
  assert.ok(resolved.startsWith(path.dirname(manifestPath) + path.sep), `jev must stay inside the release: ${resolved}`);
  assert.ok(resolved.endsWith(path.join('payload', 'webmcp-ai-cli', 'bin', 'webmcp-jev.mjs')), `jev must resolve to bin/webmcp-jev.mjs: ${resolved}`);

  const ran = spawnSync(process.execPath, [resolved], { encoding: 'utf8', timeout: 10000 });
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(ran.stdout, new RegExp(marker));
});

test('installed manifest rejects a jev bin target outside the release', (t) => {
  const { manifestPath } = buildInstalledFixture(t, { jevTarget: '../../evil.mjs', jevBody: null });
  const resolved = resolveComponentBin('jev', {
    env: { WEBMCP_RUNTIME_MANIFEST: manifestPath },
    cwd: '/tmp',
    packageRoot: PKG_ROOT,
  });
  assert.equal(resolved, null, 'escape target must resolve null');
});
