// Explicit CLI2-3 route table. Every baseline Browser top-level command/alias
// has exactly one owner. `skills` and `doctor` are CLI-local; `bootstrap` and
// `project` are explicit Browser routes (no legacy adapters, no silent
// unknown-command fallback).
export const PREVIEW_COMMAND = 'webmcp-cli';

export const LOCAL_COMMANDS = new Set(['help', 'version']);

export const ROUTES = new Map([
  // CLI-local commands: handled in-process, never delegated.
  ['skills', { kind: 'local' }],
  ['doctor', { kind: 'local' }],
  // Direct Browser-owned routes: delegate to the absolute Browser executable.
  ['mcp', { kind: 'browser' }],
  ['gateway', { kind: 'browser' }],
  ['profiles', { kind: 'browser' }],
  ['profile-pool', { kind: 'browser' }],
  ['launch', { kind: 'browser' }],
  ['close', { kind: 'browser' }],
  ['quit', { kind: 'browser' }],
  ['health', { kind: 'browser' }],
  ['call', { kind: 'browser' }],
  ['extension-info', { kind: 'browser' }],
  ['extension-path', { kind: 'browser' }],
  // Explicit Browser routes (legacy adapters removed).
  ['bootstrap', { kind: 'browser' }],
  // `project` is split in the CLI (lib/commands/project.mjs): legacy
  // subcommands stay on the Browser route, archetype/plugin/inspect/repair
  // route to the standalone Project Kit executable.
  ['project', { kind: 'project' }],
  // Component routes: delegate to an explicit component executable.
  ['workflow', { kind: 'component', component: 'workflow' }],
  ['ai', { kind: 'component', component: 'ai' }],
  ['site', { kind: 'component', component: 'site' }],
  ['automation', { kind: 'component', component: 'automation' }],
  ['vault', { kind: 'component', component: 'vault' }],
  ['mobile', { kind: 'component', component: 'mobile' }],
  ['adb', { kind: 'component', component: 'mobile', aliasOf: 'mobile' }],
  ['captcha', { kind: 'component', component: 'captcha' }],
  ['jev', { kind: 'component', component: 'jev' }],
  ['store', { kind: 'component', component: 'site', legacyAlias: true }],
  // Optional preview namespace: only a real Project Kit executable, never the
  // legacy `project` route.
  ['project-kit', { kind: 'project-kit', optional: true }],
]);
