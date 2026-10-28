---
name: webmcp-fingerprint-kit
description: Evaluate Chrome profile fingerprint telemetry, enforce Homelab Anti-Mid-Session-Mutation rules, generate Host-Aligned Same-OS Desktop & Android Mobile Digital Twin profiles, validate profiles with PlausibilityValidator, inject 4-layer Chromium stealth (native flags, recursive Worker/OOPIF CDP auto-attach, V8 prototype IIFE), align proxy geo/timezone/locale, generate Firefox/Gecko user.js, and clean Chromium profile caches. Trigger on 'fingerprint', 'StealthInjector', 'StealthBrowserManager', 'getStealthBrowser', 'CoherentProfileGenerator', 'PlausibilityValidator', 'ExtendedBlueprintRegistry', 'micro-farbling', 'native-clean', 'full-coherent', 'cpp-engine', 'attachCdpToTargets', 'applyProxyGeo', 'cleanProfileTmp', 'generateGeckoUserJs'.
---

# WebMCP Fingerprint Kit (`@webmcp/fingerprint-kit` v2.2)

- **Canonical Skill Path**: Resolve dynamically on any host via `webmcp skills path webmcp-fingerprint-kit` (or `webmcp skills path fingerprint`).
- **Package Source**: `packages/webmcp-fingerprint-kit` (`src/index.ts`, built to `dist/index.js`).
- **CLI Entrypoints**:
  - `webmcp fingerprint [--node <id>] [--mode <mode>] [--search <query>] [--json]`
  - `webmcp fleet fingerprint [--node <id>] [--mode <mode>] [--search <query>] [--json]`

---

## 1. Rule #1: Homelab Telemetry Decision Engine & Anti-Mid-Session Mutation

Homelab cluster nodes (`local`, `mac-m1`, `reup-minipc`, `dell`) run on **100% real physical hardware** (real GPU, audio stack, OS fonts, TCP/IP + TLS JA3/JA4).

`StealthInjector.evaluateProfileDecision(input: ProfileTelemetryInput): FingerprintInjectionDecision` (`src/core/stealth-injector.ts`) enforces the **Anti-Mid-Session Fingerprint Mutation Invariant** in strict priority order (`forcedMode` $\rightarrow$ `LOCKED_AT_CREATION` $\rightarrow$ `SKIP_SESSION_BOUND` $\rightarrow$ `INJECT_CPP_ENGINE` $\rightarrow$ `INJECT_FULL_COHERENT` $\rightarrow$ `INJECT_MICRO_FARBLING`):

| Priority | Condition (`ProfileTelemetryInput`) | `shouldInjectFingerprint` | `decisionCode` | `recommendedMode` | Rationale |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | `forcedMode` passed via CLI `--mode` | `forcedMode !== 'native-clean'` | `LOCKED_AT_CREATION` / `INJECT_MICRO_FARBLING` / `SKIP_SESSION_BOUND` | `forcedMode` | Explicit operator override (`riskIfInjectedNow: 'CRITICAL_SESSION_INVALIDATION'` if overriding a live session). |
| **2** | `fingerprintLockedAtCreation: true` or `lockedMode` ($\neq$ `'native-clean'`) in `.webmcp-meta.json` / `.fingerprint-lock.json` | `(lockedMode \|\| 'micro-farbling') !== 'native-clean'` (`🔒 YES`) | `LOCKED_AT_CREATION` | `lockedMode \|\| 'micro-farbling'` | Profile was initialized with this seed and `StealthMode` before first login; maintain the exact seed across the account lifecycle. |
| **3** | **Live Session Cookies Present** (`platforms.length > 0`, `email`/`gaiaName` present, or `cookieCount > 15`) | `false` (`⛔ NO`) | `SKIP_SESSION_BOUND` | `native-clean` | Session cookies (`SID`/`SAPISID`, `c_user`/`xs`, `sessionid`) are bound to the hardware hash recorded at login. Mid-session Canvas/Audio/WebGL mutation triggers **Session Hijacking / Environment Drift** checkpoints. Overrides `isAnonymousScraping`. |
| **4** | Cold-start profile (`cookieCount <= 15`) with `hasCustomBinary: true` | `true` (`✅ YES`) | `INJECT_CPP_ENGINE` | `cpp-engine` | Passes `--fingerprint=<uint32_seed>` to C++ Blink/Skia (`adryfish/fingerprint-chromium`) with `0B` JS injection. |
| **5** | Cold-start profile (`cookieCount <= 15`) with `isAnonymousScraping: true` | `true` (`✅ YES`) | `INJECT_FULL_COHERENT` | `full-coherent` | Applies full 4-layer stealth (Launch Flags + `TZ` env + CDP Emulation overrides + Worker/OOPIF Auto-Attach + V8 Stealth IIFE). |
| **6** | Default Cold-Start Profile (`cookieCount <= 15`, `platforms = []`) for multi-account social/e-commerce farming | `true` (`✅ YES`) | `INJECT_MICRO_FARBLING` | `micro-farbling` | Isolates Canvas/OffscreenCanvas/Audio hashes per profile + eTLD+1 domain from day zero while preserving 100% native Host OS, GPU, Navigator, Screen, and Fonts. |

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
| `native-clean` | `0 B` | `0` | `--disable-blink-features=AutomationControlled`, `--disable-features=...`, `--disable-background-timer-throttling` (+ WebRTC/loopback flags only when `hasProxy: true`); host `TZ` untouched | All live logged-in Chrome profiles (`Chrome:Default`, `Chrome:Profile *`) |
| `micro-farbling` | Canvas/Audio/Iframe guard only (`FULL_SPOOF = false`) | `0` | Same as `native-clean`; host `TZ` untouched | Multi-account farming (`5–10` FB/TikTok/Douyin/Shopee accounts on 1 host) |
| `full-coherent` | Full V8 Stealth IIFE (`FULL_SPOOF = true`) | `5` base (+ `setTouchEmulationEnabled` on Android + `setGeolocationOverride` when geo set) + Recursive Worker/OOPIF auto-attach | Native flags + `--window-size=<w>,<h>` + `--lang=<locale>` + `TZ=<profile.timezone.id>` | Disposable guest/anonymous scraping or cross-hardware persona emulation |
| `cpp-engine` | `0 B` | `0` | Native flags + `--window-size` + `--lang` + `--fingerprint=<uint32_seed>` + `--fingerprint-platform=<os>` + `--timezone=<tz>` + `TZ=<profile.timezone.id>` | `adryfish/fingerprint-chromium` binary |

---

## 3. 4-Layer Defense-in-Depth Architecture (v2.1 + v2.2)

### Layer 0: Native Launch Flags, Spawn Env & Resource Saver (`src/core/stealth-injector.ts`)

- `StealthInjector.getNativeLaunchFlags(profile, { mode, hasProxy, extraDisabledFeatures, resourceSaver })`:
  - Always passes `--disable-blink-features=AutomationControlled` (`navigator.webdriver === false` natively in C++ Blink without JS descriptors).
  - Merges `DEFAULT_SAFE_DISABLED_FEATURES` (`Translate`, `OptimizationHints`, `DialMediaRouteProvider`, `InterestFeedContentSuggestions`, `CertificateTransparencyComponentUpdater`, `AutofillServerCommunication`) and, when `resourceSaver !== false`, `RESOURCE_SAVER_DISABLED_FEATURES` (`OptimizationGuideModelExecution`, `OptimizationGuideOnDeviceModel`, `TextSafetyClassifier`) into a **single** `--disable-features=...` flag, plus `RESOURCE_SAVER_LAUNCH_FLAGS` (`--disable-background-timer-throttling`).
  - Appends `--lang=${profile.navigator.language}` and `--window-size=${profile.screen.width},${profile.screen.height}` **only** when `mode` is `'full-coherent'` or `'cpp-engine'`.
  - **Conditional Proxy/WebRTC Flags (`hasProxy === true`)**: Appends `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`, `--enforce-webrtc-ip-permission-check`, and `--proxy-bypass-list=<-loopback>` **only** when `hasProxy === true`.
- `StealthInjector.getSpawnEnv(profile, baseEnv, mode)`:
  - Sets `TZ: normalizeIanaTimezone(profile.timezone.id)` **only** in `'full-coherent'` and `'cpp-engine'` modes; returns a clean copy of `baseEnv` in `'native-clean'` and `'micro-farbling'`.

### Layer 1: Native CDP Emulation & Recursive Worker/OOPIF Auto-Attach (`src/core/cdp-target-attacher.ts`)

- `StealthInjector.getCDPEmulationCommands(profile)`:
  - Emits 5 base C++ Blink CDP commands:
    1. `Emulation.setUserAgentOverride` (with full `userAgentMetadata` Client Hints: `brands`, `fullVersionList`, `platform`, `platformVersion`, `architecture`, `model`, `mobile`, `bitness`, `wow64`)
    2. `Emulation.setHardwareConcurrencyOverride`
    3. `Emulation.setTimezoneOverride`
    4. `Emulation.setLocaleOverride`
    5. `Emulation.setDeviceMetricsOverride` (automatically sets `mobile: true` and `screenOrientation: { type: 'portraitPrimary', angle: 0 }` when `profile.userAgentData.mobile === true`)
  - **Android Mobile Touch Emulation**: Automatically appends `Emulation.setTouchEmulationEnabled({ enabled: true, maxTouchPoints: profile.navigator.maxTouchPoints })` when `profile.userAgentData.mobile === true` so mobile blueprints (`os: 'android'`) have coherent touch points and pointer media queries at runtime.
  - **Geolocation Emulation**: Automatically appends `Emulation.setGeolocationOverride({ latitude, longitude, accuracy })` when `profile.geolocation` is populated (e.g., via `StealthInjector.applyProxyGeo`).
- `attachCdpToTargets(cdpSession, profile, { mode, injectionOptions, debug })`:
  - Attaches `Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true })` recursively on both Browser and Page CDP sessions.
  - Intercepts `worker`, `shared_worker`, `service_worker`, and cross-origin `iframe` (OOPIF) targets while paused (`waitingForDebugger`), applies CDP emulation in `full-coherent` mode and evaluates the V8 stealth IIFE via `Runtime.evaluate` in `micro-farbling`/`full-coherent` modes, and resumes via `Runtime.runIfWaitingForDebugger` (or detaches cleanly if child session resolution is unavailable) — **sending 0 `Runtime.enable` calls**.

### Layer 2: 10-Invariant V8 Prototype Stealth IIFE (`src/core/v8-stealth-iife.ts`)

Built via `StealthInjector.buildInjectionScript(profile, options)` (`serializeStealthIIFE`) and injected via `Page.addScriptToEvaluateOnNewDocument`:

1. **Zero JS `webdriver` Override**: Never defines `Navigator.prototype.webdriver` in JS; handled natively by `--disable-blink-features=AutomationControlled`.
2. **Cross-Realm `WeakMap` `Function.prototype.toString` Bridge**: Registers wrapped functions in a shared `WeakMap` (`nativeFns`) and uses a non-enumerable `Symbol` probe (`PROBE_SYM`) to delegate cross-realm `Function.prototype.toString.call(iframeFn)` calls without leaking own properties.
3. **Realm-Bound `Function.prototype` Inheritance**: Ensures `Object.getPrototypeOf(wrappedFn) === win.Function.prototype` inside every patched realm (`window` and child iframes).
4. **Prototype-less Concise Method Wrappers (`'prototype' in fn === false`) & WebIDL Descriptor Preservation**: Uses concise method syntax `{ [label](...args) { ... } }[label]`, preserves native `origDesc.enumerable` / `origDesc.configurable` flags, and delegates WebIDL brand checks (`Illegal invocation` `TypeError`) to native C++ getters/methods.
5. **Clean `Window.prototype`**: Defines zero properties on `Window.prototype` (no `devicePixelRatio` or `outerWidth`/`outerHeight` prototype pollution).
6. **WebGL `37445` / `37446` Parameter Discipline**: Overrides only `UNMASKED_VENDOR_WEBGL` (`37445`) and `UNMASKED_RENDERER_WEBGL` (`37446`) on `WebGLRenderingContext.prototype.getParameter` and `WebGL2RenderingContext.prototype.getParameter` (only when the native call returns non-null), preserving native `VERSION` (`7938`) and `SHADING_LANGUAGE_VERSION` (`35724`).
7. **Same-Origin Blank Iframe & `window.open` Realm Propagation (`patchRealm`)**: Hooks `HTMLIFrameElement.prototype.contentWindow`/`contentDocument` getters and `window.open`, falling back to `win.origin` for `about:blank`/`srcdoc` frames so blank iframe Canvas hashes match the parent frame.
8. **Multi-Channel `AudioBuffer` Farbling + Silent Buffer Preservation**: Farbles `getChannelData` and `copyFromChannel` across all channels (`noisedAudioBuffers` `WeakSet`), tracks `copyToChannel`, and skips all-zero silent samples (`chanData[i] !== 0`).
9. **Coordinate-Locked Idempotent Canvas 1-LSB Brave Farbling**: Applies deterministic coordinate-hashed LSB bit assignment (`data[idx + 2] = (data[idx + 2] & 0xfe) | (hashCoords(seed, domain, sx + x, sy + y) & 1)`) on `getImageData` and offscreen clones for `toDataURL`/`toBlob`/`convertToBlob`, ensuring repeated reads are 100% idempotent and sub-region `getImageData(sx, sy, sw, sh)` aligns with full-canvas reads.
10. **Native `userAgentData`, `GPUAdapterInfo.prototype` Getters & `WorkerNavigator` Sync**: Leaves `navigator.userAgentData` to native C++ CDP overrides (`0` JS own properties), patches `vendor`/`architecture`/`device`/`description` on `GPUAdapterInfo.prototype` (`0` own properties on `adapter.info`), freezes `navigator.languages` per realm, and patches `WorkerNavigator.prototype` when evaluated inside Workers.

### Layer 3: Hardware Blueprints & 15-Rule `PlausibilityValidator`

- **Same-OS Host-Aligned Lock (`src/blueprints/hardware-blueprints.ts`)**:
  - `CoherentProfileGenerator.detectHostOS()` detects `'macos' | 'linux' | 'windows'` from `process.platform`.
  - `CoherentProfileGenerator.generate(options)` defaults to `allowCrossPlatform: false`, automatically locking candidate blueprints to `detectHostOS()` unless `options.os` or `options.allowCrossPlatform: true` is explicitly passed.
  - `CoherentProfileGenerator.generateForNode(nodeId, profileDir, hostOs?, chromeVersion?)` infers the target OS from the cluster node name (`minipc`/`ubuntu`/`linux`/`dell` $\rightarrow$ `'linux'`, `mac` $\rightarrow$ `'macos'`, `win` $\rightarrow$ `'windows'`) and generates a deterministic profile with seed `${nodeId}:${profileDir}`.
- **Blueprint Pools (`poolSize: 'core' | 'extended'`)**:
  - **Core Pool (`poolSize: 'core'`, default)**: Curated desktop blueprints (`src/blueprints/blueprint-catalog.ts`) with `0ms` startup cost.
  - **Extended Pool (`poolSize: 'extended'`)**: Lazy-loaded `ExtendedBlueprintRegistry` (`src/blueprints/extended-blueprint-registry.ts`) containing harvested desktop blueprints (`macos`, `windows`, `linux`) with Dawn PCI GPU architectures (`metal-3`, `ampere`, `ada-lovelace`, `blackwell`, `turing`, `rdna-2/3/4`, `gen-12lp`, `xe-lpg`, `xe-2lpg`, `xe-3lpg`) and OS-pure font catalogs (`src/blueprints/data/extended-fonts.json`), plus Android Mobile Digital Twin blueprints (`os: 'android'`, requires `poolSize: 'extended'`, weighted toward Xiaomi 13 Adreno 740 & Redmi Note 10 Adreno 612). Every extended blueprint is gated by `CoherentProfileGenerator.isBlueprintPlausible(bp)`.
- **`PlausibilityValidator.validate(profile, options)` (`src/validation/plausibility-validator.ts`)**:
  - Returns `PlausibilityValidationResult`: `{ isPlausible: boolean, score: number, checkedRules: number, passedRules: number, violations: PlausibilityViolation[] }`.
  - Validates `R01`–`R13` (GPU/OS/ANGLE/Navigator/ClientHints/WebGPU/Font/Viewport/DPR/Screen/ChromeVersion/Seed coherence, including Android mobile branches in `R03`, `R05`, `R09`, `R11`, `R13`), `R14` (`RULE_14_PROXY_TIMEZONE_COUNTRY_MISMATCH` when `options.proxyCountry` is provided), and `R15` (`RULE_15_LOCALE_HEADER_INTL_INCOHERENCE`).

---

## 4. Copy-Pasteable Code Recipes for AI Agents

### Recipe A: Host-Aligned Node Profile + Proxy Geo Alignment + 15-Rule Validation

```ts
import {
  CoherentProfileGenerator,
  StealthInjector,
  PlausibilityValidator,
} from '@webmcp/fingerprint-kit';

// 1a. Recommended for Fleet nodes: auto-locks OS to node ('local' -> detectHostOS(), 'reup-minipc' -> linux)
const nodeProfile = CoherentProfileGenerator.generateForNode('reup-minipc', 'Profile 8');

// 1b. Or generate with explicit options (defaults to detectHostOS() when os is omitted)
const profile = CoherentProfileGenerator.generate({
  profileId: 'acct-vn-01',
  seed: 'acct-vn-01',
  poolSize: 'extended',     // 'core' (default) | 'extended' (required when os: 'android')
  chromeVersion: '148',
});

// 2. Align timezone, navigator.language/languages, Accept-Language & geolocation with egress proxy
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
if (!report.isPlausible) {
  throw new Error(`Plausibility failed (${report.score}/100): ${JSON.stringify(report.violations)}`);
}
```

### Recipe B: Launch Chromium via `getStealthBrowser` (Pipe Transport + Worker/OOPIF Stealth)

```ts
import { getStealthBrowser } from '@webmcp/fingerprint-kit';

const browser = await getStealthBrowser({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  userDataDir: '/tmp/webmcp-scraper-01',
  stealthMode: 'full-coherent',   // 'native-clean' | 'micro-farbling' | 'full-coherent' | 'cpp-engine'
  hasExistingCookies: false,
  fingerprintSeed: 'scraper-01',
  pipe: true,                     // Uses --remote-debugging-pipe (no TCP port 9222)
  hasProxy: true,
  proxyGeo: { countryCode: 'VN' },
  args: ['--proxy-server=socks5://127.0.0.1:1080'],
});

const [page] = await browser.pages();
await page.goto('https://abrahamjuliot.github.io/creepjs/');
```

### Recipe C: Export Firefox/Gecko `user.js` & Clean Chromium Profile Temp Caches

```ts
import {
  CoherentProfileGenerator,
  StealthInjector,
  generateGeckoUserJs,
  getGeckoSpawnEnv,
  cleanProfileTmp,
} from '@webmcp/fingerprint-kit';

const profile = CoherentProfileGenerator.generate({ profileId: 'gecko-01' });
StealthInjector.applyProxyGeo(profile, { countryCode: 'VN' });

// 1. Generate standard Firefox user.js (locale, geo data: URL, SOCKS5 remote DNS, WebRTC ICE lock)
// Note: Does not override general.useragent.override (keeps native Gecko UA coherent with Firefox TLS/JS)
const userJsContent = generateGeckoUserJs(profile, {
  proxy: { scheme: 'socks5', host: '127.0.0.1', port: 1080 },
});
const geckoEnv = getGeckoSpawnEnv(profile); // { ...process.env, TZ: 'Asia/Ho_Chi_Minh' }

// 2. Safely clean Chromium transient caches (Crashpad, ShaderCache, GrShaderCache) after browser close
// Automatically checks isChromeProfileInUse(userDataDir) via SingletonLock PID and returns skippedReason: 'in-use' if active
const cleanup = await cleanProfileTmp('/tmp/webmcp-scraper-01');
if (cleanup.skippedReason) {
  console.log('Skipped cleanup:', cleanup.skippedReason);
} else {
  console.log('Removed temp dirs:', cleanup.removed);
}
```

---

## 5. Verification Commands (Checkout Only)

Run these commands from the `webmcp-automation-kit` checkout root (`cd "$(webmcp skills path webmcp-fingerprint-kit)/../../../.."`):

```bash
# 1. Build TypeScript -> dist/ (required before running fleet/CLI consumers that import dist/)
npm --prefix packages/webmcp-fingerprint-kit run build

# 2. Unit, 15-Rule Plausibility (Core + Extended Desktop/Android pools), V8 Stealth, Gecko & Cleanup tests
npm --prefix packages/webmcp-fingerprint-kit test

# 3. Real-Chromium Empirical Coherence Suite (browser-level invariants across Window, Iframes & Web Workers)
npm --prefix packages/webmcp-fingerprint-kit run verify:empirical

# 4. OS Font Cross-Contamination Audit (0 cross-OS font leaks across macOS/Windows/Linux/Android)
node packages/webmcp-fingerprint-kit/scripts/audit-fonts-coherence.mjs

# 5. Fleet Telemetry Fingerprint Decision Audit via WebMCP CLI
webmcp fingerprint --node local
```
