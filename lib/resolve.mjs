import process from 'node:process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
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
  for (const sibling of BROWSER_SIBLINGS) {
    const candidate = resolve(packageRoot, sibling);
    if (existsSync(candidate)) return candidate;
  }
  return resolvePackageSubpath(BROWSER_PACKAGE.name, BROWSER_PACKAGE.subpaths, packageRoot);
}

export function resolveComponentBin(component, options = {}) {
  const { env = process.env, cwd = process.cwd(), packageRoot = PACKAGE_ROOT } = options;
  const spec = COMPONENTS[component];
  if (!spec) return null;
  if (component === 'captcha') return resolveCaptchaBin({ env, cwd, packageRoot });
  const override = readOverride(env, spec.envVars);
  if (override) {
    return resolveOverride(override, spec.overrideSubpaths, { cwd, packageRoot });
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
  for (const sibling of PROJECT_KIT_SIBLINGS) {
    const candidate = resolve(packageRoot, sibling);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function browserNotFoundMessage() {
  return [
    'WebMCP Browser executable not found.',
    'Run from a checkout that provides ../browser/bin/webmcp-browser.mjs, install @gyga-browser/webmcp-browser-automation-kit, or set WEBMCP_BROWSER_BIN.',
  ].join('\n');
}

export function componentNotFoundMessage(component) {
  const spec = COMPONENTS[component];
  return [`${spec.label} not found.`, spec.installHint].join('\n');
}

export function projectKitNotFoundMessage() {
  return [
    'WebMCP Project Kit CLI not found.',
    'Install the Project Kit package, run from a checkout that provides ../project-kit/bin/webmcp-project-kit.mjs, or set WEBMCP_PROJECT_KIT_BIN.',
    'The legacy `project` route is unchanged.',
  ].join('\n');
}
