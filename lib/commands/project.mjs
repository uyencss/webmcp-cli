import { existsSync } from 'node:fs';
import process from 'node:process';
import { resolve } from 'node:path';
import { delegateCapture, delegateChild } from '../delegate.mjs';
import {
  projectKitNotFoundMessage,
  projectLibraryNotFoundMessage,
  resolveProjectKitBin,
  resolveProjectLibraryRoot,
  resolveRunnerBin,
  runnerNotFoundMessage,
} from '../resolve.mjs';

function splitDashDash(tokens) {
  const idx = tokens.indexOf('--');
  if (idx === -1) return { before: tokens, after: [] };
  return { before: tokens.slice(0, idx), after: tokens.slice(idx) };
}

function hasFlag(before, name) {
  for (const token of before) {
    if (token === `--${name}` || token.startsWith(`--${name}=`)) return true;
  }
  return false;
}

// The canonical `project` help. It is printed locally (no child spawn) so the
// aggregate route never bounces through the deprecated Browser spelling — see
// initiative 2026-09-project-commands-extraction, plan §7 commit 1.
const PROJECT_HELP = `webmcp project — WebMCP project workspace management

Usage:
  webmcp project attach <dir> [--replace] [--as-copy <id>] [--repair-layout] [--default] [--dry-run] [--json]
  webmcp project attach --scan <root> [--replace] [--repair-layout] [--default] [--dry-run] [--json]
  webmcp project list [--json]
  webmcp project where [<id>] [--json]
  webmcp project doctor [<dir>] [--json]
  webmcp project new [--template <id>] [--at <dir>] [--id <id>] [--name <name>] [--default] [--dry-run] [--json]
  webmcp project init [--at <dir>] [--id <id>] [--name <name>] [--dir <storeDir>] [--force] [--dry-run] [--json]
  webmcp project init-store [--at <dir>] [--id <id>] [--name <name>] [--dir <storeDir>] [--force] [--dry-run] [--json]
  webmcp project build-index [--dir <projectStoreDir>] [--workspace <dir>] [--json]
  webmcp project export-pack --select <domain>/<id> --output <dir> [--alias <alias>] [--json]
  webmcp project content plan --at <dir> --json
  webmcp project content apply --at <dir> --yes --json
  webmcp project policy plan [--at <dir>] [--all] --json
  webmcp project policy apply [--at <dir>] [--all] --yes --json
  webmcp project charter adopt <relative-md> [--workspace <dir>] [--yes] [--json]
  webmcp project guide list [--json]
  webmcp project guide stage <collections/<id>/GUIDE.md> --as inputs/<path> --yes [--json]
  webmcp project schedule list --workspace <path> [--json]
  webmcp project schedule plan <id> --target <t> --workspace <path> [--json]
  webmcp project schedule status [<id>] [--target <t>] --workspace <path> [--json]
  webmcp project schedule reconcile --workspace <path> [--json]
  webmcp project schedule operation <operation-id> --workspace <path> [--json]
  webmcp project schedule recover <operation-id> --workspace <path> [--json]

Notes:
  attach registers an existing project directory in the local workspace registry,
  or relocates its registered root after the folder was moved. Idempotent; without
  flags it never changes an existing registration.
  where prints the resolved project root; without an ID it resolves the registered
  default project.
  doctor runs the runner's workspace doctor, a registry audit of the project root,
  and an attach dry-run sanity check.
  new creates a project from a template in the Automation Store (template id =
  store automation id); without --template it bootstraps the store's default
  selection (all automations). Without --at the default parent is $WEBMCP_PROJECTS_ROOT
  or ~/WebMCP Projects.
  charter adopt is dry-run by default; pass --yes to write. It delegates the charter
  operation to the Automation Runner and never reads or modifies project files itself.
  content plan/apply is the optional Content Kit overlay; plan is read-only and
  apply requires --yes. It owns only content contract directories below the project root.
  policy plan/apply is the project-agent-policy migration surface; plan is read-only,
  apply requires --yes, merges only WebMCP-owned sections, and is idempotent.
  policy plan is read-only. policy apply requires --yes, merges only WebMCP-owned
  sections, skips typed conflicts, and does not provide --force.
  guide list shows derived guides (collections/<id>/GUIDE.md). guide stage copies a
  reviewed guide below the intent/evidence boundary into inputs/; it requires the
  explicit --yes confirmation and never modifies or deletes the source.
  schedule list/plan/status/reconcile/operation/recover delegate to the Automation
  Runner with an exact argv vector and the child exit code unchanged; --workspace
  is always required and legacy apply fails closed without mutating providers.
  operation/recover resume only the in-process Runner store that issued the plan;
  every CLI invocation spawns a fresh Runner, so cross-process resume fails
  closed with SCHEDULE_RECOVERY_REQUIRED.
  status without --target covers all declared targets of the selected schedules.`;

export function printProjectHelp() {
  console.log(PROJECT_HELP);
}

function runnerMissing(env) {
  console.error(runnerNotFoundMessage({ env }));
  return 1;
}

async function runRunner(args, { env, runChild, cwd }) {
  const runnerBin = resolveRunnerBin({ env, cwd });
  if (!runnerBin || !existsSync(runnerBin)) return runnerMissing(env);
  return runChild({ label: 'Automation Runner', file: runnerBin, args, useNode: true });
}

// Bounded capture used only for default-workspace resolution before a
// delegated command. Errors are surfaced with the child's own streams so a
// missing registry never degrades into a silent guess.
async function resolveDefaultProjectRoot(env, cwd) {
  const runnerBin = resolveRunnerBin({ env, cwd });
  if (!runnerBin || !existsSync(runnerBin)) return null;
  const listed = await delegateCapture({
    label: 'Automation Runner',
    file: runnerBin,
    args: ['workspace', 'list', '--json'],
    useNode: true,
  });
  if (listed.status !== 0) {
    process.stdout.write(listed.stdout);
    process.stderr.write(listed.stderr);
    return null;
  }
  const registry = JSON.parse(listed.stdout).data;
  return registry.workspaces.find((item) => item.id === registry.defaultWorkspaceId) || null;
}

export function projectOption(args, name) {
  const prefix = `--${name}`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === prefix) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) return null;
      return value;
    }
    if (arg.startsWith(`${prefix}=`)) return arg.slice(prefix.length + 1);
  }
  return null;
}

export function withoutProjectOptions(args, names) {
  const prefixes = names.map((name) => `--${name}`);
  const rest = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const match = prefixes.find((prefix) => arg === prefix);
    if (match) {
      if (args[index + 1] !== undefined && !args[index + 1].startsWith('--')) index += 1;
      continue;
    }
    if (prefixes.some((prefix) => arg.startsWith(`${prefix}=`))) continue;
    rest.push(arg);
  }
  return rest;
}

async function runProjectAttach(args, ctx) {
  const rest = [];
  let dir = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--scan') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        rest.push('--scan');
      } else {
        rest.push('--scan', value);
        index += 1;
      }
    } else if (!arg.startsWith('--')) {
      dir = arg;
    } else {
      rest.push(arg);
    }
  }
  if (!dir && !rest.includes('--scan')) {
    console.error('Usage: webmcp project attach <dir> [--replace] [--as-copy <id>] [--repair-layout] [--default] [--dry-run] [--json]');
    console.error('       webmcp project attach --scan <root> [--replace] [--repair-layout] [--default] [--dry-run] [--json]');
    return 2;
  }
  if (dir) return runRunner(['workspace', 'attach', '--workspace', dir, ...rest], ctx);
  return runRunner(['workspace', 'attach', ...rest], ctx);
}

async function runProjectWhere(args, ctx) {
  const id = args.find((arg) => !arg.startsWith('--'));
  if (id) return runRunner(['workspace', 'describe', id, ...args], ctx);
  const entry = await resolveDefaultProjectRoot(ctx.env, ctx.cwd);
  if (!entry) {
    console.error('No default project is registered. Register one with: webmcp project attach <dir> --default');
    return 1;
  }
  return runRunner(['workspace', 'describe', entry.id, ...args], ctx);
}

async function runProjectDoctor(args, ctx) {
  let root = args.find((arg) => !arg.startsWith('--'));
  if (!root) {
    const entry = await resolveDefaultProjectRoot(ctx.env, ctx.cwd);
    if (!entry) {
      console.error('No default project is registered. Register one with: webmcp project attach <dir> --default');
      return 1;
    }
    root = entry.root;
  }
  const json = args.includes('--json');
  const chain = [
    ['workspace', 'doctor', '--workspace', root, ...(json ? ['--json'] : [])],
    ['workspace', 'registry', 'audit', '--workspace-root', root, ...(json ? ['--json'] : [])],
    ['workspace', 'attach', '--workspace', root, '--dry-run', ...(json ? ['--json'] : [])],
  ];
  for (const runnerArgs of chain) {
    const exitCode = await runRunner(runnerArgs, ctx);
    if (exitCode !== 0) return exitCode;
  }
  return 0;
}

function projectLocationOptions(args, name) {
  const prefix = `--${name}`;
  const matches = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === prefix) {
      const next = args[index + 1];
      matches.push(next === undefined || next.startsWith('--') ? null : next);
      if (next !== undefined && !next.startsWith('--')) index += 1;
      continue;
    }
    if (arg.startsWith(`${prefix}=`)) matches.push(arg.slice(prefix.length + 1));
  }
  return matches;
}

async function runProjectContent(args, ctx) {
  const [action, ...contentArgs] = args;
  if (!['plan', 'apply'].includes(action)) {
    console.error(`Unknown project content command: ${action || ''}`.trim());
    printProjectHelp();
    return 2;
  }

  const atOptions = projectLocationOptions(contentArgs, 'at');
  const workspaceOptions = projectLocationOptions(contentArgs, 'workspace');
  if (atOptions.length > 1 || workspaceOptions.length > 1
    || (atOptions.length > 0 && workspaceOptions.length > 0)) {
    console.error('USAGE_ERROR: project content accepts exactly one project location');
    return 2;
  }

  const hasAt = contentArgs.some((arg) => arg === '--at' || arg.startsWith('--at='));
  const at = projectOption(contentArgs, 'at');
  if (hasAt && !at?.trim()) {
    console.error('project content requires a non-empty --at <dir> value');
    return 2;
  }
  if (at && projectOption(contentArgs, 'workspace')) {
    console.error('project content cannot combine --at with --workspace');
    return 2;
  }
  const forwarded = at
    ? ['--workspace', at, ...withoutProjectOptions(contentArgs, ['at'])]
    : contentArgs;
  return runRunner(['project', 'content', action, ...forwarded], ctx);
}

async function runProjectPolicy(args, ctx) {
  const [action, ...policyArgs] = args;
  const usage = action === 'apply'
    ? 'Usage: webmcp project policy apply [--at <dir>] [--all] --yes --json'
    : 'Usage: webmcp project policy plan [--at <dir>] [--all] --json';
  if (!['plan', 'apply'].includes(action)) {
    console.error(`Unknown project policy command: ${action || ''}`.trim());
    console.error(usage);
    return 2;
  }

  const allowedBoolean = new Set(['all', 'json', 'yes']);
  for (let index = 0; index < policyArgs.length; index += 1) {
    const arg = policyArgs[index];
    if (!arg.startsWith('--')) {
      console.error(usage);
      return 2;
    }
    const name = arg.slice(2).split('=', 1)[0];
    if (name === 'at' || name === 'workspace') {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : policyArgs[index + 1];
      if (!arg.includes('=')) {
        if (value === undefined || value.startsWith('--')) {
          console.error(usage);
          return 2;
        }
        index += 1;
      }
      if (!value?.trim()) {
        console.error(usage);
        return 2;
      }
      continue;
    }
    if (!allowedBoolean.has(name) || (arg.includes('=') && !['true', 'false'].includes(arg.slice(arg.indexOf('=') + 1)))) {
      console.error(usage);
      return 2;
    }
  }

  const atOptions = projectLocationOptions(policyArgs, 'at');
  const workspaceOptions = projectLocationOptions(policyArgs, 'workspace');
  if (atOptions.length > 1 || workspaceOptions.length > 1
    || (atOptions.length > 0 && workspaceOptions.length > 0)) {
    console.error('USAGE_ERROR: project policy accepts exactly one project location');
    return 2;
  }
  const atSpecified = policyArgs.some((arg) => arg === '--at' || arg.startsWith('--at='));
  const at = projectOption(policyArgs, 'at');
  const workspace = projectOption(policyArgs, 'workspace');
  if (atSpecified && !at?.trim()) {
    console.error(usage);
    return 2;
  }
  if (policyArgs.some((arg) => arg === '--all' || arg.startsWith('--all=')) && (at || workspace)) {
    console.error('USAGE_ERROR: project policy cannot combine --all with a project location');
    return 2;
  }
  if (!policyArgs.some((arg) => arg === '--json' || arg.startsWith('--json='))) {
    console.error(usage);
    return 2;
  }
  if (action === 'apply' && !policyArgs.some((arg) => arg === '--yes' || arg === '--yes=true')) {
    console.error(usage);
    return 2;
  }
  if (action === 'plan' && policyArgs.some((arg) => arg === '--yes' || arg === '--yes=true')) {
    console.error(usage);
    return 2;
  }

  const forwarded = at
    ? ['--workspace', at, ...withoutProjectOptions(policyArgs, ['at'])]
    : policyArgs;
  return runRunner(['project', 'policy', action, ...forwarded], ctx);
}

async function runProjectCharter(args, ctx) {
  const [subcommand, ...rest] = args;
  const usage = 'Usage: webmcp project charter adopt <relative-md> [--workspace <dir>] [--yes] [--json]';
  if (subcommand !== 'adopt') {
    console.error(usage);
    return 2;
  }
  let relativeFile = null;
  let workspace = null;
  let workspaceSpecified = false;
  let yes = false;
  let json = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--workspace') {
      const value = rest[index + 1];
      if (workspaceSpecified || value === undefined || value.startsWith('--') || value.trim() === '') {
        console.error(usage);
        return 2;
      }
      workspace = value;
      workspaceSpecified = true;
      index += 1;
      continue;
    }
    if (arg === '--yes') {
      if (yes) {
        console.error(usage);
        return 2;
      }
      yes = true;
      continue;
    }
    if (arg === '--json') {
      if (json) {
        console.error(usage);
        return 2;
      }
      json = true;
      continue;
    }
    if (arg.startsWith('--') || relativeFile) {
      console.error(usage);
      return 2;
    }
    relativeFile = arg;
  }
  if (!relativeFile) {
    console.error(usage);
    return 2;
  }
  const root = workspaceSpecified ? workspace : (await resolveDefaultProjectRoot(ctx.env, ctx.cwd))?.root;
  if (!root) {
    console.error('No default project is registered. Register one with: webmcp project attach <dir> --default');
    return 1;
  }
  return runRunner([
    'workspace', 'charter', 'adopt', relativeFile, '--workspace', root,
    ...(yes ? ['--yes'] : []),
    ...(json ? ['--json'] : []),
  ], ctx);
}

async function projectGuideTarget(rest, ctx) {
  const explicit = projectOption(rest, 'workspace');
  if (explicit) {
    return { root: explicit, flags: rest.filter((arg) => arg.startsWith('--') && !arg.startsWith('--workspace')) };
  }
  const entry = await resolveDefaultProjectRoot(ctx.env, ctx.cwd);
  if (!entry) {
    return { error: 'No default project is registered. Register one with: webmcp project attach <dir> --default' };
  }
  return { root: entry.root, flags: rest.filter((arg) => arg.startsWith('--')) };
}

async function runProjectGuide(args, ctx) {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    console.error('Usage: webmcp project guide list [--json]');
    console.error('       webmcp project guide stage <collections/<id>/GUIDE.md> --as inputs/<path> --yes [--json]');
    return subcommand && subcommand !== 'help' ? 2 : 0;
  }
  const target = await projectGuideTarget(rest, ctx);
  if (target.error) {
    console.error(target.error);
    return 1;
  }
  if (subcommand === 'list') {
    return runRunner(['workspace', 'guide', 'list', '--workspace', target.root, ...target.flags], ctx);
  }
  if (subcommand === 'stage') {
    const source = rest.find((arg) => !arg.startsWith('--'));
    const as = projectOption(rest, 'as');
    if (!source || !as) {
      console.error('Usage: webmcp project guide stage <collections/<id>/GUIDE.md> --as inputs/<path> --yes [--json]');
      return 2;
    }
    const flags = target.flags.filter((arg) => !arg.startsWith('--as'));
    return runRunner(['workspace', 'guide', 'stage', source, '--workspace', target.root, '--as', as, ...flags], ctx);
  }
  console.error(`Unknown project guide command: ${subcommand}`);
  printProjectHelp();
  return 2;
}

// ---------------------------------------------------------------------------
// `project new`: template + bootstrap branches stay on the Automation Runner;
// the archetype branch routes to the Project Kit executable (below).
// ---------------------------------------------------------------------------

const PROJECT_NEW_USAGE = 'Usage: webmcp project new [--archetype <id>] [--template <id>] [--at <dir>] [--id <id>] [--name <name>] [--default] [--dry-run] [--json]';
const VALUE_OPTIONS = new Set(['archetype', 'template', 'at', 'id', 'name']);
const BOOLEAN_OPTIONS = new Set(['default', 'dry-run', 'json']);

function parseProjectNewArgs(args) {
  const values = {};
  const booleans = new Set();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      return { error: `Unknown project new argument: ${arg}` };
    }

    const equals = arg.indexOf('=');
    const name = arg.slice(2, equals === -1 ? undefined : equals);
    if (!VALUE_OPTIONS.has(name) && !BOOLEAN_OPTIONS.has(name)) {
      return { error: `Unknown project new option: ${arg}` };
    }
    if (equals !== -1 && BOOLEAN_OPTIONS.has(name)) {
      return { error: `Project new option --${name} does not take a value` };
    }
    if (values[name] !== undefined || booleans.has(name)) {
      return { error: `Duplicate project new option: --${name}` };
    }

    if (VALUE_OPTIONS.has(name)) {
      const value = equals === -1 ? args[index + 1] : arg.slice(equals + 1);
      if (equals === -1 && (value === undefined || value.startsWith('--'))) {
        return { error: `Project new option --${name} requires a value` };
      }
      if (typeof value !== 'string' || value.trim().length === 0) {
        return { error: `Project new option --${name} requires a non-empty value` };
      }
      values[name] = value;
      if (equals === -1) index += 1;
      continue;
    }

    booleans.add(name);
  }

  return { values, booleans };
}

async function runProjectNew(args, ctx) {
  const parsed = parseProjectNewArgs(args);
  if (parsed.error) {
    console.error(parsed.error);
    console.error(PROJECT_NEW_USAGE);
    return 2;
  }

  const { values, booleans } = parsed;
  const { template, at, id, name } = values;

  const flags = [];
  for (const flag of ['default', 'dry-run', 'json']) {
    if (booleans.has(flag)) flags.push(`--${flag}`);
  }

  if (template) {
    const argv = ['workspace', 'project-new', '--template', template];
    if (at) argv.push('--at', at);
    if (id) argv.push('--id', id);
    if (name) argv.push('--name', name);
    argv.push(...flags);
    return runRunner(argv, ctx);
  }
  if (!at) {
    console.error(PROJECT_NEW_USAGE);
    return 2;
  }
  const argv = ['workspace', 'bootstrap', '--workspace-root', at];
  argv.push('--all');
  if (id) argv.push('--project-id', id);
  if (name) argv.push('--project-name', name);
  argv.push(...flags);
  return runRunner(argv, ctx);
}

// ---------------------------------------------------------------------------
// Project Kit routes: archetype create/preview, plugin, inspect, repair, session.
// ---------------------------------------------------------------------------

function usageError(message) {
  console.error(message);
  return 2;
}

const PLUGIN_ACTIONS = new Set(['list', 'add', 'update', 'remove']);
const SESSION_ACTIONS = new Set(['plan', 'apply', 'list', 'prune', 'archive']);

// Flags that take a separate value (space form) for id-skipping.
const VALUE_FLAGS = new Set([
  '--library', '-l',
  '--target', '-t',
  '--plugin-config', '--channel-profile',
  '--plugin', '--plugins',
  '--id', '--name', '--template',
  '--at', '--archetype',
  '--block', '--home', '--plan',
]);

function findFirstPositional(before, skipIndices) {
  for (let i = 0; i < before.length; i += 1) {
    if (skipIndices && skipIndices.has(i)) continue;
    const token = before[i];
    if (token === '--') continue;
    if (token.startsWith('-') && token.length > 0) {
      if (VALUE_FLAGS.has(token)) i += 1;
      continue;
    }
    if (token.length === 0) continue;
    return { value: token, index: i };
  }
  return null;
}

function buildNewRoute(rest, { env, cwd }) {
  const { before, after } = splitDashDash(rest);
  const foundArchetype = hasFlag(before, 'archetype');
  const foundTemplate = hasFlag(before, 'template');
  if (foundArchetype && foundTemplate) {
    return { error: usageError('error: --archetype and --template must not be combined') };
  }
  if (!foundArchetype) return { browser: true };
  // Project Kit route: id is first non-dash token.
  let id = null;
  let idIndex = -1;
  for (let i = 0; i < before.length; i += 1) {
    const token = before[i];
    if (token.length > 0 && !token.startsWith('-')) {
      id = token;
      idIndex = i;
      break;
    }
  }
  if (!id) {
    return { error: usageError('error: project new requires <project-id>') };
  }
  const archetypeVals = [];
  const plugins = [];
  const atVals = [];
  let hasTargetFlag = false;
  let isPreview = false;
  const passthrough = [];
  for (let i = 0; i < before.length; i += 1) {
    if (i === idIndex) continue;
    const token = before[i];
    if (token === '--archetype') {
      const next = before[i + 1];
      if (next !== undefined && next.length > 0 && !next.startsWith('-')) {
        archetypeVals.push(next);
        i += 1;
      } else {
        archetypeVals.push(null);
      }
      continue;
    }
    if (token.startsWith('--archetype=')) {
      archetypeVals.push(token.slice('--archetype='.length));
      continue;
    }
    if (token === '--plugin') {
      const next = before[i + 1];
      if (next !== undefined && next.length > 0 && !next.startsWith('-')) {
        plugins.push(next);
        i += 1;
      } else {
        passthrough.push(token);
      }
      continue;
    }
    if (token.startsWith('--plugin=')) {
      plugins.push(token.slice('--plugin='.length));
      continue;
    }
    if (token === '--at') {
      const next = before[i + 1];
      if (next !== undefined && next.length > 0 && !next.startsWith('-')) {
        atVals.push(next);
        i += 1;
      } else {
        passthrough.push(token);
      }
      continue;
    }
    if (token.startsWith('--at=')) {
      atVals.push(token.slice('--at='.length));
      continue;
    }
    if (token === '--target') {
      hasTargetFlag = true;
      passthrough.push(token);
      const next = before[i + 1];
      if (next !== undefined) {
        passthrough.push(next);
        i += 1;
      }
      continue;
    }
    if (token.startsWith('--target=')) {
      hasTargetFlag = true;
      passthrough.push(token);
      continue;
    }
    if (token === '-t') {
      hasTargetFlag = true;
      passthrough.push(token);
      const next = before[i + 1];
      if (next !== undefined) {
        passthrough.push(next);
        i += 1;
      }
      continue;
    }
    if (token.startsWith('-t=')) {
      hasTargetFlag = true;
      passthrough.push(token);
      continue;
    }
    if (token === '--dry-run') {
      isPreview = true;
      continue;
    }
    passthrough.push(token);
  }
  const kitBin = resolveProjectKitBin({ env });
  if (!kitBin || !existsSync(kitBin)) {
    console.error(projectKitNotFoundMessage({ env }));
    return { error: 1 };
  }
  const libRoot = resolveProjectLibraryRoot({ env });
  if (!libRoot || !existsSync(libRoot)) {
    console.error(projectLibraryNotFoundMessage({ env }));
    return { error: 1 };
  }
  const cmd = isPreview ? 'preview' : 'create';
  const out = [cmd, '--library', libRoot, '--id', id];
  for (const v of atVals) {
    out.push('--target', v);
  }
  if (atVals.length === 0 && !hasTargetFlag) {
    out.push('--target', resolve(cwd, id));
  }
  for (const v of archetypeVals) {
    if (v === null) out.push('--template');
    else out.push('--template', v);
  }
  if (plugins.length > 0) out.push('--plugins', plugins.join(','));
  out.push(...passthrough, ...after);
  return { kitBin, argv: out };
}

function extractTarget(before) {
  // Returns { value, indices } for all valid target occurrences.
  const indices = [];
  let value = null;
  for (let i = 0; i < before.length; i += 1) {
    const token = before[i];
    if (token === '--target' || token === '-t') {
      const next = before[i + 1];
      if (next !== undefined && next.length > 0 && !next.startsWith('-')) {
        indices.push(i, i + 1);
        value = next;
        i += 1;
      }
      continue;
    }
    if (token.startsWith('--target=')) {
      const v = token.slice('--target='.length);
      if (v.length > 0) {
        indices.push(i);
        value = v;
      }
      continue;
    }
    if (token.startsWith('-t=')) {
      const v = token.slice('-t='.length);
      if (v.length > 0) {
        indices.push(i);
        value = v;
      }
    }
  }
  return { value, indices: new Set(indices) };
}

function buildPluginRoute(args, { env }) {
  const action = args[1];
  if (!action || !PLUGIN_ACTIONS.has(action)) {
    const got = action === undefined ? 'missing' : JSON.stringify(action);
    return { error: usageError(`error: unknown plugin action: ${got} (expected list|add|update|remove)`) };
  }
  const rest = args.slice(2);
  const { before, after } = splitDashDash(rest);
  const { value: targetVal, indices: targetIndices } = extractTarget(before);
  if (!targetVal) {
    return { error: usageError('error: project plugin requires --target <path>') };
  }
  const kitBin = resolveProjectKitBin({ env });
  if (!kitBin || !existsSync(kitBin)) {
    console.error(projectKitNotFoundMessage({ env }));
    return { error: 1 };
  }
  if (action === 'list') {
    const passthrough = before.filter((_, i) => !targetIndices.has(i));
    return { kitBin, argv: ['readback', '--target', targetVal, ...passthrough, ...after] };
  }
  // add/update/remove need a plugin id.
  const found = findFirstPositional(before, targetIndices);
  if (!found) {
    return { error: usageError('error: project plugin requires <plugin-id>') };
  }
  const id = found.value;
  const idIndex = found.index;
  const passthrough = before.filter((_, i) => !targetIndices.has(i) && i !== idIndex);
  if (action === 'remove') {
    return { kitBin, argv: ['remove', '--target', targetVal, '--plugin', id, ...passthrough, ...after] };
  }
  const libRoot = resolveProjectLibraryRoot({ env });
  if (!libRoot || !existsSync(libRoot)) {
    console.error(projectLibraryNotFoundMessage({ env }));
    return { error: 1 };
  }
  return { kitBin, argv: [action, '--library', libRoot, '--target', targetVal, '--plugin', id, ...passthrough, ...after] };
}

function buildInspectRoute(args, { env }) {
  const rest = args.slice(1);
  const { before, after } = splitDashDash(rest);
  const found = findFirstPositional(before, null);
  if (!found) {
    return { error: usageError('error: project inspect requires <project-id>') };
  }
  const kitBin = resolveProjectKitBin({ env });
  if (!kitBin || !existsSync(kitBin)) {
    console.error(projectKitNotFoundMessage({ env }));
    return { error: 1 };
  }
  const passthrough = before.filter((_, i) => i !== found.index);
  return { kitBin, argv: ['readback', '--target', found.value, ...passthrough, ...after] };
}

function buildSessionRoute(args, { env }) {
  const action = args[1];
  if (!action || !SESSION_ACTIONS.has(action)) {
    const got = action === undefined ? 'missing' : JSON.stringify(action);
    return { error: usageError(`error: unknown session action: ${got} (expected plan|apply|list|prune|archive)`) };
  }
  const rest = args.slice(2);
  const { before } = splitDashDash(rest);
  const { value: targetVal } = extractTarget(before);
  if (!targetVal) {
    return { error: usageError('error: project session requires --target <path>') };
  }
  const kitBin = resolveProjectKitBin({ env });
  if (!kitBin || !existsSync(kitBin)) {
    console.error(projectKitNotFoundMessage({ env }));
    return { error: 1 };
  }
  return { kitBin, argv: ['session', ...args.slice(1)] };
}

// ---------------------------------------------------------------------------
// Aggregate route (initiative 2026-09-project-commands-extraction, plan §7).
//
// The aggregate owns the `project` route: every legacy subcommand routes
// directly to the Automation Runner (or the Project Kit for the migrated
// surfaces), and nothing bounces through the deprecated Browser spelling. The
// Browser Kit `project/` tree remains a warning shim for direct callers during
// the soak window (packages/webmcp-browser-kit/DEPRECATION.md).
// ---------------------------------------------------------------------------

export async function runProject(args, { env = process.env, runChild = delegateChild, cwd } = {}) {
  const effectiveCwd = typeof cwd === 'string' ? cwd : process.cwd();
  const effectiveRunChild = runChild || delegateChild;
  const ctx = { env, runChild: effectiveRunChild, cwd: effectiveCwd };
  const [subcommand] = args;
  if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    printProjectHelp();
    return 0;
  }
  if (subcommand === 'attach') return runProjectAttach(args.slice(1), ctx);
  if (subcommand === 'list') return runRunner(['workspace', 'list', ...args.slice(1)], ctx);
  if (subcommand === 'where') return runProjectWhere(args.slice(1), ctx);
  if (subcommand === 'doctor') return runProjectDoctor(args.slice(1), ctx);
  if (subcommand === 'new') {
    const rest = args.slice(1);
    const { before } = splitDashDash(rest);
    const foundArchetype = hasFlag(before, 'archetype');
    const foundTemplate = hasFlag(before, 'template');
    if (foundArchetype && foundTemplate) {
      return usageError('error: --archetype and --template must not be combined');
    }
    if (!foundArchetype) {
      return runProjectNew(rest, ctx);
    }
    const built = buildNewRoute(rest, { env, cwd: effectiveCwd });
    if (built.error !== undefined) return built.error;
    if (built.browser) return runProjectNew(rest, ctx);
    return effectiveRunChild({ label: 'Project Kit CLI', file: built.kitBin, args: built.argv, useNode: true });
  }
  if (subcommand === 'charter') return runProjectCharter(args.slice(1), ctx);
  if (subcommand === 'guide') return runProjectGuide(args.slice(1), ctx);
  if (subcommand === 'schedule') return runRunner(['project-schedule', ...args.slice(1)], ctx);
  if (subcommand === 'content') return runProjectContent(args.slice(1), ctx);
  if (subcommand === 'policy') return runProjectPolicy(args.slice(1), ctx);
  // Project Store commands — thin bridge onto Runner's project.* surface (R6.1)
  if (subcommand === 'init' || subcommand === 'init-store') return runRunner(['project', 'init-store', ...args.slice(1)], ctx);
  if (subcommand === 'build-index') return runRunner(['project', 'build-index', ...args.slice(1)], ctx);
  if (subcommand === 'export-pack') return runRunner(['project', 'export-pack', ...args.slice(1)], ctx);
  if (subcommand === 'plugin') {
    const built = buildPluginRoute(args, { env });
    if (built.error !== undefined) return built.error;
    return effectiveRunChild({ label: 'Project Kit CLI', file: built.kitBin, args: built.argv, useNode: true });
  }
  if (subcommand === 'repair') {
    const kitBin = resolveProjectKitBin({ env });
    if (!kitBin || !existsSync(kitBin)) {
      console.error(projectKitNotFoundMessage({ env }));
      return 1;
    }
    return effectiveRunChild({ label: 'Project Kit CLI', file: kitBin, args: ['repair', ...args.slice(1)], useNode: true });
  }
  if (subcommand === 'inspect') {
    const built = buildInspectRoute(args, { env });
    if (built.error !== undefined) return built.error;
    return effectiveRunChild({ label: 'Project Kit CLI', file: built.kitBin, args: built.argv, useNode: true });
  }
  if (subcommand === 'session') {
    const built = buildSessionRoute(args, { env });
    if (built.error !== undefined) return built.error;
    return effectiveRunChild({ label: 'Project Kit CLI', file: built.kitBin, args: built.argv, useNode: true });
  }
  console.error(`Unknown project command: ${subcommand}`);
  printProjectHelp();
  return 2;
}
