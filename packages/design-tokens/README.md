# @kd/design-tokens

Design tokens for the admin (Angular, PrimeNG) and the mobile app (Expo), generated from one file. The package is private, ESM, compiled with `tsc` (decision 0003) and has no runtime dependency.

## Source

`tokens.json` is the only source. It is a copy of `docs/ui/tokens/tokens.json` in the design workspace, which stays the owner of the values until P6-T1 moves it here. Until then:

- change a value in the design workspace first, then copy the file here unchanged and run `build`;
- never edit a token value here, and never edit a file under `src/` by hand.

`tokens:check` compares the generated files with `tokens.json` only. It cannot see the design workspace, so a copy that falls behind the design is caught in review, not by a script.

## Outputs

`scripts/build.mjs` writes four files under `src/`. Each starts with a "Generated, do not edit" header. The output has no clock or environment input, so two runs give the same bytes. It is already in the repository's Prettier style, so the pre-commit formatter leaves it unchanged.

| Subpath                          | File                                               | Content                                                                                           |
| -------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@kd/design-tokens`              | `src/index.ts` → `dist/index.js`                   | `tokens` (every token as a readonly literal) and the types `Tokens`, `ColorScheme`, `ColorToken`  |
| `@kd/design-tokens/css`          | `src/tokens.css`                                   | CSS custom properties `--kd-*` (decision 0006 item 7)                                             |
| `@kd/design-tokens/primeng`      | `src/primeng-preset.ts` → `dist/primeng-preset.js` | `primeNgPreset`, a plain object in the PrimeUIX token shape                                       |
| `@kd/design-tokens/react-native` | `src/react-native.ts` → `dist/react-native.js`     | `lightTheme`, `darkTheme`, `space`, `radius`, `touchTarget`, `fontFamily`, `typography`, `motion` |

`tsc` compiles the three TypeScript files to `dist/`. The CSS file is not compiled, so the `./css` subpath points at `src/tokens.css`, which is committed.

### CSS variables

- **Names:** the design workspace's names with the `kd` prefix: `--kd-color-<token>`, `--kd-glass-*`, `--kd-elevation`, `--kd-space-1` to `--kd-space-8`, `--kd-radius-*`, `--kd-touch-target`, `--kd-font-family`, `--kd-m-<style>-{size,line,weight}` (mobile scale), `--kd-a-<style>-{size,line,weight}` (admin scale), `--kd-motion-fast`, `--kd-motion-base`.
- **`--p-*` is never used:** PrimeNG owns that prefix.
- **Colour scheme:** light by default. Dark applies through `prefers-color-scheme` unless `data-theme="light"` is set, and `data-theme="dark"` forces it. Each scheme also sets `color-scheme`, which the PrimeNG preset relies on (below).
- **Reduced motion:** `--kd-motion-fast` and `--kd-motion-base` fall to `motion.reducedMs`.
- **Hex colours are lowercase** in the CSS file only, to match Prettier's CSS output. CSS colours are case-insensitive, so the values are unchanged.

### PrimeNG preset

The preset imports nothing, so this package stays a leaf (decision 0003) and declares no dependency on `@primeuix/themes`. The admin pins `@primeuix/themes` 3.1.0 itself (decision 0001) and extends Aura with it:

```ts
import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import { primeNgPreset } from '@kd/design-tokens/primeng';

export const kdPreset = definePreset(Aura, primeNgPreset);
```

Mapping, defined in `scripts/build.mjs`:

| PrimeUIX token                                                                                | Token in `tokens.json`                      |
| --------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `primitive.borderRadius.sm`, `.md`                                                            | `radius.sm` (8), `radius.md` (12)           |
| `semantic.transitionDuration`                                                                 | `motion.baseMs`                             |
| `semantic.primary.color`, `.contrastColor`                                                    | `primary`, `onPrimary`                      |
| `semantic.primary.hoverColor`, `.activeColor`                                                 | `primaryPressed` (see gap 2)                |
| `semantic.highlight.background`, `.color`                                                     | `primaryContainer`, `onPrimaryContainer`    |
| `semantic.formField.background`, `.disabledBackground`, `.borderColor`, `.invalidBorderColor` | `surface`, `disabledBg`, `outline`, `error` |
| `semantic.formField.color`, `.disabledColor`, `.placeholderColor`                             | `text`, `disabledText`, `textSecondary`     |
| `semantic.text.color`, `.mutedColor`                                                          | `text`, `textSecondary`                     |
| `semantic.content.background`, `.borderColor`                                                 | `surface`, `divider`                        |

- **Light and dark values use `light-dark(<light>, <dark>)`**, not `colorScheme.light` and `colorScheme.dark`. Decision 0006 item 7 names the `colorScheme` shape. The Aura base of `@primeuix/themes` 3.1.0 has no `colorScheme` block: it writes these same semantic tokens with `light-dark()`. Overriding them through `colorScheme` would define each variable twice, with an unclear winner. `light-dark()` replaces Aura's value for the same key.
- **`light-dark()` follows the CSS `color-scheme` property.** `@kd/design-tokens/css` sets it per scheme. P4-T6 loads that file in the admin and makes PrimeNG's `darkModeSelector` match the `data-theme` selectors.
- **Rendering is not verified here.** P4-T6 confirms it, as decision 0006 item 7 says.
- **Not mapped:** `bg` (the admin sets it on the page through `--kd-color-bg`); glass and elevation (the admin uses neither, per the style direction); fonts (PrimeUIX `typography.fontFamily` stays `inherit`, so the page font applies).

### React Native theme

- **Numbers, no CSS units:** sizes, radius, `glass.blur` and line heights are plain numbers. `elevation` is a `{ offsetX, offsetY, blurRadius, color }` object for React Native's `boxShadow`, or `null` for `none`.
- **Typography:** the mobile scale only, as `{ fontSize, lineHeight, fontWeight }` with `fontWeight` as a string (`'700'`).
- **Font:** `fontFamily` is the family name only. React Native has no fallback stack; the system font is the fallback.
- **Validation:** the generator rejects a value it cannot turn into a number (another unit, more than one shadow, a font stack) instead of emitting it.

## Fonts

There are no font files in this package (decision 0006 item 6). It outputs the family name, the fallback stack, weights and sizes only. Each app ships its own font files with `OFL.txt` next to them: the admin self-hosts them (P4-T6) and mobile loads them with `useFonts` (P4-T7).

## Scripts

| Script         | What it does                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build`        | Runs the generator, then `tsc` into `dist/`. Turborepo caches `dist/**`; the generated `src/` files are committed and are inputs, which is safe because the generator is deterministic |
| `tokens:check` | Regenerates in memory and fails if a file under `src/` differs from `tokens.json` or is missing. Writes nothing                                                                        |
| `lint`         | ESLint with the shared rules and the `design-tokens` boundary row (decision 0003)                                                                                                      |
| `typecheck`    | `tsc --noEmit`                                                                                                                                                                         |

After changing `tokens.json`, run `pnpm --filter @kd/design-tokens build` and commit `tokens.json` and `src/` together.

## Gaps

Tokens the consumers need that `tokens.json` does not have. They are left to the design workspace; no value is invented here.

1. **No colour palettes (50 to 950).** Decision 0006 item 7 expects `primitive` palettes and a `semantic.primary` palette. `tokens.json` has single colours only. So Aura's own palettes stay wherever Aura reads a palette step: the emerald `{primary.50}` to `{primary.950}` (for example `highlight.focusBackground` and the text and outlined button hover backgrounds) and the slate and zinc `{surface.*}` steps. Until the design adds a primary and a neutral palette, some PrimeNG states show emerald or slate. P4-T6 must list what it sees.
2. **No hover colour.** `primary.hoverColor` uses `primaryPressed`, the same as `activeColor`. This is a mapping choice, not a new value. Without it, hover would show Aura's emerald.
3. **The web font fallback differs from decision 0006 item 6.** The decision names `"Be Vietnam Pro", Inter, system-ui, sans-serif`. `tokens.json` has `'Be Vietnam Pro'` with `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` and no Inter. The package follows `tokens.json`.
4. **Radius `lg` and `xl` are not mapped to PrimeUIX.** The design's 20 and 28 are mobile radii; the admin uses 8 and 12 (style direction). Aura's own `lg` (8px) and `xl` (12px) stay. Aura uses `xl` for dialogs.
5. **`motion.sheet` is the string `"spring"`**, with no spring parameters (stiffness, damping, mass). The mobile app needs them for an animated sheet.
