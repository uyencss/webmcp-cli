import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { delegateChild } from '../lib/delegate.mjs';
import { getVersion, printHelp, printMobileHelp } from '../lib/help.mjs';
import { main } from '../lib/main.mjs';

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

test('local help/version/unknown paths never touch the delegate', async () => {
  const runChild = async () => { throw new Error('delegate must not run'); };
  const logs = [];
  const errors = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { logs.push(args.join(' ')); };
  console.error = (...args) => { errors.push(args.join(' ')); };
  try {
    assert.equal(await main([], { runChild }), 1);
    assert.equal(await main(['help'], { runChild }), 0);
    assert.equal(await main(['version'], { runChild }), 0);
    assert.equal(await main(['bogus-route'], { runChild }), 1);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  assert.match(logs.join('\n'), /webmcp-cli/);
  assert.match(errors.join('\n'), /Unknown command: bogus-route/);
  assert.match(getVersion(), /^\d+\.\d+\.\d+/);
  printHelp();
  printMobileHelp();
});
