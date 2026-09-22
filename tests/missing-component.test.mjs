import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(PKG_ROOT, 'bin', 'webmcp-cli.mjs');
const MISSING_BROWSER = path.join(PKG_ROOT, 'missing-browser-bin.mjs');

function run(args, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, WEBMCP_BROWSER_BIN: MISSING_BROWSER, ...env },
  });
}

test('help and non-browser routes work without a Browser checkout', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);

  const version = run(['--version']);
  assert.equal(version.status, 0, version.stderr);

  // The aggregate owns `project`: its help is local since §7 commit 1.
  const projectHelp = run(['project', '--help']);
  assert.equal(projectHelp.status, 0, projectHelp.stderr);
  assert.match(projectHelp.stdout, /^webmcp project — WebMCP project workspace management/);
});

test('browser routes report a typed actionable error when the Browser entry is missing', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-missing-browser-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  for (const args of [['extension-path'], ['mcp', '--help'], ['gateway', '--help'], ['bootstrap', '--help']]) {
    const result = run(args, { WEBMCP_HOME: home });
    assert.equal(result.status, 1, `${args}: expected failure without Browser`);
    assert.match(result.stderr, /Browser executable not found/, `${args}: ${result.stderr}`);
    assert.match(result.stderr, /WEBMCP_BROWSER_BIN/, `${args} must name the override`);
  }
});

test('CLI-local doctor aggregates a missing Browser as typed JSON instead of a delegate error', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-doctor-missing-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const result = run(['doctor', '--json'], { WEBMCP_HOME: home });
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schema, 'webmcp-cli-doctor/1');
  assert.equal(payload.sections.browser.status, 'missing');
  assert.equal(payload.sections.browser.code, 'MISSING_COMPONENT');
});

test('missing optional components report typed errors without touching other routes', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-missing-component-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const result = run(['ai', '--help'], {
    WEBMCP_HOME: home,
    WEBMCP_AI_BIN: path.join(home, 'no-such-ai-bin.mjs'),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /WebMCP AI CLI not found/);
  assert.match(result.stderr, /WEBMCP_AI_BIN/);
  assert.equal(result.stdout, '', 'missing-component diagnostics must stay on stderr');
});

test('project-kit without an installed kit reports component-not-installed and never replaces project', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-project-kit-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { WEBMCP_HOME: home, WEBMCP_PROJECT_KIT_BIN: path.join(home, 'no-such-kit.mjs') };

  const kit = run(['project-kit', '--help'], env);
  assert.equal(kit.status, 1);
  assert.match(kit.stderr, /Project Kit CLI not found/);
  assert.match(kit.stderr, /WEBMCP_PROJECT_KIT_BIN/);

  const unset = run(['project-kit', '--help'], { WEBMCP_HOME: home, WEBMCP_PROJECT_KIT_BIN: '' });
  if (unset.status !== 0) {
    assert.match(unset.stderr, /Project Kit CLI not found/);
  }
});
