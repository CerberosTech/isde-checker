# ISDE-checker
Static Dutch site: is my heat pump on RVO's ISDE meldcodelijst? `node build.mjs` → `dist/`. No dependencies.
Data: RVO ISDE Meldcodelijst Warmtepompen (open government info, reuse allowed per rvo.nl/onderwerpen/open-data). Fetched at build time, fallback to `data/rvo.xlsx`.
Brand kit (logo, icons, og-image): see `brand/BRAND.md`. Regenerate into `src/` with `node brand/build-brand.mjs` (needs Chrome or Chromium).
