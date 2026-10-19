import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ROUTES } from '../lib/routes.mjs';
import { COMPONENTS, INSTALLED_COMPONENTS, resolveComponentBin } from '../lib/resolve.mjs';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(PKG_ROOT, 'bin', 'webmcp-cli.mjs');

function run(args, env = null) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    timeout: 15000,
    env: env === null ? { ...process.env } : env,
  });
}

test('usage and ai-usage route descriptors are component kind', () => {
  assert.equal(ROUTES.get('usage').kind, 'component');
  assert.equal(ROUTES.get('usage').component, 'usage');

  assert.equal(ROUTES.get('ai-usage').kind, 'component');
  assert.equal(ROUTES.get('ai-usage').component, 'usage');
  assert.equal(ROUTES.get('ai-usage').aliasOf, 'usage');
});

test('usage component metadata adheres to resolver contract', () => {
  assert.ok(COMPONENTS.usage, 'COMPONENTS.usage must be defined');
  assert.deepEqual(COMPONENTS.usage.envVars, ['WEBMCP_USAGE_BIN', 'AI_USAGE_BIN']);
  assert.deepEqual(COMPONENTS.usage.overrideSubpaths, ['bin/webmcp-usage.mjs', 'bin']);
  assert.ok(COMPONENTS.usage.siblings.length > 0);
  assert.deepEqual(INSTALLED_COMPONENTS.usage, {
    componentId: 'ai-usage-bar',
    bins: ['webmcp-usage'],
  });
});

test('usage resolves sibling executable in VIBE_CODE monorepo', () => {
  const bin = resolveComponentBin('usage', process.env, PKG_ROOT);
  assert.ok(bin, 'Must resolve webmcp-usage binary via siblings');
  assert.match(bin, /webmcp-usage\.mjs$/);
});

test('cli delegates to usage executable for help', () => {
  const res = run(['usage', 'help']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /WebMCP AI Usage & Account Switcher CLI/);
  assert.match(res.stdout, /webmcp usage switch/);
});

test('cli delegates to usage executable via ai-usage alias', () => {
  const res = run(['ai-usage', 'help']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /WebMCP AI Usage & Account Switcher CLI/);
});
