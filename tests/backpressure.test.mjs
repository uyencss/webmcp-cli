import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(PKG_ROOT, 'bin', 'webmcp-cli.mjs');
const PAYLOAD_BYTES = 10 * 1024 * 1024;
const PATTERN = '0123456789ABCDEF';

function expectedHash() {
  const hash = createHash('sha256');
  const chunk = PATTERN.repeat(4096);
  let written = 0;
  while (written < PAYLOAD_BYTES) {
    const remaining = PAYLOAD_BYTES - written;
    const data = chunk.slice(0, Math.min(chunk.length, remaining));
    hash.update(data, 'utf8');
    written += data.length;
  }
  return hash.digest('hex');
}

test('large deterministic output passes through without truncation', async (t) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-backpressure-'));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const childFile = path.join(fixtureRoot, 'big.mjs');
  writeFileSync(childFile, [
    '#!/usr/bin/env node',
    `const SIZE = ${PAYLOAD_BYTES};`,
    `const CHUNK = ${JSON.stringify(PATTERN)}.repeat(4096);`,
    'let written = 0;',
    'function writeMore() {',
    '  while (written < SIZE) {',
    '    const remaining = SIZE - written;',
    '    const data = CHUNK.slice(0, Math.min(CHUNK.length, remaining));',
    '    written += data.length;',
    '    const ok = process.stdout.write(data);',
    '    if (!ok) { process.stdout.once("drain", writeMore); return; }',
    '  }',
    '}',
    'process.stdout.on("error", () => process.exit(1));',
    'writeMore();',
    '',
  ].join('\n'));
  chmodSync(childFile, 0o755);

  const wrapper = spawn(process.execPath, [BIN, 'ai', 'probe'], {
    cwd: PKG_ROOT,
    env: { ...process.env, WEBMCP_AI_BIN: childFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chunks = [];
  let stderr = '';
  wrapper.stderr.on('data', (chunk) => { stderr += chunk; });
  wrapper.stdout.on('data', (chunk) => { chunks.push(chunk); });

  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { wrapper.kill('SIGKILL'); } catch { /* already exiting */ }
      resolve('timeout');
    }, 30000);
    wrapper.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    wrapper.on('error', () => {
      clearTimeout(timer);
      resolve('spawn-error');
    });
  });

  assert.notEqual(exitCode, 'timeout', `large-output wrapper hung (stderr=${stderr})`);
  assert.equal(exitCode, 0, `large-output wrapper must exit 0, got ${exitCode} stderr=${stderr}`);
  const payload = Buffer.concat(chunks);
  assert.equal(payload.length, PAYLOAD_BYTES, `expected ${PAYLOAD_BYTES} bytes, got ${payload.length}`);
  const actual = createHash('sha256').update(payload).digest('hex');
  assert.equal(actual, expectedHash(), 'large payload hash must match (no truncation or mutation)');
});

test('closed stdout pipe terminates promptly with exit 1 and no orphan', async (t) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-closed-pipe-'));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const childPidFile = path.join(fixtureRoot, 'child.pid');
  const childFile = path.join(fixtureRoot, 'flooder.mjs');
  writeFileSync(childFile, [
    '#!/usr/bin/env node',
    "import { writeFileSync } from 'node:fs';",
    'writeFileSync(process.env.WEBMCP_CLI_PID_FILE, String(process.pid));',
    'process.stdout.on("error", () => {',
    '  try { process.kill(process.pid, "SIGTERM"); } catch {}',
    '  setTimeout(() => { try { process.exit(1); } catch {} }, 200);',
    '});',
    'let n = 0;',
    'setInterval(() => {',
    '  try { process.stdout.write("x".repeat(65536) + String(n++) + "\\n"); }',
    '  catch { try { process.kill(process.pid, "SIGTERM"); } catch {} }',
    '}, 1);',
    '',
  ].join('\n'));
  chmodSync(childFile, 0o755);

  const { readFileSync, existsSync } = await import('node:fs');
  const wrapper = spawn(process.execPath, [BIN, 'ai', 'probe'], {
    cwd: PKG_ROOT,
    env: { ...process.env, WEBMCP_AI_BIN: childFile, WEBMCP_CLI_PID_FILE: childPidFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  wrapper.stderr.on('data', (chunk) => { stderr += chunk; });
  // Drain a little, then close the reader early to simulate a closed pipe.
  wrapper.stdout.on('data', () => {});
  t.after(() => {
    try { wrapper.kill('SIGKILL'); } catch { /* already exited */ }
  });

  const deadline = Date.now() + 10000;
  while (!existsSync(childPidFile) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(existsSync(childPidFile), 'flooder child never started');
  const directChildPid = Number(readFileSync(childPidFile, 'utf8'));
  assert.ok(Number.isInteger(directChildPid) && directChildPid > 0, 'child pid must be numeric');

  await new Promise((resolve) => setTimeout(resolve, 300));
  wrapper.stdout.destroy();

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

  assert.notEqual(exitCode, 'timeout', `closed-pipe wrapper hung (stderr=${stderr})`);
  assert.equal(exitCode, 1, `closed-pipe wrapper must exit 1, got ${exitCode} stderr=${stderr}`);
  assert.match(stderr, /exited after signal|Failed to start/, 'stderr must contain the signal/exit diagnostic');

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.throws(
    () => process.kill(directChildPid, 0),
    /ESRCH/,
    'flood child must be gone after closed pipe (no orphan worker)',
  );
});
