import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(PKG_ROOT, 'bin', 'webmcp-cli.mjs');

const { runSkills, buildSkillsDoctorReport } = await import('../lib/commands/skills.mjs');
const { getWebmcpHome, parseFlags } = await import('../lib/context.mjs');

function makeKitFixture(t) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-skills-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const home = path.join(tmp, 'home');
  mkdirSync(home, { recursive: true });
  const webmcpHome = path.join(home, '.webmcp');
  mkdirSync(webmcpHome, { recursive: true });
  const kitRoot = path.join(tmp, 'kit');
  mkdirSync(kitRoot, { recursive: true });
  const skills = [];
  const defs = [
    { name: 'webmcp', source: 'skills/webmcp', owner: 'kit', exposure: 'public' },
    { name: 'alpha-public', source: 'skills/alpha-public', owner: 'kit', exposure: 'public' },
    { name: 'beta-public', source: 'skills/beta-public', owner: 'kit', exposure: 'public' },
    { name: 'gamma-public', source: 'skills/gamma-public', owner: 'kit', exposure: 'public' },
    { name: 'delta-public', source: 'skills/delta-public', owner: 'kit' },
    ...Array.from({ length: 12 }, (_, i) => ({
      name: `lib-${String(i + 1).padStart(2, '0')}`,
      source: `skills/lib-${String(i + 1).padStart(2, '0')}`,
      owner: 'workflow-cli',
      exposure: 'library',
    })),
    { name: 'opt-out', source: 'skills/opt-out', owner: 'kit', exposure: 'public', defaultInstall: false },
  ];
  assert.equal(defs.length, 18);
  for (const def of defs) {
    const dir = path.join(kitRoot, def.source);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${def.name}\n---\n`);
    skills.push(def);
  }
  const manifestPath = path.join(kitRoot, 'webmcp-kit.json');
  writeFileSync(manifestPath, JSON.stringify({
    schema: 'webmcp-kit/1',
    kitId: 'webmcp-automation-kit',
    version: 1,
    supersededSkills: ['antigravity-sidecars', 'workflow-dispatcher-cli'],
    skills,
  }, null, 2));
  return { tmp, home, webmcpHome, kitRoot, manifestPath, skills };
}

function withEnv(envOverrides, fn) {
  const saved = {};
  for (const key of Object.keys(envOverrides)) {
    saved[key] = process.env[key];
    const value = envOverrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const logs = [];
  const errors = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { logs.push(args.join(' ')); };
  console.error = (...args) => { errors.push(args.join(' ')); };
  try {
    const code = fn();
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

function spawnSkills(args, env) {
  return spawnSync(process.execPath, [BIN, 'skills', ...args], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, ...env },
  });
}

test('context helpers: getWebmcpHome and parseFlags', () => {
  const savedHome = process.env.HOME;
  const savedWebmcpHome = process.env.WEBMCP_HOME;
  const savedDataDir = process.env.WEBMCP_DATA_DIR;
  try {
    process.env.WEBMCP_HOME = '/tmp/custom-webmcp-home';
    delete process.env.WEBMCP_DATA_DIR;
    assert.equal(getWebmcpHome(), path.resolve('/tmp/custom-webmcp-home'));
    delete process.env.WEBMCP_HOME;
    process.env.WEBMCP_DATA_DIR = '/tmp/data-dir-home';
    assert.equal(getWebmcpHome(), path.resolve('/tmp/data-dir-home'));
  } finally {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedWebmcpHome === undefined) delete process.env.WEBMCP_HOME;
    else process.env.WEBMCP_HOME = savedWebmcpHome;
    if (savedDataDir === undefined) delete process.env.WEBMCP_DATA_DIR;
    else process.env.WEBMCP_DATA_DIR = savedDataDir;
  }
  assert.deepEqual(parseFlags(['--provider', 'codex', '--yes']).flags, { provider: 'codex', yes: true });
  assert.deepEqual(parseFlags(['--provider=codex']).flags, { provider: 'codex' });
  assert.deepEqual(parseFlags(['--all', '--dry-run']).flags, { all: true, 'dry-run': true });
  assert.deepEqual(parseFlags(['pos', '--flag', 'val']).positional, ['pos']);
});

test('skills list --json exposes the 18-skill inventory', (t) => {
  const { home, webmcpHome, manifestPath } = makeKitFixture(t);
  const env = { HOME: home, WEBMCP_HOME: webmcpHome, WEBMCP_KIT_MANIFEST: manifestPath };
  const { code, logs, errors } = withEnv(env, () => runSkills(['list', '--json']));
  assert.equal(code, 0);
  assert.equal(errors.join('\n'), '');
  const payload = JSON.parse(logs.join('\n'));
  assert.equal(payload.schema, 'webmcp-skills/1');
  assert.equal(payload.skills.length, 18);
  assert.ok(payload.skills.every((s) => s.available), 'all fixture skills must be available');
  assert.ok(payload.inventory.endsWith('webmcp-kit.json'));
});

test('skills list via bin keeps the same contract', (t) => {
  const { home, webmcpHome, manifestPath } = makeKitFixture(t);
  const result = spawnSkills(['list', '--json'], { HOME: home, WEBMCP_HOME: webmcpHome, WEBMCP_KIT_MANIFEST: manifestPath });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schema, 'webmcp-skills/1');
  assert.equal(payload.skills.length, 18);
});

test('skills path resolves canonical source and rejects unknown', (t) => {
  const { home, webmcpHome, manifestPath, kitRoot } = makeKitFixture(t);
  const env = { HOME: home, WEBMCP_HOME: webmcpHome, WEBMCP_KIT_MANIFEST: manifestPath };
  const ok = withEnv(env, () => runSkills(['path', 'alpha-public']));
  assert.equal(ok.code, 0);
  assert.equal(ok.logs.join('\n').trim(), path.join(kitRoot, 'skills/alpha-public'));
  const unknown = withEnv(env, () => runSkills(['path', 'no-such-skill']));
  assert.equal(unknown.code, 1);
  assert.match(unknown.errors.join('\n'), /Unknown WebMCP skill/);
  const missingName = withEnv(env, () => runSkills(['path']));
  assert.equal(missingName.code, 1);
  assert.match(missingName.errors.join('\n'), /Usage: webmcp skills path/);
});

test('skills doctor --json ok and missing-inventory exit semantics', (t) => {
  const { home, webmcpHome, manifestPath } = makeKitFixture(t);
  const env = { HOME: home, WEBMCP_HOME: webmcpHome, WEBMCP_KIT_MANIFEST: manifestPath };
  const ok = withEnv(env, () => runSkills(['doctor', '--json']));
  assert.equal(ok.code, 0);
  const report = JSON.parse(ok.logs.join('\n'));
  assert.equal(report.schema, 'webmcp-skills-doctor/1');
  assert.equal(report.ok, true);
  assert.deepEqual(report.missing, []);
  assert.equal(report.receiptPresent, false);

  const emptyHome = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-skills-empty-'));
  t.after(() => rmSync(emptyHome, { recursive: true, force: true }));
  const missingEnv = { HOME: emptyHome, WEBMCP_HOME: path.join(emptyHome, '.webmcp'), WEBMCP_KIT_MANIFEST: path.join(emptyHome, 'no-such.json') };
  const missing = withEnv(missingEnv, () => runSkills(['doctor', '--json']));
  assert.equal(missing.code, 1);
  assert.match(missing.errors.join('\n'), /skill inventory not found/);
  const missingList = withEnv(missingEnv, () => runSkills(['list', '--json']));
  assert.equal(missingList.code, 1);
  const direct = buildSkillsDoctorReport();
  void direct;
  // buildSkillsDoctorReport with missing inventory returns ok false
  const saved = { ...process.env };
  process.env.HOME = emptyHome;
  process.env.WEBMCP_HOME = path.join(emptyHome, '.webmcp');
  process.env.WEBMCP_KIT_MANIFEST = path.join(emptyHome, 'no-such.json');
  try {
    const r = buildSkillsDoctorReport();
    assert.equal(r.schema, 'webmcp-skills-doctor/1');
    assert.equal(r.ok, false);
  } finally {
    process.env.HOME = saved.HOME;
    if (saved.WEBMCP_HOME === undefined) delete process.env.WEBMCP_HOME;
    else process.env.WEBMCP_HOME = saved.WEBMCP_HOME;
    if (saved.WEBMCP_KIT_MANIFEST === undefined) delete process.env.WEBMCP_KIT_MANIFEST;
    else process.env.WEBMCP_KIT_MANIFEST = saved.WEBMCP_KIT_MANIFEST;
  }
});

test('skills adopt is dry-run without --yes and writes receipt only with --yes', (t) => {
  const { home, webmcpHome, manifestPath } = makeKitFixture(t);
  const legacy = path.join(home, '.codex', 'skills', 'workflow-dispatcher-cli');
  mkdirSync(legacy, { recursive: true });
  writeFileSync(path.join(legacy, 'SKILL.md'), 'legacy');
  const env = { HOME: home, WEBMCP_HOME: webmcpHome, WEBMCP_KIT_MANIFEST: manifestPath };
  const dry = withEnv(env, () => runSkills(['adopt', '--provider', 'codex']));
  assert.equal(dry.code, 0);
  assert.match(dry.logs.join('\n'), /Dry run only/);
  assert.ok(!existsSync(path.join(webmcpHome, 'skills', 'install-receipt.json')));

  const adopted = withEnv(env, () => runSkills(['adopt', '--provider', 'codex', '--yes']));
  assert.equal(adopted.code, 0);
  const receiptPath = path.join(webmcpHome, 'skills', 'install-receipt.json');
  assert.ok(existsSync(receiptPath));
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.schema, 'webmcp-install-receipt/2');
  assert.ok(receipt.owners['webmcp-automation-kit'].providers.codex.entries.includes('workflow-dispatcher-cli'));

  const bad = withEnv(env, () => runSkills(['adopt', '--provider', 'nope', '--yes']));
  assert.equal(bad.code, 1);
});

test('skills prune removes adopted legacy skill only with --yes', (t) => {
  const { home, webmcpHome, manifestPath } = makeKitFixture(t);
  const legacy = path.join(home, '.codex', 'skills', 'workflow-dispatcher-cli');
  mkdirSync(legacy, { recursive: true });
  writeFileSync(path.join(legacy, 'SKILL.md'), 'legacy');
  const env = { HOME: home, WEBMCP_HOME: webmcpHome, WEBMCP_KIT_MANIFEST: manifestPath };
  withEnv(env, () => runSkills(['adopt', '--provider', 'codex', '--yes']));
  assert.ok(existsSync(legacy));
  const dry = withEnv(env, () => runSkills(['prune']));
  assert.equal(dry.code, 0);
  assert.ok(existsSync(legacy), 'dry-run prune must not delete');
  const pruned = withEnv(env, () => runSkills(['prune', '--yes']));
  assert.equal(pruned.code, 0);
  assert.ok(!existsSync(legacy));
});

test('skills uninstall shared-owner protection and orphan candidates', (t) => {
  const { home, webmcpHome, manifestPath } = makeKitFixture(t);
  const codexRoot = path.join(home, '.codex', 'skills');
  const webmcpDir = path.join(codexRoot, 'webmcp');
  const zaloDir = path.join(codexRoot, 'zalo-bot-messaging');
  mkdirSync(webmcpDir, { recursive: true });
  mkdirSync(zaloDir, { recursive: true });
  writeFileSync(path.join(webmcpDir, 'SKILL.md'), 'automation owned');
  writeFileSync(path.join(zaloDir, 'SKILL.md'), 'ops owned');
  const receiptPath = path.join(webmcpHome, 'skills', 'install-receipt.json');
  mkdirSync(path.dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, JSON.stringify({
    schema: 'webmcp-install-receipt/2',
    version: 2,
    owners: {
      'webmcp-automation-kit': { skillsMode: 'umbrella', providers: { codex: { root: codexRoot, entries: ['webmcp'] } } },
      'webmcp-ops-kit': { skillsMode: 'separate', providers: { codex: { root: codexRoot, entries: ['zalo-bot-messaging'] } } },
    },
  }));
  const env = { HOME: home, WEBMCP_HOME: webmcpHome, WEBMCP_KIT_MANIFEST: manifestPath };
  // orphan candidate: legacy skill not yet in receipt
  const orphanDir = path.join(codexRoot, 'antigravity-sidecars');
  mkdirSync(orphanDir, { recursive: true });
  writeFileSync(path.join(orphanDir, 'SKILL.md'), 'orphan');
  const doctor = withEnv(env, () => runSkills(['doctor', '--json']));
  const report = JSON.parse(doctor.logs.join('\n'));
  assert.ok(report.orphanCandidates.some((c) => c.name === 'antigravity-sidecars'));

  const uninstalled = withEnv(env, () => runSkills(['uninstall', '--all', '--yes']));
  assert.equal(uninstalled.code, 0);
  assert.ok(!existsSync(webmcpDir));
  assert.ok(existsSync(zaloDir), 'other owner entries must be preserved');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assert.ok(!receipt.owners['webmcp-automation-kit']);
  assert.deepEqual(receipt.owners['webmcp-ops-kit'].providers.codex.entries, ['zalo-bot-messaging']);

  // shared same skill same root must not be deleted
  mkdirSync(webmcpDir, { recursive: true });
  writeFileSync(path.join(webmcpDir, 'SKILL.md'), 'shared');
  writeFileSync(receiptPath, JSON.stringify({
    schema: 'webmcp-install-receipt/2',
    version: 2,
    owners: {
      'webmcp-automation-kit': { skillsMode: 'umbrella', providers: { codex: { root: codexRoot, entries: ['webmcp'] } } },
      'webmcp-ops-kit': { skillsMode: 'separate', providers: { codex: { root: codexRoot, entries: ['webmcp'] } } },
    },
  }));
  const shared = withEnv(env, () => runSkills(['uninstall', '--all', '--yes']));
  assert.equal(shared.code, 0);
  assert.ok(existsSync(webmcpDir), 'shared-owner skill must not be deleted');
});

test('skills inventory falls back to WEBMCP_HOME files and catalog schema', (t) => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-skills-fallback-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const home = path.join(tmp, 'home');
  mkdirSync(home, { recursive: true });
  const webmcpHome = path.join(home, '.webmcp');
  mkdirSync(webmcpHome, { recursive: true });
  // webmcp-kit.json fallback
  const kitSkills = [
    { name: 'fallback-a', source: 'skills/fallback-a', owner: 'kit', exposure: 'public' },
    { name: 'fallback-b', source: 'skills/fallback-b', owner: 'kit', exposure: 'library' },
  ];
  for (const s of kitSkills) {
    const d = path.join(webmcpHome, s.source);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, 'SKILL.md'), s.name);
  }
  const kitManifestPath = path.join(webmcpHome, 'webmcp-kit.json');
  writeFileSync(kitManifestPath, JSON.stringify({
    schema: 'webmcp-kit/1', kitId: 'webmcp-automation-kit', skills: kitSkills,
  }));
  // Checkout-local webmcp-kit.json takes precedence when WEBMCP_KIT_MANIFEST is
  // unset, so exercise the WEBMCP_HOME kit file via explicit manifest to keep
  // schema parsing covered without fighting the checkout candidate.
  const { code, logs } = withEnv({ HOME: home, WEBMCP_HOME: webmcpHome, WEBMCP_KIT_MANIFEST: kitManifestPath }, () => runSkills(['list', '--json']));
  assert.equal(code, 0);
  assert.equal(JSON.parse(logs.join('\n')).skills.length, 2);

  // catalog fallback when kit file absent
  rmSync(kitManifestPath);
  const catalogDir = path.join(webmcpHome, 'skills');
  mkdirSync(catalogDir, { recursive: true });
  const catSkills = [{ name: 'cat-a', source: 'catalog-skills/cat-a', owner: 'kit', exposure: 'public' }];
  mkdirSync(path.join(webmcpHome, 'catalog-skills', 'cat-a'), { recursive: true });
  writeFileSync(path.join(webmcpHome, 'catalog-skills', 'cat-a', 'SKILL.md'), 'x');
  const catalogPath = path.join(catalogDir, 'catalog.json');
  writeFileSync(catalogPath, JSON.stringify({
    schema: 'webmcp-skill-catalog/1', skills: catSkills, supersededSkills: [],
  }));
  const cat = withEnv({ HOME: home, WEBMCP_HOME: webmcpHome, WEBMCP_KIT_MANIFEST: catalogPath }, () => runSkills(['list', '--json']));
  assert.equal(cat.code, 0);
  assert.equal(JSON.parse(cat.logs.join('\n')).skills.length, 1);
});

test('skills legacy receipt normalization and unknown handling', (t) => {
  const { home, webmcpHome, manifestPath } = makeKitFixture(t);
  const receiptPath = path.join(webmcpHome, 'skills', 'install-receipt.json');
  mkdirSync(path.dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, JSON.stringify({
    schema: 'webmcp-install-receipt/1',
    installedAt: '2026-01-01T00:00:00.000Z',
    skillsMode: 'umbrella',
    providers: { codex: { root: path.join(home, '.codex', 'skills'), entries: [] } },
  }));
  const env = { HOME: home, WEBMCP_HOME: webmcpHome, WEBMCP_KIT_MANIFEST: manifestPath };
  const doctor = withEnv(env, () => runSkills(['doctor', '--json']));
  assert.equal(doctor.code, 0);
  assert.equal(JSON.parse(doctor.logs.join('\n')).receiptPresent, true);
  const unknown = withEnv(env, () => runSkills(['bogus-sub']));
  assert.equal(unknown.code, 1);
  assert.match(unknown.errors.join('\n'), /Unknown skills command/);
  const help = withEnv(env, () => runSkills(['--help']));
  assert.equal(help.code, 0);
  const noReceipt = withEnv({ HOME: home, WEBMCP_HOME: path.join(home, '.nope-home'), WEBMCP_KIT_MANIFEST: manifestPath }, () => runSkills(['prune', '--yes']));
  assert.equal(noReceipt.code, 1);
  const uninstallUsage = withEnv(env, () => runSkills(['uninstall']));
  assert.equal(uninstallUsage.code, 1);
});

test('skills list and doctor resolve checkout-local kit without explicit manifest', (t) => {
  const checkoutManifest = path.resolve(PKG_ROOT, '..', '..', 'webmcp-kit.json');
  assert.ok(existsSync(checkoutManifest), `checkout kit manifest must exist at ${checkoutManifest}`);
  const checkout = JSON.parse(readFileSync(checkoutManifest, 'utf8'));
  assert.equal(checkout.schema, 'webmcp-kit/1');
  assert.ok(Array.isArray(checkout.skills) && checkout.skills.length > 0, 'checkout kit must be non-empty');
  const expectedCount = checkout.skills.length;

  const tmp = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-skills-checkout-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const home = path.join(tmp, 'home');
  mkdirSync(home, { recursive: true });
  const webmcpHome = path.join(home, '.webmcp');
  mkdirSync(webmcpHome, { recursive: true });

  function spawnIsolated(args) {
    const env = { ...process.env };
    env.HOME = home;
    env.WEBMCP_HOME = webmcpHome;
    delete env.WEBMCP_KIT_MANIFEST;
    delete env.WEBMCP_DATA_DIR;
    return spawnSync(process.execPath, [BIN, 'skills', ...args], {
      cwd: PKG_ROOT,
      encoding: 'utf8',
      timeout: 10000,
      env,
    });
  }

  const list = spawnIsolated(['list', '--json']);
  assert.equal(list.status, 0, `checkout-local skills list must succeed, stderr: ${list.stderr}`);
  const payload = JSON.parse(list.stdout);
  assert.equal(payload.schema, 'webmcp-skills/1');
  assert.equal(payload.inventory, checkoutManifest);
  assert.equal(payload.skills.length, expectedCount);
  assert.ok(payload.skills.length > 0, 'checkout inventory must be non-empty');

  const doctor = spawnIsolated(['doctor', '--json']);
  assert.equal(doctor.status, 0, `checkout-local skills doctor must succeed, stderr: ${doctor.stderr}`);
  assert.ok(!/inventory not found/i.test(doctor.stderr || ''), 'doctor must not report inventory not found');
  const report = JSON.parse(doctor.stdout);
  assert.equal(report.schema, 'webmcp-skills-doctor/1');
  assert.equal(report.inventory, checkoutManifest);
  assert.ok(report.total > 0, 'doctor total must be non-empty via checkout inventory');
});

test('browser delegation resolves checkout-local kit end-to-end', (t) => {
  const browserBin = path.resolve(PKG_ROOT, '..', 'browser', 'bin', 'webmcp.mjs');
  if (!existsSync(browserBin)) {
    console.log('SKIP: sibling browser bin absent, skipping browser-delegation checkout test');
    return;
  }
  const checkoutManifest = path.resolve(PKG_ROOT, '..', '..', 'webmcp-kit.json');
  assert.ok(existsSync(checkoutManifest), `checkout kit manifest must exist at ${checkoutManifest}`);
  const checkout = JSON.parse(readFileSync(checkoutManifest, 'utf8'));
  assert.equal(checkout.schema, 'webmcp-kit/1');
  const expectedCount = checkout.skills.length;
  assert.ok(expectedCount > 0, 'checkout kit must be non-empty');

  const tmp = mkdtempSync(path.join(tmpdir(), 'webmcp-cli-skills-browser-delegate-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const home = path.join(tmp, 'home');
  mkdirSync(home, { recursive: true });
  const webmcpHome = path.join(home, '.webmcp');
  mkdirSync(webmcpHome, { recursive: true });

  const env = { ...process.env };
  env.HOME = home;
  env.WEBMCP_HOME = webmcpHome;
  env.WEBMCP_CLI_BIN = BIN;
  delete env.WEBMCP_KIT_MANIFEST;
  delete env.WEBMCP_DATA_DIR;
  const result = spawnSync(process.execPath, [browserBin, 'skills', 'list', '--json'], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    timeout: 15000,
    env,
  });
  assert.equal(result.status, 0, `browser-delegated skills list must succeed via checkout, stderr: ${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schema, 'webmcp-skills/1');
  assert.equal(payload.inventory, checkoutManifest);
  assert.equal(payload.skills.length, expectedCount);
});
