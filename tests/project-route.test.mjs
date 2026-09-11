import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { main } from '../lib/main.mjs';
import { PACKAGE_ROOT } from '../lib/help.mjs';
import {
  PROJECT_LIBRARY_SIBLINGS,
  projectKitNotFoundMessage,
  projectLibraryNotFoundMessage,
  resolveInstalledComponentDir,
  resolveProjectLibraryRoot,
} from '../lib/resolve.mjs';

function fixtureBin(t) {
  const dir = mkdtempSync(path.join('/tmp', 'webmcp-cli-proj-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'fake-bin.mjs');
  writeFileSync(file, '#!/usr/bin/env node\n');
  return { dir, file };
}

function fixtureDir(t) {
  const dir = mkdtempSync(path.join('/tmp', 'webmcp-cli-projlib-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function recorder(exitCode = 0) {
  const calls = [];
  const runChild = async (spec) => {
    calls.push(spec);
    return exitCode;
  };
  return { calls, runChild };
}

async function captureStderr(fn) {
  const errors = [];
  const orig = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };
  try {
    const code = await fn();
    return { code, stderr: errors.join('\n') };
  } finally {
    console.error = orig;
  }
}

// Legacy matrix: every Browser-owned subcommand stays byte-identical.
test('legacy project subcommands delegate to Browser unchanged', async (t) => {
  const { file: browserBin } = fixtureBin(t);
  const { file: kitBin } = fixtureBin(t);
  const libDir = fixtureDir(t);
  const env = { WEBMCP_BROWSER_BIN: browserBin, WEBMCP_PROJECT_KIT_BIN: kitBin, WEBMCP_PROJECT_LIBRARY: libDir };
  const cases = [
    ['new', '--template', 'tpl-a', '--at', '/tmp/dir with spaces'],
    ['new', 'my-id', '--template', 'tpl-a'],
    ['new', 'my-id'],
    ['attach', '--foo', 'bar'],
    ['list', '--json'],
    ['where'],
    ['doctor', '--json'],
    ['charter', 'get'],
    ['guide', 'show'],
    ['schedule', 'list'],
    ['content', 'get'],
    ['policy', 'show'],
    ['init', '--yes'],
    ['init-store', '--json'],
    ['build-index', '--json'],
    ['export-pack', '--out', 'x'],
    ['unknown-subcommand', '--flag'],
  ];
  for (const args of cases) {
    const { calls, runChild } = recorder();
    const code = await main(['project', ...args], { env, runChild });
    assert.equal(code, 0, JSON.stringify(args));
    assert.deepEqual(calls, [{
      label: 'Browser project',
      file: browserBin,
      args: ['project', ...args],
      useNode: true,
    }], JSON.stringify(args));
  }
  // Matrix item 10: legacy template never becomes a Kit create.
  const { calls, runChild } = recorder();
  const code = await main(['project', 'new', '--template', 'tpl-a', '--at', '/tmp/legacy-dir'], { env, runChild });
  assert.equal(code, 0);
  assert.deepEqual(calls[0].args, ['project', 'new', '--template', 'tpl-a', '--at', '/tmp/legacy-dir']);
  assert.equal(calls[0].file, browserBin);
});

test('legacy project --help routes to Browser', async (t) => {
  const { file: browserBin } = fixtureBin(t);
  for (const args of [[], ['--help'], ['-h'], ['help']]) {
    const { calls, runChild } = recorder();
    const env = { WEBMCP_BROWSER_BIN: browserBin };
    const code = await main(['project', ...args], { env, runChild });
    assert.equal(code, 0, JSON.stringify(args));
    assert.deepEqual(calls[0], {
      label: 'Browser project',
      file: browserBin,
      args: ['project', ...args],
      useNode: true,
    }, JSON.stringify(args));
  }
});

test('new --archetype routes to create with template/plugins/id/target preserved', async (t) => {
  const { file: kitBin } = fixtureBin(t);
  const libDir = fixtureDir(t);
  const { file: browserBin } = fixtureBin(t);
  const env = { WEBMCP_BROWSER_BIN: browserBin, WEBMCP_PROJECT_KIT_BIN: kitBin, WEBMCP_PROJECT_LIBRARY: libDir };
  const { calls, runChild } = recorder();
  const code = await main(
    ['project', 'new', 'my-proj', '--archetype', 'arch-a', '--plugin', 'p1', '--plugin', 'p hai', '--name', 'Tên Dự Án', '--json'],
    { env, runChild },
  );
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].label, 'Project Kit CLI');
  assert.equal(calls[0].file, kitBin);
  assert.equal(calls[0].useNode, true);
  const argv = calls[0].args;
  assert.equal(argv[0], 'create');
  assert.deepEqual(argv.slice(0, 5), ['create', '--library', libDir, '--id', 'my-proj']);
  const ti = argv.indexOf('--template');
  assert.ok(ti !== -1);
  assert.equal(argv[ti + 1], 'arch-a');
  const pi = argv.indexOf('--plugins');
  assert.ok(pi !== -1);
  assert.equal(argv[pi + 1], 'p1,p hai');
  const tgt = argv.indexOf('--target');
  assert.ok(tgt !== -1);
  assert.equal(argv[tgt + 1], path.resolve(process.cwd(), 'my-proj'));
  const ni = argv.indexOf('--name');
  assert.equal(argv[ni + 1], 'Tên Dự Án');
  assert.ok(argv.includes('--json'));
  // No leftover --archetype/--plugin/--dry-run.
  assert.ok(!argv.includes('--archetype'));
  assert.ok(!argv.includes('--plugin'));
  assert.ok(!argv.includes('--dry-run'));
});

test('new --archetype with --at rewrites to --target; --dry-run selects preview', async (t) => {
  const { file: kitBin } = fixtureBin(t);
  const libDir = fixtureDir(t);
  const env = { WEBMCP_PROJECT_KIT_BIN: kitBin, WEBMCP_PROJECT_LIBRARY: libDir };
  const { calls, runChild } = recorder();
  const code = await main(['project', 'new', 'p1', '--archetype', 'a', '--at', '/tmp/custom dir', '--dry-run', '--json'], { env, runChild });
  assert.equal(code, 0);
  const argv = calls[0].args;
  assert.equal(argv[0], 'preview');
  assert.ok(!argv.includes('--dry-run'));
  assert.ok(!argv.includes('--at'));
  const ti = argv.indexOf('--target');
  assert.equal(argv[ti + 1], '/tmp/custom dir');
  // Equals forms.
  const { calls: calls2, runChild: rc2 } = recorder();
  await main(['project', 'new', 'p2', '--archetype=a2', '--at=/tmp/eq dir'], { env, runChild: rc2 });
  const argv2 = calls2[0].args;
  assert.equal(argv2[0], 'create');
  assert.ok(argv2.includes('--template'));
  assert.equal(argv2[argv2.indexOf('--template') + 1], 'a2');
  assert.equal(argv2[argv2.indexOf('--target') + 1], '/tmp/eq dir');
});

test('new --archetype plus --template is rejected before spawn', async (t) => {
  const { file: kitBin } = fixtureBin(t);
  const libDir = fixtureDir(t);
  const { file: browserBin } = fixtureBin(t);
  const env = { WEBMCP_BROWSER_BIN: browserBin, WEBMCP_PROJECT_KIT_BIN: kitBin, WEBMCP_PROJECT_LIBRARY: libDir };
  const runChild = async () => { throw new Error('must not spawn on conflict'); };
  for (const args of [
    ['project', 'new', 'x', '--archetype', 'a', '--template', 't'],
    ['project', 'new', 'x', '--archetype=a', '--template=t'],
    ['project', 'new', 'x', '--archetype', 'a', '--template=t'],
  ]) {
    const { code, stderr } = await captureStderr(() => main(args, { env, runChild }));
    assert.equal(code, 2, JSON.stringify(args));
    assert.match(stderr, /--archetype and --template/);
  }
});

test('plugin list/add/update/remove map to exact Kit argv', async (t) => {
  const { file: kitBin } = fixtureBin(t);
  const libDir = fixtureDir(t);
  const env = { WEBMCP_PROJECT_KIT_BIN: kitBin, WEBMCP_PROJECT_LIBRARY: libDir };
  async function run(args) {
    const { calls, runChild } = recorder();
    const code = await main(['project', ...args], { env, runChild });
    assert.equal(code, 0, JSON.stringify(args));
    return calls[0];
  }
  assert.deepEqual((await run(['plugin', 'list', '--target', '/tmp/proj', '--json'])).args,
    ['readback', '--target', '/tmp/proj', '--json']);
  // -t canonicalizes.
  assert.deepEqual((await run(['plugin', 'list', '-t', '/tmp/proj'])).args,
    ['readback', '--target', '/tmp/proj']);
  assert.deepEqual((await run(['plugin', 'add', 'plug-a', '--target', '/tmp/proj', '--yes'])).args,
    ['add', '--library', libDir, '--target', '/tmp/proj', '--plugin', 'plug-a', '--yes']);
  assert.deepEqual((await run(['plugin', 'update', 'plug-a', '--target', '/tmp/proj', '--allow-downgrade'])).args,
    ['update', '--library', libDir, '--target', '/tmp/proj', '--plugin', 'plug-a', '--allow-downgrade']);
  assert.deepEqual((await run(['plugin', 'remove', 'plug-a', '--target', '/tmp/proj', '--yes'])).args,
    ['remove', '--target', '/tmp/proj', '--plugin', 'plug-a', '--yes']);
  // Target-first order canonicalizes identically.
  assert.deepEqual((await run(['plugin', 'add', '--target', '/tmp/proj', 'plug-a', '--yes'])).args,
    ['add', '--library', libDir, '--target', '/tmp/proj', '--plugin', 'plug-a', '--yes']);
});

test('repair and inspect map to repair/readback', async (t) => {
  const { file: kitBin } = fixtureBin(t);
  const libDir = fixtureDir(t);
  const env = { WEBMCP_PROJECT_KIT_BIN: kitBin, WEBMCP_PROJECT_LIBRARY: libDir };
  const { calls, runChild } = recorder();
  assert.equal(await main(['project', 'repair', '--block', 'b1', '--target', '/tmp/p', '--yes'], { env, runChild }), 0);
  assert.deepEqual(calls[0].args, ['repair', '--block', 'b1', '--target', '/tmp/p', '--yes']);
  const { calls: c2, runChild: r2 } = recorder();
  assert.equal(await main(['project', 'inspect', 'my-proj', '--json'], { env, runChild: r2 }), 0);
  assert.deepEqual(c2[0].args, ['readback', '--target', 'my-proj', '--json']);
});

test('missing target/action/id are usage errors with no spawn', async (t) => {
  const { file: kitBin } = fixtureBin(t);
  const libDir = fixtureDir(t);
  const env = { WEBMCP_PROJECT_KIT_BIN: kitBin, WEBMCP_PROJECT_LIBRARY: libDir };
  const runChild = async () => { throw new Error('must not spawn'); };
  const cases = [
    ['project', 'plugin', 'list', '--json'],
    ['project', 'plugin', 'add', '--target', '/tmp/p'],
    ['project', 'plugin', 'remove', '--target', '/tmp/p'],
    ['project', 'plugin', 'frobnicate', '--target', '/tmp/p'],
    ['project', 'plugin'],
    ['project', 'inspect'],
    ['project', 'new', '--archetype'],
  ];
  for (const args of cases) {
    const { code } = await captureStderr(() => main(args, { env, runChild }));
    assert.equal(code, 2, JSON.stringify(args));
  }
});

test('missing Kit bin fails with typed message and no spawn', async (t) => {
  const missing = path.join(tmpdir(), `no-kit-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
  const libDir = fixtureDir(t);
  const env = { WEBMCP_PROJECT_KIT_BIN: missing, WEBMCP_PROJECT_LIBRARY: libDir };
  const runChild = async () => { throw new Error('must not spawn'); };
  const { code, stderr } = await captureStderr(() => main(['project', 'new', 'x', '--archetype', 'a'], { env, runChild }));
  assert.equal(code, 1);
  assert.equal(stderr.trim(), projectKitNotFoundMessage({ env }).trim());
});

test('missing library for create/add/update fails with typed message and no spawn', async (t) => {
  const { file: kitBin } = fixtureBin(t);
  const missingLib = path.join(tmpdir(), `no-lib-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const env = { WEBMCP_PROJECT_KIT_BIN: kitBin, WEBMCP_PROJECT_LIBRARY: missingLib };
  const runChild = async () => { throw new Error('must not spawn'); };
  for (const args of [
    ['project', 'new', 'x', '--archetype', 'a'],
    ['project', 'plugin', 'add', 'p', '--target', '/tmp/p'],
    ['project', 'plugin', 'update', 'p', '--target', '/tmp/p'],
  ]) {
    const { code, stderr } = await captureStderr(() => main(args, { env, runChild }));
    assert.equal(code, 1, JSON.stringify(args));
    assert.equal(stderr.trim(), projectLibraryNotFoundMessage({ env }).trim());
  }
  // remove/list/repair/inspect do not need the library.
  const { calls, runChild: rc } = recorder();
  assert.equal(await main(['project', 'plugin', 'remove', 'p', '--target', '/tmp/p'], { env, runChild: rc }), 0);
  assert.equal(calls.length, 1);
});

test('-- and JSON values are preserved byte-for-byte', async (t) => {
  const { file: kitBin } = fixtureBin(t);
  const libDir = fixtureDir(t);
  const env = { WEBMCP_PROJECT_KIT_BIN: kitBin, WEBMCP_PROJECT_LIBRARY: libDir };
  const jsonVal = 'p={"a":1,"b":[1,2]}';
  const { calls, runChild } = recorder();
  await main(['project', 'new', 'my-proj', '--archetype', 'a', '--plugin-config', jsonVal, '--', '--not-a-flag', 'p hai'], { env, runChild });
  const argv = calls[0].args;
  assert.ok(argv.includes('--plugin-config'));
  assert.equal(argv[argv.indexOf('--plugin-config') + 1], jsonVal);
  assert.deepEqual(argv.slice(-3), ['--', '--not-a-flag', 'p hai']);
  const { calls: c2, runChild: r2 } = recorder();
  await main(['project', 'plugin', 'add', 'plug-a', '--target', '/tmp/p', '--plugin-config', jsonVal, '--', '--x'], { env, runChild: r2 });
  const argv2 = c2[0].args;
  assert.equal(argv2[argv2.indexOf('--plugin-config') + 1], jsonVal);
  assert.deepEqual(argv2.slice(-2), ['--', '--x']);
});

test('project-kit alias warns on stderr and still delegates', async (t) => {
  const { file: kitBin } = fixtureBin(t);
  const { calls, runChild } = recorder();
  const { code, stderr } = await captureStderr(() => main(['project-kit', 'plan'], { env: { WEBMCP_PROJECT_KIT_BIN: kitBin }, runChild }));
  assert.equal(code, 0);
  assert.equal(stderr.trim(), `webmcp: warning: 'project-kit' is a deprecated alias and will be removed after one release; use 'webmcp project …' instead.`);
  assert.deepEqual(calls[0].args, ['plan']);
});

test('resolveProjectLibraryRoot honours override, sibling and installed payload', async (t) => {
  // Dev sibling exists in this checkout.
  const dev = resolveProjectLibraryRoot({ env: {} });
  assert.ok(dev);
  assert.ok(existsSync(dev));
  assert.deepEqual(PROJECT_LIBRARY_SIBLINGS, ['../../../webmcp-project-library', '../webmcp-project-library']);
  // Override wins via cwd-relative resolve.
  const dir = fixtureDir(t);
  const target = path.join(dir, 'custom lib');
  mkdirSync(target, { recursive: true });
  assert.equal(resolveProjectLibraryRoot({ env: { WEBMCP_PROJECT_LIBRARY: target }, cwd: '/' }), target);
  const rel = resolveProjectLibraryRoot({ env: { WEBMCP_PROJECT_LIBRARY: 'rel-lib' }, cwd: dir });
  assert.equal(rel, path.resolve(dir, 'rel-lib'));
  // Installed payload dir.
  const root = mkdtempSync(path.join(tmpdir(), 'webmcp-lib-installed-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'payload', 'webmcp-project-library'), { recursive: true });
  const manifestPath = path.join(root, 'release.json');
  writeFileSync(manifestPath, JSON.stringify({
    schema: 'webmcp-runtime-release/2',
    components: [{ id: 'webmcp-project-library', version: '0.0.0-test', publicBins: {} }],
  }));
  const env = { WEBMCP_RUNTIME_MANIFEST: manifestPath };
  const resolved = resolveProjectLibraryRoot({ env, cwd: '/tmp' });
  assert.equal(resolved, path.join(root, 'payload', 'webmcp-project-library'));
  // Messages.
  assert.match(projectLibraryNotFoundMessage({ env: {} }), /WEBMCP_PROJECT_LIBRARY/);
  assert.match(projectLibraryNotFoundMessage({ env }), /webmcp-project-library/);
  assert.match(projectLibraryNotFoundMessage({ env }), /installed mode/);
});

test('resolveInstalledComponentDir contains escapes and requires a directory', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'webmcp-compdir-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'payload', 'webmcp-project-library'), { recursive: true });
  const outside = mkdtempSync(path.join(tmpdir(), 'webmcp-compdir-out-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(path.join(outside, 'evil.mjs'), 'x');
  const linkPath = path.join(root, 'payload', 'webmcp-project-library', 'link-out');
  try {
    symlinkSync(outside, linkPath, 'dir');
  } catch {
    t.skip('symlink not permitted');
    return;
  }
  const manifestPath = path.join(root, 'release.json');
  writeFileSync(manifestPath, JSON.stringify({ schema: 'webmcp-runtime-release/2', components: [{ id: 'webmcp-project-library' }] }));
  const env = { WEBMCP_RUNTIME_MANIFEST: manifestPath };
  const ok = resolveInstalledComponentDir('webmcp-project-library', env, '/tmp');
  assert.equal(ok, path.join(root, 'payload', 'webmcp-project-library'));
  assert.equal(resolveInstalledComponentDir('no-such', env, '/tmp'), null);
  assert.equal(resolveInstalledComponentDir('../evil', env, '/tmp'), null);
  assert.equal(resolveInstalledComponentDir('', env, '/tmp'), null);
  // File (not dir) is rejected.
  const root2 = mkdtempSync(path.join(tmpdir(), 'webmcp-compdir2-'));
  t.after(() => rmSync(root2, { recursive: true, force: true }));
  mkdirSync(path.join(root2, 'payload'), { recursive: true });
  writeFileSync(path.join(root2, 'payload', 'webmcp-project-library'), 'file-not-dir');
  const manifest2 = path.join(root2, 'release.json');
  writeFileSync(manifest2, JSON.stringify({ schema: 'webmcp-runtime-release/2', components: [{ id: 'webmcp-project-library' }] }));
  assert.equal(resolveInstalledComponentDir('webmcp-project-library', { WEBMCP_RUNTIME_MANIFEST: manifest2 }, '/tmp'), null);
});
