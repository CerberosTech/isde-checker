# ISDE-checker brand

## Idea

The meldcode is the "kenteken" of a heat pump: the code you copy into your ISDE application.
The site shows every meldcode as a yellow plate. This plate is the one bold element.
Everything around it stays quiet: white space, green type, thin lines. No shadows and no gradients.

## Palette

| Name | Hex | Use |
| --- | --- | --- |
| Veengroen | `#0F3D2E` | Text, headings, logo body, borders, `theme-color` |
| Poldergroen | `#146B4A` | Links, the "staat op de lijst" check, secondary buttons |
| Kentekengeel | `#FFCC00` | Meldcode plates, the search button, focus rings, the fan in the logo |

Support tints (not brand colours): white `#FFFFFF`, mist `#F1F5F2` (bands, footer), line `#D5E0DA` (dividers only), muted text `#4A5D55`.

Rules:

- Use Kentekengeel only for meldcodes, the main search button and focus. Do not use it for decoration.
- Never put Kentekengeel text on white (contrast 1.5:1). Put Veengroen text on Kentekengeel (8.0:1).
- Contrast on white: Veengroen 12.2:1, Poldergroen 6.5:1, muted text 7.0:1. On mist: muted text 6.4:1, Poldergroen 5.9:1.

## Font

One system font stack, no web fonts:

```css
font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

- Weights: 400 for text, 600 for labels, 800 for headings, amounts and meldcodes.
- Use tabular figures (`font-variant-numeric: tabular-nums`) for meldcodes and amounts.
- Body text is 17 px with a line height of 1.6. Keep lines shorter than about 70 characters.

## Logo

The mark is a heat-pump outdoor unit with two feet and a side grille. Its fan is a disc with a check.

| File | Size | Use |
| --- | --- | --- |
| `src/logo.svg` | square master, transparent | On white or light backgrounds (Veengroen unit, yellow fan) |
| `src/logo-512.png` | 512 × 512, transparent | Where SVG is not accepted |
| `src/icon.svg` | square, Veengroen tile | Browser favicon (white unit, yellow check) |
| `src/favicon.ico` | 32 × 32 | Older browsers |
| `src/apple-touch-icon.png` | 180 × 180, full bleed | iOS home screen (iOS rounds the corners) |
| `src/og-image.png` | 1200 × 630 | Link previews: "Staat jouw warmtepomp op de ISDE-lijst?" |

- On a Veengroen background, use the white unit (as in `icon.svg` and the og-image).
- Keep clear space around the mark of at least one fan radius.
- Do not use the mark smaller than 16 px.
- In the site header, set the mark at 36 px next to the word "ISDE-checker" in weight 800. The word is text, not part of the image.

## Make the files again

```sh
node brand/build-brand.mjs
```

The script writes all six files to `src/`. `node build.mjs` copies them to `dist/`.
It needs Node 18 or later and Google Chrome or Chromium; `brand/chrome.mjs` drives headless Chrome with no npm packages.
If Chrome is not in a standard place, set `CHROME=/path/to/chrome`.
Change the colours or the mark in `brand/build-brand.mjs`, then copy the new hex values to `src/style.css` and `THEME` in `build.mjs`.
