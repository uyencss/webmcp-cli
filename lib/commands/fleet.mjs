import process from 'node:process';
import { execSync } from 'node:child_process';
import { parseFlags } from '../context.mjs';
import { CoherentProfileGenerator } from '../../../webmcp-fingerprint-kit/src/blueprints/hardware-blueprints.ts';
import { PlausibilityValidator } from '../../../webmcp-fingerprint-kit/src/validation/plausibility-validator.ts';
import { StealthInjector } from '../../../webmcp-fingerprint-kit/src/core/stealth-injector.ts';

const SCANNER_PYTHON_SCRIPT = `
import os, sys, json, sqlite3, subprocess

def inspect_cookies(cookie_path):
    platforms = []
    cookie_count = 0
    host_count = 0
    if os.path.exists(cookie_path):
        try:
            conn = sqlite3.connect(f'file:{cookie_path}?mode=ro', uri=True)
            cur = conn.cursor()
            cur.execute('SELECT COUNT(*) FROM cookies')
            row_cnt = cur.fetchone()
            if row_cnt:
                cookie_count = int(row_cnt[0] or 0)
            cur.execute('SELECT DISTINCT host_key FROM cookies')
            hosts = set(row[0] for row in cur.fetchall() if row and row[0])
            host_count = len(hosts)
            conn.close()
            if any('facebook.com' in h for h in hosts): platforms.append('facebook')
            if any('accounts.google.com' in h or 'mail.google.com' in h for h in hosts): platforms.append('google')
            if any('tiktok.com' in h for h in hosts): platforms.append('tiktok')
            if any('douyin.com' in h for h in hosts): platforms.append('douyin')
            if any('youtube.com' in h for h in hosts): platforms.append('youtube')
            if any('shopee.' in h for h in hosts): platforms.append('shopee')
            if any('twitter.com' in h or 'x.com' in h for h in hosts): platforms.append('x')
            if any('github.com' in h for h in hosts): platforms.append('github')
        except Exception:
            pass
    return platforms, cookie_count, host_count

def inspect_lock_meta(profile_root):
    locked_mode = None
    locked_at_creation = False
    for fname in ('.webmcp-meta.json', '.fingerprint-lock.json'):
        fpath = os.path.join(profile_root, fname)
        if os.path.exists(fpath):
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    meta = json.load(f)
                if meta.get('stealthMode') or meta.get('fingerprintMode'):
                    locked_mode = meta.get('stealthMode') or meta.get('fingerprintMode')
                if meta.get('fingerprintLockedAtCreation') is True or meta.get('lockedAtCreation') is True:
                    locked_at_creation = True
            except Exception:
                pass
    return locked_mode, locked_at_creation

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
                platforms, cookie_count, host_count = inspect_cookies(cookie_path)
                locked_mode, locked_at_creation = inspect_lock_meta(p_path)
                results.append({
                    'kind': 'existing',
                    'dir': pdir,
                    'name': info.get('name', ''),
                    'email': info.get('user_name', ''),
                    'gaiaName': info.get('gaia_name', ''),
                    'platforms': platforms,
                    'cookieCount': cookie_count,
                    'hostCount': host_count,
                    'lockedMode': locked_mode,
                    'fingerprintLockedAtCreation': locked_at_creation,
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
                platforms, cookie_count, host_count = inspect_cookies(cookie_path)
                locked_mode, locked_at_creation = inspect_lock_meta(m_path)
                results.append({
                    'kind': 'managed',
                    'dir': mdir,
                    'name': name,
                    'email': email,
                    'gaiaName': '',
                    'platforms': platforms,
                    'cookieCount': cookie_count,
                    'hostCount': host_count,
                    'lockedMode': locked_mode,
                    'fingerprintLockedAtCreation': locked_at_creation,
                    'online': mdir in running_dirs
                })
        except Exception:
            pass

    detected_os = 'macos' if sys.platform == 'darwin' else ('windows' if sys.platform.startswith('win') else 'linux')
    print(json.dumps({'hostOs': detected_os, 'profiles': results}))

scan()
`.trim();

const DEFAULT_NODES = [
  { id: 'local', alias: 'mac-m1-14-56', name: 'mac m1 14 56 (Host)', isLocal: true, hostOs: 'macos' },
  { id: 'mac-m1', alias: 'mac-m1-69', name: 'mac m1 69 (Tailscale)', sshHost: 'mac-m1', hostOs: 'macos' },
  { id: 'reup-minipc', alias: 'minipc', name: 'minipc (Ubuntu)', sshHost: 'reup-minipc', hostOs: 'linux' },
  { id: 'dell', alias: 'dell', name: 'dell (Laptop)', sshHost: 'dell', hostOs: 'linux' },
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
    const parsed = JSON.parse(out.trim());
    const profiles = Array.isArray(parsed) ? parsed : parsed.profiles || [];
    const detectedHostOs = (!Array.isArray(parsed) && parsed.hostOs) ? parsed.hostOs : node.hostOs;
    return { ok: true, node: node.id, name: node.name, hostOs: detectedHostOs, profiles };
  } catch (err) {
    return { ok: false, node: node.id, name: node.name, hostOs: node.hostOs, error: err.message.split('\n')[0] };
  }
}

const HOMELAB_FINGERPRINT_PLAYBOOK = {
  package: '@webmcp/fingerprint-kit v2.0 (Ponytail 2026 Host-Aligned Edition)',
  whatItIs:
    'Hệ thống sinh & kiểm định vân tay trình duyệt 4 tầng (C++ CLI Flags, CDP Native Emulation, V8 Prototype Stealth + Brave Farbling 1-LSB theo eTLD+1 domain, 17 Hardware Blueprints & 13-Rule Plausibility Validator) tích hợp bộ phán quyết chống đổi vân tay giữa chừng (Anti Mid-Session Fingerprint Mutation).',
  sameOsRule:
    'BẮT BUỘC giữ cố định theo họ hệ điều hành thật của máy vật lý (Same-OS Lock): máy Mac (local, mac-m1) chỉ sinh macos; máy Ubuntu/Linux (reup-minipc, dell) chỉ sinh linux. Tuyệt đối không fake chéo OS để tránh lệch chữ ký mạng TCP/TLS JA4 và Font.',
  homelabUsageRules: {
    SKIP_SESSION_BOUND:
      '⛔ NO (native-clean, 0B JS / 0 CDP): Áp dụng cho MỌI profile đang có Cookie sống (Google, YouTube, FB, TikTok, Douyin). Tuyệt đối không tiêm JS/CDP đè vào phiên đang sống để tránh Mid-Session Fingerprint Mutation làm văng cookie/checkpoint.',
    INJECT_MICRO_FARBLING:
      '✅ YES (micro-farbling): Áp dụng khi tạo profile MỚI TINH (Cold Start <= 15 cookies, chưa login) để nuôi nhiều tài khoản MXH/TMĐT trên cùng 1 máy. Giữ nguyên 100% OS/GPU máy thật, chỉ xoay nhẹ mã băm Canvas/OffscreenCanvas/Audio theo seed + domain.',
    LOCKED_AT_CREATION:
      '🔒 YES (lockedMode): Profile đã được khóa chế độ fingerprint trong .webmcp-meta.json ngay từ lúc tạo mới (Cold Start) -> tiếp tục duy trì đúng chế độ đó xuyên suốt vòng đời.',
    INJECT_FULL_COHERENT:
      '🔵 YES (full-coherent): Chỉ dùng cho profile rỗng chạy tác vụ cào dữ liệu ẩn danh (Anonymous Scraping / Guest).',
    INJECT_CPP_ENGINE:
      '🟣 YES (cpp-engine): Dùng khi chạy trên binary nhân C++ adryfish/fingerprint-chromium (--fingerprint=<uint32_seed>, 0B JS).',
  },
  howToLockNewProfile:
    'Khi tạo profile mới ở Cold Start, ghi vào <profileDir>/.webmcp-meta.json: {"stealthMode": "micro-farbling", "fingerprintLockedAtCreation": true} trước khi đăng nhập lần đầu.',
};

export function printFleetHelp() {
  console.log(`WebMCP Fleet Profile & Fingerprint Manager (Cluster-wide Discovery & Antidetect)

Usage:
  webmcp fleet [profiles|fingerprint] [--json] [--search <text>] [--node <node-id>] [--mode <stealth-mode>]

Subcommands:
  profiles        List all browser profiles across all fleet nodes with session & fingerprint decision status (default)
  inspect         Alias for profiles
  fingerprint     Evaluate Fingerprint Injection Decision (Should Inject? + 4 StealthModes + 13-Rule Plausibility + Homelab Playbook)

Options:
  --json          Output full raw structured JSON (including homelabPlaybook, telemetry signals, decision, CDP & CLI flags)
  --search <text> Filter by profile name, email, or platform
  --node <id>     Filter by specific node (e.g. local, reup-minipc, mac-m1, dell)
  --mode <mode>   Override StealthMode (native-clean | micro-farbling | full-coherent | cpp-engine)
  --help, -h      Show this help message

Homelab Fingerprint Rules (4 Nodes: local, mac-m1, reup-minipc, dell):
  1. ⛔ NO (SessionBound -> native-clean): Profiles with active cookies MUST NOT inject JS/CDP (0B JS) to prevent Mid-Session Mutation.
  2. ✅ YES (ColdStart -> micro-farbling): Brand-new empty profiles (<=15 cookies) use Same-OS Brave Farbling (1-LSB Canvas/Audio).
  3. 🔒 YES (LockedMeta): Lock mode at creation in .webmcp-meta.json: {"stealthMode":"micro-farbling","fingerprintLockedAtCreation":true}.
  4. 🖥️  Same-OS Lock: macOS nodes only generate macos blueprints; Linux/Ubuntu nodes only generate linux blueprints.

Examples:
  webmcp fleet
  webmcp fleet profiles --search hieu2906090001
  webmcp fleet fingerprint --node local
  webmcp fleet fingerprint --node local --search "Profile 8" --json
`);
}

function enrichNodeProfilesWithDecisions(results, query, flags) {
  const socialPlatforms = ['facebook', 'tiktok', 'douyin', 'shopee', 'x'];

  return results.map((r) => {
    if (!r.ok) return r;
    const allNodeProfiles = r.profiles || [];
    let profiles = allNodeProfiles;
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

      const mySocial = (p.platforms || []).filter((pl) => socialPlatforms.includes(pl));
      const sameNodeSocialSiblings = allNodeProfiles.filter(
        (other) =>
          other.dir !== p.dir &&
          Array.isArray(other.platforms) &&
          other.platforms.some((pl) => mySocial.includes(pl))
      ).length;

      const decision = StealthInjector.evaluateProfileDecision({
        kind: p.kind,
        dir: p.dir,
        email: p.email,
        gaiaName: p.gaiaName,
        platforms: p.platforms,
        cookieCount: p.cookieCount,
        hostCount: p.hostCount,
        sameNodeSocialSiblings,
        lockedMode: p.lockedMode,
        fingerprintLockedAtCreation: p.fingerprintLockedAtCreation,
        forcedMode: flags.mode || undefined,
      });

      const modeConfig = StealthInjector.getModeConfiguration(fp, decision.recommendedMode);
      return {
        ...p,
        sameNodeSocialSiblings,
        shouldInjectFingerprint: decision.shouldInjectFingerprint,
        decisionCode: decision.decisionCode,
        riskIfInjectedNow: decision.riskIfInjectedNow,
        decisionReason: decision.reason,
        recommendedMode: decision.recommendedMode,
        modeRationale: modeConfig.rationale,
        jsInjectionBytes: modeConfig.injectionScript.length,
        fingerprint: fp,
        plausibility: validation,
        nativeLaunchFlags: modeConfig.cliFlags,
        cdpEmulationCommands: modeConfig.cdpCommands,
      };
    });
    return { ...r, profiles: fingerprintedProfiles };
  });
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
  const enrichedNodes = enrichNodeProfilesWithDecisions(results, query, flags);

  if (isFingerprintMode) {
    return renderFleetFingerprints(enrichedNodes, query, flags);
  }

  if (flags.json) {
    const output = {
      timestamp: new Date().toISOString(),
      homelabPlaybook: HOMELAB_FINGERPRINT_PLAYBOOK,
      nodes: enrichedNodes.map((r) => {
        if (!r.ok) return r;
        return {
          ...r,
          profiles: r.profiles.map(({ fingerprint, plausibility, nativeLaunchFlags, cdpEmulationCommands, ...rest }) => rest),
        };
      }),
    };
    console.log(JSON.stringify(output, null, 2));
    return 0;
  }

  // Terminal human-readable table
  console.log(`\n🌐 WEBMCP FLEET PROFILE & STEALTH DECISION MATRIX (${new Date().toLocaleString()})\n`);
  
  for (const r of enrichedNodes) {
    console.log(`💻 Node: \x1b[1m\x1b[36m${r.name}\x1b[0m [${r.node}] — Host OS: \x1b[33m${r.hostOs || 'unknown'}\x1b[0m`);
    if (!r.ok) {
      console.log(`   \x1b[31m⚠️ Offline / Không thể kết nối: ${r.error}\x1b[0m\n`);
      continue;
    }

    const profiles = r.profiles;
    if (profiles.length === 0) {
      console.log(`   (Không có profile nào${query ? ` khớp với '${query}'` : ''})\n`);
      continue;
    }

    console.log(`   ┌────────────┬─────────────────────────┬────────────────────────────┬───────────────────────────┬──────────────────────┬─────────┐`);
    console.log(`   │ Kind/Dir   │ Profile Name            │ Google / Email             │ Logged-in Platforms       │ Inject Fingerprint?  │ Status  │`);
    console.log(`   ├────────────┼─────────────────────────┼────────────────────────────┼───────────────────────────┼──────────────────────┼─────────┤`);

    for (const p of profiles) {
      const kindDir = (p.kind === 'managed' ? `m:${p.dir}` : p.dir).padEnd(10).slice(0, 10);
      const name = (p.name || '-').padEnd(23).slice(0, 23);
      const email = (p.email || p.gaiaName || '-').padEnd(26).slice(0, 26);
      
      const pIcons = [];
      if (p.platforms.includes('google')) pIcons.push('Google');
      if (p.platforms.includes('facebook')) pIcons.push('FB');
      if (p.platforms.includes('tiktok')) pIcons.push('TikTok');
      if (p.platforms.includes('douyin')) pIcons.push('Douyin');
      if (p.platforms.includes('youtube')) pIcons.push('YT');
      if (p.platforms.includes('shopee')) pIcons.push('Shopee');
      if (p.platforms.includes('x')) pIcons.push('X');
      if (p.platforms.includes('github')) pIcons.push('GitHub');
      const platformStr = (pIcons.length > 0 ? pIcons.join(', ') : `none (${p.cookieCount || 0}c)`).padEnd(25).slice(0, 25);

      const injectShort = !p.shouldInjectFingerprint
        ? `\x1b[32m⛔ NO (native-clean)\x1b[0m `
        : p.decisionCode === 'LOCKED_AT_CREATION'
          ? `\x1b[36m🔒 YES (${p.recommendedMode})\x1b[0m`.padEnd(29)
          : `\x1b[33m✅ YES (micro-farb)\x1b[0m  `;
      
      const statusStr = p.online ? '\x1b[32m● Active\x1b[0m ' : '\x1b[90m○ Idle\x1b[0m   ';

      console.log(`   │ ${kindDir} │ ${name} │ ${email} │ ${platformStr} │ ${injectShort} │ ${statusStr} │`);
    }
    console.log(`   └────────────┴─────────────────────────┴────────────────────────────┴───────────────────────────┴──────────────────────┴─────────┘\n`);
  }

  console.log(`💡 Tip: Chạy \x1b[36mwebmcp fleet fingerprint [--node <id>] [--json]\x1b[0m để xem chi tiết Blueprint, 13-Rule Plausibility & Homelab Playbook.\n`);
  return 0;
}

function renderFleetFingerprints(enrichedNodes, query, flags) {
  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          architecture: 'Ponytail 2026 Host-Aligned Native-First + Session Binding Decision Engine',
          homelabPlaybook: HOMELAB_FINGERPRINT_PLAYBOOK,
          nodes: enrichedNodes,
        },
        null,
        2
      )
    );
    return 0;
  }

  console.log(`\n🛡️  WEBMCP FLEET FINGERPRINT DECISION & STEALTH MODE MATRIX (2026 Edition)\n`);

  for (const r of enrichedNodes) {
    console.log(`💻 Node: \x1b[1m\x1b[36m${r.name}\x1b[0m [${r.node}] — Host OS: \x1b[33m${r.hostOs}\x1b[0m (Same-OS Locked)`);
    if (!r.ok) {
      console.log(`   \x1b[31m⚠️ Offline / Không thể kết nối: ${r.error}\x1b[0m\n`);
      continue;
    }

    if (r.profiles.length === 0) {
      console.log(`   (Không có profile nào${query ? ` khớp với '${query}'` : ''})\n`);
      continue;
    }

    console.log(`   ┌────────────┬──────────────────────┬───────────────────────┬───────────────────────┬────────────────────┬───────────────────┬────────────┐`);
    console.log(`   │ Dir        │ Email / Name         │ Cookies / Platforms   │ Inject Fingerprint?   │ Stealth Mode       │ JS / CDP Footprint│ Plausible  │`);
    console.log(`   ├────────────┼──────────────────────┼───────────────────────┼───────────────────────┼────────────────────┼───────────────────┼────────────┤`);

    for (const p of r.profiles) {
      const val = p.plausibility;
      const dirStr = p.dir.padEnd(10).slice(0, 10);
      const idStr = (p.email || p.name || '-').padEnd(20).slice(0, 20);
      const platShort = p.platforms && p.platforms.length > 0 ? p.platforms.join(',') : 'none';
      const cookiePlatStr = `${p.cookieCount || 0}c (${platShort})`.padEnd(21).slice(0, 21);

      const injectBadge = !p.shouldInjectFingerprint
        ? `\x1b[32m⛔ NO (SessionBound)\x1b[0m  `
        : p.decisionCode === 'LOCKED_AT_CREATION'
          ? `\x1b[36m🔒 YES (LockedMeta)\x1b[0m   `
          : `\x1b[33m✅ YES (ColdStart)\x1b[0m    `;

      const modeBadge =
        p.recommendedMode === 'native-clean'
          ? `\x1b[32m🟢 native-clean\x1b[0m    `
          : p.recommendedMode === 'micro-farbling'
            ? `\x1b[33m🟡 micro-farbling\x1b[0m  `
            : p.recommendedMode === 'cpp-engine'
              ? `\x1b[35m🟣 cpp-engine\x1b[0m      `
              : `\x1b[36m🔵 full-coherent\x1b[0m   `;

      const footprintStr = `${p.jsInjectionBytes}B / ${p.cdpEmulationCommands.length} CDP`.padEnd(17).slice(0, 17);
      const scoreStr = val.isPlausible
        ? `\x1b[32m✓ ${val.score}% (13)\x1b[0m`
        : `\x1b[31m✗ ${val.score}%\x1b[0m    `;

      console.log(`   │ ${dirStr} │ ${idStr} │ ${cookiePlatStr} │ ${injectBadge} │ ${modeBadge} │ ${footprintStr} │ ${scoreStr} │`);
    }
    console.log(`   └────────────┴──────────────────────┴───────────────────────┴───────────────────────┴────────────────────┴───────────────────┴────────────┘\n`);
  }

  console.log(`📘 HOMELAB FINGERPRINT PLAYBOOK (Quy tắc thực chiến cho 4 máy Homelab):`);
  console.log(`   • ⛔ NO (SessionBound -> 🟢 native-clean): Profile đã có Cookie sống (Google/FB/TikTok/Douyin) -> TUYỆT ĐỐI KHÔNG tiêm JS/CDP (0B JS) để chống Mid-Session Fingerprint Mutation.`);
  console.log(`   • ✅ YES (ColdStart   -> 🟡 micro-farbling): Profile mới/trống (<=15 cookies) -> Bật Same-OS Brave Farbling (giữ nguyên OS/GPU máy thật, chỉ xoay 1-LSB Canvas/Audio theo seed + domain).`);
  console.log(`   • 🔒 YES (LockedMeta): Khi tạo profile mới cần nuôi đa tài khoản, khóa ngay từ đầu trong .webmcp-meta.json: {"stealthMode":"micro-farbling","fingerprintLockedAtCreation":true}.`);
  console.log(`   • 🖥️  Same-OS Lock: Máy Mac (local, mac-m1) chỉ sinh macOS; máy Ubuntu/Linux (reup-minipc, dell) chỉ sinh Linux.\n`);

  return 0;
}
