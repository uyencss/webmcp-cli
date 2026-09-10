import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(PKG_ROOT, 'bin', 'webmcp-cli.mjs');

function run(args, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, ...env },
  });
}

test('help flags render the preview route table on stdout', () => {
  for (const args of [[], ['help'], ['--help'], ['-h']]) {
    const result = run(args);
    assert.match(result.stdout, /webmcp-cli/, `${JSON.stringify(args)} must brand the preview`);
    for (const route of ['mcp', 'doctor', 'bootstrap', 'gateway', 'ai', 'project', 'project-kit', 'skills']) {
      assert.match(result.stdout, new RegExp(route), `${JSON.stringify(args)} must list ${route}`);
    }
    assert.match(result.stdout, /CLI-local/, 'help must mark skills/doctor as CLI-local');
    assert.equal(result.stderr, '', `help must not write diagnostics: ${result.stderr}`);
  }
});

test('empty argv exits 1 like the baseline; explicit help exits 0', () => {
  assert.equal(run([]).status, 1);
  assert.equal(run(['help']).status, 0);
  assert.equal(run(['--help']).status, 0);
  assert.equal(run(['-h']).status, 0);
});

test('version is handled locally without a Browser checkout', () => {
  const env = { WEBMCP_BROWSER_BIN: path.join(PKG_ROOT, 'missing-browser-bin.mjs') };
  for (const args of [['version'], ['--version'], ['-v']]) {
    const result = run(args, env);
    assert.equal(result.status, 0, `${args}: ${result.stderr}`);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
    assert.equal(result.stderr, '');
  }
});

test('unknown commands fail closed locally and never delegate', () => {
  const result = run(['definitely-not-a-route', '--json'], {
    WEBMCP_BROWSER_BIN: path.join(PKG_ROOT, 'missing-browser-bin.mjs'),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command: definitely-not-a-route/);
  assert.match(result.stdout, /webmcp-cli/);
});

test('version output matches the package version', async () => {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
  const result = run(['--version']);
  assert.equal(result.stdout.trim(), pkg.version);
});

test('skills and doctor help are handled locally without a Browser checkout', () => {
  const env = { WEBMCP_BROWSER_BIN: path.join(PKG_ROOT, 'missing-browser-bin.mjs') };
  const skillsHelp = run(['skills', '--help'], env);
  assert.equal(skillsHelp.status, 0, skillsHelp.stderr);
  assert.match(skillsHelp.stdout, /WebMCP Skills/);
  const doctorHelp = run(['doctor', '--help'], env);
  assert.equal(doctorHelp.status, 0, doctorHelp.stderr);
  assert.match(doctorHelp.stdout, /WebMCP CLI doctor/);
});
