import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(PKG_ROOT, 'bin', 'webmcp-cli.mjs');
const HOSTILE = '/tmp/demo workspace – dự án "$HOME" `sentinel` ; | & > $(sentinel) \'quoted\'';

function captureProgram(t) {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-delegate-argv-'));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const file = path.join(fixtureRoot, 'capture.mjs');
  writeFileSync(file, [
    '#!/usr/bin/env node',
    "process.stdout.write(`${JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: process.env.WEBMCP_CLI_PROBE, stdin: await new Promise((resolve) => { let data = ''; process.stdin.on('data', (c) => { data += c; }); process.stdin.on('end', () => resolve(data)); }) })}\\n`);",
    '',
  ].join('\n'));
  chmodSync(file, 0o755);
  return { file, fixtureRoot };
}

function invoke(command, args, { env = {}, input = undefined, cwd = PKG_ROOT } = {}) {
  return spawnSync(process.execPath, [BIN, command, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
    input,
    env: { ...process.env, ...env },
  });
}

test('component delegates preserve argv boundaries, cwd, env, stdin and exit codes', (t) => {
  const { file, fixtureRoot } = captureProgram(t);
  const args = ['probe', HOSTILE, '--literal', 'semi;pipe|amp&dollar$', '--', '--not-a-flag'];
  const cases = [
    ['workflow', 'WEBMCP_WORKFLOW_DISPATCHER_BIN'],
    ['ai', 'WEBMCP_AI_BIN'],
    ['vault', 'WEBMCP_VAULT_BIN'],
    ['site', 'WEBMCP_STORE_BIN'],
    ['automation', 'WEBMCP_AUTOMATION_BIN'],
    ['captcha', 'WEBMCP_CAPTCHA_BIN'],
  ];
  const cwd = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-cwd with spaces – テスト-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  for (const [command, override] of cases) {
    const result = invoke(command, args, {
      cwd,
      input: 'stdin-payload-✓',
      env: {
        WEBMCP_CLI_PROBE: 'probe-value-✓',
        WEBMCP_HOME: path.join(fixtureRoot, '.webmcp'),
        [override]: file,
      },
    });
    assert.equal(result.status, 0, `${command}: status=${result.status} stderr=${result.stderr}`);
    assert.equal(result.stderr, '', `${command} must keep diagnostics off stderr on success`);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.argv, args, `${command} changed argv boundaries`);
    assert.equal(payload.cwd, realpathSync(cwd), `${command} changed cwd`);
    assert.equal(payload.env, 'probe-value-✓', `${command} dropped env`);
    assert.equal(payload.stdin, 'stdin-payload-✓', `${command} broke stdin`);
  }
});

test('child exit codes pass through; spawn failures report clearly on stderr', (t) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-exit-'));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const failer = path.join(fixtureRoot, 'failer.mjs');
  writeFileSync(failer, '#!/usr/bin/env node\nprocess.exit(7);\n');
  chmodSync(failer, 0o755);

  const failed = invoke('ai', ['--help'], { env: { WEBMCP_AI_BIN: failer } });
  assert.equal(failed.status, 7, `exit code must pass through, got ${failed.status}: ${failed.stderr}`);

  const missing = invoke('ai', ['--help'], { env: { WEBMCP_AI_BIN: path.join(fixtureRoot, 'no-such-bin.mjs') } });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /WebMCP AI CLI not found/);

  const unset = invoke('ai', ['--help'], {
    env: { WEBMCP_AI_BIN: '', PATH: process.env.PATH },
  });
  if (unset.status !== 0) {
    assert.equal(unset.status, 1);
    assert.match(unset.stderr, /not found/i);
  }
});

test('mobile mcp stays lazy and invokes the resolved server with an empty argv vector', (t) => {
  const { file, fixtureRoot } = captureProgram(t);
  for (const command of ['mobile', 'adb']) {
    const result = invoke(command, ['mcp'], {
      env: {
        WEBMCP_HOME: path.join(fixtureRoot, '.webmcp'),
        WEBMCP_ADB_MCP_BIN: file,
      },
    });
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout).argv, [], `${command} must pass an empty argv vector`);
  }
});

test('mobile help and unknown subcommands never spawn a child', (t) => {
  const { fixtureRoot } = captureProgram(t);
  const help = invoke('mobile', ['--help'], {
    env: { WEBMCP_ADB_MCP_BIN: path.join(fixtureRoot, 'must-not-spawn.mjs') },
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /mobile mcp/);

  const unknown = invoke('mobile', ['nope'], {
    env: { WEBMCP_ADB_MCP_BIN: path.join(fixtureRoot, 'must-not-spawn.mjs') },
  });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown mobile command: nope/);
});

test('store remains a deprecated compatibility alias onto the Site component', (t) => {
  const { file, fixtureRoot } = captureProgram(t);
  const siteEnv = {
    WEBMCP_CLI_PROBE: 'alias-probe',
    WEBMCP_STORE_BIN: file,
  };
  void fixtureRoot;
  const result = invoke('store', ['probe-arg'], { env: siteEnv });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.argv, ['probe-arg']);
});
