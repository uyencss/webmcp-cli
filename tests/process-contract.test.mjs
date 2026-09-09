import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(PKG_ROOT, 'bin', 'webmcp-cli.mjs');

test('SIGTERM to the preview reaches only the direct child and the preview exits', async (t) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-signal-'));
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

  const child = spawn(process.execPath, [BIN, 'ai', 'probe'], {
    cwd: PKG_ROOT,
    env: {
      ...process.env,
      WEBMCP_AI_BIN: childFile,
      WEBMCP_CLI_CHILD_PID_FILE: childPidFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const deadline = Date.now() + 10000;
  const { readFileSync, existsSync } = await import('node:fs');
  while (!existsSync(childPidFile) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(existsSync(childPidFile), 'fixture child never started');
  const directChildPid = Number(readFileSync(childPidFile, 'utf8'));

  child.kill('SIGTERM');
  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve('timeout');
    }, 10000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  assert.notEqual(exitCode, 'timeout', `preview did not exit after SIGTERM (stdout=${stdout} stderr=${stderr})`);
  assert.equal(stdout, '', 'interrupted preview must not pollute stdout');

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.throws(
    () => process.kill(directChildPid, 0),
    /ESRCH/,
    'direct child must be gone after forwarded SIGTERM (no orphan worker)',
  );
});

test('preview never imports the Browser CLI tree or a side-effectful MCP server', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const ownFiles = ['bin/webmcp-cli.mjs', 'lib/routes.mjs', 'lib/help.mjs', 'lib/resolve.mjs', 'lib/delegate.mjs', 'lib/main.mjs'];
  // Public package names and sibling paths in resolution metadata are allowed;
  // actual static/dynamic imports of Browser code are not.
  const bannedImports = [
    /from\s+['"][^'"]*(webmcp-browser-kit|lib\/cli\/|server\/mcp_server)[^'"]*['"]/,
    /require\(\s*['"][^'"]*(webmcp-browser-kit|lib\/cli\/|server\/mcp_server)/,
    /import\(\s*['"][^'"]*(webmcp-browser-kit|lib\/cli\/|server\/mcp_server)/,
    /from\s+['"]webmcp['"]/,
  ];
  for (const relative of ownFiles) {
    const content = readFileSync(path.join(PKG_ROOT, relative), 'utf8');
    for (const pattern of bannedImports) {
      assert.doesNotMatch(content, pattern, `${relative} must not import Browser code (${pattern})`);
    }
  }
  assert.ok(!readdirSync(path.join(PKG_ROOT, 'bin')).includes('webmcp.mjs'), 'must never ship bin/webmcp.mjs');
});
