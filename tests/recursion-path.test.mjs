import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(PKG_ROOT, 'bin', 'webmcp-cli.mjs');
const CANDIDATE_BROWSER_BIN = path.resolve(PKG_ROOT, '..', 'browser', 'bin', 'webmcp.mjs');
const AUTHORITATIVE_BROWSER_BIN = path.resolve(PKG_ROOT, '..', 'webmcp-browser-kit', 'bin', 'webmcp.mjs');
const BROWSER_BIN =
  [CANDIDATE_BROWSER_BIN, AUTHORITATIVE_BROWSER_BIN].find((candidate) => existsSync(candidate)) ??
  null;

function poisonEnv(t) {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-recursion-'));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const poisonDir = path.join(fixtureRoot, 'poison');
  mkdirSync(poisonDir, { recursive: true });
  const marker = path.join(fixtureRoot, 'marker.log');
  for (const name of ['webmcp', 'webmcp-cli', 'node']) {
    const file = path.join(poisonDir, name);
    writeFileSync(file, `#!/bin/sh\necho "poisoned:$0" >> ${marker}\nexit 7\n`);
    chmodSync(file, 0o755);
  }
  const poisonPath = `${poisonDir}${path.delimiter}${process.env.PATH ?? ''}`;
  return { fixtureRoot, marker, poisonPath };
}

function browserBinForTest(t, fixtureRoot) {
  if (BROWSER_BIN) return BROWSER_BIN;
  const stub = path.join(fixtureRoot, 'stub-browser.mjs');
  writeFileSync(stub, [
    '#!/usr/bin/env node',
    'if (process.argv.includes("--help") || process.argv.includes("mcp")) {',
    '  console.log("WebMCP stdio MCP adapter\\n\\nUsage:\\n  webmcp mcp");',
    '  process.exit(0);',
    '}',
    'console.log("{}");',
    '',
  ].join('\n'));
  chmodSync(stub, 0o755);
  return stub;
}

test('delegate never resolves through PATH (no recursion)', (t) => {
  const { fixtureRoot, marker, poisonPath } = poisonEnv(t);
  const aiChild = path.join(fixtureRoot, 'ai-ok.mjs');
  writeFileSync(aiChild, '#!/usr/bin/env node\nconsole.log("ai-ok");\n');
  chmodSync(aiChild, 0o755);
  const browserBin = browserBinForTest(t, fixtureRoot);

  const component = spawnSync(process.execPath, [BIN, 'ai', 'probe-arg'], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, PATH: poisonPath, WEBMCP_AI_BIN: aiChild },
  });
  assert.equal(component.status, 0, `component route must exit 0: stderr=${component.stderr}`);
  assert.match(component.stdout, /ai-ok/, 'component route must reach the explicit child bin');
  assert.ok(!existsSync(marker), 'poison PATH bins must never run for a component route');

  const browser = spawnSync(process.execPath, [BIN, 'mcp', '--help'], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, PATH: poisonPath, WEBMCP_BROWSER_BIN: browserBin },
  });
  assert.equal(browser.status, 0, `browser route must exit 0: stderr=${browser.stderr}`);
  assert.match(browser.stdout, /Usage:|MCP/i, 'browser route must reach the explicit browser bin');
  assert.ok(!existsSync(marker), 'poison PATH bins must never run for a browser route');

  const local = spawnSync(process.execPath, [BIN, 'skills', '--help'], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, PATH: poisonPath },
  });
  assert.equal(local.status, 0, `local route must exit 0: stderr=${local.stderr}`);
  assert.match(local.stdout, /skills/i, 'local route must stay in-process');
  assert.ok(!existsSync(marker), 'poison PATH bins must never run for a local route');
});
