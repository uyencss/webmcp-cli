import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(PKG_ROOT, 'bin', 'webmcp-cli.mjs');
const CANDIDATE_BROWSER_BIN = path.resolve(PKG_ROOT, '..', 'browser', 'bin', 'webmcp.mjs');
const AUTHORITATIVE_BROWSER_BIN = path.resolve(PKG_ROOT, '..', 'webmcp-browser-kit', 'bin', 'webmcp.mjs');
const BROWSER_BIN =
  [CANDIDATE_BROWSER_BIN, AUTHORITATIVE_BROWSER_BIN].find((candidate) => existsSync(candidate)) ??
  CANDIDATE_BROWSER_BIN;

function run(args, { input = undefined, env = {}, timeout = 15000 } = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    timeout,
    input,
    env: {
      ...process.env,
      WEBMCP_BROWSER_BIN: BROWSER_BIN,
      WEBMCP_NO_AUTOSTART: '1',
      ...env,
    },
  });
}

test('MCP handshake over the preview delegate keeps stdout as pure MCP JSON-RPC', () => {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'webmcp-cli-smoke', version: '0.0.0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ].map((entry) => `${JSON.stringify(entry)}\n`).join('');
  const result = run(['mcp'], { input: requests, timeout: 20000 });
  const lines = result.stdout.split('\n').filter((line) => line.trim().length > 0);
  assert.ok(lines.length >= 2, `expected JSON-RPC responses, got stdout=${result.stdout} stderr=${result.stderr}`);
  const responses = lines.map((line, index) => {
    assert.doesNotThrow(() => JSON.parse(line), `stdout line ${index} is not pure JSON: ${line}`);
    return JSON.parse(line);
  });
  const hello = responses.find((entry) => entry.id === 1);
  assert.ok(hello && hello.result, `initialize must succeed: ${JSON.stringify(hello)}`);
  const tools = responses.find((entry) => entry.id === 2);
  assert.ok(tools && (tools.result || tools.error), `tools/list must answer: ${JSON.stringify(tools)}`);
  if (tools.result) {
    assert.ok(Array.isArray(tools.result.tools), 'tools/list result must carry a tools array');
  }
});
