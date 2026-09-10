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
  const { readFileSync, readdirSync, existsSync } = await import('node:fs');
  const ownFiles = ['bin/webmcp-cli.mjs', 'lib/routes.mjs', 'lib/help.mjs', 'lib/resolve.mjs', 'lib/delegate.mjs', 'lib/main.mjs', 'lib/context.mjs', 'lib/commands/skills.mjs', 'lib/commands/doctor.mjs'];
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

test('SIGINT to the preview reaches only the direct child and the preview exits', async (t) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-signal-int-'));
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

  child.kill('SIGINT');
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

  assert.notEqual(exitCode, 'timeout', `preview did not exit after SIGINT (stdout=${stdout} stderr=${stderr})`);
  assert.equal(stdout, '', 'interrupted preview must not pollute stdout');

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.throws(
    () => process.kill(directChildPid, 0),
    /ESRCH/,
    'direct child must be gone after forwarded SIGINT (no orphan worker)',
  );
});

test('SIGTERM never kills a detached background grandchild', async (t) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-bg-'));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const childPidFile = path.join(fixtureRoot, 'child.pid');
  const grandchildPidFile = path.join(fixtureRoot, 'grandchild.pid');
  const childFile = path.join(fixtureRoot, 'spawner.mjs');
  writeFileSync(childFile, [
    '#!/usr/bin/env node',
    "import { spawn } from 'node:child_process';",
    "import { writeFileSync } from 'node:fs';",
    'writeFileSync(process.env.WEBMCP_CLI_CHILD_PID_FILE, String(process.pid));',
    'const grandchild = spawn(process.execPath, ["-e", "import { writeFileSync } from \'node:fs\'; writeFileSync(process.env.WEBMCP_CLI_GRANDCHILD_PID_FILE, String(process.pid)); setTimeout(() => {}, 30000);"], { detached: true, stdio: "ignore", env: process.env });',
    'grandchild.unref();',
    'setTimeout(() => {}, 30000);',
    '',
  ].join('\n'));
  chmodSync(childFile, 0o755);

  const { readFileSync, existsSync } = await import('node:fs');
  const wrapper = spawn(process.execPath, [BIN, 'ai', 'probe'], {
    cwd: PKG_ROOT,
    env: {
      ...process.env,
      WEBMCP_AI_BIN: childFile,
      WEBMCP_CLI_CHILD_PID_FILE: childPidFile,
      WEBMCP_CLI_GRANDCHILD_PID_FILE: grandchildPidFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  wrapper.stdout.on('data', (chunk) => { stdout += chunk; });
  wrapper.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(() => {
    try { wrapper.kill('SIGKILL'); } catch { /* already exited */ }
    try {
      if (existsSync(grandchildPidFile)) {
        const pid = Number(readFileSync(grandchildPidFile, 'utf8'));
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    } catch { /* cleanup best-effort */ }
  });

  const deadline = Date.now() + 10000;
  while ((!existsSync(childPidFile) || !existsSync(grandchildPidFile)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(existsSync(childPidFile), 'fixture direct child never started');
  assert.ok(existsSync(grandchildPidFile), 'detached grandchild never started');
  const directChildPid = Number(readFileSync(childPidFile, 'utf8'));
  const grandchildPid = Number(readFileSync(grandchildPidFile, 'utf8'));
  assert.ok(Number.isInteger(directChildPid) && directChildPid > 0, 'direct child pid must be numeric');
  assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0, 'grandchild pid must be numeric');
  assert.notEqual(directChildPid, grandchildPid, 'grandchild must be a distinct process');

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

  assert.notEqual(exitCode, 'timeout', `preview did not exit after SIGTERM (stdout=${stdout} stderr=${stderr})`);
  assert.equal(stdout, '', 'interrupted preview must not pollute stdout');

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.throws(
    () => process.kill(directChildPid, 0),
    /ESRCH/,
    'direct child must be gone after forwarded SIGTERM',
  );
  assert.doesNotThrow(
    () => process.kill(grandchildPid, 0),
    'detached grandchild must stay alive (delegate never kills background gateway-style processes)',
  );
});

test('single common delegate owns every child-process call site', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  function listMjs(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) out.push(...listMjs(full));
      else if (entry.endsWith('.mjs')) out.push(full);
    }
    return out;
  }
  const libRoot = path.join(PKG_ROOT, 'lib');
  const files = listMjs(libRoot);
  const bannedSubstrings = [
    'node:child_process',
    'child_process',
    'spawn(',
    'spawnSync(',
    'exec(',
    'execSync(',
    'execFile(',
    'execFileSync(',
    'fork(',
  ];
  const offenders = [];
  for (const file of files) {
    const relative = path.relative(PKG_ROOT, file).replaceAll(path.sep, '/');
    if (relative === 'lib/delegate.mjs') continue;
    const content = readFileSync(file, 'utf8');
    const hits = bannedSubstrings.filter((token) => content.includes(token));
    if (hits.length > 0) offenders.push(`${relative}: ${hits.join(', ')}`);
  }
  assert.deepEqual(offenders, [], `only lib/delegate.mjs may contain child-process call sites (offenders: ${offenders.join('; ')})`);
  const delegateContent = readFileSync(path.join(PKG_ROOT, 'lib', 'delegate.mjs'), 'utf8');
  assert.match(delegateContent, /from\s+['"]node:child_process['"]/, 'delegate must import node:child_process');
  assert.match(delegateContent, /\bspawn\s*\(/, 'delegate must own the spawn(s)');
});

test('delegate waits for child stdio cleanup before resolving', async () => {
  const { readFileSync } = await import('node:fs');
  const content = readFileSync(path.join(PKG_ROOT, 'lib', 'delegate.mjs'), 'utf8');
  assert.match(content, /child\.on\(\s*['"]close['"]/, 'delegate must resolve on close (stdio + cleanup complete)');
  assert.doesNotMatch(content, /child\.on\(\s*['"]exit['"]/, 'delegate must not resolve on exit before stdio drains');
});
