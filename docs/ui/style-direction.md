# UI style direction

> **Superseded in part (2026-10-27, [ADR-0009](../adr/0009-owner-business-pivot.md)).** VER.02 is now the owner's own restaurant app: one brand with branches, a menu, pickup and delivery orders, table reservations, loyalty and vouchers, and a staff operations console (orders board first). The principles, tokens, state matrix and the screens for accounts, auth, account deletion and system states below still hold. The directory screens (browse venues of any restaurant, nearby places on a map as discovery, search of venues, venue reports, brands and destinations in the admin) are replaced; the new screen inventory is in [ADR-0009](../adr/0009-owner-business-pivot.md) and the endpoints in [api-outline.md](../api-outline.md) v3. The wireframes in this folder have **not** been redrawn yet.

Status: **proposal, revised (2).** Requested by the owner on 2026-10-21: a modern, commercial look using the hottest current style. The owner approved the overall direction and **rejected the first accent color (chili red)**; revision 1 replaced it with saffron and herb green. **Revision 2 (2026-10-21):** the owner, whose element is Water (mệnh Thủy), asked to drop the yellow and brown tone. The palette is now ocean blue and teal on cool white, and the product is named **Kitchen Daylight** with a "KD" monogram (see [../../designs/brand/](../../designs/brand/)). The Water-element reasoning (Water and Metal colors suit; Earth colors yellow and brown do not) is the owner's convention, not something I verified. Flows and wireframes are in [README.md](README.md), [mobile.md](mobile.md) and [admin.md](admin.md). Step 2 (high-fidelity mockups) implements this document.

## Decision in one paragraph

**Photo-first and cool, with platform-native "glass" chrome and expressive motion.** Content (food photography, big type, bento tiles) carries the brand; navigation and floating controls follow each platform's current design language (Liquid Glass on iOS 26, Material 3 Expressive influences on Android); text always sits on solid surfaces, never on glass. The brand colors are **ocean blue** (action) and **teal** (confirmation, "open now", verified); warnings are violet. The admin web is deliberately calmer: a clean, dense, productivity style that shares the same color, type and radius tokens but not the glass or heavy motion.

## What "hottest style" means in 2026, and what I adopt

Evidence (secondary sources: design blogs and press, not studies; Apple and Google first-party documentation was not read):

| Trend | What the sources say | Decision |
|---|---|---|
| **Liquid Glass** (Apple, iOS 26) | Apple's largest visual change in over a decade; a distinct functional layer for navigation and controls floating above content ([wavespace](https://www.wavespace.agency/blog/ui-design-trends), [orangeloops](https://orangeloops.com/2025/12/liquid-glass-vs-material-3-expressive-next%e2%80%91gen-ui-design-compared/)) | **Adopt for chrome only** (tab bar, toolbars, floating map controls, sheets) |
| **Material 3 Expressive** (Google) | Mood conveyed through motion physics, distinctive shapes and bold color ([orangeloops](https://orangeloops.com/2025/12/liquid-glass-vs-material-3-expressive-next%e2%80%91gen-ui-design-compared/)) | **Adopt its motion and shape ideas** on Android inside the brand tokens |
| **Bento grids** | Modular tiles of varied size; reported to work best for about 6 to 9 tiles ([The Plus Addons](https://theplusaddons.com/blog/web-design-trends-2026/)) | **Adopt for the "explore" section of Home** (6 tiles: venue types and top dietary tags) |
| **Calm vs. expressive split** | 2026 is framed as Apple's restrained glass versus Google's springy expression ([wavespace](https://www.wavespace.agency/blog/ui-design-trends)) | Use each platform's native feel for chrome; one brand layer for content |
| **Human craft over generic AI-looking UI** | Designers deliberately add distinctive details ([SolGuruz](https://solguruz.com/blog/ui-ux-design-trends/)) | Cool Water-element palette, tactile micro-interactions, real photography, no stock-gradient look |
| **Photo-first** | Searches did not cover it, so this is my own judgment: food discovery is decided by images | Adopt (project principle 1) |

**Known problem with Liquid Glass, and how this design avoids it.** Beta testing reported text falling below WCAG contrast (one measurement of 1.5:1 against 4.5:1), and Apple later reduced transparency and added a "Tinted" option ([Infinum](https://infinum.com/blog/apples-ios-26-liquid-glass-sleek-shiny-and-questionably-accessible/), [Apple Developer Forums](https://developer.apple.com/forums/thread/811219), [BGR](https://bgr.com/tech/ios-26-beta-3-liquid-glass-complaints/)). Evidence is partly informal beta feedback. Rules here: glass only on chrome that holds icons and short labels; never behind paragraphs, prices or ratings; a solid-surface fallback whenever the system asks for reduced transparency.

## Platform strategy (mobile)

| Platform | Chrome | Content |
|---|---|---|
| iOS 26+ | Native tab bar and toolbars through Expo Router `NativeTabs`, which give system Liquid Glass; sheets use the native glass presentation | Brand tokens (below) |
| iOS earlier, Android | Same layout with a solid or lightly translucent tab bar; Material-style motion and shapes | Brand tokens |

Feasibility, from Expo's documentation and posts: native tabs are the route to Liquid Glass tabs ([Expo native tabs](https://docs.expo.dev/router/advanced/native-tabs/)); the import path is `expo-router/unstable-native-tabs`, so the API may still change; Expo Router v55 adds a bottom accessory (iOS 26) and a native Toolbar with breaking changes ([Expo Router v55](https://expo.dev/blog/expo-router-v55-more-native-navigation-more-powerful-web)); glass sheets are covered in an Expo guide ([Apple Maps style sheets](https://expo.dev/blog/how-to-create-apple-maps-style-liquid-glass-sheets)). I did not find an official `expo-glass-effect` API page or a version-compatibility matrix, and I did not verify how native tabs render on Android. **Decision for scaffolding:** build the tab bar behind one component so it can fall back to a standard JavaScript tab bar if native tabs prove unstable.

## Visual language

1. **Hero photography.** Large cards with generous radius; the photo is the card. Aspect ratio 4:3 for list cards, 16:9 for the detail hero, 1:1 for bento tiles. Blurhash placeholder always.
2. **Bento "explore" section. Superseded for mobile Home on 2026-10-21 (owner feedback, [designs/mobile/brief.md](../../designs/mobile/brief.md) revision 2): Home uses a denser ten-shortcut category grid instead.** The bento idea may return in a later release. Original proposal: six tiles of mixed sizes (for example one large, two medium, three small) for venue types and dietary tags such as Chay and Buffet. Everything else on Home is horizontal rails and lists so row height stays predictable.
3. **Expressive type.** Section titles are large and heavy; body text stays calm and highly legible.
4. **Glass on chrome.** Tab bar, back button, save and share buttons floating over the hero photo, map controls, sheet handle area. Selected state is shown by shape and weight, not color alone.
5. **Expressive but restrained motion.** Spring-based sheets, a shared-element transition from card photo to detail hero, a heart "pop" with a light haptic on save, skeleton to content cross-fade. All are replaced by a short cross-fade when the system's Reduce Motion is on.
6. **Cool, tinted neutrals.** A cool off-white background in light mode and a deep navy in dark mode, never pure white or pure black. No yellow, brown or other earth tones in the interface (food photography is the only warm color).
7. **Two accents with fixed jobs.** **Ocean blue** is for actions and selection (buttons, the active tab indicator, chips). **Teal** is for "open now", verified marks, success and secondary actions. **Violet** is the warning color (always with an icon and text), chosen over amber so the interface stays free of yellow. Stars use the blue family. **Red is never a brand color;** it appears only as the error color.

**Avoid:** glass behind readable text, full-screen gradients, neon, heavy drop shadows, autoplay video, fake urgency or scarcity messages, pre-ticked consent, parallax-heavy screens.

## Design tokens (proposal)

### Color

A rough visual preview of both modes is in [preview/palette.html](preview/palette.html); open it in a browser. It is a draft (placeholder photos, system font), not a mockup.

All pairs below were measured with the WCAG relative-luminance formula (script run in this session). Text needs at least 4.5:1, graphical objects at least 3:1.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `bg` | `#F3F7FB` | `#07111D` | Screen background |
| `surface` | `#FFFFFF` | `#0E1C2E` | Cards, sheets, inputs |
| `surface-variant` | `#E6EDF5` | `#16293F` | Chips, secondary areas |
| `text` | `#0B1B2E` | `#E7F0FA` | Primary text |
| `text-secondary` | `#44566C` | `#A8BACF` | Supporting text |
| `outline` | `#667A93` | `#7087A3` | Input and control boundaries |
| `divider` | `#D3DEEA` | `#213A58` | Decorative separators only |
| `primary` (ocean blue) | `#1560C8` | `#5CA8FF` | Button fills, active indicators |
| `on-primary` | `#FFFFFF` | `#04213F` | Text and icons on `primary` |
| `primary-strong` | `#0F4FA8` | `#5CA8FF` | Primary-colored text, icons and links on plain surfaces |
| `primary-container` / `on-primary-container` | `#D6E7FF` / `#0A2E5C` | `#0E3463` / `#D3E6FF` | Selected chips, active tab pill |
| `secondary` (teal) / `on-secondary` | `#0B7A83` / `#FFFFFF` | `#4FD1C5` / `#022B2A` | Open now, verified, success, secondary buttons |
| `secondary-container` / `on-secondary-container` | `#D3F1F0` / `#063D3F` | `#0C3F3F` / `#B6F0EA` | Open and verified pills |
| `warning` (violet) / container | `#6B3FA0` / `#EDE5FA` | `#CDB6FF` / `#2E2054` | Warnings (always with an icon and text) |
| `error` | `#B3261E` | `#FFB4AB` | Errors only |
| `star` | `#2F6FB5` | `#7DB8FF` | Rating stars (always with the number) |

Measured contrast (light / dark):

| Pair | Light | Dark | Required |
|---|---|---|---|
| `text` on `bg` | 16.12 | 16.48 | 4.5 |
| `text-secondary` on `surface` | 7.52 | 8.65 | 4.5 |
| `text-secondary` on `surface-variant` | 6.37 | 7.44 | 4.5 |
| `on-primary` on `primary` | 5.93 | 6.57 | 4.5 |
| `primary-strong` on `bg` | 7.21 | 7.68 | 4.5 |
| `primary-strong` on `surface-variant` | 6.58 | 5.97 | 4.5 |
| `on-primary-container` on `primary-container` | 10.74 | 9.78 | 4.5 |
| `on-secondary` on `secondary` | 5.09 | 8.15 | 4.5 |
| `secondary` on `bg` (text or icon) | 4.73 | 10.17 | 4.5 |
| `on-secondary-container` on `secondary-container` | 10.08 | 9.25 | 4.5 |
| `warning` on `warning-container` | 6.04 | 8.09 | 4.5 |
| `error` on `surface` | 6.54 | 10.10 | 4.5 |
| `outline` on `surface` | 4.40 | 4.64 | 3.0 |
| `star` on `surface` | 5.17 | 8.31 | 3.0 |
| `star` on `surface-variant` | 4.38 | 7.15 | 3.0 |

All 26 pairs in `tokens.mjs` pass in both modes (`node tokens.mjs check`, run on 2026-10-21 after revision 2).

Rules that follow from the numbers:
- **The `primary` fill is 5.51:1 against the light background and carries a white label (5.93:1).** Icons, links and the active-tab glyph on light surfaces use `primary-strong` (7.21:1), which is darker than the fill. In dark mode the fill is light blue and its label is dark navy.
- `secondary` (teal) text on the light background is 4.73:1, close to the 4.5 limit: use it for short labels and icons, not for long text.
- Stars are never the only carrier of the rating: the number always sits beside them.
- Text laid over a photo sits on a bottom scrim (transparent to about 65% black). Because photos vary, this must be checked against bright images during step 2; I have not tested it.
- Pressed and disabled states for `primary` are derived in step 2 and measured then; I have not defined them yet.

### Typography

- **Typeface:** Be Vietnam Pro for all UI text. It was designed with Vietnamese in mind and is distributed on Google Fonts under an open license; **I have not verified the license text or the React Native packaging**, so confirm both before adopting. Fallback: Inter, which also covers Vietnamese.
- **Mobile scale:** Display 28/36 bold; Title 22/30 bold; Headline 18/26 semibold; Body 16/24 regular; Body small 14/20; Caption 12/16 medium (nothing smaller). Line heights run about 1.4 to 1.5 so stacked Vietnamese diacritics are not clipped.
- **Admin scale:** base 14 px, headings 16, 20, 24.
- Text scales with the system font size; layouts must remain usable at 200%.

### Shape, space, elevation, motion

| Item | Value |
|---|---|
| Spacing | 4-pt grid: 4, 8, 12, 16, 20, 24, 32, 48 |
| Radius | 8 (inputs, chips), 12 (small cards), 20 (cards), 28 (hero, sheets), pill (buttons, chips) |
| Elevation | Tonal surfaces first. Light mode: one soft shadow (`y 4`, blur 16, 8% black). Dark mode: no shadow, lighter surface instead |
| Motion | Fades about 150 ms; shared element and sheets use springs; skeleton to content about 200 ms. Reduce Motion: a 100 ms cross-fade only |
| Touch target | At least 44 x 44 pt |
| Icons | 24 pt outline icons, one family; selected tab uses a filled variant. Icon library is chosen at scaffolding |

### Core components

| Component | Spec summary |
|---|---|
| Place card (rail) | Photo 4:3, radius 20, name (Headline), rating and distance on one line, small status pill when closed |
| Place card (list) | Photo 1:1 at left, text at right, save button 44 pt |
| Primary button | Filled `primary` (ocean blue), pill, 52 pt tall, `on-primary` label 16 px semibold |
| Secondary button | Filled `secondary` (teal) with `on-secondary` label, or outlined with `outline` |
| Chip | Pill, `surface-variant`; selected uses `primary-container` and a check mark |
| Rating | Star glyph plus number `4,5` plus count `(128)` |
| Status pill | Open: `secondary-container` with a dot icon. Closed: neutral. Temporarily closed: `warning` with a pause icon. Permanently closed: neutral, with a struck-through name in the detail header |
| Bottom sheet | Radius 28, native glass on iOS 26, solid `surface` elsewhere |
| Tab bar | Four tabs, glass on iOS 26, solid elsewhere, label always visible; active tab uses a filled icon in `primary-strong` on a `primary-container` pill |
| Input | Radius 8, 1.5 pt `outline` boundary, label above, error text below |

## Admin web style

Calm and dense rather than trendy: PrimeNG themed with the same tokens, light and dark, 8 and 12 radius, subtle shadows, comfortable table density with a compact option, skeleton loading, consistent form layout and inline validation. No glass, no heavy motion. Layouts as in [admin.md](admin.md). Primary actions use the ocean-blue button; destructive actions use an outlined button with the `error` color and a confirmation step.

## Commercial polish checklist

- Perceived speed: blurhash and skeletons everywhere, optimistic save and unsave, cached lists when offline.
- No dead ends: every empty state has a next action.
- Consistent tone of voice in Vietnamese, short and friendly; error messages say what to do.
- Haptics on key actions (save, submit review), never on scroll.
- App icon, splash and store screenshots are designed after the name and logo are fixed.
- No third-party analytics SDK until a consent and data-minimization decision is made (the privacy design has no analytics tables).

## Risks

1. **Trend fragility.** Glass and expressive styles date quickly. Mitigation: they live only in chrome and motion; the content layer is plain cards, photos and type.
2. **Accessibility of glass.** See above; solid fallbacks are mandatory.
3. **Expo native tabs are unstable API** and the Android rendering is unverified; fallback component required.
4. **Brand differentiation.** I have not surveyed the Vietnamese market, so I cannot say how close blue and teal are to existing food or delivery apps; blue is common in apps generally and a food product may feel colder than warm-toned competitors. Photography carries the warmth. Reconsider if mockups feel generic.
4a. **Violet as the warning color** is unconventional (amber is the usual choice) and was picked only to keep yellow out of the interface. It is always paired with an icon and text; revert to amber if users find it confusing.
5. **Font license and packaging** unverified.
6. **Glass cost on low-end Android devices** is untested; keep the solid fallback for them.
7. **Photography rights** for the migrated catalog are unresolved (migration plan), which affects how good the mockups can honestly look.

## Open items

1. Confirm the ocean-blue, teal and violet palette (revision 2; the owner rejected chili red, then saffron).
2. Product name **Kitchen Daylight** and the "KD" monogram ([../../designs/brand/](../../designs/brand/)) replace the working names "Nếm" and "KD Cuisine" (renamed on 2026-10-21 to fit the "Nắng" theme: KD = Kitchen Daylight). Trademark not checked; the app icon and splash are derived from the monogram.
3. Native tabs versus a JavaScript tab bar, decided at scaffolding.
4. Icon family and font packaging. **Admin web mockups:** the hand-drawn set was replaced on 2026-10-30 by [Lucide](https://lucide.dev) (ISC licence, commercial use allowed, keep the copyright notice), 24 px grid, 1.8 px stroke, round caps and joins, `currentColor`; the `i-…` names were kept and the full set is on the "Bộ biểu tượng" board of frame 00. The mobile app still has to choose (Lucide has Angular, Flutter, React Native and font builds, so the same family could serve both); packaging of the font is still open.
5. Step 2 scope: tokens as code (shared package for mobile and admin), plus mockups for Home, Place detail, Search with filter sheet, Favorites, and the admin place editor and list, light and dark.
