import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { delegateChild } from '../lib/delegate.mjs';
import { getVersion, printHelp, printMobileHelp } from '../lib/help.mjs';
import { main } from '../lib/main.mjs';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(PKG_ROOT, 'bin', 'webmcp-cli.mjs');

function fixture(t, body) {
  const dir = mkdtempSync(path.join('/tmp', 'webmcp-cli-delegate-unit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'child.mjs');
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(file, 0o755);
  return { dir, file };
}

test('delegate preserves argv/cwd/env, writes through a marker file and passes exit codes', async (t) => {
  const { dir, file } = fixture(t, [
    "import { writeFileSync } from 'node:fs';",
    'writeFileSync(process.env.WEBMCP_CLI_MARKER, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));',
    'process.exit(3);',
  ].join('\n'));
  const marker = path.join(dir, 'marker.json');
  const code = await delegateChild({
    label: 'Probe',
    file,
    args: ['a b', 'ünïcode'],
    useNode: true,
    extraEnv: { WEBMCP_CLI_MARKER: marker },
  });
  assert.equal(code, 3);
  assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), { argv: ['a b', 'ünïcode'], cwd: process.cwd() });
});

test('delegate reports spawn failures on stderr and resolves 1', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => { errors.push(args.join(' ')); };
  try {
    const code = await delegateChild({ label: 'Missing thing', file: '/nonexistent-bin-xyz', args: [], useNode: false });
    assert.equal(code, 1);
  } finally {
    console.error = original;
  }
  assert.match(errors.join('\n'), /Failed to start Missing thing/);
});

test('delegate maps a signal-killed child to exit 1 with a diagnostic', async (t) => {
  const { file } = fixture(t, "process.kill(process.pid, 'SIGTERM');\nsetTimeout(() => {}, 5000);");
  const errors = [];
  const original = console.error;
  console.error = (...args) => { errors.push(args.join(' ')); };
  try {
    const code = await delegateChild({ label: 'Signalled', file, args: [] });
    assert.equal(code, 1);
  } finally {
    console.error = original;
  }
  assert.match(errors.join('\n'), /Signalled exited after signal SIGTERM/);
});

test('delegate preserves cwd and merges env with extraEnv overrides', async (t) => {
  const { dir, file } = fixture(t, [
    "import { writeFileSync } from 'node:fs';",
    'writeFileSync(process.env.WEBMCP_CLI_MARKER, JSON.stringify({ cwd: process.cwd(), parent: process.env.WEBMCP_CLI_PARENT_VAR, extra: process.env.WEBMCP_CLI_EXTRA_VAR, path: process.env.PATH }));',
  ].join('\n'));
  const marker = path.join(dir, 'marker.json');
  const savedParent = process.env.WEBMCP_CLI_PARENT_VAR;
  const savedExtra = process.env.WEBMCP_CLI_EXTRA_VAR;
  process.env.WEBMCP_CLI_PARENT_VAR = 'parent-value-✓';
  delete process.env.WEBMCP_CLI_EXTRA_VAR;
  try {
    const code = await delegateChild({
      label: 'EnvProbe',
      file,
      args: [],
      useNode: true,
      extraEnv: { WEBMCP_CLI_MARKER: marker, WEBMCP_CLI_PARENT_VAR: 'overridden-✓', WEBMCP_CLI_EXTRA_VAR: 'extra-value-✓' },
    });
    assert.equal(code, 0);
    const data = JSON.parse(readFileSync(marker, 'utf8'));
    assert.equal(data.cwd, process.cwd(), 'cwd must equal the caller cwd');
    assert.equal(data.parent, 'overridden-✓', 'extraEnv must override the caller env');
    assert.equal(data.extra, 'extra-value-✓', 'extraEnv must add new vars');
    assert.equal(data.path, process.env.PATH, 'everything else in env must be preserved');
  } finally {
    if (savedParent === undefined) delete process.env.WEBMCP_CLI_PARENT_VAR;
    else process.env.WEBMCP_CLI_PARENT_VAR = savedParent;
    if (savedExtra === undefined) delete process.env.WEBMCP_CLI_EXTRA_VAR;
    else process.env.WEBMCP_CLI_EXTRA_VAR = savedExtra;
  }
});

test('delegate passes stdin bytes through untouched (stdio inherit)', (t) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-stdin-'));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const file = path.join(fixtureRoot, 'echo.mjs');
  writeFileSync(file, '#!/usr/bin/env node\nprocess.stdin.pipe(process.stdout);\n');
  chmodSync(file, 0o755);
  const payload = 'stdin-bytes-✓ ünïcode\nline2\twith tabs — テスト\n';
  const result = spawnSync(process.execPath, [BIN, 'ai', 'probe'], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    timeout: 10000,
    input: payload,
    env: { ...process.env, WEBMCP_AI_BIN: file },
  });
  assert.equal(result.status, 0, `echo delegate must exit 0: stderr=${result.stderr}`);
  assert.equal(result.stdout, payload, 'child must receive the exact bytes the wrapper received');
});

test('local help/version/unknown/skills-help/doctor-help paths never touch the delegate', async () => {
  const runChild = async () => { throw new Error('delegate must not run'); };
  const logs = [];
  const errors = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { logs.push(args.join(' ')); };
  console.error = (...args) => { errors.push(args.join(' ')); };
  const savedEnv = { ...process.env };
  const { mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const tmpHome = `${tmpdir()}/webmcp-cli-delegate-local-${Date.now()}`;
  mkdirSync(tmpHome, { recursive: true });
  process.env.HOME = tmpHome;
  process.env.WEBMCP_HOME = `${tmpHome}/.webmcp`;
  delete process.env.WEBMCP_KIT_MANIFEST;
  try {
    assert.equal(await main([], { runChild }), 1);
    assert.equal(await main(['help'], { runChild }), 0);
    assert.equal(await main(['version'], { runChild }), 0);
    assert.equal(await main(['bogus-route'], { runChild }), 1);
    assert.equal(await main(['skills', '--help'], { runChild }), 0);
    assert.equal(await main(['doctor', '--help'], { runChild }), 0);
  } finally {
    console.log = origLog;
    console.error = origErr;
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    for (const [k, v] of Object.entries(savedEnv)) process.env[k] = v;
    rmSync(tmpHome, { recursive: true, force: true });
  }
  assert.match(logs.join('\n'), /webmcp-cli/);
  assert.match(errors.join('\n'), /Unknown command: bogus-route/);
  assert.match(getVersion(), /^\d+\.\d+\.\d+/);
  printHelp();
  printMobileHelp();
});
