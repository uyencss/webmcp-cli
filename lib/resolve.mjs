import process from 'node:process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { PACKAGE_ROOT } from './help.mjs';

// Narrow component lookup for the preview dispatcher. Resolution order per
// component is explicit: environment override, monorepo sibling checkout,
// then public package metadata. Nothing here imports the Browser CLI tree.
export const COMPONENTS = {
  workflow: {
    label: 'Workflow dispatcher CLI',
    installHint: 'Install @gyga-browser/webmcp-workflow, run from the webmcp-automation-kit checkout, or set WEBMCP_WORKFLOW_DISPATCHER_BIN.',
    envVars: ['WEBMCP_WORKFLOW_DISPATCHER_BIN', 'WORKFLOW_DISPATCHER_BIN'],
    overrideSubpaths: ['bin/webmcp-workflow-cli.js'],
    siblings: ['../webmcp-workflow-cli/bin/webmcp-workflow-cli.js'],
    packages: [
      { name: '@gyga-browser/webmcp-workflow', subpaths: ['bin/webmcp-workflow-cli.js'] },
      { name: 'webmcp-workflow-cli', subpaths: ['bin/webmcp-workflow-cli.js'] },
    ],
  },
  ai: {
    label: 'WebMCP AI CLI',
    installHint: 'Install @gyga-browser/webmcp-ai, run from the webmcp-automation-kit checkout, or set WEBMCP_AI_BIN.',
    envVars: ['WEBMCP_AI_BIN'],
    overrideSubpaths: ['bin/webmcp-ai.mjs', 'bin'],
    siblings: ['../webmcp-ai-cli/bin/webmcp-ai.mjs'],
    packages: [
      { name: '@gyga-browser/webmcp-ai', subpaths: ['bin/webmcp-ai.mjs', 'bin'] },
      { name: 'webmcp-ai-cli', subpaths: ['bin/webmcp-ai.mjs', 'bin'] },
    ],
  },
  site: {
    label: 'WebMCP Site CLI',
    installHint: 'Install @gyga-browser/webmcp-site-store, run from the webmcp-automation-kit checkout, or set WEBMCP_STORE_BIN.',
    envVars: ['WEBMCP_STORE_BIN'],
    overrideSubpaths: ['bin/webmcp-store.mjs'],
    siblings: [
      '../../stores/webmcp-site-store/bin/webmcp-store.mjs',
      '../webmcp-site-store/bin/webmcp-store.mjs',
    ],
    packages: [
      { name: '@gyga-browser/webmcp-site-store', subpaths: ['bin/webmcp-store.mjs'] },
      { name: 'webmcp-site-store', subpaths: ['bin/webmcp-store.mjs'] },
    ],
  },
  automation: {
    label: 'WebMCP Automation Store CLI',
    installHint: 'Install the full WebMCP kit, run from the webmcp-automation-kit checkout, or set WEBMCP_AUTOMATION_BIN.',
    envVars: ['WEBMCP_AUTOMATION_BIN'],
    overrideSubpaths: ['bin/webmcp-automation.mjs'],
    siblings: [
      '../../stores/webmcp-automation-store/bin/webmcp-automation.mjs',
      '../webmcp-automation-store/bin/webmcp-automation.mjs',
    ],
    packages: [
      { name: '@gyga-browser/webmcp-automation-store', subpaths: ['bin/webmcp-automation.mjs'] },
    ],
  },
  vault: {
    label: 'WebMCP vault CLI',
    installHint: 'Install @gyga-browser/webmcp-vault-kit, run from the webmcp-automation-kit checkout, or set WEBMCP_VAULT_BIN.',
    envVars: ['WEBMCP_VAULT_BIN'],
    overrideSubpaths: ['bin/webmcp-vault.mjs', 'bin'],
    siblings: ['../webmcp-vault-kit/bin/webmcp-vault.mjs'],
    packages: [
      { name: '@gyga-browser/webmcp-vault-kit', subpaths: ['bin/webmcp-vault.mjs', 'bin'] },
    ],
  },
  mobile: {
    label: 'WebMCP ADB MCP server',
    installHint: 'Install @gyga-browser/webmcp-adb-kit, run from the webmcp-automation-kit checkout, or set WEBMCP_ADB_MCP_BIN.',
    envVars: ['WEBMCP_ADB_MCP_BIN'],
    overrideSubpaths: ['server/mcp_server.mjs'],
    siblings: ['../webmcp-adb-kit/server/mcp_server.mjs'],
    packages: [
      { name: '@gyga-browser/webmcp-adb-kit', subpaths: ['server/mcp_server.mjs'] },
    ],
  },
  captcha: {
    label: 'WebMCP captcha solver',
    direct: true,
    installHint: 'Run install.sh step 4, or set WEBMCP_CAPTCHA_HOME to a checkout of packages/webmcp-captcha-solver that has a built .venv.',
    envVars: ['WEBMCP_CAPTCHA_BIN'],
    overrideSubpaths: [],
    siblings: [],
    packages: [],
  },
};

export const BROWSER_SIBLINGS = [
  '../browser/bin/webmcp-browser.mjs',
  '../webmcp-browser-kit/bin/webmcp-browser.mjs',
  '../browser/bin/webmcp.mjs',
  '../webmcp-browser-kit/bin/webmcp.mjs',
];

export const BROWSER_PACKAGE = {
  name: '@gyga-browser/webmcp-browser-automation-kit',
  subpaths: ['bin/webmcp-browser.mjs', 'bin/webmcp.mjs'],
};

export const PROJECT_KIT_SIBLINGS = [
  '../project-kit/bin/webmcp-project-kit.mjs',
  '../webmcp-project-kit/bin/webmcp-project-kit.mjs',
];

export const PROJECT_LIBRARY_SIBLINGS = ['../../../webmcp-project-library', '../webmcp-project-library'];

// Installed-mode (CLI2-6) immutable release contract. When the runtime
// wrapper exports WEBMCP_RUNTIME_MANIFEST / WEBMCP_RUNTIME_ROOT, the CLI
// resolves every component strictly from the selected release.json
// (schema webmcp-runtime-release/2): explicit override, then manifest,
// then no fallback. Dev mode (no manifest env) keeps env → sibling →
// package resolution unchanged.
export const INSTALLED_SCHEMA = 'webmcp-runtime-release/2';

export const INSTALLED_COMPONENTS = {
  browser: { componentId: 'webmcp-browser-kit', bins: ['webmcp-browser', 'webmcp'] },
  workflow: { componentId: 'webmcp-workflow-cli', bins: ['webmcp-workflow-cli', 'webmcp-workflow'] },
  ai: { componentId: 'webmcp-ai-cli', bins: ['webmcp-ai'] },
  site: { componentId: 'webmcp-site-store', bins: ['webmcp-store', 'webmcp-site', 'webmcp-store-cli'] },
  automation: { componentId: 'webmcp-automation-store', bins: ['webmcp-automation'] },
  vault: { componentId: 'webmcp-vault-kit', bins: ['webmcp-vault'] },
  mobile: { componentId: 'webmcp-adb-kit', bins: ['webmcp-adb-mcp'] },
  projectKit: { componentId: 'webmcp-project-kit', bins: ['webmcp-project-kit'] },
  projectLibrary: { componentId: 'webmcp-project-library', bins: [] },
  runner: { componentId: 'webmcp-automation-runner', bins: ['webmcp-automation-runner', 'webmcp-agent-entry'] },
};

export const RUNNER_ENV_VARS = ['WEBMCP_RUNNER_BIN', 'WEBMCP_AUTOMATION_RUNNER_BIN'];

const installedManifestCache = new Map();

export function clearInstalledManifestCache() {
  installedManifestCache.clear();
}

export function isInstalledMode(env = process.env) {
  if (!env || typeof env !== 'object') return false;
  return Boolean(env.WEBMCP_RUNTIME_MANIFEST || env.WEBMCP_RELEASE_ROOT || env.WEBMCP_RUNTIME_ROOT);
}

function normalizeInstalledPaths(env, cwd = process.cwd()) {
  const raw = env.WEBMCP_RUNTIME_MANIFEST || env.WEBMCP_RELEASE_ROOT || env.WEBMCP_RUNTIME_ROOT;
  if (!raw) return null;
  const abs = resolve(cwd, raw);
  try {
    const st = statSync(abs);
    if (st.isDirectory()) {
      return { root: abs, manifestPath: resolve(abs, 'release.json') };
    }
    return { root: dirname(abs), manifestPath: abs };
  } catch {
    if (abs.endsWith('.json')) {
      return { root: dirname(abs), manifestPath: abs };
    }
    return { root: abs, manifestPath: resolve(abs, 'release.json') };
  }
}

function loadInstalledManifest(manifestPath) {
  if (installedManifestCache.has(manifestPath)) {
    return installedManifestCache.get(manifestPath);
  }
  let result;
  try {
    const raw = readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.schema !== INSTALLED_SCHEMA || !Array.isArray(parsed.components)) {
      result = { ok: false, manifest: null, error: 'invalid schema' };
    } else {
      result = { ok: true, manifest: parsed, error: null };
    }
  } catch (error) {
    result = { ok: false, manifest: null, error: error && error.message ? error.message : String(error) };
  }
  installedManifestCache.set(manifestPath, result);
  return result;
}

function findInstalledComponent(manifest, componentId) {
  if (!manifest || !Array.isArray(manifest.components)) return null;
  return manifest.components.find((entry) => entry && entry.id === componentId) || null;
}

function getPublicBinTarget(entry, binName) {
  if (!entry || typeof entry !== 'object') return null;
  for (const key of ['publicBins', 'bins']) {
    const map = entry[key];
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      const value = map[binName];
      if (typeof value === 'string' && value.length > 0) return value;
      if (value && typeof value === 'object') {
        if (typeof value.target === 'string' && value.target.length > 0) return value.target;
        if (typeof value.path === 'string' && value.path.length > 0) return value.path;
      }
    }
    if (Array.isArray(map)) {
      for (const item of map) {
        if (typeof item === 'string' && item === binName) return binName;
        if (item && typeof item === 'object' && item.name === binName) {
          if (typeof item.target === 'string' && item.target.length > 0) return item.target;
          if (typeof item.path === 'string' && item.path.length > 0) return item.path;
          return binName;
        }
      }
    }
  }
  return null;
}

function resolveInstalledPayload(root, componentId, target) {
  if (typeof target !== 'string' || target.length === 0) return null;
  if (isAbsolute(target)) return null;
  // Reject any `.` / `..` / empty (`//`) segment before resolution so
  // `../sibling`, `../../release.json`, `./x`, `a/./b` and `a//b` never
  // reach the filesystem even when the lexical destination exists.
  for (const segment of target.split(/[\\/]/)) {
    if (segment === '' || segment === '.' || segment === '..') return null;
  }
  // Anchor containment at the component payload dir, not the release root.
  const componentDir = resolve(root, 'payload', componentId);
  const candidate = resolve(componentDir, target);
  const rel = relative(componentDir, candidate);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  if (!existsSync(candidate)) return null;
  // Reject symlink escapes: the real path must stay inside the real
  // component payload dir. Missing dir/candidate → null.
  let realDir;
  let realCandidate;
  try {
    realDir = realpathSync(componentDir);
  } catch {
    return null;
  }
  try {
    realCandidate = realpathSync(candidate);
  } catch {
    return null;
  }
  const realRel = relative(realDir, realCandidate);
  if (realRel === '' || realRel.startsWith('..') || isAbsolute(realRel)) return null;
  return candidate;
}

function resolveFromInstalledManifest(routeKey, env, cwd) {
  const mapping = INSTALLED_COMPONENTS[routeKey];
  if (!mapping) return null;
  const normalized = normalizeInstalledPaths(env, cwd);
  if (!normalized) return null;
  const { root, manifestPath } = normalized;
  const loaded = loadInstalledManifest(manifestPath);
  if (!loaded.ok) return null;
  const entry = findInstalledComponent(loaded.manifest, mapping.componentId);
  if (!entry) return null;
  for (const bin of mapping.bins) {
    const target = getPublicBinTarget(entry, bin);
    if (!target) continue;
    const resolved = resolveInstalledPayload(root, mapping.componentId, target);
    if (resolved) return resolved;
  }
  return null;
}

function installedManifestState(env, cwd) {
  const normalized = normalizeInstalledPaths(env, cwd);
  if (!normalized) return { installed: false };
  const loaded = loadInstalledManifest(normalized.manifestPath);
  return { installed: true, ...normalized, ...loaded };
}

function messageEnv(options) {
  if (!options || typeof options !== 'object') return process.env;
  if (options.env && typeof options.env === 'object') return options.env;
  const keys = Object.keys(options);
  if (keys.some((key) => key.startsWith('WEBMCP_'))) return options;
  if (keys.length === 0) return process.env;
  return process.env;
}

function messageCwd(options) {
  if (options && typeof options === 'object' && typeof options.cwd === 'string') return options.cwd;
  if (options && typeof options === 'object' && options.env && typeof options.env === 'object' && typeof options.env.WEBMCP_CWD === 'string') {
    return options.env.WEBMCP_CWD;
  }
  try {
    return process.cwd();
  } catch {
    return '/tmp';
  }
}

export function resolvePackageSubpath(packageName, subpaths, packageRoot = PACKAGE_ROOT) {
  const requireFromPackage = createRequire(resolve(packageRoot, 'package.json'));
  for (const subpath of subpaths) {
    try {
      const resolved = requireFromPackage.resolve(`${packageName}/${subpath}`);
      if (existsSync(resolved)) return resolved;
    } catch {
      // Fall through to the package-root join below (some packages restrict
      // subpath exports while still shipping the file).
    }
  }
  let packageDir = null;
  try {
    packageDir = dirname(requireFromPackage.resolve(`${packageName}/package.json`));
  } catch {
    return null;
  }
  for (const subpath of subpaths) {
    const candidate = resolve(packageDir, subpath);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveOverride(override, overrideSubpaths, { cwd, packageRoot }) {
  const overridePath = resolve(cwd, override);
  if (existsSync(overridePath)) return overridePath;
  if (overrideSubpaths.length > 0) {
    const requireFromPackage = createRequire(resolve(packageRoot, 'package.json'));
    for (const subpath of overrideSubpaths) {
      try {
        return requireFromPackage.resolve(`${override}/${subpath}`);
      } catch {
        // Keep the explicit override path below.
      }
    }
  }
  return overridePath;
}

function readOverride(env, envVars) {
  for (const name of envVars) {
    if (env[name]) return env[name];
  }
  return null;
}

export function resolveBrowserBin(options = {}) {
  const { env = process.env, cwd = process.cwd(), packageRoot = PACKAGE_ROOT } = options;
  const override = env.WEBMCP_BROWSER_BIN;
  if (override) {
    return resolveOverride(override, BROWSER_PACKAGE.subpaths, { cwd, packageRoot });
  }
  if (isInstalledMode(env)) {
    return resolveFromInstalledManifest('browser', env, cwd);
  }
  for (const sibling of BROWSER_SIBLINGS) {
    const candidate = resolve(packageRoot, sibling);
    if (existsSync(candidate)) return candidate;
  }
  return resolvePackageSubpath(BROWSER_PACKAGE.name, BROWSER_PACKAGE.subpaths, packageRoot);
}

export function resolveComponentBin(component, options = {}) {
  const { env = process.env, cwd = process.cwd(), packageRoot = PACKAGE_ROOT } = options;
  // Exception: captcha (python runtime) keeps its existing env/home resolution
  // in both dev and installed modes; it never resolves from release.json.
  if (component === 'captcha') return resolveCaptchaBin({ env, cwd, packageRoot });
  if (component === 'runner') return resolveRunnerBin({ env, cwd, packageRoot });
  const spec = COMPONENTS[component];
  if (!spec) return null;
  const override = readOverride(env, spec.envVars);
  if (override) {
    return resolveOverride(override, spec.overrideSubpaths, { cwd, packageRoot });
  }
  if (isInstalledMode(env)) {
    return resolveFromInstalledManifest(component, env, cwd);
  }
  for (const sibling of spec.siblings) {
    const candidate = resolve(packageRoot, sibling);
    if (existsSync(candidate)) return candidate;
  }
  for (const pkg of spec.packages) {
    const resolved = resolvePackageSubpath(pkg.name, pkg.subpaths, packageRoot);
    if (resolved) return resolved;
  }
  return null;
}

export function resolveCaptchaBin({ env = process.env, cwd = process.cwd(), packageRoot = PACKAGE_ROOT } = {}) {
  if (env.WEBMCP_CAPTCHA_BIN) return resolve(cwd, env.WEBMCP_CAPTCHA_BIN);
  const candidates = [];
  if (env.WEBMCP_CAPTCHA_HOME) {
    candidates.push(resolve(env.WEBMCP_CAPTCHA_HOME, '.venv', 'bin', 'captcha-solve'));
  }
  candidates.push(resolve(homedir(), '.webmcp', 'captcha-solver', '.venv', 'bin', 'captcha-solve'));
  candidates.push(resolve(packageRoot, '..', 'webmcp-captcha-solver', '.venv', 'bin', 'captcha-solve'));
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

export function resolveProjectKitBin(options = {}) {
  const { env = process.env, cwd = process.cwd(), packageRoot = PACKAGE_ROOT } = options;
  if (env.WEBMCP_PROJECT_KIT_BIN) return resolve(cwd, env.WEBMCP_PROJECT_KIT_BIN);
  if (isInstalledMode(env)) {
    return resolveFromInstalledManifest('projectKit', env, cwd);
  }
  for (const sibling of PROJECT_KIT_SIBLINGS) {
    const candidate = resolve(packageRoot, sibling);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveRunnerBin(options = {}) {
  const { env = process.env, cwd = process.cwd() } = options;
  const override = readOverride(env, RUNNER_ENV_VARS);
  if (override) return resolve(cwd, override);
  if (isInstalledMode(env)) {
    return resolveFromInstalledManifest('runner', env, cwd);
  }
  return null;
}

export function resolveInstalledComponentDir(componentId, env, cwd) {
  try {
    if (typeof componentId !== 'string' || componentId.length === 0) return null;
    const effectiveEnv = env && typeof env === 'object' ? env : process.env;
    let effectiveCwd = cwd;
    if (typeof effectiveCwd !== 'string') {
      try {
        effectiveCwd = process.cwd();
      } catch {
        effectiveCwd = '/tmp';
      }
    }
    const normalized = normalizeInstalledPaths(effectiveEnv, effectiveCwd);
    if (!normalized) return null;
    const { root, manifestPath } = normalized;
    const loaded = loadInstalledManifest(manifestPath);
    if (!loaded.ok) return null;
    const entry = findInstalledComponent(loaded.manifest, componentId);
    if (!entry) return null;
    const payloadDir = resolve(root, 'payload');
    const componentDir = resolve(payloadDir, componentId);
    let stat;
    try {
      stat = statSync(componentDir);
    } catch {
      return null;
    }
    if (!stat.isDirectory()) return null;
    let realPayload;
    let realComponent;
    try {
      realPayload = realpathSync(payloadDir);
    } catch {
      return null;
    }
    try {
      realComponent = realpathSync(componentDir);
    } catch {
      return null;
    }
    const rel = relative(realPayload, realComponent);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
    return realComponent;
  } catch {
    return null;
  }
}

export function resolveProjectLibraryRoot(options = {}) {
  const { env = process.env, cwd = process.cwd(), packageRoot = PACKAGE_ROOT } = options;
  if (env.WEBMCP_PROJECT_LIBRARY) return resolve(cwd, env.WEBMCP_PROJECT_LIBRARY);
  if (isInstalledMode(env)) {
    return resolveInstalledComponentDir('webmcp-project-library', env, cwd);
  }
  for (const sibling of PROJECT_LIBRARY_SIBLINGS) {
    const candidate = resolve(packageRoot, sibling);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function browserNotFoundMessage(options = {}) {
  const devMessage = [
    'WebMCP Browser executable not found.',
    'Run from a checkout that provides ../browser/bin/webmcp-browser.mjs, install @gyga-browser/webmcp-browser-automation-kit, or set WEBMCP_BROWSER_BIN.',
  ].join('\n');
  const env = messageEnv(options);
  if (!isInstalledMode(env)) return devMessage;
  const cwd = messageCwd(options);
  const state = installedManifestState(env, cwd);
  if (state.installed && state.ok === false) {
    return [
      'WebMCP Browser executable not found (installed mode).',
      `Installed release manifest is invalid: ${state.manifestPath} (installed mode: no source/npm fallback).`,
    ].join('\n');
  }
  return [
    'WebMCP Browser executable not found (installed mode).',
    'The selected release does not contain component webmcp-browser-kit (installed mode: no source/npm fallback).',
  ].join('\n');
}

export function componentNotFoundMessage(component, options = {}) {
  const spec = COMPONENTS[component];
  const installedMapping = INSTALLED_COMPONENTS[component];
  const label = spec ? spec.label : (installedMapping ? `WebMCP ${component} component` : `WebMCP ${component} component`);
  const hint = spec ? spec.installHint : `Install the ${component} component.`;
  const devMessage = [`${label} not found.`, hint].join('\n');
  const env = messageEnv(options);
  if (!isInstalledMode(env)) {
    // Preserve exact dev behavior for unknown components: historical callers
    // only pass known components; unknown stays a plain dev message.
    if (!spec) return devMessage;
    return devMessage;
  }
  const cwd = messageCwd(options);
  const state = installedManifestState(env, cwd);
  if (state.installed && state.ok === false) {
    return [
      `${label} not found (installed mode).`,
      `Installed release manifest is invalid: ${state.manifestPath} (installed mode: no source/npm fallback).`,
    ].join('\n');
  }
  const componentId = installedMapping ? installedMapping.componentId : component;
  return [
    `${label} not found (installed mode).`,
    `The selected release does not contain component ${componentId} (installed mode: no source/npm fallback).`,
  ].join('\n');
}

export function projectKitNotFoundMessage(options = {}) {
  const devMessage = [
    'WebMCP Project Kit CLI not found.',
    'Install the Project Kit package, run from a checkout that provides ../project-kit/bin/webmcp-project-kit.mjs, or set WEBMCP_PROJECT_KIT_BIN.',
    'The legacy `project` route is unchanged.',
  ].join('\n');
  const env = messageEnv(options);
  if (!isInstalledMode(env)) return devMessage;
  const cwd = messageCwd(options);
  const state = installedManifestState(env, cwd);
  if (state.installed && state.ok === false) {
    return [
      'WebMCP Project Kit CLI not found (installed mode).',
      `Installed release manifest is invalid: ${state.manifestPath} (installed mode: no source/npm fallback).`,
    ].join('\n');
  }
  return [
    'WebMCP Project Kit CLI not found (installed mode).',
    'The selected release does not contain component webmcp-project-kit (installed mode: no source/npm fallback).',
  ].join('\n');
}

export function projectLibraryNotFoundMessage(options = {}) {
  const devMessage = [
    'WebMCP Project Library not found.',
    'Install the Project Library package, run from a checkout that provides ../../../webmcp-project-library, or set WEBMCP_PROJECT_LIBRARY.',
  ].join('\n');
  const env = messageEnv(options);
  if (!isInstalledMode(env)) return devMessage;
  const cwd = messageCwd(options);
  const state = installedManifestState(env, cwd);
  if (state.installed && state.ok === false) {
    return [
      'WebMCP Project Library not found (installed mode).',
      `Installed release manifest is invalid: ${state.manifestPath} (installed mode: no source/npm fallback).`,
    ].join('\n');
  }
  return [
    'WebMCP Project Library not found (installed mode).',
    'The selected release does not contain component webmcp-project-library (installed mode: no source/npm fallback).',
  ].join('\n');
}
