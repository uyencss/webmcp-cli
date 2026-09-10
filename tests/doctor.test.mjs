import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(PKG_ROOT, 'bin', 'webmcp-cli.mjs');

const { collectCliDoctorReport, runDoctor } = await import('../lib/commands/doctor.mjs');

function makeKit(t, home, webmcpHome, names = ['doc-a', 'doc-b']) {
  const kitRoot = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-doctor-kit-'));
  t.after(() => rmSync(kitRoot, { recursive: true, force: true }));
  const skills = names.map((name) => ({ name, source: `skills/${name}`, owner: 'kit', exposure: 'public' }));
  for (const s of skills) {
    const d = path.join(kitRoot, s.source);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, 'SKILL.md'), s.name);
  }
  const manifest = path.join(kitRoot, 'webmcp-kit.json');
  writeFileSync(manifest, JSON.stringify({ schema: 'webmcp-kit/1', kitId: 'webmcp-automation-kit', skills, supersededSkills: [] }));
  return manifest;
}

function makeBrowserStub(t, { report = null, raw = null, exitCode = 0 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-doctor-stub-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'stub-browser.mjs');
  const payload = raw !== null ? raw : JSON.stringify(report);
  writeFileSync(file, [
    '#!/usr/bin/env node',
    `process.stdout.write(${JSON.stringify(payload)});`,
    `process.exit(${exitCode});`,
    '',
  ].join('\n'));
  chmodSync(file, 0o755);
  return file;
}

async function runDoctorWithEnv(envOverrides, args) {
  const saved = {};
  for (const key of Object.keys(envOverrides)) {
    saved[key] = process.env[key];
    const v = envOverrides[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
  const logs = [];
  const errors = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => { logs.push(a.join(' ')); };
  console.error = (...a) => { errors.push(a.join(' ')); };
  try {
    const code = await runDoctor(args);
    return { code, logs, errors };
  } finally {
    console.log = origLog;
    console.error = origErr;
    for (const key of Object.keys(envOverrides)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function spawnDoctor(args, env) {
  return spawnSync(process.execPath, [BIN, 'doctor', ...args], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, ...env },
  });
}

test('aggregate doctor ok embeds browser report verbatim and stays pure JSON', async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-doctor-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const webmcpHome = path.join(home, '.webmcp');
  mkdirSync(webmcpHome, { recursive: true });
  const manifest = makeKit(t, home, webmcpHome);
  const browserReport = { schema: 'webmcp-doctor/1', ok: true, marker: 'stub-ok-123' };
  const stub = makeBrowserStub(t, { report: browserReport, exitCode: 0 });
  const env = { HOME: home, WEBMCP_HOME: webmcpHome, WEBMCP_KIT_MANIFEST: manifest, WEBMCP_BROWSER_BIN: stub };
  const { code, logs, errors } = await runDoctorWithEnv(env, ['--json']);
  assert.equal(code, 0);
  assert.equal(errors.join('\n'), '');
  const payload = JSON.parse(logs.join('\n'));
  assert.equal(payload.schema, 'webmcp-cli-doctor/1');
  assert.equal(payload.ok, true);
  assert.equal(payload.sections.cli.status, 'ok');
  assert.match(payload.sections.cli.version, /^\d+\.\d+\.\d+/);
  assert.ok(payload.sections.cli.node);
  assert.equal(payload.sections.browser.status, 'ok');
  assert.deepEqual(payload.sections.browser.report, browserReport);
  assert.equal(payload.sections.skills.schema, 'webmcp-skills-doctor/1');
  assert.equal(payload.sections.skills.ok, true);
  assert.ok(payload.components.workflow);
  assert.ok(payload.components['project-kit']);
  for (const key of ['workflow', 'ai', 'site', 'automation', 'vault', 'mobile', 'captcha', 'project-kit']) {
    assert.ok(payload.components[key], `missing component ${key}`);
    assert.ok(['available', 'missing'].includes(payload.components[key].status));
  }

  const spawned = spawnDoctor(['--json'], env);
  assert.equal(spawned.status, 0, spawned.stderr);
  assert.equal(spawned.stderr, '');
  const spawnedPayload = JSON.parse(spawned.stdout);
  assert.equal(spawnedPayload.schema, 'webmcp-cli-doctor/1');
  assert.equal(spawnedPayload.ok, true);
  assert.deepEqual(spawnedPayload.sections.browser.report, browserReport);
});

test('browser non-zero exit with valid JSON still embeds report; ok false propagates', async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-doctor-fail-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const webmcpHome = path.join(home, '.webmcp');
  mkdirSync(webmcpHome, { recursive: true });
  const manifest = makeKit(t, home, webmcpHome);
  const browserReport = { schema: 'webmcp-doctor/1', ok: false, error: 'gateway down' };
  const stub = makeBrowserStub(t, { report: browserReport, exitCode: 1 });
  const env = { HOME: home, WEBMCP_HOME: webmcpHome, WEBMCP_KIT_MANIFEST: manifest, WEBMCP_BROWSER_BIN: stub };
  const { code, logs } = await runDoctorWithEnv(env, ['--json']);
  assert.equal(code, 1);
  const payload = JSON.parse(logs.join('\n'));
  assert.equal(payload.ok, false);
  assert.equal(payload.sections.browser.status, 'ok');
  assert.deepEqual(payload.sections.browser.report, browserReport);
});

test('missing browser bridge yields MISSING_COMPONENT and exit 1', async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-doctor-missing-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const webmcpHome = path.join(home, '.webmcp');
  mkdirSync(webmcpHome, { recursive: true });
  const manifest = makeKit(t, home, webmcpHome);
  const env = { HOME: home, WEBMCP_HOME: webmcpHome, WEBMCP_KIT_MANIFEST: manifest, WEBMCP_BROWSER_BIN: path.join(home, 'no-such-browser.mjs') };
  const { code, logs } = await runDoctorWithEnv(env, ['--json']);
  assert.equal(code, 1);
  const payload = JSON.parse(logs.join('\n'));
  assert.equal(payload.ok, false);
  assert.equal(payload.sections.browser.status, 'missing');
  assert.equal(payload.sections.browser.code, 'MISSING_COMPONENT');
  assert.equal(payload.sections.browser.component, 'browser');

  const spawned = spawnDoctor(['--json'], env);
  assert.equal(spawned.status, 1);
  const spawnedPayload = JSON.parse(spawned.stdout);
  assert.equal(spawnedPayload.sections.browser.code, 'MISSING_COMPONENT');
});

test('unparseable browser output yields BROWSER_DOCTOR_INVALID', async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-doctor-invalid-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const webmcpHome = path.join(home, '.webmcp');
  mkdirSync(webmcpHome, { recursive: true });
  const manifest = makeKit(t, home, webmcpHome);
  const stub = makeBrowserStub(t, { raw: 'not-json-output', exitCode: 0 });
  const env = { HOME: home, WEBMCP_HOME: webmcpHome, WEBMCP_KIT_MANIFEST: manifest, WEBMCP_BROWSER_BIN: stub };
  const { code, logs } = await runDoctorWithEnv(env, ['--json']);
  assert.equal(code, 1);
  const payload = JSON.parse(logs.join('\n'));
  assert.equal(payload.sections.browser.status, 'error');
  assert.equal(payload.sections.browser.code, 'BROWSER_DOCTOR_INVALID');
  assert.equal(payload.sections.browser.component, 'browser');
});

test('skills failure makes aggregate ok false; components do not affect ok', async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-doctor-skillsfail-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const webmcpHome = path.join(home, '.webmcp');
  mkdirSync(webmcpHome, { recursive: true });
  const emptyManifest = path.join(home, 'no-such-manifest.json');
  const browserReport = { schema: 'webmcp-doctor/1', ok: true };
  const stub = makeBrowserStub(t, { report: browserReport, exitCode: 0 });
  const env = { HOME: home, WEBMCP_HOME: webmcpHome, WEBMCP_KIT_MANIFEST: emptyManifest, WEBMCP_BROWSER_BIN: stub };
  const { code, logs } = await runDoctorWithEnv(env, ['--json']);
  assert.equal(code, 1);
  const payload = JSON.parse(logs.join('\n'));
  assert.equal(payload.sections.skills.ok, false);
  assert.equal(payload.ok, false);
  // components present but do not flip ok to true
  assert.ok(payload.components);
});

test('collectCliDoctorReport returns typed sections and human output', async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-doctor-collect-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const webmcpHome = path.join(home, '.webmcp');
  mkdirSync(webmcpHome, { recursive: true });
  const manifest = makeKit(t, home, webmcpHome, ['only-a']);
  const stub = makeBrowserStub(t, { report: { schema: 'webmcp-doctor/1', ok: true }, exitCode: 0 });
  const saved = { HOME: process.env.HOME, WEBMCP_HOME: process.env.WEBMCP_HOME, WEBMCP_KIT_MANIFEST: process.env.WEBMCP_KIT_MANIFEST, WEBMCP_BROWSER_BIN: process.env.WEBMCP_BROWSER_BIN };
  process.env.HOME = home;
  process.env.WEBMCP_HOME = webmcpHome;
  process.env.WEBMCP_KIT_MANIFEST = manifest;
  process.env.WEBMCP_BROWSER_BIN = stub;
  try {
    const report = await collectCliDoctorReport();
    assert.equal(report.schema, 'webmcp-cli-doctor/1');
    assert.equal(typeof report.ok, 'boolean');
    assert.equal(report.sections.cli.status, 'ok');
    const human = await runDoctorWithEnv({ HOME: home, WEBMCP_HOME: webmcpHome, WEBMCP_KIT_MANIFEST: manifest, WEBMCP_BROWSER_BIN: stub }, []);
    assert.equal(human.code, 0);
    assert.match(human.logs.join('\n'), /WebMCP CLI doctor/);
  } finally {
    if (saved.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = saved.HOME;
    if (saved.WEBMCP_HOME === undefined) delete process.env.WEBMCP_HOME;
    else process.env.WEBMCP_HOME = saved.WEBMCP_HOME;
    if (saved.WEBMCP_KIT_MANIFEST === undefined) delete process.env.WEBMCP_KIT_MANIFEST;
    else process.env.WEBMCP_KIT_MANIFEST = saved.WEBMCP_KIT_MANIFEST;
    if (saved.WEBMCP_BROWSER_BIN === undefined) delete process.env.WEBMCP_BROWSER_BIN;
    else process.env.WEBMCP_BROWSER_BIN = saved.WEBMCP_BROWSER_BIN;
  }
});
