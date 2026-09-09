# @gyga-browser/webmcp-cli (preview, local MVP)

Local preview dispatcher for WebMCP top-level commands. This package owns only
the top-level route table and a common child-process delegate. It never
declares a public `webmcp` bin, never imports the Browser CLI tree, and never
changes installer files or MCP registration.

## Run from a local checkout

```sh
node bin/webmcp-cli.mjs --help
node bin/webmcp-cli.mjs --version
node bin/webmcp-cli.mjs ai --help
node bin/webmcp-cli.mjs extension-path
```

Paths with spaces work: resolution is absolute and argv is passed to the child
without a shell.

## Routing

- `help` / `version` / unknown commands are handled locally, no Browser needed.
- `mcp`, `gateway`, `profiles`, `profile-pool`, `launch`, `close`, `quit`,
  `health`, `call`, `extension-info`, `extension-path` delegate to the absolute
  Browser executable.
- `doctor`, `bootstrap`, `project`, `skills` are explicit legacy adapters to
  the same Browser executable; their parsers and logic stay there for the MVP.
- `workflow`, `ai`, `site`, `automation`, `vault`, `mobile`/`adb`, `captcha`,
  and the `store` alias delegate to explicit component executables.
- `project-kit` delegates only to an explicit Project Kit executable when one
  is installed; otherwise it reports component-not-installed and never replaces
  the legacy `project` route.

## Environment overrides

- `WEBMCP_BROWSER_BIN`
- `WEBMCP_WORKFLOW_DISPATCHER_BIN` (or `WORKFLOW_DISPATCHER_BIN`)
- `WEBMCP_AI_BIN`, `WEBMCP_STORE_BIN`, `WEBMCP_AUTOMATION_BIN`
- `WEBMCP_VAULT_BIN`, `WEBMCP_ADB_MCP_BIN`
- `WEBMCP_CAPTCHA_BIN`, `WEBMCP_CAPTCHA_HOME`
- `WEBMCP_PROJECT_KIT_BIN`

Without overrides, the preview probes monorepo sibling checkouts and then
public package metadata. Missing components fail with a typed actionable error
on stderr. Child stdout stays untouched (pure MCP JSON-RPC included), exit
codes pass through, and SIGINT/SIGTERM forward narrowly to the direct child.

## Tests

```sh
npm test
```
