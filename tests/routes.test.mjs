import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES = (await import('../lib/routes.mjs')).ROUTES;
const LOCAL_COMMANDS = (await import('../lib/routes.mjs')).LOCAL_COMMANDS;

// M1 route freeze: every baseline Browser top-level command/alias must appear
// explicitly in the preview route table. Only `project-kit` is new.
const EXPECTED_BASELINE = [
  'mcp',
  'doctor',
  'bootstrap',
  'gateway',
  'profiles',
  'profile-pool',
  'launch',
  'close',
  'quit',
  'workflow',
  'ai',
  'site',
  'automation',
  'project',
  'mobile',
  'adb',
  'captcha',
  'skills',
  'store',
  'health',
  'call',
  'vault',
  'extension-info',
  'extension-path',
];

test('route table freezes every baseline route/alias plus local help/version and project-kit', () => {
  for (const command of EXPECTED_BASELINE) {
    assert.ok(ROUTES.has(command), `missing baseline route: ${command}`);
  }
  assert.ok(ROUTES.has('project-kit'), 'missing optional project-kit route');
  assert.deepEqual(
    [...ROUTES.keys()].sort(),
    [...EXPECTED_BASELINE, 'project-kit'].sort(),
    'route table must not gain silent extras or lose baseline routes',
  );
});

test('help/version/unknown stay local; nothing falls through silently', () => {
  assert.ok(LOCAL_COMMANDS.has('help'));
  assert.ok(LOCAL_COMMANDS.has('version'));
  for (const command of ROUTES.keys()) {
    assert.ok(!LOCAL_COMMANDS.has(command), `${command} must not be local-handled`);
  }
  for (const [, descriptor] of ROUTES) {
    assert.ok(
      ['browser', 'local', 'component', 'project-kit'].includes(descriptor.kind),
      `route kind must be explicit: ${JSON.stringify(descriptor)}`,
    );
  }
  for (const [, descriptor] of ROUTES) {
    assert.notEqual(descriptor.kind, 'legacy-browser', 'legacy-browser kind must be removed');
  }
});

test('browser-owned routes delegate direct; skills/doctor are CLI-local', () => {
  for (const command of ['mcp', 'gateway', 'profiles', 'profile-pool', 'launch', 'close', 'quit', 'health', 'call', 'extension-info', 'extension-path', 'bootstrap', 'project']) {
    assert.equal(ROUTES.get(command).kind, 'browser', command);
  }
  for (const command of ['skills', 'doctor']) {
    assert.equal(ROUTES.get(command).kind, 'local', command);
  }
});

test('component routes resolve explicit executables; store stays a site alias', () => {
  for (const command of ['workflow', 'ai', 'site', 'automation', 'vault', 'mobile', 'adb', 'captcha', 'store']) {
    assert.equal(ROUTES.get(command).kind, 'component', command);
  }
  assert.equal(ROUTES.get('store').component, 'site');
  assert.equal(ROUTES.get('store').legacyAlias, true);
  assert.equal(ROUTES.get('adb').component, 'mobile');
  assert.equal(ROUTES.get('project-kit').kind, 'project-kit');
  assert.equal(ROUTES.get('project-kit').optional, true);
});

test('package exposes only the preview executable, never a public webmcp bin', () => {
  const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@gyga-browser/webmcp-cli');
  assert.deepEqual(Object.keys(pkg.bin), ['webmcp-cli']);
  assert.equal(pkg.bin['webmcp-cli'], 'bin/webmcp-cli.mjs');
});
