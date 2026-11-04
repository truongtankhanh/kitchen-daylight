# @kd/i18n

String catalogues shared by the admin (Angular) and the mobile app (Expo). The package is private, ESM, compiled with `tsc` (decision 0003), and has no runtime dependency. Vietnamese (`vi`) is the default locale; English is added later.

## Framework-neutral

The package exports plain objects and types only. It imports neither Angular nor React. Each app writes its own adapter (an Angular service or pipe, a React Native hook) on top of `catalogues`, and chooses how to interpolate values and pick plural forms.

## Exports

| Export           | What it is                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `catalogues`     | The locale registry: a map from locale code to catalogue, today `{ vi }`                 |
| `DEFAULT_LOCALE` | `'vi'`                                                                                   |
| `LOCALES`        | The registered locale codes                                                              |
| `Locale`         | Union of the registered codes                                                            |
| `Catalogue`      | The shape every locale must have: the keys of `vi`, with every message typed as `string` |
| `Namespace`      | Top-level groups: `common`, `errors`                                                     |
| `MessageKey`     | Dot path of every message, for example `common.appName`                                  |

## Catalogue

`src/locales/vi.ts` is the reference. Keys are grouped by namespace:

- `common`: neutral keys shared by both apps. Today only `appName`, which is the working name `KD` until the trademark check (decision 0006 item 9).
- `errors`: empty. The error messages are added with the API error codes, by the slices that use them.

Screen strings are added by the slice that builds the screen, in the namespace of that feature. Keys are camelCase identifiers and nest at most as deep as the feature needs.

## Adding a locale

Adding English is data only. No type, script or adapter changes.

1. Add `src/locales/en.ts` exporting `en`, typed as `Catalogue`.
2. Add `en` to `catalogues` in `src/index.ts`.

A missing key then fails twice:

- **`typecheck`:** `catalogues` must satisfy `Record<string, Catalogue>`.
- **`check`:** this also covers a catalogue whose type was loosened, for example with a cast.

## Scripts

| Script      | What it does                                                             |
| ----------- | ------------------------------------------------------------------------ |
| `build`     | `tsc` into `dist/`                                                       |
| `typecheck` | `tsc --noEmit`                                                           |
| `lint`      | ESLint with the shared rules and the `i18n` boundary row (decision 0003) |
| `check`     | Builds, then runs `scripts/check.mjs`                                    |

`scripts/check.mjs` runs two steps:

1. **The real registry:** it fails when any locale lacks a key that `vi` has. A missing empty namespace counts as a missing key. Today the step passes trivially, because `vi` is the only locale.
2. **The fixture:** it runs the same check on `scripts/fixtures/missing-key.mjs`, where `en` lacks `common.tagline` and the `errors` namespace. The step fails unless exactly those keys are reported, so a check that silently stops matching breaks the script.

Keys that a locale has and `vi` does not are not reported.
