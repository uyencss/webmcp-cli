import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(PKG_ROOT, 'bin', 'webmcp-cli.mjs');
// Mirror candidate resolution order from lib/resolve.mjs BROWSER_SIBLINGS.
const CANDIDATE_BROWSER_BIN = path.resolve(PKG_ROOT, '..', 'browser', 'bin', 'webmcp-browser.mjs');
const BROWSER_BIN =
  [
    CANDIDATE_BROWSER_BIN,
    path.resolve(PKG_ROOT, '..', 'webmcp-browser-kit', 'bin', 'webmcp-browser.mjs'),
    path.resolve(PKG_ROOT, '..', 'browser', 'bin', 'webmcp.mjs'),
    path.resolve(PKG_ROOT, '..', 'webmcp-browser-kit', 'bin', 'webmcp.mjs'),
  ].find((candidate) => existsSync(candidate)) ?? CANDIDATE_BROWSER_BIN;

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

test('MCP shutdown closes stdin cleanly with exit 0 and banner-free stdout', () => {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'webmcp-cli-smoke', version: '0.0.0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ].map((entry) => `${JSON.stringify(entry)}\n`).join('');
  const result = run(['mcp'], { input: requests, timeout: 20000 });
  assert.equal(result.error, undefined, `MCP run must not time out: ${String(result.error)}`);
  assert.equal(result.signal, null, `MCP run must not be killed by a signal: ${result.signal}`);
  assert.equal(result.status, 0, `MCP must exit 0 after stdin closes: status=${result.status} stderr=${result.stderr}`);
  const lines = result.stdout.split('\n').filter((line) => line.trim().length > 0);
  assert.ok(lines.length >= 2, `expected JSON-RPC responses, got stdout=${result.stdout} stderr=${result.stderr}`);
  for (const [index, line] of lines.entries()) {
    assert.doesNotThrow(() => JSON.parse(line), `stdout line ${index} is not pure JSON: ${line}`);
    const parsed = JSON.parse(line);
    assert.equal(parsed.jsonrpc, '2.0', `stdout line ${index} must stay JSON-RPC: ${line}`);
  }
  assert.doesNotMatch(result.stdout, /Usage:|WebMCP CLI|banner/i, 'stdout must never carry banners');
});
