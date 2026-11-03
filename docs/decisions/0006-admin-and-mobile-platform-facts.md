# 0006. Admin and mobile platform facts

Status: **accepted** (P0-T7, proposed 2026-11-03; accepted by the owner 2026-11-03, Phase 0 gate). Records documented facts about Expo SDK 58, React Native 0.88.1 and PrimeNG 22.1.4 that the foundation depends on, and answers scaffold-plan section 10 items 2 to 6. No code was written, no package installed and no device used. Each item has a status: `confirmed` (stated by official documentation or package metadata), `not confirmed` (no official statement found), or `deferred to <slice>` (needs a runtime check that belongs to that slice).

## Context

- ADR-0001: mobile is React Native with Expo, TypeScript, Expo Router and TanStack Query, on iOS and Android; the admin is Angular (standalone, signals) with PrimeNG.
- scaffold-plan section 5 (admin): PrimeNG preset generated from `design-tokens`; MapLibre GL JS for the branch pin and zone preview, with the tile URL from `/meta/config`; fonts self-hosted.
- scaffold-plan section 6 (mobile):
  - four tabs behind one `AppTabBar` (native tabs on iOS 26, JavaScript fallback elsewhere);
  - `expo-secure-store` for the refresh token;
  - one realtime client in the foreground;
  - build profiles `dev`, `demo`, `prod` with separate bundle identifiers.
- scaffold-plan open item 2: names, bundle identifiers and store accounts are not decided.
- ADR-0005: MapLibre with OSM-based vector tiles on both clients. The tile URL is configuration, and the tile source is still open (ADR-0008 "Still open" 1).
- ADR-0008 #7: Socket.IO, with plain WebSocket as the fallback; React Native behaviour on the chosen SDK still to be verified.
- 0001 pins: Expo SDK 58 (`expo` 58.0.22, React Native 0.88.1, React 19.3.0, `expo-router` 58.0.29), Angular 22.2.4, PrimeNG 22.1.4, `@primeuix/themes` 3.1.0.
- 0003: pnpm's isolated layout, no `nodeLinker: hoisted`, no manual Metro `watchFolders`; compiled ESM shared packages; P4-T7 confirms on a device.

## Evidence

Read on 2026-11-03. Registry data from read-only `npm view`; SDK 58 versions from `https://cdn.jsdelivr.net/npm/expo@58.0.22/bundledNativeModules.json`.

| ID | Source |
|---|---|
| S1 | https://docs.expo.dev/guides/monorepos/: "Expo configures Metro automatically for monorepos" (SDK 52+). Remove `watchFolders`, `resolver.nodeModulesPath`, `resolver.extraNodeModules` and `resolver.disableHierarchicalLookup` if set. "Starting with SDK 54, Expo supports isolated dependencies"; the fallback is `nodeLinker: hoisted` in `pnpm-workspace.yaml`. Autolinking module resolution "is enabled automatically for apps in monorepos" from SDK 55. Check duplicates with `pnpm why --depth=10 react-native`; "Duplicate React versions in a single app will cause runtime errors"; native modules must never be duplicated |
| S2 | https://docs.expo.dev/develop/development-builds/introduction/: a development build is "your own version of Expo Go where you are free to use any native libraries and change any native configuration"; with `expo-dev-client` installed, `npx expo start` targets the development build |
| S3 | https://docs.expo.dev/versions/latest/sdk/securestore/ (SDK 58): "Included in Expo Go"; recommended `~58.0.2`; Android Keystore and iOS keychain; iOS keychain items survive uninstall when the app is reinstalled with the same bundle ID; Android Auto Backup must exclude SecureStore entries (`configureAndroidBackup`, default `true`); "some iOS releases refused values above roughly 2048 bytes" |
| S4 | https://socket.io/how-to/use-with-react-native: plain `io(url)` setup with Expo Go and React Native CLI samples. Known issues: Android 9+ blocks cleartext traffic by default (`usesCleartextTraffic` or a network security config for debug builds), and self-signed certificates need the IP in `subjectAltName`. No supported-version matrix; Hermes and backgrounding are not covered |
| S5 | https://socket.io/docs/v4/client-options/: `transports` default `["polling", "websocket", "webtransport"]`; `reconnection` default `true` (`reconnectionDelay` 1000 ms, `reconnectionDelayMax` 5000 ms); `auth` sent when connecting to a namespace |
| S6 | Registry: `socket.io-client` 4.8.4 (dependencies `engine.io-client ~6.6.1`, `socket.io-parser ~4.2.4`); the server side `@nestjs/platform-socket.io` 12.3.2 depends on `socket.io` 4.8.4 (0005 S10) |
| S7 | Issue search, 2026-11-03: the React Native reports found (for example https://github.com/socketio/socket.io-client/issues/1254 and https://github.com/socketio/socket.io-client/issues/1097) date from React Native 0.59/0.60. No report was found against React Native 0.8x or Hermes |
| S8 | https://maplibre.org/maplibre-react-native/docs/setup/getting-started: React Native "≥ 0.80.0"; "From v11 onwards only the new architecture is supported"; Android API level ≥ 23; wraps MapLibre Native Android 13.6.1 and iOS 6.31.0 |
| S9 | https://maplibre.org/maplibre-react-native/docs/setup/expo: "This package can't be used with "Expo Go"", "not part of the Expo SDK"; config plugin `"plugins": ["@maplibre/maplibre-react-native"]`; install with `npx expo install @maplibre/maplibre-react-native`, then rebuild |
| S10 | Registry: `@maplibre/maplibre-react-native` `latest` 11.5.1 (modified 2026-10-29), peers `expo >=54.0.0`, `react >=19.1.0`, `react-native >=0.80.0`; MIT. Not in SDK 58 `bundledNativeModules.json` |
| S11 | https://docs.expo.dev/router/advanced/native-tabs/ (SDK 58): import from `expo-router/native-tabs` "available in SDK 58 and later" (`expo-router/unstable-native-tabs` in SDK 54 to 57); no stability level stated. Limitations: Android at most 5 tabs; Android `md` icons are outlined Material Symbols only; tab bar height cannot be measured; no nesting of native tabs; limited FlatList integration; tabs cannot change at runtime. iOS 26 draws the bar with Liquid Glass, and `backgroundColor`, `blurEffect`, `shadowColor` apply only on iOS 18 and earlier. "If you don't need native platform behavior, you can keep using JavaScript tabs" |
| S12 | https://github.com/google/fonts/blob/main/ofl/bevietnampro/OFL.txt and `METADATA.pb`: SIL Open Font License 1.1; "Copyright 2021 The Be Vietnam Pro Project Authors (https://github.com/bettergui/BeVietnamPro)"; no Reserved Font Name; 18 static TTF files (weights 100 to 900, upright and italic, named by PostScript name such as `BeVietnamPro-Regular.ttf`). OFL items 1 and 2: the font may not be sold by itself; it may be bundled with software "provided that each copy contains the above copyright notice and this license" |
| S13 | https://github.com/google/fonts/blob/main/ofl/inter/METADATA.pb: OFL; "Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)"; variable `Inter[opsz,wght].ttf` and `Inter-Italic[opsz,wght].ttf` (`wght` 100 to 900) |
| S14 | https://docs.expo.dev/develop/user-interface/fonts/: OTF and TTF supported. Two loading paths: the `expo-font` config plugin embeds fonts at build time ("Doesn't work with Expo Go"), and `useFonts` loads them at runtime (works in Expo Go). On Android the file name becomes the family name, while iOS reads it from the file, so files are named by PostScript name. Variable fonts work on Android and iOS from SDK 58 |
| S15 | https://primeng.dev/theming/styled (`primeng.org` redirects there): tokens in three layers (primitive, semantic, component); `colorScheme` for light and dark; `darkModeSelector` (default `system`, or a class such as `.app-dark`); `prefix` (default `p`, so `primary.color` becomes `var(--p-primary-color)`); `cssLayer` (default `false`); "Primitive and semantic tokens are always generated as CSS variables"; built-in presets `@primeuix/themes/{aura,lara,material,nora}` |
| S16 | `@primeuix/themes` 3.1.0 package metadata and `dist/index.d.mts` (jsDelivr): the root export provides `definePreset(base, ...extensions)`, `updatePreset`, `updatePrimaryPalette`, `updateSurfacePalette`; `Preset` and `DesignTokens` types under `@primeuix/themes/types`; presets under `@primeuix/themes/<name>` |
| S17 | https://expo.dev/pricing: Free plan "15 Android and 15 iOS builds" (period not stated), "Low-priority queue", "45-minute build timeout", updates for "1,000 MAUs"; Submit included on every plan. No effective date shown |
| S18 | https://docs.expo.dev/tutorial/eas/multiple-app-variants/: `app.config.js` reads `process.env.APP_VARIANT`, set by each `eas.json` build profile's `env`; `ios.bundleIdentifier` and `android.package` get a per-variant suffix so the variants install side by side |
| S19 | https://docs.expo.dev/guides/environment-variables/: `EXPO_PUBLIC_*` values are inlined and "visible in plain-text in your compiled application"; from SDK 58, `.env` file selection follows the command's mode, and other names such as `.env.staging` are not loaded |
| S20 | SDK 58 `bundledNativeModules.json`: `expo-secure-store ~58.0.2`, `expo-font ~58.0.11`, `expo-dev-client ~58.0.18`, `expo-constants ~58.0.14`, `expo-build-properties ~58.0.12`, `expo-router ~58.0.29` |

## Findings

### 1. Expo SDK 58 in a pnpm monorepo: **confirmed** (documentation); runtime **deferred to P4-T7**

- **Metro:** configured automatically for monorepos since SDK 52 [S1]. `apps/mobile` uses the default `expo/metro-config`. It has no `metro.config.js` unless a later need is recorded, and never sets `watchFolders` or the resolver options listed in S1.
- **Hoisting:** not required. SDK 58 is past SDK 54, which supports isolated dependencies [S1], so 0003's "no `nodeLinker: hoisted`" holds. The documented fallback is `nodeLinker: hoisted` [S1], which would need a new record (0003).
- **Autolinking:** module resolution in monorepos is automatic from SDK 55 [S1]. No `experiments.autolinkingModuleResolution` setting.
- **What `apps/mobile` sets (P4-T7):**
  - internal packages as `workspace:*` [S1, 0003];
  - Expo-managed packages pinned exactly from SDK 58's `bundledNativeModules.json` (0001);
  - nothing in the root `.npmrc` or `pnpm-workspace.yaml` specific to Expo.
- **P4-T7 check:** `pnpm why --depth=10 react-native` and the same for `react` must show one version each [S1]. A duplicate gets a root `overrides` entry, recorded in 0003.
- **Feeds P1-T1:** the workspace stays isolated and needs no mobile setting.

### 2. Development build versus Expo Go: **confirmed**

| Library | Expo Go | Source |
|---|---|---|
| `expo-secure-store` | works ("Included in Expo Go") | S3 |
| `socket.io-client` | works: plain JavaScript on React Native's own WebSocket and XHR; the official guide has an Expo Go sample | S4 |
| `@maplibre/maplibre-react-native` | **development build required** ("can't be used with Expo Go"; config plugin) | S9 |
| Fonts through the `expo-font` config plugin | development build required; `useFonts` works in Expo Go | S14 |

- **Consequence for `dev:mobile`:**
  - The script is `expo start` (no `--clear`, no extra watchers; a persistent task with `cache: false`, 0003).
  - Until a module that Expo Go lacks is installed, it opens in Expo Go. Once `expo-dev-client` is installed, the same command targets the development build [S2], so the script never changes.
- **`expo-dev-client`** (`~58.0.18` in SDK 58 [S20]) is **not** installed in the foundation. The first slice that adds a native module Expo Go lacks (the map slice with MapLibre, or embedded fonts) installs it, and from then on every developer needs a development build on their device or simulator.
- **Secure store:** the refresh-token slice keeps `configureAndroidBackup` on (Android backups would hold undecryptable entries otherwise [S3]). On iOS, it clears the token on first launch after reinstall, because keychain items survive uninstall [S3]. Refresh tokens are opaque and far below the roughly 2048-byte limit some iOS releases had [S3].

### 3. Socket.IO client in React Native (scaffold-plan item 2, ADR-0008 #7): **not confirmed**; runtime spike **deferred to the realtime slice**

- **Version:** `socket.io-client` 4.8.4 [S6] is on the same 4.8 line as the server's `socket.io` 4.8.4 (0005).
- **Official guide [S4]:**
  - Android 9+ blocks cleartext HTTP, which matters for a development build that reaches the API over `http://<LAN IP>`. The dev profile needs cleartext allowed in debug only; the exact setting (for example through `expo-build-properties` [S20]) is **not verified**.
  - Self-signed certificates need the IP in `subjectAltName`.
- **Not found in official sources:** a supported React Native version matrix, and Hermes or background notes [S4]. The issue reports found are from React Native 0.59/0.60 [S7].
- **Default transports:** polling, then WebSocket [S5]. The single API instance (ADR-0004) works with polling. Whether to force `transports: ['websocket']` on mobile is decided by the spike.
- **What the foundation does (nothing installed now):**
  - The mobile app reaches the socket through one module of its own (`RealtimeClient`: connect with token, subscribe, connection state, close). Screens never import `socket.io-client`.
  - Event names and payloads come from `@kd/contracts` (0004) and do not depend on the transport.
  - So the ADR-0008 fallback (plain WebSocket) changes one module, plus a server gateway adapter.
- **The spike:** connect, reconnect after airplane mode, background then foreground (the client closes in background, scaffold-plan section 6), token refresh and reconnect (ADR-0008 #8), on one iOS and one Android device with a release-mode build.

### 4. MapLibre for React Native (scaffold-plan item 3): **confirmed on paper** (peer ranges); runtime **deferred to the map slice**

- **Package:** `@maplibre/maplibre-react-native` 11.5.1.
- **Peer ranges:** `expo >=54.0.0`, `react >=19.1.0`, `react-native >=0.80.0` [S10]. Expo 58.0.22, React 19.3.0 and React Native 0.88.1 (0001) satisfy all three.
- **Requirements:** new architecture only from v11 [S8]; Android API level ≥ 23 [S8]; config plugin [S9]; development build [S9].
- **Version source:** it is not in SDK 58's `bundledNativeModules.json` [S10], so `expo install --fix` does not manage it. The map slice pins it exactly and records it in 0001.
- **Not verified:** that SDK 58 builds with the new architecture enabled. It is the default in recent SDKs, but this was not re-read for SDK 58.
- **What the foundation does:** nothing installed.
  - The map slice is already blocked by the tile source (ADR-0008 "Still open" 1), and the tile URL is configuration (ADR-0005).
  - A map screen stays behind one component of the app, so a different binding would change one place.

### 5. Expo Router native tabs (scaffold-plan item 4): **confirmed** (documentation); Android rendering **deferred to the mobile shell slice**

- **Status in SDK 58:** native tabs import from `expo-router/native-tabs`, without the `unstable-` prefix used in SDK 54 to 57 [S11]. The page states no stability level.
- **Limitations that touch the plan [S11]:**
  - Android allows at most 5 tabs; the plan has 4.
  - Android `md` icons are outlined only, so a filled selected icon needs an icon font.
  - On iOS 26, Liquid Glass ignores `backgroundColor`, so the tab bar cannot carry brand colour there.
  - The tab bar height cannot be measured, so layouts must not depend on it.
  - Tabs cannot be added or removed at runtime.
- **Fallback:** JavaScript tabs, which Expo keeps supported [S11].
- **What the foundation does:**
  - `AppTabBar` is the one place that chooses native tabs (iOS 26) or JavaScript tabs (elsewhere), as scaffold-plan section 6 says.
  - The four tabs are a static list.
  - No screen measures the tab bar.
- **Deferred:** Android rendering is checked on a device by the mobile shell slice.

### 6. Fonts (scaffold-plan item 5): license **confirmed**; packaging **deferred to P4-T6 and P4-T7**

- **Be Vietnam Pro** [S12]:
  - SIL OFL 1.1, no Reserved Font Name.
  - It may ship inside an app if every copy carries the copyright notice and the license.
  - 18 static TTF files named by PostScript name.
- **Inter** [S13]: OFL, with variable TTF files.
- **React Native packaging [S14]:**
  - `useFonts` at runtime works in Expo Go.
  - The `expo-font` config plugin embeds the fonts but needs a development build.
  - PostScript-named files give the same family name on Android and iOS.
- **Decision for P3-T1: no font files in `@kd/design-tokens`** (the default).
  - The tokens package outputs family names, weights and the fallback stack only: `"Be Vietnam Pro", Inter, system-ui, sans-serif` on web; the system font is the fallback on mobile.
  - Each app ships the files it uses, with `OFL.txt` next to them:
    - the admin self-hosts the WOFF2 or TTF files in its assets (P4-T6);
    - mobile loads the TTF files with `useFonts` until a development build exists, and then embeds them with the config plugin (P4-T7 or the first UI slice).
  - **Reason:** binary assets in a shared package would tie both apps to package asset paths, and the license needs nothing from the tokens package.
- **Closes:** the font license part of ADR-0008 "Still open" 6. The trademark check named there stays open.

### 7. PrimeNG theming: **confirmed** (documentation and type declarations); rendering **deferred to P4-T6** (as in 0001)

- **How a preset is built for PrimeNG 22.1.4 with `@primeuix/themes` 3.1.0:**
  - `definePreset(Aura, extension)` from the root of `@primeuix/themes` [S16], with `Aura` from `@primeuix/themes/aura` [S15].
  - It is registered once through `providePrimeNG({ theme: { preset, options } })`. The import path of `providePrimeNG` was not captured from the page and is confirmed in P4-T6.
- **Options:**
  - `prefix: 'p'`;
  - `darkModeSelector`: a class (for example `.app-dark`) if dark mode is offered, otherwise `false`;
  - `cssLayer`: on, so the admin's own styles override PrimeNG without `!important`.
  - Primitive and semantic tokens always become `--p-*` CSS variables [S15].
- **What `@kd/design-tokens` outputs for it (P3-T1):**
  1. A **plain, dependency-free object** in the PrimeUIX token shape: `primitive` (colour palettes 50 to 950), `semantic` (`primary` mapped to a brand palette, `colorScheme.light` and `.dark` surfaces, focus ring, border radius), and `components` only where a token cannot express the design.
     - It does not import `@primeuix/themes`, so the package stays a leaf (0003).
     - The admin passes it to `definePreset`, whose parameter type checks the shape at compile time [S16].
  2. **CSS variables under the prefix `--kd-*`** for non-PrimeNG styles in the admin, never `--p-*`, which PrimeNG owns [S15].
  3. **The same values as plain TypeScript constants** for the mobile theme.
- **Base preset:** Aura (recommended). The final pick is made in P3-T1 against the design.

### 8. EAS Build and Submit free plan (scaffold-plan item 6): **deferred to the release slice**

- **Free plan today [S17]:**
  - 15 Android and 15 iOS builds (period not stated);
  - low-priority queue;
  - 45-minute build timeout;
  - Submit included;
  - updates for 1,000 MAU.
- **Why it does not block the foundation:**
  - No foundation task builds for a store. CI does not build mobile (0003).
  - Development builds can be made locally (ADR-0004 lists local builds as the fallback; the local commands are **not re-verified** here).
  - Store submission also needs the Apple and Google accounts, which are an open owner item (scaffold-plan open item 2).
- **The release slice** re-reads the pricing page, because the period and terms are not stated, and decides EAS or local builds.

### 9. Build profiles `dev`, `demo`, `prod`: pattern **confirmed** [S18]; values are placeholders

- **Selection:** `apps/mobile/app.config.ts` reads `APP_VARIANT` (`dev` | `demo` | `prod`; default `dev` for a local `expo start`). Each `eas.json` build profile sets `APP_VARIANT` in its `env` [S18]. From one table keyed by variant it sets:
  - `ios.bundleIdentifier` and `android.package`: `<base>.dev`, `<base>.demo` and `<base>`, so the three install side by side [S18];
  - the display name: `<name> Dev`, `<name> Demo`, `<name>`;
  - `extra.apiBaseUrl`, read at runtime through `expo-constants` (`~58.0.14` [S20]):
    - `demo` and `prod` take fixed `https://` URLs from the table;
    - `dev` takes the developer's machine URL from `KD_MOBILE_DEV_API_URL` in `apps/mobile/.env.local` (git-ignored), because it depends on each machine's LAN IP;
    - the root `.env` is never read (0005).
  - `app.config.ts` fails when the URL is missing, and when `demo` or `prod` is not `https://`.
- **No secrets** go into `app.config.ts`, `extra` or `EXPO_PUBLIC_*`: these values ship in plain text in the app [S19].
- **Placeholder rule** (until the restaurant name and the store accounts exist; scaffold-plan open item 2 and `WA1`):
  - The base identifier is one constant, `com.example.kitchendaylight`, under the reserved `example` domain.
  - The display name is `KD`. "Kitchen Daylight" itself awaits the trademark check (ADR-0008 "Still open" 6).
  - The `demo` and `prod` URLs are `https://demo.example.invalid/api` and `https://example.invalid/api` until the domain exists (ADR-0008 "Still open" 7).
  - `app.config.ts` **throws for `APP_VARIANT=prod`** while the base identifier still starts with `com.example.` or a URL ends in `.invalid`. A store build can therefore never ship a placeholder.
  - Replacing the placeholders is one edit of that table, done by the release slice.

## Risks, not blockers (items 3 to 5)

| Item | Risk | What the foundation does so it can be solved later |
|---|---|---|
| 3 Socket.IO on React Native | unknown behaviour on React Native 0.88 and Hermes | one `RealtimeClient` module; transport-neutral event types in `@kd/contracts`; plain WebSocket fallback stays a one-module change |
| 4 MapLibre binding | runtime and new-architecture build on SDK 58 | nothing installed; the map sits behind one component; development build introduced by the map slice |
| 5 Native tabs | Android rendering, iOS 26 styling limits | `AppTabBar` chooses native or JavaScript tabs; a static tab list; no layout depends on tab bar height |

## Consequences

- **P1-T1:** no Expo-specific workspace setting (item 1).
- **P3-T1:** the tokens package outputs the PrimeUIX-shaped object, `--kd-*` CSS variables and TypeScript constants, with **no font files** (items 6 and 7).
- **P4-T6:**
  - confirms the `providePrimeNG` import path and preset rendering;
  - self-hosts the fonts with `OFL.txt`.
- **P4-T7:**
  - `apps/mobile` without a `metro.config.js`;
  - the duplicate check;
  - `dev:mobile` as `expo start`;
  - `app.config.ts` with the variant table and the placeholder guard;
  - `useFonts` for the fonts.
- **Slices:**
  - realtime: the item 3 spike;
  - map: MapLibre, the item 4 runtime check and `expo-dev-client`;
  - mobile shell: item 5 on Android;
  - release: item 8 and replacing the item 9 placeholders.
- **Revisit triggers:**
  - Expo documents a problem with isolated installs;
  - `@maplibre/maplibre-react-native` drops Expo 58 from its peer range;
  - native tabs change API;
  - the EAS free plan changes before the release slice.
