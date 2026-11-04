# @kd/tsconfig

Shared TypeScript configurations (TypeScript 6.0.3, decision 0001). The package is private and JSON only: it has no build. Add it as a `workspace:*` dev dependency and extend one config by its full subpath, for example `"extends": "@kd/tsconfig/node.json"`.

Rule for every app and package: **never switch `strict` off, and never switch off any flag that `strict` enables.** An app may add stricter flags. TypeScript 6 already makes `strict` the default; `base.json` still states it.

## `base.json`

The common strictness, with no runtime or module settings, so that every environment can extend it.

- **Flags:** `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `isolatedModules` and `skipLibCheck`.
- **`exactOptionalPropertyTypes` is off.** Not every app can live with it: React Native component props, Angular inputs and generated API types routinely pass `undefined` to optional properties. A package may switch it on for itself.
- **Not here:** `noPropertyAccessFromIndexSignature`. Expo only inlines `process.env.EXPO_PUBLIC_*` written in dot notation, which that flag forbids. It is set in `web.json` instead.
- **May override:** add stricter flags.
- **Must not:** switch off any flag listed above.

## `node.json`

For NestJS on Node 26 (`apps/api`) and Node command-line tools.

- **Settings:**
  - `module` and `moduleResolution` are `nodenext` (ESM, decisions 0003 and 0005);
  - `target` and `lib` are `es2024`;
  - `experimentalDecorators` and `emitDecoratorMetadata` for Nest and TypeORM;
  - `types: ["node"]`, because TypeScript 6 defaults `types` to an empty list (the app installs `@types/node`).
- **With `isolatedModules`:** a type used in a decorated constructor must be imported with `import type`, and TypeScript reports this.
- **DTO and entity properties:** declared with `!` (definite assignment). `strictPropertyInitialization` stays on, unlike the NestJS template.
- **May override:** `outDir`, `rootDir`, `include`, `sourceMap`, `declaration`, `incremental`, and extra `types` (for example `vitest/globals`).
- **Must not:** change `module` or `moduleResolution`, or switch off the decorator flags.

## `library.json`

For compiled shared packages (`packages/*` and `tools/*`, decision 0003 sections 2 and 4), first used by `@kd/design-tokens`.

- **Settings:**
  - `module` and `moduleResolution` are `nodenext` (ESM);
  - `target` and `lib` are `es2024`;
  - `declaration`, so consumers read `dist/*.d.ts` and never a sibling's source;
  - `outDir` is `${configDir}/dist`. `${configDir}` is the folder of the package's own `tsconfig.json`, so the output lands in that package, not in this one.
- **Not here:** decorators and `types`. TypeScript 6 defaults `types` to an empty list, so a package that needs Node types adds `"types": ["node"]` and installs `@types/node`.
- **The package sets:** `rootDir` (usually `./src`) and `include`.
- **Must not:** change `module`, `moduleResolution` or `outDir`, or switch off `declaration`.

## `web.json`

For the Angular admin (`apps/admin`).

- **Settings:** the strict settings of the Angular 22 workspace template:
  - `target: es2022`, `module: preserve`, `experimentalDecorators`, `importHelpers`, `noPropertyAccessFromIndexSignature`;
  - `angularCompilerOptions` with `strictTemplates`, `strictInjectionParameters` and `strictInputAccessModifiers`.
- **Left to the app:** builder-specific options, such as `outDir`, `files`, `include`, `types` and the `tsconfig.app.json` / `tsconfig.spec.json` split.
- **May override:** add `lib` entries.
- **Must not:** switch off any of the template's strict flags or Angular's strict template checks.

## `react-native.json`

For the Expo app (`apps/mobile`): the strictness of `base.json` with no module, target, JSX or `lib` settings. Those come from Expo, so they always match the SDK.

- **How to extend:** the app lists both configs, Expo first:

  ```json
  { "extends": ["expo/tsconfig.base", "@kd/tsconfig/react-native.json"] }
  ```

  Later entries win, so the strictness of `base.json` applies on top of Expo's settings.

- **Why the file does not extend Expo itself:** this package does not depend on `expo` (0003 keeps Expo-managed packages pinned in `apps/mobile`). TypeScript resolves an `extends` from the folder of the config that names it. So `expo/tsconfig.base` resolves from `apps/mobile`, not from this package.
- **May override:** `include`, and the app settings Expo documents. No `paths` aliases (decision 0003).
- **Must not:** reorder the two entries, or switch off any strict flag.
