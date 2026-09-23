import { existsSync } from 'node:fs';
import process from 'node:process';
import { runDoctor } from './commands/doctor.mjs';
import { runProject } from './commands/project.mjs';
import { runSkills } from './commands/skills.mjs';
import { delegateChild } from './delegate.mjs';
import { getVersion, printHelp, printMobileHelp } from './help.mjs';
import {
  browserNotFoundMessage,
  componentNotFoundMessage,
  projectKitNotFoundMessage,
  resolveBrowserBin,
  resolveComponentBin,
  resolveProjectKitBin,
} from './resolve.mjs';
import { PREVIEW_COMMAND, ROUTES } from './routes.mjs';

const COMPONENT_LABELS = {
  workflow: 'Workflow dispatcher',
  ai: 'WebMCP AI CLI',
  jev: 'WebMCP Jev decision runtime',
  site: 'Site CLI',
  automation: 'Automation Store CLI',
  vault: 'Vault CLI',
};

function componentExtraEnv(command, route) {
  if (route.component === 'workflow') {
    return { WORKFLOW_DISPATCHER_COMMAND_NAME: `${PREVIEW_COMMAND} workflow` };
  }
  if (route.component === 'ai') {
    return { WEBMCP_AI_COMMAND_NAME: `${PREVIEW_COMMAND} ai` };
  }
  if (route.component === 'site') {
    if (route.legacyAlias || command === 'store') {
      return {
        WEBMCP_SITE_COMMAND_NAME: `${PREVIEW_COMMAND} store`,
        WEBMCP_SITE_LEGACY_ALIAS: '1',
      };
    }
    return { WEBMCP_SITE_COMMAND_NAME: `${PREVIEW_COMMAND} site` };
  }
  if (route.component === 'automation') {
    return { WEBMCP_AUTOMATION_COMMAND_NAME: `${PREVIEW_COMMAND} automation` };
  }
  return {};
}

async function runComponent(command, route, args, { env, runChild }) {
  if (route.component === 'mobile') {
    const [subcommand] = args;
    if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
      printMobileHelp();
      return 0;
    }
    if (subcommand !== 'mcp') {
      console.error(`Unknown mobile command: ${subcommand}`);
      printMobileHelp();
      return 1;
    }
    const adbBin = resolveComponentBin('mobile', { env });
    if (!adbBin || !existsSync(adbBin)) {
      console.error(componentNotFoundMessage('mobile', { env }));
      return 1;
    }
    return runChild({ label: 'ADB MCP server', file: adbBin, args: [], useNode: true });
  }

  const bin = resolveComponentBin(route.component, { env });
  if (!bin || !existsSync(bin)) {
    console.error(componentNotFoundMessage(route.component, { env }));
    return 1;
  }
  const childArgs = args.length > 0 ? args : ['--help'];
  if (route.component === 'captcha') {
    return runChild({ label: 'Captcha solver', file: bin, args: childArgs, useNode: false });
  }
  return runChild({
    label: COMPONENT_LABELS[route.component],
    file: bin,
    args: childArgs,
    useNode: true,
    extraEnv: componentExtraEnv(command, route),
  });
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const { env = process.env, runChild = delegateChild } = deps;
  const [command, ...args] = argv;

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return command ? 0 : 1;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(getVersion());
    return 0;
  }

  const route = ROUTES.get(command);
  if (!route) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    return 1;
  }

  if (route.kind === 'local') {
    if (command === 'skills') return runSkills(args);
    if (command === 'doctor') return runDoctor(args);
    console.error(`Unknown command: ${command}`);
    return 1;
  }

  if (route.kind === 'browser') {
    const browserBin = resolveBrowserBin({ env });
    if (!browserBin || !existsSync(browserBin)) {
      console.error(browserNotFoundMessage({ env }));
      return 1;
    }
    return runChild({
      label: `Browser ${command}`,
      file: browserBin,
      args: [command, ...args],
      useNode: true,
    });
  }

  if (route.kind === 'component') {
    return runComponent(command, route, args, { env, runChild });
  }

  if (route.kind === 'project') {
    return runProject(args, { env, runChild });
  }

  if (route.kind === 'project-kit') {
    console.error(`webmcp: warning: 'project-kit' is a deprecated alias and will be removed after one release; use 'webmcp project …' instead.`);
    const kitBin = resolveProjectKitBin({ env });
    if (!kitBin || !existsSync(kitBin)) {
      console.error(projectKitNotFoundMessage({ env }));
      return 1;
    }
    return runChild({
      label: 'Project Kit CLI',
      file: kitBin,
      args: args.length > 0 ? args : ['--help'],
      useNode: true,
    });
  }

  console.error(`Unknown command: ${command}`);
  return 1;
}
