import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREVIEW_COMMAND } from './routes.mjs';

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = resolve(LIB_DIR, '..');

export function getVersion() {
  return JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
}

export function printHelp() {
  console.log(`WebMCP CLI preview (local dispatcher MVP)

Usage:
  ${PREVIEW_COMMAND} help|--help|-h
  ${PREVIEW_COMMAND} version|--version|-v
  ${PREVIEW_COMMAND} mcp
  ${PREVIEW_COMMAND} mcp --help
  ${PREVIEW_COMMAND} gateway start
  ${PREVIEW_COMMAND} gateway health [--json]
  ${PREVIEW_COMMAND} health [--json]
  ${PREVIEW_COMMAND} doctor [--json]
  ${PREVIEW_COMMAND} bootstrap plan|apply|canary|vault-key-plan|binding-plan|tailnet-plan|tailnet-apply|profile-candidates|enroll-role|service-plan|service-apply|service-install-plan|service-install|service-load-plan|service-load|enroll-alias|enroll-binding [--json]
  ${PREVIEW_COMMAND} launch [--name <name> | --profile-id <id>] [--gateway] [--relaunch] [--dry-run] [--json]
  ${PREVIEW_COMMAND} close [--profile-id <id>] [--all] [--json]
  ${PREVIEW_COMMAND} quit [--json]
  ${PREVIEW_COMMAND} profiles list [--json]
  ${PREVIEW_COMMAND} profile-pool acquire|renew|release|list|status|reclaim|doctor [--json]
  ${PREVIEW_COMMAND} call <method> [jsonParams]
  ${PREVIEW_COMMAND} ai <command> [options]
  ${PREVIEW_COMMAND} vault <command> [options]
  ${PREVIEW_COMMAND} workflow <command> [options]
  ${PREVIEW_COMMAND} site <command> [options]
  ${PREVIEW_COMMAND} automation <command> [options]
  ${PREVIEW_COMMAND} project new <id> --archetype <id> [--plugin <id>]... [--at <dir>|--target <dir>] [--dry-run] [--json]
  ${PREVIEW_COMMAND} project plugin list|add|update|remove --target <project> [options]
  ${PREVIEW_COMMAND} project inspect <project-id> [--json]
  ${PREVIEW_COMMAND} project repair --block <id> --target <project> [--yes] [--json]
  ${PREVIEW_COMMAND} project <legacy> [options]   Legacy Browser route: new --template, attach/list/where/doctor/charter/guide/schedule/content/policy/init/init-store/build-index/export-pack
  ${PREVIEW_COMMAND} project-kit <command> [options]   Deprecated alias for 'project'; needs an installed Project Kit CLI
  ${PREVIEW_COMMAND} mobile mcp
  ${PREVIEW_COMMAND} adb mcp                         Alias for mobile mcp
  ${PREVIEW_COMMAND} captcha <command> [options]
  ${PREVIEW_COMMAND} skills list [--json]
  ${PREVIEW_COMMAND} skills path <name>
  ${PREVIEW_COMMAND} skills doctor [--json]
  ${PREVIEW_COMMAND} store <command> [options]       Deprecated alias for site
  ${PREVIEW_COMMAND} extension-info [--json]
  ${PREVIEW_COMMAND} extension-path

Preview routing:
  help/version/unknown are handled locally.
  skills/doctor are CLI-local (no child spawn).
  mcp/gateway/profiles/profile-pool/launch/close/quit/health/call/extension-*
  plus bootstrap delegate to the Browser executable.
  project splits in the CLI: legacy subcommands stay on the Browser route,
  new archetype/plugin/inspect/repair routes delegate to the Project Kit executable.
  workflow/ai/site/automation/vault/mobile/adb/captcha delegate to explicit
  component executables (environment overrides honoured).
  project-kit is a deprecated alias for 'project' and delegates only to an
  explicit Project Kit executable when one is installed; it never replaces
  the legacy project route.

Environment:
  WEBMCP_BROWSER_BIN            Override Browser executable path or package name
  WEBMCP_WORKFLOW_DISPATCHER_BIN|WORKFLOW_DISPATCHER_BIN
  WEBMCP_AI_BIN                 Override standalone WebMCP AI CLI path or package name
  WEBMCP_STORE_BIN              Override Site Store CLI path or package name
  WEBMCP_AUTOMATION_BIN         Override Automation Store CLI path or package name
  WEBMCP_VAULT_BIN              Override vault CLI path or package name
  WEBMCP_ADB_MCP_BIN            Override ADB MCP server path or package name
  WEBMCP_CAPTCHA_BIN            Override captcha solver executable path
  WEBMCP_CAPTCHA_HOME           Checkout root of the captcha solver package
  WEBMCP_PROJECT_KIT_BIN        Override Project Kit CLI executable path
  WEBMCP_PROJECT_LIBRARY        Override Project Library root path
`);
}

export function printMobileHelp() {
  console.log(`WebMCP Mobile Automation

Usage:
  ${PREVIEW_COMMAND} mobile mcp
  ${PREVIEW_COMMAND} adb mcp       Alias for ${PREVIEW_COMMAND} mobile mcp
`);
}
