import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { main } from '../lib/main.mjs';
import {
  browserNotFoundMessage,
  componentNotFoundMessage,
  projectKitNotFoundMessage,
  resolveBrowserBin,
  resolveCaptchaBin,
  resolveComponentBin,
  resolveProjectKitBin,
} from '../lib/resolve.mjs';
import { ROUTES } from '../lib/routes.mjs';

function fixtureBin(t) {
  const dir = mkdtempSync(path.join('/tmp', 'webmcp-cli-unit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'fake-bin.mjs');
  writeFileSync(file, '#!/usr/bin/env node\n');
  return file;
}

function recorder(exitCode = 0) {
  const calls = [];
  const runChild = async (spec) => {
    calls.push(spec);
    return exitCode;
  };
  return { calls, runChild };
}

test('every browser route delegates with the command preserved', async (t) => {
  const browserBin = fixtureBin(t);
  const env = { WEBMCP_BROWSER_BIN: browserBin };
  for (const [command, route] of ROUTES) {
    if (route.kind !== 'browser') continue;
    const { calls, runChild } = recorder();
    const code = await main([command, '--probe', 'a b'], { env, runChild });
    assert.equal(code, 0, command);
    assert.deepEqual(calls, [{
      label: `Browser ${command}`,
      file: browserBin,
      args: [command, '--probe', 'a b'],
      useNode: true,
    }], command);
  }
});

test('local skills/doctor and unknown never spawn a child', async () => {
  const runChild = async () => { throw new Error('delegate must not run for local/unknown'); };
  const logs = [];
  const errors = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { logs.push(args.join(' ')); };
  console.error = (...args) => { errors.push(args.join(' ')); };
  const savedEnv = { ...process.env };
  const tmpHome = `/tmp/webmcp-cli-local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(tmpHome, { recursive: true });
  process.env.HOME = tmpHome;
  process.env.WEBMCP_HOME = `${tmpHome}/.webmcp`;
  delete process.env.WEBMCP_KIT_MANIFEST;
  try {
    // unknown must fail without spawning
    assert.equal(await main(['definitely-not-a-route'], { runChild }), 1);
    // local help paths must not spawn
    assert.equal(await main(['skills', '--help'], { runChild }), 0);
    assert.equal(await main(['doctor', '--help'], { runChild }), 0);
  } finally {
    console.log = origLog;
    console.error = origErr;
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    for (const [k, v] of Object.entries(savedEnv)) process.env[k] = v;
    const { rmSync } = await import('node:fs');
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('every component route resolves its own override and defaults empty args to --help', async (t) => {
  const bins = {
    workflow: fixtureBin(t),
    ai: fixtureBin(t),
    site: fixtureBin(t),
    automation: fixtureBin(t),
    vault: fixtureBin(t),
    captcha: fixtureBin(t),
  };
  const env = {
    WEBMCP_WORKFLOW_DISPATCHER_BIN: bins.workflow,
    WEBMCP_AI_BIN: bins.ai,
    WEBMCP_STORE_BIN: bins.site,
    WEBMCP_AUTOMATION_BIN: bins.automation,
    WEBMCP_VAULT_BIN: bins.vault,
    WEBMCP_CAPTCHA_BIN: bins.captcha,
  };
  const expectations = {
    workflow: { file: bins.workflow, args: ['--help'], useNode: true },
    ai: { file: bins.ai, args: ['--help'], useNode: true },
    site: { file: bins.site, args: ['--help'], useNode: true },
    automation: { file: bins.automation, args: ['--help'], useNode: true },
    vault: { file: bins.vault, args: ['--help'], useNode: true },
    captcha: { file: bins.captcha, args: ['--help'], useNode: false },
    store: { file: bins.site, args: ['--help'], useNode: true },
  };
  for (const [command, expected] of Object.entries(expectations)) {
    const { calls, runChild } = recorder();
    const code = await main([command], { env, runChild });
    assert.equal(code, 0, command);
    assert.equal(calls.length, 1, command);
    assert.equal(calls[0].file, expected.file, command);
    assert.deepEqual(calls[0].args, expected.args, command);
    assert.equal(calls[0].useNode, expected.useNode, command);
  }
  const { calls, runChild } = recorder();
  await main(['store', 'list'], { env, runChild });
  assert.equal(calls[0].extraEnv.WEBMCP_SITE_LEGACY_ALIAS, '1');
  assert.match(calls[0].extraEnv.WEBMCP_SITE_COMMAND_NAME, /store/);
});

test('mobile/adb validate the subcommand before resolving anything', async (t) => {
  const { runChild } = recorder();
  assert.equal(await main(['mobile'], { env: {}, runChild }), 0);
  assert.equal(await main(['adb', '--help'], { env: {}, runChild }), 0);
  assert.equal(await main(['mobile', 'nope'], { env: {}, runChild }), 1);
  const adbBin = fixtureBin(t);
  const { calls, runChild: runChild2 } = recorder();
  assert.equal(await main(['mobile', 'mcp'], { env: { WEBMCP_ADB_MCP_BIN: adbBin }, runChild: runChild2 }), 0);
  assert.deepEqual(calls[0], { label: 'ADB MCP server', file: adbBin, args: [], useNode: true });
});

test('project-kit delegates only when a real executable resolves', async (t) => {
  const kitBin = fixtureBin(t);
  const { calls, runChild } = recorder();
  const code = await main(['project-kit', 'plan'], { env: { WEBMCP_PROJECT_KIT_BIN: kitBin }, runChild });
  assert.equal(code, 0);
  assert.deepEqual(calls[0].args, ['plan']);
});

test('resolvers honour overrides, siblings, packages and typed errors', async (t) => {
  const { BROWSER_SIBLINGS, BROWSER_PACKAGE } = await import('../lib/resolve.mjs');
  // Bridge prefers the explicit webmcp-browser executable before the legacy shim.
  assert.ok(BROWSER_SIBLINGS[0].endsWith('bin/webmcp-browser.mjs'));
  assert.ok(BROWSER_SIBLINGS[1].endsWith('bin/webmcp-browser.mjs'));
  assert.equal(BROWSER_PACKAGE.subpaths[0], 'bin/webmcp-browser.mjs');
  assert.ok(BROWSER_PACKAGE.subpaths.includes('bin/webmcp.mjs'), 'legacy fallback must remain for older Browser versions');
  const browserBin = fixtureBin(t);
  assert.equal(resolveBrowserBin({ env: { WEBMCP_BROWSER_BIN: browserBin }, cwd: '/tmp' }), browserBin);
  assert.equal(resolveBrowserBin({ env: {}, packageRoot: '/nonexistent-root-xyz' }), null);
  assert.equal(resolveComponentBin('nope', { env: {} }), null);
  assert.equal(resolveComponentBin('ai', { env: {}, packageRoot: '/nonexistent-root-xyz' }), null);
  const captchaBin = fixtureBin(t);
  assert.equal(resolveCaptchaBin({ env: { WEBMCP_CAPTCHA_BIN: captchaBin }, cwd: '/' }), captchaBin);
  assert.equal(resolveCaptchaBin({ env: {}, packageRoot: '/nonexistent-root-xyz' }), null);
  const kitBin = fixtureBin(t);
  assert.equal(resolveProjectKitBin({ env: { WEBMCP_PROJECT_KIT_BIN: kitBin }, cwd: '/tmp' }), kitBin);
  assert.equal(resolveProjectKitBin({ env: {}, packageRoot: '/nonexistent-root-xyz' }), null);
  assert.match(browserNotFoundMessage(), /WEBMCP_BROWSER_BIN/);
  assert.match(componentNotFoundMessage('ai'), /WEBMCP_AI_BIN/);
  assert.match(projectKitNotFoundMessage(), /WEBMCP_PROJECT_KIT_BIN/);
  assert.match(projectKitNotFoundMessage(), /legacy `project` route is unchanged/);
});
