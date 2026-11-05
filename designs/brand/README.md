# Kitchen Daylight brand assets

**Name:** Kitchen Daylight (daylight = ánh nắng ban ngày), monogram **KD**. Chosen by the owner on 2026-10-21 to fit the "Nắng" theme; it replaces "KD Cuisine". Trademark not checked.

Status: **draft, revision 3** (2026-10-21). Revision 1 used a thin stroke monogram and the UI font for the name. Revision 2 followed the owner's request for a softer typeface with more depth. Revision 3 follows the owner's request that the two letters read as a sun: "KD" now sits in a sun disc with rays (option A of three explored in `explore/`; B put rays on the D, C was a sunrise over water). The aqua wave was dropped from the mark.

Open `index.html` in a browser to see every file on light, dark and colored backgrounds.

## Files

| File | Use |
|---|---|
| `logo-mark.svg` | App icon and avatar: soft rounded tile, "KD" inside a sun disc with a ring of 12 rays. From 24 px up. |
| `logo-mark-small.svg` | Favicon and anything below 24 px: flat, with 8 thicker rays and no gradients or shadows, so it stays crisp. |
| `logo-horizontal.svg`, `logo-horizontal-on-dark.svg` | Mark and name side by side: headers, emails, documents. |
| `logo-stacked.svg`, `logo-stacked-on-dark.svg` | Mark above the name: splash screen, login card, store listing. |
| `logo-wordmark.svg`, `logo-wordmark-on-dark.svg` | Name only, when the mark already appears next to it. |
| `source/generate-logos.py` | Regenerates every SVG above from the font. |
| `explore/` | The three sun options compared on 2026-10-21 (A chosen). Kept for reference; not for production. |

## Design

- **Typeface:** Nunito, fully rounded terminals. "Kitchen" is ExtraBold (800), "Daylight" is Bold (700); the monogram "KD" uses the same ExtraBold. All text is converted to outlines, so the files do not depend on an installed font. Nunito covers Vietnamese, which a future tagline will need. License: SIL Open Font License 1.1 (`source/Nunito-OFL.txt`); I read the license header but did not review the full FAQ on logos made from outlined glyphs, so confirm before commercial release.
- **Depth, in three layers:** the tile has a top-lit gradient with a thin rim light; the sun disc (white to `#9ED8FF`) and the 12 rays each sit on a soft darker copy offset downward, with a pale aqua glow around the rays; "KD" is deep blue on the disc with a thin light edge. The name carries a faint offset shadow in the same blue.
- **Color (Water element, no yellow or brown):** tile `#4F9BFF` to `#1560C8` to `#0E3463`; disc `#FFFFFF` to `#9ED8FF`, letters `#0E3463`, rays white, glow `#BFEFFF`; name on light `#0E3463` to `#1560C8`; name on dark white to `#BCD8FF`. These come from the product palette in `docs/ui/tokens`.

## Rules

- Minimum size: full mark 24 px, small mark 16 px; horizontal logo 24 px tall.
- Clear space: half the height of the letter K on every side.
- Do not rotate, stretch, recolor the tile, add an outer shadow, or place the full mark on a busy photo (use the on-dark version over a dark scrim).

## Regenerating

The script needs Python with `fonttools` and the variable Nunito file (`Nunito[wght].ttf`, from the Google Fonts repository). It writes the SVG files into this folder:

```
python3 -m venv .venv && .venv/bin/pip install fonttools
.venv/bin/python source/generate-logos.py /path/to/Nunito[wght].ttf
```

Set `KD_SYMBOL_OUT` to also write an inline `<symbol>` of the full mark (used by the admin mockups in `designs/web/mockups`).

## Not done

- At 16 px the favicon rays read as a ring of dots; check it in a real browser tab.
- No print-ready CMYK or single-color versions, and no clear-space or minimum-size test on real devices.
- The admin mockups embed the full mark inline; if the mark changes, regenerate the symbol and replace it in each frame.
- Trademark search for the name is still open (see `docs/ui/style-direction.md`).
