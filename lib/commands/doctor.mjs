import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { getVersion } from '../help.mjs';
import { resolveBrowserBin, resolveComponentBin, resolveProjectKitBin } from '../resolve.mjs';
import { buildSkillsDoctorReport } from './skills.mjs';

const COMPONENT_NAMES = ['workflow', 'ai', 'site', 'automation', 'vault', 'mobile', 'captcha'];

function collectBrowserSection() {
  const browserBin = resolveBrowserBin({ env: process.env, cwd: process.cwd() });
  if (!browserBin || !existsSync(browserBin)) {
    return {
      status: 'missing',
      code: 'MISSING_COMPONENT',
      component: 'browser',
      error: 'WebMCP Browser executable not found.',
    };
  }
  try {
    const result = spawnSync(process.execPath, [browserBin, 'doctor', '--json'], {
      cwd: process.cwd(),
      env: { ...process.env },
      encoding: 'utf8',
      timeout: 15000,
    });
    const stdout = result.stdout ?? '';
    const report = JSON.parse(stdout);
    return { status: 'ok', report };
  } catch {
    return {
      status: 'error',
      code: 'BROWSER_DOCTOR_INVALID',
      component: 'browser',
      error: 'Browser doctor did not produce parseable JSON.',
    };
  }
}

function collectComponents() {
  const components = {};
  for (const name of COMPONENT_NAMES) {
    let bin = null;
    try {
      bin = resolveComponentBin(name, { env: process.env, cwd: process.cwd() });
    } catch {
      bin = null;
    }
    const available = Boolean(bin && existsSync(bin));
    components[name] = { status: available ? 'available' : 'missing', path: available ? bin : null };
  }
  let kitBin = null;
  try {
    kitBin = resolveProjectKitBin({ env: process.env, cwd: process.cwd() });
  } catch {
    kitBin = null;
  }
  const kitAvailable = Boolean(kitBin && existsSync(kitBin));
  components['project-kit'] = { status: kitAvailable ? 'available' : 'missing', path: kitAvailable ? kitBin : null };
  return components;
}

export async function collectCliDoctorReport() {
  const cli = {
    status: 'ok',
    ok: true,
    version: getVersion(),
    node: process.versions.node,
  };
  const browser = collectBrowserSection();
  const skills = buildSkillsDoctorReport();
  const components = collectComponents();
  const browserOk = browser.status === 'ok' && browser.report != null && browser.report.ok === true;
  const ok = cli.ok === true && browserOk && skills.ok === true;
  return {
    schema: 'webmcp-cli-doctor/1',
    ok,
    sections: { cli, browser, skills },
    components,
  };
}

function printDoctorHelp() {
  console.log(`WebMCP CLI doctor

Usage:
  webmcp-cli doctor [--json]

Aggregate doctor: CLI version plus the Browser doctor report and the
CLI-local skills report. Stdout stays pure JSON with --json.
`);
}

export async function runDoctor(args = []) {
  if (args.includes('--help') || args.includes('-h') || args[0] === 'help') {
    printDoctorHelp();
    return 0;
  }
  const report = await collectCliDoctorReport();
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    console.log(`WebMCP CLI doctor: OK`);
    console.log(`  CLI: ${report.sections.cli.version} (node ${report.sections.cli.node})`);
    console.log(`  Browser: ${report.sections.browser.status}`);
    console.log(`  Skills: ${report.sections.skills.available}/${report.sections.skills.total} available`);
  } else {
    console.log(`WebMCP CLI doctor: NOT READY`);
    console.log(`  CLI: ${report.sections.cli.version} (node ${report.sections.cli.node})`);
    console.log(`  Browser: ${report.sections.browser.status}`);
    console.log(`  Skills: ${report.sections.skills.ok ? `${report.sections.skills.available}/${report.sections.skills.total} available` : `missing ${report.sections.skills.missing.join(', ') || 'inventory'}`}`);
  }
  return report.ok ? 0 : 1;
}
