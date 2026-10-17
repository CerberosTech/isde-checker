#!/usr/bin/env node
// Checks the built site in dist/ (run `node build.mjs` first). No deps, Node >= 18.
//   node scripts/check-site.mjs
// - every English route exists (one per Dutch page: home, lists, every brand, every model, guides, 404)
// - hreflang: lang attribute, self canonical, nl/en/x-default alternates, and the other page links back with the same set
// - sitemap.xml: well formed, < 50,000 URLs and < 50 MB, every <loc> exists, alternates match the pages, every indexable page is listed
// - internal links (href/src to the site, also absolute https://cerberostech.github.io/isde-checker/ links) resolve, including #fragments
// - English pages: no body links to Dutch pages (the language switch excepted); kept site features (analytics, affiliate box, key files)
// - follow-up: JSON-LD per page type (no offers/prices/ratings), visible RVO list date, one list date everywhere (stamp, Dataset, sitemap lastmod),
//   model index split into letter pages (< 150 KB, prev/next chain), model page content (summary, siblings, brand link), noindex for thin pages,
//   GoatCounter click names on bol.com links, twitter:* tags, no crawlable ?q= links
// - follow-up 3: /over/ and /en/about/ (AboutPage + BreadcrumbList, fixed lastmod, footer link on every page), GoatCounter script on every
//   dist/en/**/*.html, data-goatcounter-click names on every affiliate and CTA link or button (counts per name and language)
import fs from 'node:fs'; import path from 'node:path';
const SITE = 'https://cerberostech.github.io/isde-checker', BASE = '/isde-checker', OUT = 'dist';
const errors = [], warn = [], err = m => errors.push(m);
const t0 = Date.now();

// ---------- read every page ----------
const files = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f) : files.push(path.relative(OUT, f).split(path.sep).join('/')); } })(OUT);
const fileSet = new Set(files);
const htmlFiles = files.filter(f => f.endsWith('.html') && !/^google[\w-]*\.html$/.test(f));
const relOf = f => f.endsWith('index.html') ? f.slice(0, -'index.html'.length) : f; // dist file -> URL path after SITE/
const unent = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const pages = new Map();
for (const f of htmlFiles) {
  const html = fs.readFileSync(path.join(OUT, f), 'utf8'), rel = relOf(f);
  const alts = {}; for (const m of html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)) { if (alts[m[1]]) err(`${rel}: hreflang ${m[1]} twice`); alts[m[1]] = m[2]; }
  pages.set(rel, { f, rel, html, lang: html.match(/<html lang="([^"]+)"/)?.[1], canonical: html.match(/<link rel="canonical" href="([^"]+)">/)?.[1], alts,
    noindex: /<meta name="robots" content="[^"]*noindex/.test(html), ids: new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => unent(m[1]))) });
}
// A site URL (absolute or root-relative) -> { rel, hash } or null for other sites.
const local = u => { u = unent(u); let p;
  if (u.startsWith(SITE + '/') || u === SITE) p = u.slice(SITE.length); else if (u.startsWith(BASE + '/') || u === BASE) p = u.slice(BASE.length); else return null;
  const hash = p.includes('#') ? p.slice(p.indexOf('#') + 1) : ''; p = p.replace(/[#?].*$/, '').replace(/^\//, '');
  return { rel: decodeURIComponent(p), hash }; };
const exists = rel => rel === '' || rel.endsWith('/') ? fileSet.has(rel + 'index.html') : fileSet.has(rel);

// ---------- 1. English routes ----------
const products = JSON.parse(fs.readFileSync(path.join(OUT, 'products.json'), 'utf8')).products;
const nlBrands = files.filter(f => /^merk\/[^/]+\/index\.html$/.test(f)).map(f => f.split('/')[1]);
const modelSlugs = new Set(products.map(p => p[5]));
const letterSlugs = files.map(f => f.match(/^warmtepomp\/([^/]+)\/index\.html$/)?.[1]).filter(x => x && !modelSlugs.has(x)).sort();
const kind = rel => rel === '' || rel === 'en/' ? 'home' : /^(en\/)?(warmtepomp|heat-pumps)\/$/.test(rel) ? 'models' : /^(en\/)?(merken|brands)\/$/.test(rel) ? 'brands'
  : (m => m ? (modelSlugs.has(m[1]) ? 'model' : 'letter') : null)(rel.match(/^(?:en\/heat-pumps|warmtepomp)\/([^/]+)\/$/)) || (/^(en\/brand|merk)\/[^/]+\/$/.test(rel) ? 'brand' : /^(en\/guides|gidsen)\/[^/]+\/$/.test(rel) ? 'guide' : 'other');
const GUIDES = { 'isde-subsidie-warmtepomp-2026': 'isde-heat-pump-subsidy-2026', 'isde-aanvragen-stap-voor-stap': 'isde-application-step-by-step', 'isde-hybride-warmtepomp-2026-bedrag': 'isde-hybrid-heat-pump-2026-amount',
  'isde-warmtepomp-en-isolatie-combineren': 'isde-heat-pump-and-insulation', 'meldcode-warmtepomp-opzoeken': 'heat-pump-meldcode-lookup', 'warmtepomp-meldcode-niet-in-lijst': 'heat-pump-meldcode-not-on-list' };
const pairs = [['', 'en/'], ['warmtepomp/', 'en/heat-pumps/'], ['merken/', 'en/brands/'], ['subsidie-uitleg/', 'en/subsidy-explained/'], ['disclosure/', 'en/disclosure/'], ['over/', 'en/about/'], ['gidsen/', 'en/guides/'], ['404.html', 'en/404.html'],
  ...letterSlugs.map(l => [`warmtepomp/${l}/`, `en/heat-pumps/${l}/`]), ...products.map(p => [`warmtepomp/${p[5]}/`, `en/heat-pumps/${p[5]}/`]), ...nlBrands.map(b => [`merk/${b}/`, `en/brand/${b}/`]), ...Object.entries(GUIDES).map(([n, e]) => [`gidsen/${n}/`, `en/guides/${e}/`])];
for (const [n, e] of pairs) { if (!pages.has(n)) err(`missing Dutch page /${n}`); if (!pages.has(e)) err(`missing English page /${e}`); }
const enPages = [...pages.values()].filter(p => p.rel.startsWith('en/'));
const nlPages = [...pages.values()].filter(p => !p.rel.startsWith('en/'));
console.log(`routes: ${pairs.length} pairs expected (${products.length} models, ${nlBrands.length} brands, ${letterSlugs.length} letter pages, ${Object.keys(GUIDES).length} guides); ${nlPages.length} Dutch and ${enPages.length} English HTML pages`);
for (const p of enPages) if (!pairs.some(([, e]) => e === p.rel)) warn.push(`English page without a Dutch pair in the route list: /${p.rel}`);

// ---------- 2. hreflang ----------
let paired = 0;
for (const p of pages.values()) {
  const want = p.rel.startsWith('en/') ? 'en' : 'nl', self = `${SITE}/${p.rel}`;
  if (p.lang !== want) err(`${p.rel}: <html lang="${p.lang}">, expected ${want}`);
  if (p.canonical !== self) err(`${p.rel}: canonical ${p.canonical}, expected ${self}`);
  if (!/og:locale" content="(nl_NL|en_GB)"/.test(p.html) || !p.html.includes(`og:locale" content="${want === 'en' ? 'en_GB' : 'nl_NL'}"`)) err(`${p.rel}: wrong og:locale`);
  const a = p.alts, keys = Object.keys(a).sort().join(',');
  if (!keys) { warn.push(`${p.rel}: no hreflang (unpaired page)`); continue; }
  if (keys !== 'en,nl,x-default') { err(`${p.rel}: hreflang set "${keys}"`); continue; }
  if (a[want] !== self) err(`${p.rel}: hreflang ${want} is ${a[want]}, not itself`);
  if (a['x-default'] !== a.nl) err(`${p.rel}: x-default ${a['x-default']} is not the Dutch page ${a.nl}`);
  const otherLang = want === 'en' ? 'nl' : 'en', other = pages.get(local(a[otherLang])?.rel);
  if (!other) { err(`${p.rel}: hreflang ${otherLang} target ${a[otherLang]} does not exist`); continue; }
  if (JSON.stringify(other.alts, Object.keys(other.alts).sort()) !== JSON.stringify(a, Object.keys(a).sort())) err(`${p.rel}: not reciprocal with ${other.rel}`);
  // the visible switch goes to the same page in the other language
  const sw = p.html.match(/<a class="lang" href="([^"]+)" hreflang="([^"]+)" lang="([^"]+)">(EN|NL)</);
  if (!sw) err(`${p.rel}: no language switch`); else if (local(sw[1])?.rel !== other.rel || sw[2] !== otherLang || sw[4] !== otherLang.toUpperCase()) err(`${p.rel}: switch goes to ${sw[1]}, expected /${other.rel}`);
  paired++;
}
for (const p of pages.values()) if (!Object.keys(p.alts).length && !/<a class="lang" href="[^"]+"/.test(p.html)) err(`${p.rel}: no language switch`);
console.log(`hreflang: ${paired} pages with reciprocal nl/en/x-default alternates`);

// ---------- 3. sitemap ----------
const sm = fs.readFileSync(path.join(OUT, 'sitemap.xml'), 'utf8');
if (!sm.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) err('sitemap: no XML declaration');
{ const stack = []; for (const m of sm.replace(/^<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) { if (m[3]) continue; if (!m[1]) stack.push(m[2]); else if (stack.pop() !== m[2]) { err(`sitemap: tag </${m[2]}> does not match`); break; } } if (stack.length) err(`sitemap: unclosed tags ${stack.join(',')}`); }
if (/&(?!amp;|lt;|gt;|quot;|apos;)/.test(sm)) err('sitemap: unescaped &');
const urls = [...sm.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => ({ loc: m[1].match(/<loc>([^<]+)<\/loc>/)?.[1], lastmod: m[1].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1], alts: Object.fromEntries([...m[1].matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\/>/g)].map(x => [x[1], x[2]])) }));
if (urls.length >= 50000) err(`sitemap: ${urls.length} URLs (limit 50,000)`);
if (Buffer.byteLength(sm) >= 50 * 1024 * 1024) err('sitemap: larger than 50 MB');
const locs = new Set();
for (const u of urls) {
  if (locs.has(u.loc)) err(`sitemap: ${u.loc} twice`); locs.add(u.loc);
  const p = pages.get(local(u.loc)?.rel ?? '\0');
  if (!p) { err(`sitemap: ${u.loc} does not exist`); continue; }
  if (p.noindex) err(`sitemap: ${u.loc} is noindex`);
  if (JSON.stringify(u.alts, Object.keys(u.alts).sort()) !== JSON.stringify(p.alts, Object.keys(p.alts).sort())) err(`sitemap: alternates of ${u.loc} differ from the page`);
}
for (const p of pages.values()) if (!p.noindex && !locs.has(`${SITE}/${p.rel}`)) err(`sitemap: indexable page /${p.rel} missing`);
// scripts/indexnow.mjs reads the sitemap with this regex: it must see every URL
const indexnow = [...sm.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));
if (indexnow.length !== urls.length) err(`sitemap: indexnow.mjs would read ${indexnow.length} of ${urls.length} URLs`);
console.log(`sitemap: ${urls.length} URLs (${urls.filter(u => u.loc.startsWith(SITE + '/en/')).length} English), ${(Buffer.byteLength(sm) / 1048576).toFixed(1)} MB, ${urls.filter(u => Object.keys(u.alts).length).length} with alternates`);

// ---------- 4. internal links ----------
let links = 0, external = 0;
for (const p of pages.values()) {
  const body = p.html.replace(/<script[\s\S]*?<\/script>/g, s => s.startsWith('<script type="application/ld+json">') ? '' : s.replace(/[\s\S]*/, '')); // inline JS builds URLs at run time; tested in the browser
  for (const m of body.matchAll(/\s(?:href|src|action)="([^"]*)"/g)) {
    const u = m[1];
    if (/^(https?:)?\/\//.test(u) && !u.startsWith(SITE)) { external++; continue; }
    if (u.startsWith('#')) { if (u.length > 1 && !p.ids.has(unent(u.slice(1)))) err(`${p.rel}: broken anchor ${u}`); links++; continue; }
    const l = local(u); if (!l) { if (!/^(mailto|tel):/.test(u)) err(`${p.rel}: link not under ${BASE}: ${u}`); continue; }
    links++;
    if (!exists(l.rel)) { err(`${p.rel}: broken link ${u}`); continue; }
    if (l.hash) { const t = pages.get(l.rel); if (t && !t.ids.has(decodeURIComponent(l.hash))) err(`${p.rel}: broken anchor ${u}`); }
  }
}
console.log(`links: ${links} internal links checked, ${external} external links skipped`);

// ---------- 5. English pages stay English; kept features ----------
for (const p of enPages) {
  const body = p.html.replace(/<a class="lang"[^>]*>/, '').replace(/<link rel="alternate"[^>]*>/g, '');
  for (const m of body.matchAll(/\shref="([^"]*)"/g)) { const l = local(m[1]); if (l && /^(warmtepomp|merk|merken|gidsen|subsidie-uitleg|disclosure|over)\b|^$/.test(l.rel) && !/\.(css|ico|svg|png)$/.test(l.rel)) err(`${p.rel}: English page links to Dutch page ${m[1]}`); }
  if (/<form[^>]+action="\/isde-checker\/"/.test(p.html)) err(`${p.rel}: search form goes to the Dutch home`);
}
for (const p of pages.values()) if (!p.html.includes('data-goatcounter="https://isde-checker.goatcounter.com/count"')) err(`${p.rel}: GoatCounter missing`);
const affPages = [...pages.values()].filter(p => kind(p.rel) === 'model' || kind(p.rel) === 'guide');
for (const p of affPages) { const n = (p.html.match(/https:\/\/partner\.bol\.com\/click\/click\?t=url&(?:amp;)?s=1550553&/g) || []).length; if (n !== 4 || !p.html.includes('class="aff"')) err(`${p.rel}: bol.com box missing (${n} links)`); }
console.log(`features: GoatCounter on ${pages.size} pages, bol.com box on ${affPages.length} model and guide pages`);
for (const f of ['google8042a96498438aa5.html', 'cea0f7c14a3dc89af8e410cf4d54d1bd.txt', 'robots.txt', 'products.json', 'search.js', '.nojekyll']) if (!fileSet.has(f)) err(`missing ${f}`);
if (fs.readFileSync(path.join(OUT, 'google8042a96498438aa5.html'), 'utf8') !== 'google-site-verification: google8042a96498438aa5.html') err('google verification file content changed');
if (fs.readFileSync(path.join(OUT, 'cea0f7c14a3dc89af8e410cf4d54d1bd.txt'), 'utf8').trim() !== 'cea0f7c14a3dc89af8e410cf4d54d1bd') err('IndexNow key file content changed');

// ---------- 6. follow-up: structured data, list date, pagination, model content, tracking ----------
const today = new Date().toISOString().slice(0, 10);
const ld = p => { const out = []; for (const m of p.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { out.push(JSON.parse(m[1])); } catch (e) { err(`${p.rel}: JSON-LD does not parse (${e.message})`); } }
  return out.flatMap(d => d['@graph'] || [d]); };
const FORBIDDEN = /"(offers|aggregateRating|review|price|priceCurrency|lowPrice|highPrice)"\s*:/;
const need = (p, nodes, type) => { const n = nodes.filter(x => x['@type'] === type); if (!n.length) err(`${p.rel}: JSON-LD ${type} missing`); return n[0]; };
const stampDates = new Set(), datasetDates = new Set(), lastmods = new Map(urls.map(u => [u.loc, u.lastmod]));
const byKind = {}; let biggest = { size: 0 };
for (const p of pages.values()) {
  const k = kind(p.rel), nodes = ld(p), size = Buffer.byteLength(p.html), self = `${SITE}/${p.rel}`;
  (byKind[k] ||= { n: 0, max: 0, maxRel: '' }).n++; if (size > byKind[k].max) Object.assign(byKind[k], { max: size, maxRel: p.rel }); if (size > biggest.size) biggest = { size, rel: p.rel };
  if (FORBIDDEN.test(p.html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g)?.join('') || '')) err(`${p.rel}: JSON-LD has offers, prices or ratings`);
  // twitter cards and GoatCounter click names
  for (const n of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) if (!p.html.includes(`<meta name="${n}" content="`)) err(`${p.rel}: ${n} missing`);
  if (p.html.match(/<meta name="twitter:title" content="([^"]*)">/)?.[1] !== p.html.match(/<title>([^<]*)<\/title>/)?.[1]) err(`${p.rel}: twitter:title is not the <title>`);
  for (const m of p.html.matchAll(/<a href="https:\/\/partner\.bol\.com\/[^"]*"([^>]*)>/g)) if (!/ data-goatcounter-click="bol-[\w-]+"/.test(m[1])) err(`${p.rel}: bol.com link without data-goatcounter-click="bol-…"`);
  for (const m of p.html.replace(/<script[\s\S]*?<\/script>/g, '').matchAll(/\shref="([^"]*\?q=[^"]*)"/g)) warn.push(`${p.rel}: crawlable search link ${m[1]}`);
  // the RVO list date: visible on data pages, the same date in the Dataset node and in the sitemap
  if (['home', 'models', 'brands', 'letter', 'brand', 'model'].includes(k)) {
    const st = p.html.match(/(?:RVO-lijst bijgewerkt:|RVO list updated:) <time datetime="([\d-]+)">[^<]+<\/time> · <a href="https:\/\/www\.rvo\.nl\/[^"]+"/);
    if (!st) err(`${p.rel}: visible RVO list date with source link missing`); else stampDates.add(st[1]);
    if (p.lang === 'en' && st && !p.html.includes('RVO list updated:')) err(`${p.rel}: English page with the Dutch list date line`);
    const ds = need(p, nodes, 'Dataset');
    if (ds) { datasetDates.add(ds.dateModified); if (!/rvo/i.test(ds.creator?.name || '') || !/^https:\/\/www\.rvo\.nl\//.test(ds.url || '') || !ds.name || !ds.description) err(`${p.rel}: Dataset needs name, description, RVO creator and RVO url`);
      if (!p.noindex && lastmods.get(self) !== ds.dateModified) err(`${p.rel}: sitemap lastmod ${lastmods.get(self)} is not the RVO list date ${ds.dateModified}`); }
  }
  if (!['home', 'other'].includes(k) || /(subsidie-uitleg|subsidy-explained|disclosure|gidsen|guides|over|about)\/$/.test(p.rel)) {
    const bc = need(p, nodes, 'BreadcrumbList'), items = bc?.itemListElement || [];
    if (bc && (items.at(-1)?.item !== self || items[0]?.item !== `${SITE}/${p.rel.startsWith('en/') ? 'en/' : ''}` || items.some((x, i) => x.position !== i + 1 || !x.name))) err(`${p.rel}: BreadcrumbList does not run from the home page to this page`);
  }
  if (k === 'home') { const app = need(p, nodes, 'WebApplication'); if (app && app.url !== self) err(`${p.rel}: WebApplication url`); }
  if (k === 'brand') { need(p, nodes, 'Brand'); const il = need(p, nodes, 'ItemList');
    if (il && (il.numberOfItems !== il.itemListElement?.length || il.itemListElement.some(x => x.item?.['@type'] !== 'Product' || !x.item.mpn || !exists(local(x.item.url)?.rel ?? '\0')))) err(`${p.rel}: ItemList of products is incomplete`); }
  if (k === 'model') {
    const slugOf = p.rel.split('/').at(-2), prod = products.find(x => x[5] === slugOf), pr = need(p, nodes, 'Product');
    if (pr && prod && (pr.mpn !== prod[2] || pr.name !== `${prod[0]} ${prod[1]}` || pr.brand?.name !== prod[0] || pr.model !== prod[1] || !pr.description || pr.url !== self)) err(`${p.rel}: Product node does not match the data (name, brand, model, mpn = meldcode, description, url)`);
    const about = p.html.match(/<p class="about">([^<]+)<\/p>/)?.[1];
    if (!about || !about.includes(prod?.[2])) err(`${p.rel}: generated summary with the meldcode missing`);
    (byKind.about ||= new Map()).set(`${p.lang}\u0000${about}`, ((byKind.about.get(`${p.lang}\u0000${about}`)) || 0) + 1);
    const siblings = products.filter(x => x[0] === prod?.[0]).length - 1, rel = p.html.match(/<section class="related"[\s\S]*?<\/section>/)?.[0] || '';
    const n = (rel.match(/<td class="m"><a href=/g) || []).length;
    if (n !== Math.min(6, siblings)) err(`${p.rel}: ${n} related models, expected ${Math.min(6, siblings)}`);
    if (!/<dt>(Merk|Brand)<\/dt><dd><a href="\/isde-checker\/(en\/brand|merk)\/[^"]+\/">/.test(p.html)) err(`${p.rel}: link to the brand page missing`);
    if (p.noindex && !p.html.includes('<meta name="robots" content="noindex,follow">')) err(`${p.rel}: thin model page must be noindex,follow`);
  }
  if (k === 'guide') { const a = need(p, nodes, 'Article'), mod = p.html.match(/<meta property="article:modified_time" content="([^"]+)">/)?.[1];
    if (a && mod && (a.dateModified !== mod || (!p.noindex && lastmods.get(self) !== mod))) err(`${p.rel}: guide dateModified / sitemap lastmod is not the updated: date`); }
  if (['letter', 'models'].includes(k) && size >= 150 * 1024) err(`${p.rel}: ${(size / 1024).toFixed(0)} KB (limit 150 KB)`);
}
if (stampDates.size !== 1 || datasetDates.size !== 1 || [...stampDates][0] !== [...datasetDates][0]) err(`list date differs between pages: visible ${[...stampDates]}, Dataset ${[...datasetDates]}`);
const listDate = [...stampDates][0];
if (listDate === today) warn.push(`the RVO list date is today (${today}); check that it is not the build date`);
for (const u of urls) if (!u.lastmod) err(`sitemap: ${u.loc} has no lastmod`);
const dupAbout = [...(byKind.about || new Map()).values()].filter(n => n > 1).length;
if (dupAbout) err(`${dupAbout} model summaries are used on more than one page`);
// pagination: walk rel=next from the first letter page; every letter page once, prev links back, self-canonical (checked above)
for (const pre of ['', 'en/']) { const base = pre ? 'en/heat-pumps/' : 'warmtepomp/', seen = [];
  let cur = pages.get(base + letterSlugs.find(l => !pages.get(base + l + '/')?.html.includes('<link rel="prev"')) + '/');
  while (cur && !seen.includes(cur.rel)) { seen.push(cur.rel); const next = cur.html.match(/<link rel="next" href="([^"]+)">/)?.[1], vis = cur.html.match(/<a href="([^"]+)" rel="next">/)?.[1];
    if (next && local(vis || '')?.rel !== local(next).rel) err(`${cur.rel}: visible next link differs from <link rel="next">`);
    const nx = next && pages.get(local(next).rel); if (nx && local(nx.html.match(/<link rel="prev" href="([^"]+)">/)?.[1] || '')?.rel !== cur.rel) err(`${nx.rel}: rel=prev does not point back to ${cur.rel}`);
    cur = nx; }
  if (seen.length !== letterSlugs.length) err(`${base}: prev/next chain covers ${seen.length} of ${letterSlugs.length} letter pages`);
  const idx = pages.get(base); for (const l of letterSlugs) if (!idx?.html.includes(`href="${BASE}/${base}${l}/"`)) err(`/${base}: no link to letter page ${l}`); }
const reach = new Set([...pages.values()].filter(p => kind(p.rel) === 'letter').flatMap(p => [...p.html.matchAll(/<td class="m"><a href="([^"]+)"/g)].map(m => local(m[1]).rel)));
for (const p of pages.values()) if (kind(p.rel) === 'model' && !reach.has(p.rel)) err(`${p.rel}: not listed on any letter page`);
const thinN = [...pages.values()].filter(p => kind(p.rel) === 'model' && p.noindex).length;
console.log(`structured data and dates: RVO list date ${listDate} on every data page, in every Dataset node and as sitemap lastmod; ${thinN} thin model pages (noindex,follow)`);
console.log(`page sizes: ${Object.entries(byKind).filter(([k]) => k !== 'about').map(([k, v]) => `${k} ${v.n} (max ${(v.max / 1024).toFixed(0)} KB${['models', 'letter'].includes(k) ? ', /' + v.maxRel : ''})`).join('; ')}; largest page /${biggest.rel} ${(biggest.size / 1024).toFixed(0)} KB`);

// ---------- 7. follow-up 3: about page, GoatCounter on every English page, click names on affiliate and CTA links ----------
const ABOUT = { nl: 'over/', en: 'en/about/' }, ABOUT_DATE = '2026-10-17';
for (const [L, rel] of Object.entries(ABOUT)) { const p = pages.get(rel); if (!p) continue; const nodes = ld(p), ap = need(p, nodes, 'AboutPage');
  if (ap && (ap.url !== `${SITE}/${rel}` || ap.dateModified !== ABOUT_DATE || ap.inLanguage !== (L === 'en' ? 'en-GB' : 'nl-NL') || !ap.name || !ap.description)) err(`${rel}: AboutPage needs url, name, description, inLanguage and dateModified ${ABOUT_DATE}`);
  if (lastmods.get(`${SITE}/${rel}`) !== ABOUT_DATE) err(`sitemap: /${rel} lastmod ${lastmods.get(`${SITE}/${rel}`)}, expected the fixed date ${ABOUT_DATE}`);
  if (!p.html.includes('lambdamediaeu@gmail.com') || !/<h2 id="[^"]+">(Wie maakt deze site\?|Who makes this site\?)<\/h2>/.test(p.html)) err(`${rel}: about text not rendered`); }
const aboutLabel = { nl: 'Over ISDE-checker', en: 'About' };
for (const p of pages.values()) { const L = p.rel.startsWith('en/') ? 'en' : 'nl', foot = p.html.match(/<footer[\s\S]*?<\/footer>/)?.[0] || '';
  if (!foot.includes(`<a href="${BASE}/${ABOUT[L]}">${aboutLabel[L]}</a>`)) err(`${p.rel}: footer link to the about page missing`);
  if (!foot.includes('https://cerberostech.github.io/belastingcalculator/')) err(`${p.rel}: footer link to the Belastingcalculator missing`); }
// GoatCounter: every English HTML file in dist/en/ (also the 404), read again from disk
const GC_TAG = '<script data-goatcounter="https://isde-checker.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>';
const enFiles = files.filter(f => f.startsWith('en/') && f.endsWith('.html')), enGc = enFiles.filter(f => fs.readFileSync(path.join(OUT, f), 'utf8').includes(GC_TAG)).length;
if (enGc !== enFiles.length) err(`GoatCounter script on ${enGc} of ${enFiles.length} files in dist/en/`);
// Click names: every affiliate link and every call to action carries data-goatcounter-click with a descriptive name.
// Calls to action on this site: search buttons and example searches, the "look up your model" link on the subsidy page, the copy-meldcode button,
// the RVO application link, the Belastingcalculator footer link.
// (No newsletter, lead/offerte/vergelijker links, .ics or feeds exist; any such link would be caught by the CTA pattern below.)
const CTA = [[/<a href="https:\/\/partner\.bol\.com\/[^"]*"[^>]*>/g, /^bol-[a-z0-9-]+$/], [/<button type="submit"[^>]*>/g, /^search-[a-z0-9-]+$/], [/<p class="try">[\s\S]*?<\/p>/g, null],
  [/<button[^>]*data-copy=[^>]*>/g, /^copy-meldcode$/], [/(?<=<p class="note">[^<]*)<a href="\/isde-checker\/(?:en\/)?"[^>]*>/g, /^search-explain$/], [/<a href="https:\/\/www\.rvo\.nl\/subsidies-financiering\/isde"[^>]*>/g, /^rvo-isde-apply$/], [/<a href="https:\/\/cerberostech\.github\.io\/belastingcalculator\/"[^>]*>/g, /^footer-belastingcalculator$/],
  [/<a [^>]*href="[^"]*(?:\.ics|\/feed|\.rss|\.atom|offerte|vergelijk|nieuwsbrief|newsletter|daisycon)[^"]*"[^>]*>/gi, /^[a-z0-9-]+$/]];
const clicks = { nl: new Map(), en: new Map() };
for (const p of pages.values()) { const L = p.rel.startsWith('en/') ? 'en' : 'nl', html = p.html.replace(/<script[\s\S]*?<\/script>/g, '');
  for (const [re, name] of CTA) for (const m of html.matchAll(re)) { const tags = name ? [m[0]] : m[0].match(/<a [^>]*>/g) || [];
    for (const tag of tags) { const n = tag.match(/ data-goatcounter-click="([^"]+)"/)?.[1];
      if (!n || (name && !name.test(n)) || (!name && n !== 'search-example')) { err(`${p.rel}: no descriptive data-goatcounter-click on ${tag.slice(0, 90)}`); continue; }
      clicks[L].set(n, (clicks[L].get(n) || 0) + 1); } } }
console.log(`about: /${ABOUT.nl} and /${ABOUT.en} with AboutPage + BreadcrumbList, lastmod ${ABOUT_DATE}; footer link on all ${pages.size} pages`);
console.log(`GoatCounter: script tag on ${enGc} of ${enFiles.length} English HTML files (dist/en/**/*.html), on ${pages.size} pages in total`);
for (const L of ['nl', 'en']) console.log(`click names (${L}): ${[...clicks[L]].sort().map(([n, k]) => `${n} ${k}`).join(', ')}; total ${[...clicks[L].values()].reduce((a, b) => a + b, 0)}`);

for (const w of [...new Set(warn)].slice(0, 20)) console.log('warning: ' + w);
for (const e of errors.slice(0, 50)) console.log('ERROR: ' + e);
console.log(errors.length ? `${errors.length} errors` : `OK (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(errors.length ? 1 : 0);
