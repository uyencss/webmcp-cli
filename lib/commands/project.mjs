import { existsSync } from 'node:fs';
import process from 'node:process';
import { resolve } from 'node:path';
import { delegateChild } from '../delegate.mjs';
import {
  browserNotFoundMessage,
  projectKitNotFoundMessage,
  projectLibraryNotFoundMessage,
  resolveBrowserBin,
  resolveProjectKitBin,
  resolveProjectLibraryRoot,
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

async function delegateBrowser(args, { env, runChild }) {
  const browserBin = resolveBrowserBin({ env });
  if (!browserBin || !existsSync(browserBin)) {
    console.error(browserNotFoundMessage({ env }));
    return 1;
  }
  return runChild({ label: 'Browser project', file: browserBin, args: ['project', ...args], useNode: true });
}

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

export async function runProject(args, { env = process.env, runChild = delegateChild, cwd } = {}) {
  const effectiveCwd = typeof cwd === 'string' ? cwd : process.cwd();
  const effectiveRunChild = runChild || delegateChild;
  const [subcommand] = args;
  if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    return delegateBrowser(args, { env, runChild: effectiveRunChild });
  }
  if (subcommand === 'new') {
    const rest = args.slice(1);
    const { before } = splitDashDash(rest);
    const foundArchetype = hasFlag(before, 'archetype');
    const foundTemplate = hasFlag(before, 'template');
    if (foundArchetype && foundTemplate) {
      return usageError('error: --archetype and --template must not be combined');
    }
    if (!foundArchetype) {
      return delegateBrowser(args, { env, runChild: effectiveRunChild });
    }
    const built = buildNewRoute(rest, { env, cwd: effectiveCwd });
    if (built.error !== undefined) return built.error;
    if (built.browser) return delegateBrowser(args, { env, runChild: effectiveRunChild });
    return effectiveRunChild({ label: 'Project Kit CLI', file: built.kitBin, args: built.argv, useNode: true });
  }
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
  return delegateBrowser(args, { env, runChild: effectiveRunChild });
}
