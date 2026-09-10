import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { delegateCapture, delegateChild } from '../lib/delegate.mjs';
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

test('delegateCapture captures stdout/stderr and exit code from a stub child', async (t) => {
  const { file } = fixture(t, [
    "process.stdout.write('out-✓ ünïcode');",
    "process.stderr.write('err-✓ テスト');",
    'process.exit(3);',
  ].join('\n'));
  const result = await delegateCapture({ label: 'CaptureProbe', file, args: [], timeoutMs: 5000 });
  assert.equal(result.status, 3);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, 'out-✓ ünïcode');
  assert.equal(result.stderr, 'err-✓ テスト');
  assert.equal(result.timedOut, false);
  assert.ok(result.spawnErrorMessage === null || result.spawnErrorMessage === undefined);
});

test('delegateCapture reports spawn failures without throwing', async () => {
  const result = await delegateCapture({
    label: 'Missing thing',
    file: '/nonexistent-bin-xyz',
    args: [],
    useNode: false,
    timeoutMs: 5000,
  });
  assert.equal(result.status, null);
  assert.equal(result.timedOut, false);
  assert.ok(typeof result.spawnErrorMessage === 'string' && result.spawnErrorMessage.length > 0);
  assert.equal(typeof result.stdout, 'string');
  assert.equal(typeof result.stderr, 'string');
});

test('delegateCapture times out and kills a hanging child', async (t) => {
  const dir = mkdtempSync(path.join('/tmp', 'webmcp-cli-capture-timeout-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pidFile = path.join(dir, 'child.pid');
  const file = path.join(dir, 'sleeper.mjs');
  writeFileSync(file, [
    '#!/usr/bin/env node',
    "import { writeFileSync } from 'node:fs';",
    'writeFileSync(process.env.WEBMCP_CLI_CHILD_PID_FILE, String(process.pid));',
    'setTimeout(() => {}, 30000);',
    '',
  ].join('\n'));
  chmodSync(file, 0o755);
  const { existsSync } = await import('node:fs');
  const pending = delegateCapture({
    label: 'Hanging',
    file,
    args: [],
    extraEnv: { WEBMCP_CLI_CHILD_PID_FILE: pidFile },
    timeoutMs: 500,
  });
  const result = await pending;
  assert.equal(result.timedOut, true);
  assert.ok(existsSync(pidFile), 'hanging child must have started before timeout');
  const childPid = Number(readFileSync(pidFile, 'utf8'));
  assert.ok(Number.isInteger(childPid) && childPid > 0);
  const deadline = Date.now() + 5000;
  let gone = false;
  while (Date.now() < deadline) {
    try {
      process.kill(childPid, 0);
    } catch (error) {
      if (error && error.code === 'ESRCH') {
        gone = true;
        break;
      }
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(gone, 'timed-out direct child must be killed (pid-file ESRCH) within a bounded wait');
});

test('delegateCapture forwards SIGTERM to the direct child', async (t) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-capture-signal-'));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const childPidFile = path.join(fixtureRoot, 'child.pid');
  const childFile = path.join(fixtureRoot, 'sleeper.mjs');
  writeFileSync(childFile, [
    '#!/usr/bin/env node',
    "import { writeFileSync } from 'node:fs';",
    'writeFileSync(process.env.WEBMCP_CLI_CHILD_PID_FILE, String(process.pid));',
    'setTimeout(() => {}, 30000);',
    '',
  ].join('\n'));
  chmodSync(childFile, 0o755);
  const wrapperFile = path.join(fixtureRoot, 'wrapper.mjs');
  writeFileSync(wrapperFile, [
    '#!/usr/bin/env node',
    `import { delegateCapture } from ${JSON.stringify(path.join(PKG_ROOT, 'lib', 'delegate.mjs'))};`,
    'const result = await delegateCapture({',
    '  label: "CaptureSignalProbe",',
    `  file: ${JSON.stringify(childFile)},`,
    '  args: [],',
    '  extraEnv: { WEBMCP_CLI_CHILD_PID_FILE: process.env.WEBMCP_CLI_CHILD_PID_FILE },',
    '  timeoutMs: 30000,',
    '});',
    'process.stdout.write(JSON.stringify({ status: result.status, signal: result.signal, timedOut: result.timedOut }));',
    '',
  ].join('\n'));
  chmodSync(wrapperFile, 0o755);
  const { existsSync } = await import('node:fs');
  const wrapper = spawn(process.execPath, [wrapperFile], {
    cwd: PKG_ROOT,
    env: { ...process.env, WEBMCP_CLI_CHILD_PID_FILE: childPidFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    try { wrapper.kill('SIGKILL'); } catch { /* already exited */ }
  });
  const deadline = Date.now() + 10000;
  while (!existsSync(childPidFile) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(existsSync(childPidFile), 'capture child never started');
  const directChildPid = Number(readFileSync(childPidFile, 'utf8'));
  assert.ok(Number.isInteger(directChildPid) && directChildPid > 0);
  wrapper.kill('SIGTERM');
  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { wrapper.kill('SIGKILL'); } catch { /* already exiting */ }
      resolve('timeout');
    }, 10000);
    wrapper.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.notEqual(exitCode, 'timeout', 'capture wrapper did not exit after SIGTERM');
  const goneDeadline = Date.now() + 5000;
  let gone = false;
  while (Date.now() < goneDeadline) {
    try {
      process.kill(directChildPid, 0);
    } catch (error) {
      if (error && error.code === 'ESRCH') {
        gone = true;
        break;
      }
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(gone, 'direct child must be gone after forwarded SIGTERM (no orphan worker)');
});
