---
name: webmcp-fingerprint-kit
description: Evaluate Chrome profile fingerprint telemetry, enforce Homelab Anti-Mid-Session-Mutation rules, generate OS-coherent Desktop & Android Mobile Digital Twin blueprints (17 Core + 237 Extended blueprints), validate profiles against the 15-Rule PlausibilityValidator, inject 4-layer Chromium 148/153 stealth (native flags, recursive Worker/OOPIF CDP auto-attach, 10-invariant V8 prototype IIFE), align proxy geo/timezone/locale, generate Firefox/Gecko user.js, and clean Chromium profile caches. Trigger on 'fingerprint', 'webmcp fingerprint', 'fleet fingerprint', 'StealthInjector', 'StealthBrowser', 'CoherentProfileGenerator', 'PlausibilityValidator', 'ExtendedBlueprintRegistry', 'micro-farbling', 'native-clean', 'full-coherent', 'cpp-engine', 'attachCdpToTargets', 'applyProxyGeo', 'cleanProfileTmp', 'generateGeckoUserJs'.
---

# WebMCP Fingerprint Kit (`@webmcp/fingerprint-kit` v2.2)

- **Package Root**: `/Users/ttcenter/Desktop/VIBE_CODE/webmcp-automation-kit/packages/webmcp-fingerprint-kit` (`src/index.ts`)
- **CLI Skill Location**: `/Users/ttcenter/Desktop/VIBE_CODE/webmcp-automation-kit/packages/webmcp-cli/skills/webmcp-fingerprint-kit/SKILL.md` (`webmcp skills path webmcp-fingerprint-kit` or `webmcp skills path fingerprint`)
- **CLI Commands**:
  - `webmcp fingerprint [--node <id>] [--mode <mode>] [--search <query>] [--json]`
  - `webmcp fleet fingerprint [--node <id>] [--mode <mode>] [--search <query>] [--json]`

---

## 1. Rule #1: Homelab Telemetry Decision Engine & Anti-Mid-Session Mutation

Homelab cluster nodes (`local`, `mac-m1`, `reup-minipc`, `dell`) run on **100% real physical hardware** (real GPU, audio stack, OS fonts, TCP/IP + TLS JA3/JA4).

`StealthInjector.evaluateProfileDecision(telemetry)` (`src/core/stealth-injector.ts`) enforces the **Anti-Mid-Session Fingerprint Mutation Invariant**: never inject JS fingerprint overrides into a profile that already holds live authenticated session cookies unless that profile was locked to a stealth mode at cold-start creation.

| Profile State (`ProfileTelemetryInput`) | `shouldInjectFingerprint` | `decisionCode` | `recommendedMode` | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **Live Session Cookies Present** (`platforms.length > 0`, `email`/`gaiaName` present, or `cookieCount > 15`) without creation lock | `false` (`⛔ NO`) | `SKIP_SESSION_BOUND` | `native-clean` | Session cookies (`SID`/`SAPISID`, `c_user`/`xs`, `sessionid`) are bound to the hardware hash recorded at login. Mid-session Canvas/Audio/WebGL mutation triggers **Session Hijacking / Environment Drift** checkpoints. |
| **Locked at Cold Start** (`fingerprintLockedAtCreation: true` or `lockedMode` in `.webmcp-meta.json` / `.fingerprint-lock.json`) | `true` (`🔒 YES`) | `LOCKED_AT_CREATION` | `lockedMode` | Profile was initialized with this seed and `StealthMode` before first login; maintain the exact seed across the account lifecycle. |
| **Fresh / Cold-Start Profile** (`cookieCount <= 15`, `platforms = []`) for multi-account social/e-commerce farming | `true` (`✅ YES`) | `INJECT_MICRO_FARBLING` | `micro-farbling` | Isolates Canvas/OffscreenCanvas/Audio hashes per profile + eTLD+1 domain from day zero while preserving 100% native Host OS, GPU, Navigator, Screen, and Fonts. |
| **Cold-Start Profile on `fingerprint-chromium`** (`cppEngineAvailable: true`) | `true` (`✅ YES`) | `INJECT_CPP_ENGINE` | `cpp-engine` | Passes `--fingerprint=<uint32_seed>` to C++ Blink/Skia with `0B` JS injection. |
| **Disposable Anonymous Scraping Profile** (`purpose: 'anonymous-scraping'`) | `true` (`✅ YES`) | `INJECT_FULL_COHERENT` | `full-coherent` | Applies full 4-layer stealth (Launch Flags + `TZ` env + 5 CDP Emulation overrides + Worker/OOPIF Auto-Attach + 10-Invariant V8 Stealth IIFE). |

### Cold-Start Profile Lock (`.webmcp-meta.json`)

When creating a new profile in `~/.webmcp/managed-profiles/<slug>/` for multi-account farming, lock its stealth mode before first launch:

```json
{
  "name": "tiktok-acc-01",
  "stealthMode": "micro-farbling",
  "fingerprintLockedAtCreation": true
}
```

---

## 2. Four `StealthMode` Tiers

| Mode | JS Payload | CDP Commands | Launch Flags & Spawn Env | Primary Use Case |
| :--- | :--- | :--- | :--- | :--- |
| `native-clean` | `0 B` | `0` | `--disable-blink-features=AutomationControlled` (+ WebRTC/loopback flags only when `hasProxy: true`); host `TZ` untouched | All live logged-in Chrome profiles (`Chrome:Default`, `Chrome:Profile *`) |
| `micro-farbling` | `~8 KB` (Canvas/Audio/Iframe guard only) | `0` | Same as `native-clean`; host `TZ` untouched | Multi-account farming (`5–10` FB/TikTok/Douyin/Shopee accounts on 1 host) |
| `full-coherent` | `~18 KB` (Full 10-invariant V8 IIFE) | `5` + Recursive Worker/OOPIF auto-attach | Native flags + `--window-size` + `--lang` + `TZ=<profile.timezone.id>` | Disposable guest/anonymous scraping or cross-hardware persona emulation |
| `cpp-engine` | `0 B` | `0` | `--fingerprint=<seed> --fingerprint-platform=<os> --timezone=<tz> --lang=<locale>` + `TZ=<profile.timezone.id>` | `adryfish/fingerprint-chromium` binary |

---

## 3. 4-Layer Defense-in-Depth Architecture (v2.1 + v2.2)

### Layer 0: Native Launch Flags, Spawn Env & Resource Saver (`src/core/stealth-injector.ts`)

- `StealthInjector.getNativeLaunchFlags(profile, { mode, hasProxy, extraDisabledFeatures, resourceSaver })`:
  - Always passes `--disable-blink-features=AutomationControlled` (`navigator.webdriver === false` natively in C++ Blink without JS descriptors).
  - **Conditional Proxy/WebRTC Flags (`hasProxy: true`)**: Emits `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`, `--enforce-webrtc-ip-permission-check`, and `--proxy-bypass-list=<-loopback>` **only** when `hasProxy: true`.
  - **Resource Saver (`resourceSaver: true`)**: Merges `RESOURCE_SAVER_DISABLED_FEATURES` (`OptimizationHints`, `Translate`, `MediaRouter`, `CalculateNativeWinOcclusion`, `HardwareMediaKeyHandling`) into a single `--disable-features=...` flag and appends `RESOURCE_SAVER_EXTRA_FLAGS` (`--disable-background-timer-throttling`, `--disable-renderer-backgrounding`, `--disable-backgrounding-occluded-windows`, `--disable-ipc-flooding-protection`) to prevent background tab timer/`rAF` throttling.
- `StealthInjector.getSpawnEnv(profile, mode)`:
  - Sets `TZ: profile.timezone.id` **only** in `full-coherent` and `cpp-engine` modes so V8 `new Date().getTimezoneOffset()` and `Intl` match CDP `Emulation.setTimezoneOverride`.

### Layer 1: Native CDP Emulation & Recursive Worker/OOPIF Auto-Attach (`src/core/cdp-target-attacher.ts`)

- `StealthInjector.getCDPEmulationCommands(profile, { mode })`:
  - Returns 5 C++ Blink CDP overrides in `full-coherent` mode: `Emulation.setUserAgentOverride` (including full `userAgentMetadata` Client Hints: `brands`, `fullVersionList`, `platform`, `platformVersion`, `architecture`, `bitness`, `model`, `mobile`, `wow64`), `Emulation.setHardwareConcurrencyOverride`, `Emulation.setTimezoneOverride`, `Emulation.setLocaleOverride`, and `Emulation.setDeviceMetricsOverride`.
- `attachCdpToTargets(target, profile, options)`:
  - Attaches `Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true })` recursively on both Browser and Page CDP sessions.
  - Pauses `dedicated_worker`, `shared_worker`, `service_worker`, and cross-origin `iframe` (OOPIF) targets at startup (`waitingForDebugger`), sends `Emulation.setUserAgentOverride` + `Emulation.setHardwareConcurrencyOverride` + `Emulation.setTimezoneOverride` + `Emulation.setLocaleOverride`, and resumes via `Runtime.runIfWaitingForDebugger` **without ever calling `Runtime.enable`**.
  - Guarantees `self.navigator.userAgent`, `userAgentData`, `hardwareConcurrency`, `language`, `languages`, and `Intl.DateTimeFormat().resolvedOptions().timeZone` inside Workers match `window.navigator` 100%.

### Layer 2: 10-Invariant V8 Prototype Stealth IIFE (`src/core/v8-stealth-iife.ts`)

Generated via `StealthInjector.buildStealthScript(profile, { mode })` and injected via `Page.addScriptToEvaluateOnNewDocument`:

1. **Zero JS `webdriver` Patch**: Never touches `Navigator.prototype.webdriver` in JS; handled natively by `--disable-blink-features=AutomationControlled`.
2. **Zero `Window.prototype` Own-Property Leaks**: `Object.getOwnPropertyNames(Window.prototype)` remains `["constructor"]`; `devicePixelRatio` and window dimensions stay on the `window` instance.
3. **Prototype-less Concise Method Wrappers (`'prototype' in fn === false`)**: All wrapped methods use concise method syntax `{ [name](...args) { ... } }[name]` and register in a cross-realm `WeakMap` so `Function.prototype.toString.call(fn)` returns `"function <name>() { [native code] }"` without leaking own `.prototype` or `.toString` properties.
4. **WebIDL Enumerability & Brand Check Preservation**: Preserves native `enumerable` flags (`true` on `Navigator`, `Screen`, `GPUAdapterInfo`; `false` on `HTMLIFrameElement.prototype.contentWindow`) and delegates `Illegal invocation` `TypeError` to native C++ getters/methods with spoofed stack frames stripped.
5. **Cross-Realm `WeakMap` + Non-Enumerable `Symbol.for` Guard**: Prevents `WeakSet` identity loss and double-patching across `about:blank`/`srcdoc` iframes (`patchRealm`), DOM insertions (`appendChild`, `insertBefore`, `replaceChild`, `Element.prototype.append`/`prepend`/`replaceWith`/`after`/`before`, `insertAdjacentElement`, `innerHTML`/`outerHTML`, `insertAdjacentHTML`), and `contentWindow`/`contentDocument` getters.
6. **WebGL `37445` / `37446` Parameter Discipline**: Overrides only `UNMASKED_VENDOR_WEBGL` (`37445`) and `UNMASKED_RENDERER_WEBGL` (`37446`) on `WebGLRenderingContext.prototype.getParameter` and `WebGL2RenderingContext.prototype.getParameter`.
7. **WebGPU `GPUAdapterInfo.prototype` Getters**: Patches `vendor`, `architecture`, `device`, `description` on `GPUAdapterInfo.prototype` with `0` instance own properties (`Object.keys(adapter.info).length === 0`).
8. **Coordinate-Locked Idempotent Canvas 1-LSB Brave Farbling**: Uses deterministic coordinate hash `((x * 73856093) ^ (y * 19349663) ^ domainSeed) >>> 0` (1-in-64 sparse pixel mask) with `dirtyCanvasSet` tracking so repeated `getImageData` / `toDataURL` / `toBlob` / `convertToBlob` reads on an unmodified canvas return bit-identical bytes while sub-rectangle reads match full-canvas slices at `(sx + x, sy + y)`.
9. **Multi-Channel `AudioBuffer` Farbling + Silent Buffer Preservation**: Farbles `getChannelData` and `copyFromChannel` per channel (`WeakMap<AudioBuffer, Set<number>>`) while skipping all-zero silent buffers (`max(|sample|) === 0`).
10. **Sub-Pixel `TextMetrics` Width Jitter**: Applies deterministic $\pm 0.02\text{px}$ domain-keyed jitter on `CanvasRenderingContext2D` and `OffscreenCanvasRenderingContext2D` `measureText` via a `Proxy` preserving `metrics instanceof TextMetrics === true`.

### Layer 3: Blueprints (17 Core + 237 Extended) & 15-Rule `PlausibilityValidator`

- **Core Pool (`poolSize: 'core'`, default)**: 17 curated desktop blueprints (`src/blueprints/blueprint-catalog.ts`) with `0ms` startup cost.
- **Extended Pool (`poolSize: 'extended'`)**: Lazy-loaded `ExtendedBlueprintRegistry` (`src/blueprints/extended-blueprint-registry.ts`) with **237 blueprints**:
  - **111 Desktop Blueprints (`macos`, `windows`, `linux`)**: Mapped to exact Dawn PCI GPU architectures (`metal-3`, `ampere`, `ada-lovelace`, `blackwell`, `turing`, `rdna-2`, `rdna-3`, `rdna-4`, `gen-12lp`, `xe-lpg`, `xe-2lpg`, `xe-3lpg`) and OS-pure font catalogs (`src/blueprints/data/extended-fonts.json`).
  - **126 Android Mobile Digital Twin Blueprints (`os: 'android'`)**: Real device profiles from `mobile-devices.json`, weighted (`weight: 10`) toward **Xiaomi 13 (`2211133G`/`2211133C`, Qualcomm Adreno 740, `360x800`, DPR `3`)** and **Redmi Note 10 (`M2101K7AG`/`M2101K7AI`, Qualcomm Adreno 612, `393x873`, DPR `2.75`)**, plus Xiaomi 12, Redmi Note 8 Pro, Xiaomi 11T, and Redmi K50 Pro.
- **15-Rule `PlausibilityValidator.validate(profile, { proxyCountry, expectedBrowserMajor })`** (`src/validators/plausibility-validator.ts`):
  - `R01`–`R13`: GPU/OS/ANGLE/Navigator/ClientHints/WebGPU/Font/Viewport/DPR/Screen/ChromeVersion/Seed coherence (including Android mobile branches in `R03`, `R05`, `R09`, `R11`, `R13`).
  - `R14` (`Proxy-Timezone Country Match`): Enforces `profile.timezone.country === options.proxyCountry` when `proxyCountry` is supplied.
  - `R15` (`Locale, Accept-Language & Timezone Region Coherence`): Enforces BCP-47 primary tag coherence between `navigator.language`, `navigator.languages[0]`, `acceptLanguage`, and `timezone.country` (`COUNTRY_TO_GEO_MAP`).

---

## 4. Code Recipes for AI Agents

### Recipe A: Generate an OS-Locked Profile + Align Proxy Geo + Validate (15/15 Rules)

```ts
import {
  CoherentProfileGenerator,
  StealthInjector,
  PlausibilityValidator,
} from '@webmcp/fingerprint-kit';

// 1. Generate deterministic profile from Core (17) or Extended (237) pool
const profile = CoherentProfileGenerator.generate({
  seed: 'acct-vn-01',
  os: 'macos',              // 'macos' | 'windows' | 'linux' | 'android'
  poolSize: 'extended',     // 'core' (default, 17) | 'extended' (237 Desktop + Android)
  country: 'VN',
  browserMajor: 148,
});

// 2. If routing through an egress proxy, align timezone + locale + Accept-Language + geolocation
StealthInjector.applyProxyGeo(profile, {
  countryCode: 'JP',
  latitude: 35.6762,
  longitude: 139.6503,
});

// 3. Validate all 15 physical + network coherence rules
const report = PlausibilityValidator.validate(profile, {
  proxyCountry: 'JP',
  expectedBrowserMajor: 148,
});
if (!report.valid) {
  throw new Error(`Plausibility failed: ${JSON.stringify(report.errors)}`);
}
```

### Recipe B: Launch Chromium with `StealthBrowser` (Pipe Transport + Worker/OOPIF Stealth)

```ts
import puppeteer from 'puppeteer-core';
import { StealthBrowser } from '@webmcp/fingerprint-kit';

const session = await StealthBrowser.launch(puppeteer, {
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  userDataDir: '/Users/ttcenter/.webmcp/managed-profiles/scraper-01',
  mode: 'full-coherent',    // 'native-clean' | 'micro-farbling' | 'full-coherent' | 'cpp-engine'
  seed: 'scraper-01',
  os: 'macos',
  poolSize: 'extended',
  proxyServer: 'socks5://127.0.0.1:1080',
  proxyGeo: { countryCode: 'VN' },
  resourceSaver: true,      // Disables background timer throttling & unused Chromium services
});

const page = await session.newStealthPage();
await page.goto('https://abrahamjuliot.github.io/creepjs/');
```

### Recipe C: Export Firefox/Gecko `user.js` & Clean Chromium Profile Caches

```ts
import {
  generateGeckoUserJs,
  getGeckoSpawnEnv,
  cleanProfileTmp,
} from '@webmcp/fingerprint-kit';

// Generate Mozilla Firefox/Camoufox user.js + TZ env from the same FingerprintProfile
const userJsContent = generateGeckoUserJs(profile, {
  proxy: { type: 'socks', host: '127.0.0.1', port: 1080, socksVersion: 5, remoteDns: true },
});
const geckoEnv = getGeckoSpawnEnv(profile); // { TZ: profile.timezone.id }

// Safely clean Chromium transient caches (Crashpad, ShaderCache, GrShaderCache, Code Cache/js)
// Automatically skips if SingletonLock is held by a live Chrome PID
const cleanup = cleanProfileTmp('/Users/ttcenter/.webmcp/managed-profiles/scraper-01');
```

---

## 5. Verification Commands

Run these commands to verify `@webmcp/fingerprint-kit` after any blueprint, stealth IIFE, or validator change:

```bash
# 1. Unit, 15-Rule Plausibility (17 Core + 237 Extended blueprints), V8 Stealth, Gecko & Cleanup tests
npm --prefix /Users/ttcenter/Desktop/VIBE_CODE/webmcp-automation-kit/packages/webmcp-fingerprint-kit test

# 2. Real-Chromium Empirical Coherence Suite (20 browser-level invariants across Window, Iframes & Web Workers)
npm --prefix /Users/ttcenter/Desktop/VIBE_CODE/webmcp-automation-kit/packages/webmcp-fingerprint-kit run verify:empirical

# 3. OS Font Cross-Contamination Audit (0 cross-OS font leaks across macOS/Windows/Linux/Android)
node /Users/ttcenter/Desktop/VIBE_CODE/webmcp-automation-kit/packages/webmcp-fingerprint-kit/scripts/audit-fonts-coherence.mjs

# 4. Fleet Telemetry Fingerprint Decision Audit via WebMCP CLI
webmcp fingerprint --node local
```
