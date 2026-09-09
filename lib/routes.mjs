// Explicit preview route table. This freezes the M1 baseline Browser router
// (every top-level command/alias) and adds only `project-kit` as an optional
// route. There is intentionally no silent unknown-command fallback.
export const PREVIEW_COMMAND = 'webmcp-cli';

export const LOCAL_COMMANDS = new Set(['help', 'version']);

export const ROUTES = new Map([
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
  // Explicit legacy adapters: parser/logic stays in the Browser owner for MVP.
  ['doctor', { kind: 'legacy-browser', owner: 'browser' }],
  ['bootstrap', { kind: 'legacy-browser', owner: 'browser' }],
  ['project', { kind: 'legacy-browser', owner: 'browser' }],
  ['skills', { kind: 'legacy-browser', owner: 'browser' }],
  // Component routes: delegate to an explicit component executable.
  ['workflow', { kind: 'component', component: 'workflow' }],
  ['ai', { kind: 'component', component: 'ai' }],
  ['site', { kind: 'component', component: 'site' }],
  ['automation', { kind: 'component', component: 'automation' }],
  ['vault', { kind: 'component', component: 'vault' }],
  ['mobile', { kind: 'component', component: 'mobile' }],
  ['adb', { kind: 'component', component: 'mobile', aliasOf: 'mobile' }],
  ['captcha', { kind: 'component', component: 'captcha' }],
  ['store', { kind: 'component', component: 'site', legacyAlias: true }],
  // Optional preview namespace: only a real Project Kit executable, never the
  // legacy `project` route.
  ['project-kit', { kind: 'project-kit', optional: true }],
]);
