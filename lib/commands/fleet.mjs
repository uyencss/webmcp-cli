import process from 'node:process';
import { execSync } from 'node:child_process';
import { parseFlags } from '../context.mjs';
import { CoherentProfileGenerator } from '../../../webmcp-fingerprint-kit/src/blueprints/hardware-blueprints.ts';
import { PlausibilityValidator } from '../../../webmcp-fingerprint-kit/src/validation/plausibility-validator.ts';
import { StealthInjector } from '../../../webmcp-fingerprint-kit/src/core/stealth-injector.ts';

const SCANNER_PYTHON_SCRIPT = `
import os, sys, json, sqlite3, subprocess

def scan():
    if sys.platform == 'darwin':
        chrome_root = os.path.expanduser('~/Library/Application Support/Google/Chrome')
    else:
        chrome_root = os.path.expanduser('~/.config/google-chrome')
        
    managed_root = os.path.expanduser('~/.webmcp/managed-profiles')
    
    running_dirs = set()
    try:
        ps_out = subprocess.check_output(['ps', '-eo', 'pid,args'], text=True)
        for line in ps_out.splitlines():
            if 'chrome' in line.lower():
                for part in line.split():
                    if part.startswith('--profile-directory='):
                        running_dirs.add(part.split('=', 1)[1].strip('"\\''))
                    elif part.startswith('--user-data-dir='):
                        running_dirs.add(os.path.basename(part.split('=', 1)[1].strip('"\\'')))
    except Exception:
        pass

    results = []
    
    ls_file = os.path.join(chrome_root, 'Local State')
    if os.path.exists(ls_file):
        try:
            with open(ls_file, 'r', encoding='utf-8') as f:
                ls = json.load(f)
            info_cache = ls.get('profile', {}).get('info_cache', {})
            for pdir, info in info_cache.items():
                p_path = os.path.join(chrome_root, pdir)
                cookie_path = os.path.join(p_path, 'Network', 'Cookies')
                if not os.path.exists(cookie_path):
                    cookie_path = os.path.join(p_path, 'Cookies')
                platforms = []
                if os.path.exists(cookie_path):
                    try:
                        conn = sqlite3.connect(f'file:{cookie_path}?mode=ro', uri=True)
                        cur = conn.cursor()
                        cur.execute('SELECT DISTINCT host_key FROM cookies')
                        hosts = set(row[0] for row in cur.fetchall())
                        conn.close()
                        if any('facebook.com' in h for h in hosts): platforms.append('facebook')
                        if any('accounts.google.com' in h or 'mail.google.com' in h for h in hosts): platforms.append('google')
                        if any('tiktok.com' in h for h in hosts): platforms.append('tiktok')
                        if any('douyin.com' in h for h in hosts): platforms.append('douyin')
                        if any('youtube.com' in h for h in hosts): platforms.append('youtube')
                    except Exception:
                        pass
                results.append({
                    'kind': 'existing',
                    'dir': pdir,
                    'name': info.get('name', ''),
                    'email': info.get('user_name', ''),
                    'gaiaName': info.get('gaia_name', ''),
                    'platforms': platforms,
                    'online': pdir in running_dirs
                })
        except Exception:
            pass

    if os.path.exists(managed_root):
        try:
            for mdir in os.listdir(managed_root):
                m_path = os.path.join(managed_root, mdir)
                if not os.path.isdir(m_path): continue
                meta_file = os.path.join(m_path, '.webmcp-meta.json')
                pref_file = os.path.join(m_path, 'Default', 'Preferences')
                cookie_path = os.path.join(m_path, 'Default', 'Network', 'Cookies')
                if not os.path.exists(cookie_path):
                    cookie_path = os.path.join(m_path, 'Default', 'Cookies')
                name = mdir
                email = ''
                if os.path.exists(meta_file):
                    try:
                        meta = json.load(open(meta_file))
                        name = meta.get('name', mdir)
                    except: pass
                if os.path.exists(pref_file):
                    try:
                        pref = json.load(open(pref_file))
                        accs = pref.get('account_info', [])
                        if accs: email = accs[0].get('email', '')
                    except: pass
                platforms = []
                if os.path.exists(cookie_path):
                    try:
                        conn = sqlite3.connect(f'file:{cookie_path}?mode=ro', uri=True)
                        cur = conn.cursor()
                        cur.execute('SELECT DISTINCT host_key FROM cookies')
                        hosts = set(row[0] for row in cur.fetchall())
                        conn.close()
                        if any('facebook.com' in h for h in hosts): platforms.append('facebook')
                        if any('accounts.google.com' in h or 'mail.google.com' in h for h in hosts): platforms.append('google')
                        if any('tiktok.com' in h for h in hosts): platforms.append('tiktok')
                        if any('douyin.com' in h for h in hosts): platforms.append('douyin')
                        if any('youtube.com' in h for h in hosts): platforms.append('youtube')
                    except Exception:
                        pass
                results.append({
                    'kind': 'managed',
                    'dir': mdir,
                    'name': name,
                    'email': email,
                    'gaiaName': '',
                    'platforms': platforms,
                    'online': mdir in running_dirs
                })
        except Exception:
            pass

    print(json.dumps(results))

scan()
`.trim();

const DEFAULT_NODES = [
  { id: 'local', alias: 'mac-m1-14-56', name: 'mac m1 14 56 (Host)', isLocal: true, hostOs: 'macos' },
  { id: 'mac-m1', alias: 'mac-m1-69', name: 'mac m1 69 (Tailscale)', sshHost: 'mac-m1', hostOs: 'macos' },
  { id: 'reup-minipc', alias: 'minipc', name: 'minipc (Ubuntu)', sshHost: 'reup-minipc', hostOs: 'linux' },
  { id: 'dell', alias: 'dell', name: 'dell (Laptop)', sshHost: 'dell', hostOs: 'windows' },
];

function runRemoteScan(node) {
  try {
    let out;
    if (node.isLocal) {
      out = execSync('python3 -', { input: SCANNER_PYTHON_SCRIPT, encoding: 'utf-8', timeout: 6000 });
    } else {
      out = execSync(`ssh -o BatchMode=yes -o ConnectTimeout=5 ${node.sshHost} 'python3 -'`, {
        input: SCANNER_PYTHON_SCRIPT,
        encoding: 'utf-8',
        timeout: 10000,
      });
    }
    const profiles = JSON.parse(out.trim());
    return { ok: true, node: node.id, name: node.name, hostOs: node.hostOs, profiles };
  } catch (err) {
    return { ok: false, node: node.id, name: node.name, hostOs: node.hostOs, error: err.message.split('\n')[0] };
  }
}

export function printFleetHelp() {
  console.log(`WebMCP Fleet Profile & Fingerprint Manager (Cluster-wide Discovery & Antidetect)

Usage:
  webmcp fleet [profiles|fingerprint] [--json] [--search <text>] [--node <node-id>]

Subcommands:
  profiles        List all browser profiles across all fleet nodes with session status (default)
  inspect         Alias for profiles
  fingerprint     Generate & validate Host-Aligned Fingerprints (13-Rule Plausibility + WebGPU + CDP)

Options:
  --json          Output full raw structured JSON (including CDP & CLI flags in fingerprint mode)
  --search <text> Filter by profile name, email, or platform
  --node <id>     Filter by specific node (e.g. local, reup-minipc, mac-m1)
  --help, -h      Show this help message

Examples:
  webmcp fleet
  webmcp fleet profiles --search hieu2906090001
  webmcp fleet fingerprint --node reup-minipc
  webmcp fleet fingerprint --node local --search "Profile 8" --json
`);
}

export async function runFleet(args = []) {
  const { flags, positional } = parseFlags(args);
  const subcommand = positional[0] || 'profiles';

  if (flags.help || flags.h || subcommand === 'help') {
    printFleetHelp();
    return 0;
  }

  const validSubcommands = new Set(['profiles', 'inspect', 'list', 'fingerprint', 'fingerprints']);
  if (!validSubcommands.has(subcommand)) {
    console.error(`Unknown fleet subcommand: ${subcommand}`);
    printFleetHelp();
    return 1;
  }

  const isFingerprintMode = subcommand === 'fingerprint' || subcommand === 'fingerprints';

  const nodesToScan = flags.node
    ? DEFAULT_NODES.filter(
        (n) =>
          n.id === flags.node ||
          n.alias === flags.node ||
          n.name.toLowerCase().includes(flags.node.toLowerCase()) ||
          (n.sshHost && n.sshHost.toLowerCase().includes(flags.node.toLowerCase()))
      )
    : DEFAULT_NODES;

  if (nodesToScan.length === 0) {
    console.error(`Node not found: ${flags.node}`);
    return 1;
  }

  const results = [];
  for (const node of nodesToScan) {
    const report = runRemoteScan(node);
    results.push(report);
  }

  const query = flags.search ? flags.search.toLowerCase() : null;

  if (isFingerprintMode) {
    return renderFleetFingerprints(results, query, flags);
  }

  if (flags.json) {
    const output = {
      timestamp: new Date().toISOString(),
      nodes: results.map((r) => {
        if (!r.ok) return r;
        let p = r.profiles;
        if (query) {
          p = p.filter((x) =>
            x.name.toLowerCase().includes(query) ||
            x.email.toLowerCase().includes(query) ||
            x.dir.toLowerCase().includes(query) ||
            x.platforms.some((pl) => pl.includes(query))
          );
        }
        return { ...r, profiles: p };
      }),
    };
    console.log(JSON.stringify(output, null, 2));
    return 0;
  }

  // Terminal human-readable table
  console.log(`\n🌐 WEBMCP FLEET PROFILE MATRIX (${new Date().toLocaleString()})\n`);
  
  for (const r of results) {
    console.log(`💻 Node: \x1b[1m\x1b[36m${r.name}\x1b[0m [${r.node}]`);
    if (!r.ok) {
      console.log(`   \x1b[31m⚠️ Offline / Không thể kết nối: ${r.error}\x1b[0m\n`);
      continue;
    }

    let profiles = r.profiles;
    if (query) {
      profiles = profiles.filter((x) =>
        x.name.toLowerCase().includes(query) ||
        x.email.toLowerCase().includes(query) ||
        x.dir.toLowerCase().includes(query) ||
        x.platforms.some((pl) => pl.includes(query))
      );
    }

    if (profiles.length === 0) {
      console.log(`   (Không có profile nào${query ? ` khớp với '${query}'` : ''})\n`);
      continue;
    }

    console.log(`   ┌────────────┬─────────────────────────────┬────────────────────────────────┬───────────────────────────────┬─────────┐`);
    console.log(`   │ Kind/Dir   │ Profile Name                │ Google / Email                 │ Logged-in Platforms           │ Status  │`);
    console.log(`   ├────────────┼─────────────────────────────┼────────────────────────────────┼───────────────────────────────┼─────────┤`);

    for (const p of profiles) {
      const kindDir = (p.kind === 'managed' ? `m:${p.dir}` : p.dir).padEnd(10).slice(0, 10);
      const name = (p.name || '-').padEnd(27).slice(0, 27);
      const email = (p.email || p.gaiaName || '-').padEnd(30).slice(0, 30);
      
      const pIcons = [];
      if (p.platforms.includes('google')) pIcons.push('Google');
      if (p.platforms.includes('facebook')) pIcons.push('FB');
      if (p.platforms.includes('tiktok')) pIcons.push('TikTok');
      if (p.platforms.includes('douyin')) pIcons.push('Douyin');
      if (p.platforms.includes('youtube')) pIcons.push('YT');
      const platformStr = (pIcons.length > 0 ? pIcons.join(', ') : 'none').padEnd(29).slice(0, 29);
      
      const statusStr = p.online ? '\x1b[32m● Active\x1b[0m ' : '\x1b[90m○ Idle\x1b[0m   ';

      console.log(`   │ ${kindDir} │ ${name} │ ${email} │ ${platformStr} │ ${statusStr} │`);
    }
    console.log(`   └────────────┴─────────────────────────────┴────────────────────────────────┴───────────────────────────────┴─────────┘\n`);
  }

  return 0;
}

function renderFleetFingerprints(results, query, flags) {
  const enrichedNodes = results.map((r) => {
    if (!r.ok) return r;
    let profiles = r.profiles;
    if (query) {
      profiles = profiles.filter(
        (x) =>
          x.name.toLowerCase().includes(query) ||
          x.email.toLowerCase().includes(query) ||
          x.dir.toLowerCase().includes(query) ||
          x.platforms.some((pl) => pl.includes(query))
      );
    }
    const fingerprintedProfiles = profiles.map((p) => {
      const fp = CoherentProfileGenerator.generateForNode(r.node, p.dir, r.hostOs || 'macos');
      const validation = PlausibilityValidator.validate(fp);
      return {
        ...p,
        fingerprint: fp,
        plausibility: validation,
        nativeLaunchFlags: StealthInjector.getNativeLaunchFlags(fp),
        cdpEmulationCommands: StealthInjector.getCDPEmulationCommands(fp),
      };
    });
    return { ...r, profiles: fingerprintedProfiles };
  });

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          architecture: 'Ponytail 2026 Host-Aligned Native-First',
          nodes: enrichedNodes,
        },
        null,
        2
      )
    );
    return 0;
  }

  console.log(`\n🛡️  WEBMCP FLEET HOST-ALIGNED FINGERPRINT MATRIX (Ponytail 2026 Edition)\n`);

  for (const r of enrichedNodes) {
    console.log(`💻 Node: \x1b[1m\x1b[36m${r.name}\x1b[0m [${r.node}] — Host OS: \x1b[33m${r.hostOs}\x1b[0m`);
    if (!r.ok) {
      console.log(`   \x1b[31m⚠️ Offline / Không thể kết nối: ${r.error}\x1b[0m\n`);
      continue;
    }

    if (r.profiles.length === 0) {
      console.log(`   (Không có profile nào${query ? ` khớp với '${query}'` : ''})\n`);
      continue;
    }

    console.log(`   ┌────────────┬──────────────────────────┬───────────────────────────┬──────────────────────────┬───────────────────┬──────────────┐`);
    console.log(`   │ Dir        │ Email / Name             │ Host-Aligned Blueprint    │ WebGPU & WebGL Vendor    │ Screen / Cores    │ Plausibility │`);
    console.log(`   ├────────────┼──────────────────────────┼───────────────────────────┼──────────────────────────┼───────────────────┼──────────────┤`);

    for (const p of r.profiles) {
      const fp = p.fingerprint;
      const val = p.plausibility;
      const dirStr = p.dir.padEnd(10).slice(0, 10);
      const idStr = (p.email || p.name || '-').padEnd(24).slice(0, 24);
      const bpStr = fp.blueprintId.padEnd(25).slice(0, 25);
      const gpuStr = `${fp.webgpu.vendor}:${fp.webgpu.architecture}`.padEnd(24).slice(0, 24);
      const hwStr = `${fp.screen.width}x${fp.screen.height} (${fp.navigator.hardwareConcurrency}c)`.padEnd(17).slice(0, 17);
      const scoreStr = val.isPlausible
        ? `\x1b[32m✓ ${val.score}% (13/13)\x1b[0m`
        : `\x1b[31m✗ ${val.score}%\x1b[0m       `;

      console.log(`   │ ${dirStr} │ ${idStr} │ ${bpStr} │ ${gpuStr} │ ${hwStr} │ ${scoreStr} │`);
    }
    console.log(`   └────────────┴──────────────────────────┴───────────────────────────┴──────────────────────────┴───────────────────┴──────────────┘\n`);
  }

  return 0;
}
