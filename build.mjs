// ISDE-checker static site builder. No dependencies (Node >= 18).
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const SITE = 'https://cerberostech.github.io/isde-checker';
const BASE = '/isde-checker';
const RVO_PAGE = 'https://www.rvo.nl/subsidies-financiering/isde/meldcodelijsten';
const RVO_LIST = 'https://www.rvo.nl/subsidies-financiering/isde/meldcodelijsten/warmtepompen';
const ANALYTICS = '<script data-goatcounter="https://isde-checker.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>'; // GoatCounter slot
const OUT = 'dist';

// ---------- minimal xlsx reader ----------
function unzip(buf) {
  let e = buf.length - 22; while (buf.readUInt32LE(e) !== 0x06054b50) e--;
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const files = {};
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42); const name = buf.toString('utf8', p + 46, p + 46 + nl);
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + csize);
    files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nl + xl + cl;
  }
  return files;
}
const unxml = s => s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,d)=>String.fromCharCode(d)).replace(/&amp;/g,'&');
function readXlsx(buf) {
  const f = unzip(buf); const str = k => f[k] ? f[k].toString('utf8') : '';
  const shared = [...str('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
  const wb = str('xl/workbook.xml'), rels = str('xl/_rels/workbook.xml.rels'); const sheets = {};
  for (const m of wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const t = rels.match(new RegExp(`Id="${m[2]}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${m[2]}"`));
    const target = 'xl/' + (t[1] || t[2]).replace(/^\/?xl\//, ''); const rows = [];
    for (const r of str(target).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const col = [...c[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const type = (c[2].match(/t="(\w+)"/) || [])[1]; const inner = c[3] || '';
        let v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (type === 's') v = shared[+v]; else if (type === 'inlineStr') v = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => unxml(x[1])).join(''); else if (v != null) v = unxml(v);
        row[col] = v;
      }
      rows.push(row);
    }
    sheets[unxml(m[1])] = rows;
  }
  return sheets;
}

// ---------- fetch current list (fallback: committed copy) ----------
async function getList() {
  let fileUrl = null, buf = null;
  try {
    const html = await (await fetch(RVO_PAGE, { headers: { 'user-agent': 'Mozilla/5.0 isde-checker' } })).text();
    const m = html.match(/href="([^"]*Meldcodelijst[^"]*Warmtepomp[^"]*\.xlsx)"/i);
    if (m) { fileUrl = new URL(m[1], RVO_PAGE).href; const r = await fetch(fileUrl, { headers: { 'user-agent': 'Mozilla/5.0 isde-checker' } }); if (r.ok) buf = Buffer.from(await r.arrayBuffer()); }
  } catch (e) { console.warn('fetch failed, using committed copy:', e.message); }
  if (buf && buf.length > 10000) { fs.writeFileSync('data/rvo.xlsx', buf); fs.writeFileSync('data/source.json', JSON.stringify({ url: fileUrl, fetched: new Date().toISOString().slice(0, 10) })); }
  return { buf: fs.readFileSync('data/rvo.xlsx'), src: JSON.parse(fs.readFileSync('data/source.json', 'utf8')) };
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = s => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const euro = s => { const n = parseInt(String(s ?? '').replace(/[^\d]/g, ''), 10); return isNaN(n) ? null : n; };
const fmt = n => n == null ? '–' : '€\u00a0' + n.toLocaleString('nl-NL');

// ---------- minimal markdown (guides) ----------
// Headings, paragraphs, **bold**, *italic*, [links](url), `code`, - / 1. lists, > quotes, ``` code blocks, ---.
// All text is escaped; raw HTML in the markdown is shown as text. "#" and "##" both become <h2> (the page title is the <h1>).
const SAFE_URL = /^(https?:|mailto:|tel:|[^:]*$)/i; // other schemes (javascript: and so on) are shown as text
const GUIDE_LINK = /^(?:\.{1,2}\/)*([\w-]+)\/?$/; // "slug", "slug/", "../slug/": no scheme, no leading /, no #, no extension
const href = u => GUIDE_LINK.test(u) ? `${BASE}/gidsen/${slug(u.match(GUIDE_LINK)[1])}/` // bare relative links point to another guide
  : /^\/(?!\/)/.test(u) && u !== BASE && !u.startsWith(BASE + '/') ? BASE + u : u; // root-relative links live under BASE
function inline(s, store) {
  const keep = html => `\u0000${store.push(html) - 1}\u0000`;
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, t, c) => keep(`<code>${esc(c.replace(/^ (.*) $/, '$1'))}</code>`))
    .replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, (_, c) => keep(esc(c)))
    .replace(/\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"([^"]*)")?\s*\)/g, (m, text, url, title) => !SAFE_URL.test(url) ? keep(esc(m))
      : keep(`<a href="${esc(href(url))}"${title ? ` title="${esc(title)}"` : ''}${/^https?:/i.test(url) ? ' rel="noopener"' : ''}>${inline(text, store)}</a>`))
    .replace(/<(https?:\/\/[^\s<>]+)>/g, (_, url) => keep(`<a href="${esc(url)}" rel="noopener">${esc(url)}</a>`))
    .replace(/(^|[\s(])(https?:\/\/[^\s<>]*[^\s<>.,;:!?)'"\]*_])/g, (_, pre, url) => pre + keep(`<a href="${esc(url)}" rel="noopener">${esc(url)}</a>`)); // bare URLs (source lists)
  return esc(s)
    .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*|(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, (_, a, pre, b) => a != null ? `<strong>${a}</strong>` : `${pre}<strong>${b}</strong>`)
    .replace(/\*(?=\S)([\s\S]*?\S)\*|(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, (_, a, pre, b) => a != null ? `<em>${a}</em>` : `${pre}<em>${b}</em>`)
    .replace(/(?: {2,}|\\)\n/g, '<br>\n');
}
function markdown(src) {
  const store = [], ids = new Set(['main', 'q2']); // ids the page itself uses
  const il = s => inline(s, store);
  const LIST = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)/, FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/, HR = /^ {0,3}([-*_])( *\1){2,} *$/;
  const HEAD = /^ {0,3}(#{1,6})(?: +(.*?))?(?: +#+)? *$/, QUOTE = /^ {0,3}> ?/;
  const starts = l => HEAD.test(l) || HR.test(l) || FENCE.test(l) || QUOTE.test(l) || LIST.test(l);
  const blocks = (lines, tight = false) => { const out = []; let i = 0;
    while (i < lines.length) { const l = lines[i]; let m;
      if (!l.trim()) { i++; continue; }
      if ((m = l.match(FENCE))) { const end = new RegExp(`^ {0,3}${m[1][0]}{${m[1].length},} *$`), code = []; i++;
        while (i < lines.length && !end.test(lines[i])) code.push(lines[i++]); i++;
        out.push(`<pre><code${m[2] ? ` class="language-${esc(m[2])}"` : ''}>${esc(code.join('\n'))}</code></pre>`); continue; }
      if (/^ {4}/.test(l)) { const code = [];
        while (i < lines.length && (/^ {4}/.test(lines[i]) || !lines[i].trim())) code.push(lines[i++].slice(4));
        while (code.length && !code.at(-1).trim()) code.pop();
        out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); continue; }
      if ((m = l.match(HEAD))) { const n = Math.max(2, m[1].length), text = m[2] || '';
        const base = slug(text.replace(/\]\([^)]*\)|[*_`\[\]]/g, '')); let id = base, k = 1; while (ids.has(id)) id = `${base}-${++k}`; ids.add(id);
        out.push(`<h${n} id="${id}">${il(text)}</h${n}>`); i++; continue; }
      if (HR.test(l)) { out.push('<hr>'); i++; continue; }
      if (QUOTE.test(l)) { const q = [];
        while (i < lines.length && lines[i].trim() && (QUOTE.test(lines[i]) || !starts(lines[i]))) q.push(lines[i++].replace(QUOTE, ''));
        out.push(`<blockquote>${blocks(q)}</blockquote>`); continue; }
      if ((m = l.match(LIST))) { const ordered = /\d/.test(m[2]), items = []; let loose = false;
        while (i < lines.length) { const lm = lines[i].match(LIST);
          if (!lm || /\d/.test(lm[2]) !== ordered || lm[1].length > m[1].length + 1) break;
          const w = lm[0].length, item = [lines[i].slice(lm[0].length)]; i++;
          while (i < lines.length) { const x = lines[i];
            if (!x.trim()) { const next = lines.slice(i).find(y => y.trim()); if (next == null || !/^\s/.test(next) || next.search(/\S/) < Math.min(w, 2)) break; item.push(''); i++; continue; }
            if (x.search(/\S/) >= Math.min(w, 2)) { item.push(x.slice(Math.min(w, x.search(/\S/)))); i++; continue; }
            if (starts(x)) break;
            item.push(x); i++; }
          if (item.slice(0, -1).includes('')) loose = true;
          items.push(item);
          let j = i; while (j < lines.length && !lines[j].trim()) j++;
          if (j > i && j < lines.length && LIST.test(lines[j]) && lines[j].match(LIST)[1].length <= m[1].length + 1 && /\d/.test(lines[j].match(LIST)[2]) === ordered) { loose = true; i = j; }
        }
        const n = ordered ? parseInt(m[2], 10) : 1, tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}${ordered && n !== 1 ? ` start="${n}"` : ''}>${items.map(it => `<li>${blocks(it, !loose)}</li>`).join('')}</${tag}>`); continue; }
      const para = [];
      while (i < lines.length && lines[i].trim() && !(para.length && starts(lines[i]))) para.push(lines[i++].replace(/^ +/, ''));
      const html = il(para.join('\n').replace(/ +$/, ''));
      out.push(tight ? html : `<p>${html}</p>`);
    }
    return out.join('\n'); };
  let html = blocks(String(src).replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'));
  while (html.includes('\u0000')) html = html.replace(/\u0000(\d+)\u0000/g, (_, n) => store[n]);
  return html;
}

// Guides: content/gidsen/*.md with front matter (title, description, slug, optional updated: YYYY-MM-DD).
// A value is split from its key on the first colon only; "..." and '...' quotes are stripped.
const unquote = v => { let m = v.match(/^"((?:[^"\\]|\\.)*)"$/); if (m) return m[1].replace(/\\(["\\])/g, '$1');
  m = v.match(/^'((?:[^']|'')*)'$/); return m ? m[1].replace(/''/g, "'") : v; };
const plainText = s => squash(s.replace(/[*_`]/g, '')).replace(/ +/g, ' ').toLowerCase();
const GUIDES_DIR = 'content/gidsen';
function readGuides() {
  const list = [], slugs = new Set();
  const files = fs.existsSync(GUIDES_DIR) ? fs.readdirSync(GUIDES_DIR).filter(f => f.endsWith('.md')).sort() : [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(GUIDES_DIR, file), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const fm = text.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/), meta = {};
    for (const line of (fm ? fm[1] : '').split('\n')) { const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/); if (m) meta[m[1].toLowerCase()] = unquote(m[2]); }
    const g = { file, title: squash(meta.title || ''), description: squash(meta.description || ''), slug: slug(meta.slug || file.replace(/\.md$/, '')), body: fm ? text.slice(fm[0].length) : text };
    const h1 = g.body.match(/^\s*(?:# +(.*?)(?: +#+)? *|(\S.*?) *\n=+ *)(?:\n|$)/); // the page H1 is the title: drop a body H1 that repeats it
    if (h1 && plainText(h1[1] ?? h1[2]) === plainText(g.title)) g.body = g.body.slice(h1[0].length);
    if (!g.title || !g.description) { console.warn(`gidsen: ${file} skipped (title and description are required)`); continue; }
    if (slugs.has(g.slug)) { console.warn(`gidsen: ${file} skipped (slug "${g.slug}" is already used)`); continue; }
    if (meta.updated) { const d = new Date(`${meta.updated}T00:00:00Z`);
      if (/^\d{4}-\d{2}-\d{2}$/.test(meta.updated) && !isNaN(d) && d.toISOString().slice(0, 10) === meta.updated) g.updated = meta.updated;
      else console.warn(`gidsen: ${file}: updated "${meta.updated}" ignored (use YYYY-MM-DD)`); }
    slugs.add(g.slug); list.push(g);
  }
  return list.sort((a, b) => (b.updated || '').localeCompare(a.updated || '') || a.title.localeCompare(b.title, 'nl'));
}

const { buf, src } = await getList();
const sheets = readXlsx(buf);
const rows = sheets['Meldcodes'] || Object.values(sheets).find(r => String(r[0]?.[0]).toUpperCase() === 'MELDCODE');
const head = rows[0].map(h => String(h || '').toLowerCase());
const ix = k => head.findIndex(h => h.includes(k));
const I = { code: ix('meldcode'), brand: ix('fabrikant'), model: ix('model'), kw: ix('vermogen'), sub: head.findIndex(h => h.startsWith('subsidiebedrag') && !h.includes('2e')), sub2: ix('2e'), gas: ix('koudemiddel'), gwp: ix('gwp'), cat: ix('categorie') };
const monthName = (src.url && decodeURIComponent(src.url).match(/Warmtepompen\s*-\s*([A-Za-z]+\s+\d{4})/i)?.[1]) || '';
const products = rows.slice(1).filter(r => r[I.code]).map(r => ({
  code: String(r[I.code]).trim(), brand: String(r[I.brand] || '').trim(), model: String(r[I.model] || '').trim(),
  kw: r[I.kw] != null ? Math.round(+r[I.kw] * 10) / 10 : null, sub: euro(r[I.sub]), sub2: euro(r[I.sub2]),
  gas: r[I.gas] || '', gwp: r[I.gwp] || '', cat: r[I.cat] || ''
}));
const seen = new Set(); for (const p of products) { let s = slug(`${p.brand} ${p.model}`); if (seen.has(s)) s += '-' + p.code.toLowerCase(); seen.add(s); p.slug = s; }
const brands = [...new Set(products.map(p => p.brand))].sort((a, b) => a.localeCompare(b, 'nl'));
console.log(`${products.length} products, ${brands.length} brands, source ${src.url} (${src.fetched})`);

// ---------- templates ----------
const OG_IMAGE = `${SITE}/og-image.png`;
const OG_ALT = 'ISDE-checker: Staat jouw warmtepomp op de ISDE-lijst?';
const THEME = '#0F3D2E';
const nl = n => n.toLocaleString('nl-NL');
const count = (n, one, many) => `${nl(n)} ${n === 1 ? one : many}`;
const fetchedAt = new Date(`${src.fetched}T00:00:00Z`);
const fetchedLong = isNaN(fetchedAt) ? String(src.fetched) : fetchedAt.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const when = `<time datetime="${esc(src.fetched)}">${esc(fetchedLong)}</time>`;
const listMonth = monthName ? monthName[0].toLowerCase() + monthName.slice(1) : '';
const listName = listMonth ? `de ISDE-meldcodelijst van ${esc(listMonth)}` : 'de ISDE-meldcodelijst';
const srcLine = `Bron: <a href="${RVO_LIST}" rel="noopener">RVO ISDE Meldcodelijst Warmtepompen</a>${monthName ? ' – ' + esc(monthName) : ''} (opgehaald ${when}). Aan deze gegevens kunnen geen rechten worden ontleend; controleer altijd bij RVO.`;

// <title> (max 60) and meta description (max 155): use the first option that fits, else shorten at a word.
const squash = s => String(s).replace(/[^\S ]+/g, ' ').trim();
const clip = (s, max) => { s = squash(s); if (s.length <= max) return s; const cut = s.slice(0, max - 1), at = cut.lastIndexOf(' '); return (at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,.;:/(+–-]+$/, '') + '…'; };
const fit = (max, ...options) => options.map(squash).find(o => o.length <= max) ?? clip(options.at(-1), max);
const fill = (max, tpl, part) => fit(max, tpl.replace('{}', part), tpl.replace('{}', clip(part, Math.max(8, max - squash(tpl).length + 2))));
const productTitle = p => { const name = `${squash(p.brand)} ${squash(p.model)}`;
  return fit(60, `ISDE-subsidie ${name} – ${p.code}`, `ISDE ${name} – ${p.code}`, fill(60, `ISDE {} – ${p.code}`, name)); };
const productDesc = p => { const name = `${squash(p.brand)} ${squash(p.model)}`, facts = `staat op ${listName}: meldcode ${p.code}, indicatief subsidiebedrag ${fmt(p.sub)}.`;
  return fit(155, `${name} ${facts} Met type, vermogen en koudemiddel.`, `${name} ${facts}`, fill(155, `{} ${facts}`, name)); };
const brandTitle = b => fit(60, `ISDE-subsidie ${b} warmtepomp: meldcodes en bedragen`, `ISDE-subsidie ${b} warmtepomp – meldcodes`, `ISDE-subsidie ${b} warmtepomp`, fill(60, 'ISDE-subsidie {}', b));
const brandDesc = (b, n, range) => { const what = n === 1 ? `De warmtepomp van ${b} op ${listName}, met meldcode en subsidiebedrag` : `Alle ${nl(n)} warmtepompen van ${b} op ${listName}, met meldcode en subsidiebedrag per model`;
  return fit(155, `${what}${range ? ` (${range})` : ''}.`, `${what}.`, fill(155, `Alle warmtepompen van {} op ${listName}, met meldcode en subsidiebedrag.`, b)); };

const NAV = [['', 'Zoeken'], ['merken/', 'Merken'], ['warmtepomp/', 'Modellen'], ['gidsen/', 'Gidsen'], ['subsidie-uitleg/', 'Uitleg'], ['disclosure/', 'Over']];
const page = (title, desc, rel, body, { cls = '', robots = '', type = 'website', head = '' } = {}) => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${SITE}/${rel}">${robots ? `<meta name="robots" content="${robots}">` : ''}
<meta name="theme-color" content="${THEME}"><meta name="color-scheme" content="light">
<link rel="icon" href="${BASE}/favicon.ico" sizes="32x32"><link rel="icon" href="${BASE}/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="${BASE}/apple-touch-icon.png">
<meta property="og:type" content="${type}"><meta property="og:site_name" content="ISDE-checker"><meta property="og:locale" content="nl_NL">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${SITE}/${rel}">
<meta property="og:image" content="${OG_IMAGE}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(OG_ALT)}">
<meta name="twitter:card" content="summary_large_image">${head}
<link rel="stylesheet" href="${BASE}/style.css"></head><body${cls ? ` class="${cls}"` : ''}>
<a class="skip" href="#main">Naar de inhoud</a>
<header class="site-head"><div class="wrap"><a class="brand" href="${BASE}/"><img src="${BASE}/logo.svg" alt="" width="36" height="36">ISDE-checker</a>
<nav class="site-nav" aria-label="Hoofdmenu"><ul>${NAV.map(([href, label]) => `<li><a href="${BASE}/${href}"${href === rel ? ' aria-current="page"' : ''}>${label}</a></li>`).join('')}</ul></nav></div></header>
<main id="main" tabindex="-1">${body}</main>
<footer class="site-foot"><div class="wrap"><p>${srcLine}</p><p>Onafhankelijke site, niet verbonden aan RVO of de Rijksoverheid.</p>
<ul class="foot-nav"><li><a href="${BASE}/merken/">Alle merken</a></li><li><a href="${BASE}/warmtepomp/">Alle modellen</a></li><li><a href="${BASE}/subsidie-uitleg/">Uitleg subsidie</a></li><li><a href="${BASE}/disclosure/">Over deze site en disclosure</a></li></ul></div></footer>${ANALYTICS}</body></html>`;

// A list of models: the model name (with type and kW) links to the product page; meldcode as a plate; amount.
// Brand pages group the tables by type, so there the line under the model only gives the kW.
const typeLine = (p, withType) => [withType ? p.cat : '', p.kw ? `${nl(p.kw)} kW` : ''].filter(Boolean).join(', ');
const row = (p, withBrand) => { const x = typeLine(p, withBrand); return `<tr><td class="m"><a href="${BASE}/warmtepomp/${p.slug}/">${withBrand ? `<span class="b">${esc(p.brand)}</span>` : ''}<span class="n">${esc(p.model)}</span>${x ? `<span class="x">${esc(x)}</span>` : ''}</a></td><td class="c"><span class="plate">${esc(p.code)}</span></td><td class="s">${fmt(p.sub)}</td></tr>`; };
const table = (list, { withBrand = false, label = '' } = {}) => `<table class="list"${label ? ` aria-labelledby="${label}"` : ''}><thead><tr><th scope="col">${withBrand ? 'Merk en model' : 'Model'}</th><th scope="col">Meldcode</th><th scope="col">Subsidie</th></tr></thead><tbody>${list.map(p => row(p, withBrand)).join('')}</tbody></table>`;
const miniSearch = (id, label) => `<form class="search search-mini" action="${BASE}/" method="get" role="search"><label for="${id}">${label}</label><div class="field"><input id="${id}" name="q" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="Merk of model"><button type="submit">Zoeken</button></div></form>`;
// bol.com partner search links (affiliate). Shown on every model page and every guide; disclosed on /disclosure/.
const bol = (query, name) => `https://partner.bol.com/click/click?t=url&s=1550553&url=${encodeURIComponent('https://www.bol.com/nl/nl/s/?searchtext=' + encodeURIComponent(query))}&f=txl&name=${name}`;
const BOL_LINKS = [['Slimme thermostaat', 'slimme thermostaat tado nest', 'slimme-thermostaat'], ['P1-meter', 'homewizard p1 meter', 'p1-meter'], ['Radiatorventilator', 'radiatorventilator', 'radiatorventilator'], ['Tochtstrips en isolatie', 'tochtstrips', 'tochtstrips']];
const AFF = `<aside class="aff" aria-labelledby="aff-h"><h2 id="aff-h">Handig bij je warmtepomp</h2><p>Zoek op bol.com:</p><ul>${BOL_LINKS.map(([label, q, name]) => `<li><a href="${bol(q, name)}" rel="sponsored nofollow noopener" target="_blank">${label}</a></li>`).join('')}</ul><p class="aff-note"><a href="${BASE}/disclosure/#affiliate">Affiliatelinks: wij krijgen een kleine commissie, jij betaalt niets extra</a></p></aside>`;
const ICON_OK ='<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="12" fill="currentColor"/><path d="M6.8 12.4l3.4 3.4 7-7.6" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_BAND = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const COPY = `<script>(()=>{const b=document.querySelector('[data-copy]');if(!b||!navigator.clipboard)return;const s=b.nextElementSibling,t=b.textContent;let k;b.hidden=false;b.addEventListener('click',()=>navigator.clipboard.writeText(b.dataset.copy).then(()=>{b.textContent='Gekopieerd';s.textContent='Meldcode '+b.dataset.copy+' gekopieerd';clearTimeout(k);k=setTimeout(()=>{b.textContent=t;s.textContent=''},2500)},()=>{}))})()</script>`;

const byModel = new Intl.Collator('nl', { numeric: true, sensitivity: 'base' });
const TYPES = ['Lucht-Water', 'Grond-Water', 'Water-Water', 'Warmtepompboiler'];
const typeRank = c => { const i = TYPES.indexOf(c); return i < 0 ? TYPES.length : i; };
const byType = list => { const m = new Map(); for (const p of [...list].sort((a, b) => byModel.compare(a.model, b.model))) { const k = p.cat || 'Overig'; if (!m.has(k)) m.set(k, []); m.get(k).push(p); }
  return [...m].sort((a, b) => typeRank(a[0]) - typeRank(b[0]) || a[0].localeCompare(b[0], 'nl')); };
const span = list => { const s = list.map(p => p.sub).filter(n => n != null); return s.length ? [Math.min(...s), Math.max(...s)] : null; };
const perBrand = new Map(brands.map(b => [b, products.filter(p => p.brand === b)]));

fs.rmSync(OUT, { recursive: true, force: true });
const write = (rel, html) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };
fs.cpSync('src', OUT, { recursive: true });
write('products.json', JSON.stringify({ source: src, month: monthName, products: products.map(p => [p.brand, p.model, p.code, p.kw, p.sub, p.slug, p.cat]) }));
write('.nojekyll', '');
// Never remove: Google Search Console HTML verification file (exact content required).
write('google8042a96498438aa5.html', 'google-site-verification: google8042a96498438aa5.html');

// Homepage examples: only searches that find something on the current list (same matching as search.js).
const norm = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const hay = products.map(p => norm(`${p.brand} ${p.model} ${p.code}`) + ' ' + norm(p.model).replace(/ /g, ''));
const finds = q => { const t = norm(q).split(' '); return hay.some(h => t.every(w => h.includes(w))); };
const examples = [...['Quatt', 'NIBE F2120', 'Remeha Elga', 'Intergas Xtend', 'Vaillant aroTHERM', 'Bosch Compress'].filter(finds).slice(0, 2), products[0].code];
const hint = examples.slice(0, -1).filter(x => x.length <= 16).at(-1) || examples[0]; // short enough for the input at 360 px
const top = [...perBrand].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'nl')).slice(0, 12).map(([b]) => b);
const brandItem = b => { const n = perBrand.get(b).length; return `<li><a href="${BASE}/merk/${slug(b)}/">${esc(b)} <span class="num">${nl(n)}<span class="vh"> ${n === 1 ? 'model' : 'modellen'}</span></span></a></li>`; };

write('index.html', page('ISDE-subsidie warmtepomp checken – meldcode en bedrag', `Staat je warmtepomp op de ISDE-meldcodelijst van RVO? Zoek op merk, model of meldcode en zie direct de meldcode en het subsidiebedrag.`, '',
`<section class="hero"><div class="wrap">
<h1>Staat jouw warmtepomp op de ISDE-lijst?</h1>
<p class="lead">Zoek tussen ${nl(products.length)} goedgekeurde warmtepompen van ${brands.length} merken. Je ziet direct de meldcode en het subsidiebedrag.</p>
<form id="zoek" class="search" action="${BASE}/" method="get" role="search"><label for="q">Zoek op merk, model of meldcode</label>
<div class="field"><input id="q" name="q" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="Bijv. ${esc(hint)}"><button type="submit">Zoeken</button></div></form>
<p class="try">Probeer: ${examples.map(x => `<a href="${BASE}/?q=${encodeURIComponent(x)}" data-q="${esc(x)}">${esc(x)}</a>`).join(' ')}</p>
<p class="stamp">Bron: RVO-meldcodelijst${listMonth ? ` van ${esc(listMonth)}` : ''}, opgehaald op ${when}.</p>
</div></section>
<div class="wrap">
<section class="results" aria-label="Zoekresultaten"><p id="count" class="count" role="status"></p><div id="results"></div>
<noscript><p>Zoeken werkt met JavaScript. Zonder JavaScript vind je alle modellen via de <a href="${BASE}/merken/">lijst per merk</a>.</p></noscript></section>
<div class="info">
<section><h2>Zo gebruik je de meldcode</h2><ol class="steps"><li>Zoek je warmtepomp op merk, model of meldcode.</li><li>Open het model. Je ziet de meldcode en het subsidiebedrag.</li><li>Vul na de installatie de meldcode in bij je ISDE-aanvraag op rvo.nl.</li></ol></section>
<section><h2>Waar vind je het model?</h2><ul class="dots"><li>Op de offerte of factuur van je installateur.</li><li>Op het typeplaatje van de warmtepomp.</li><li>In de handleiding.</li></ul><p>Vind je niets op de hele naam? Zoek dan op een deel van de typecode. Hoofdletters, spaties en streepjes maken niet uit.</p></section>
</div>
<section class="top"><h2>Merken met de meeste modellen</h2><ul class="brands">${top.map(brandItem).join('')}</ul><p class="more"><a href="${BASE}/merken/">Alle ${brands.length} merken</a></p></section>
</div>
<script>window.BASE=${JSON.stringify(BASE)}</script><script src="${BASE}/search.js" defer></script>`, { cls: 'home' }));

const letterOf = b => { const c = b.normalize('NFKD')[0].toUpperCase(); return /[A-Z]/.test(c) ? c : '#'; };
const letters = new Map(); for (const b of brands) { const l = letterOf(b); if (!letters.has(l)) letters.set(l, []); letters.get(l).push(b); }
const letterId = l => `letter-${l === '#' ? 'overig' : l.toLowerCase()}`;
write('merken/index.html', page('Alle warmtepompmerken op de ISDE-meldcodelijst', fit(155, `Alle ${brands.length} warmtepompmerken op ${listName}. Kies een merk en zie per model de meldcode en het subsidiebedrag.`, `Alle warmtepompmerken op ${listName}.`), 'merken/',
`<div class="wrap">
<h1>Alle merken op de ISDE-lijst</h1>
<p class="lead">${brands.length} merken met samen ${nl(products.length)} warmtepompen op ${listName}. Kies een merk voor alle modellen, meldcodes en bedragen.</p>
<nav class="az" aria-label="Merken per letter"><ul>${[...letters.keys()].map(l => `<li><a href="#${letterId(l)}">${l}</a></li>`).join('')}</ul></nav>
${[...letters].map(([l, bs]) => `<section class="letter" aria-labelledby="${letterId(l)}"><h2 id="${letterId(l)}">${l}</h2><ul class="brands">${bs.map(brandItem).join('')}</ul></section>`).join('\n')}
</div>`));

for (const b of brands) { const list = perBrand.get(b), s = span(list), groups = byType(list);
  const range = !s ? '' : s[0] === s[1] ? fmt(s[0]) : `${fmt(s[0])} tot ${fmt(s[1])}`;
  write(`merk/${slug(b)}/index.html`, page(brandTitle(b), brandDesc(b, list.length, range), `merk/${slug(b)}/`,
`<div class="wrap">
<nav class="crumbs" aria-label="Kruimelpad"><ol><li><a href="${BASE}/merken/">Merken</a></li></ol></nav>
<h1>ISDE-subsidie ${esc(b)}</h1>
<p class="lead">${list.length === 1 ? `Eén model van ${esc(b)} staat` : `${nl(list.length)} modellen van ${esc(b)} staan`} op ${listName}.${!s ? '' : s[0] === s[1] ? ` Het indicatieve subsidiebedrag is ${fmt(s[0])}.` : ` Het indicatieve subsidiebedrag ligt tussen ${fmt(s[0])} en ${fmt(s[1])}.`}</p>
${groups.length > 1 ? `<nav class="jump" aria-label="Soorten warmtepomp"><ul>${groups.map(([c, l]) => `<li><a href="#${slug(c)}">${esc(c)} <span class="num">${nl(l.length)}<span class="vh"> ${l.length === 1 ? 'model' : 'modellen'}</span></span></a></li>`).join('')}</ul></nav>` : ''}
${groups.map(([c, l]) => `<section class="group"><h2 id="${slug(c)}">${esc(c)} <span class="count">${count(l.length, 'model', 'modellen')}</span></h2>${table(l, { label: slug(c) })}</section>`).join('\n')}
${miniSearch('q2', 'Zoek een ander model')}
</div>`)); }

// All models on one page, per brand. Without JS it is a plain list; the filter only hides rows and empty brands.
const brandId = b => `merk-${slug(b)}`;
const FILTER = `<script>(()=>{const f=document.getElementById('filter'),q=document.getElementById('fq'),c=document.getElementById('fcount');if(!f||!q||!c)return;const norm=s=>String(s).toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim(),nl=n=>n.toLocaleString('nl-NL');const G=[...document.querySelectorAll('section[data-brand]')].map(s=>({s,j:document.querySelector('.jump-brands a[href="#'+s.querySelector('h2').id+'"]'),r:[...s.querySelectorAll('tbody tr')].map(r=>{const m=r.querySelector('.n').textContent;return{r,h:norm(s.dataset.brand+' '+m+' '+r.querySelector('.plate').textContent)+' '+norm(m).replace(/ /g,'')}})}));const run=()=>{const t=norm(q.value).split(' ').filter(Boolean);let n=0;for(const g of G){let k=0;for(const x of g.r){const ok=t.every(w=>x.h.includes(w));x.r.hidden=!ok;if(ok)k++}g.s.hidden=!k;if(g.j)g.j.parentNode.hidden=!k;n+=k}c.textContent=!t.length?'':n?nl(n)+(n===1?' model gevonden':' modellen gevonden'):'Geen model gevonden. Zoek op een deel van de typecode.'};f.hidden=false;f.addEventListener('submit',e=>e.preventDefault());q.addEventListener('input',run);if(q.value)run()})()</script>`;
write('warmtepomp/index.html', page('Alle warmtepompen op de ISDE-meldcodelijst', fit(155, `Alle ${nl(products.length)} warmtepompen op ${listName}, per merk. Kies een model en zie de meldcode en het subsidiebedrag.`, `Alle warmtepompen op ${listName}, per merk.`), 'warmtepomp/',
`<div class="wrap">
<h1>Alle warmtepompen op de ISDE-lijst</h1>
<p class="lead">${nl(products.length)} warmtepompen van ${brands.length} merken op ${listName}. Kies een model voor de meldcode en het subsidiebedrag.</p>
<form id="filter" class="search search-filter" action="${BASE}/" method="get" role="search" hidden><label for="fq">Filter op merk, model of meldcode</label>
<div class="field"><input id="fq" name="q" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="Merk, model of meldcode"></div></form>
<p id="fcount" class="count" role="status"></p>
<nav class="jump-brands" aria-label="Merken"><details><summary>Spring naar een merk (${brands.length})</summary><ul class="brands">${brands.map(b => { const n = perBrand.get(b).length; return `<li><a href="#${brandId(b)}">${esc(b)} <span class="num">${nl(n)}<span class="vh"> ${n === 1 ? 'model' : 'modellen'}</span></span></a></li>`; }).join('')}</ul></details></nav>
${brands.map(b => { const l = [...perBrand.get(b)].sort((x, y) => byModel.compare(x.model, y.model));
  return `<section class="group" data-brand="${esc(b)}"><h2 id="${brandId(b)}">${esc(b)} <span class="count">${count(l.length, 'model', 'modellen')}</span></h2>${table(l, { label: brandId(b) })}</section>`; }).join('\n')}
</div>${FILTER}`));

for (const p of products) { const bs = slug(p.brand), n = perBrand.get(p.brand).length;
  write(`warmtepomp/${p.slug}/index.html`, page(productTitle(p), productDesc(p), `warmtepomp/${p.slug}/`,
`<div class="wrap">
<nav class="crumbs" aria-label="Kruimelpad"><ol><li><a href="${BASE}/merken/">Merken</a></li><li><a href="${BASE}/merk/${bs}/">${esc(p.brand)}</a></li></ol></nav>
<h1>ISDE-subsidie ${esc(p.brand)} ${esc(p.model)}</h1>
<p class="verdict">${ICON_OK}Staat op ${listName}</p>
<dl class="answer">
<div class="a-code"><dt>Meldcode</dt><dd><span class="plate plate-xl"><span class="band">${ICON_BAND}</span>${esc(p.code)}</span><button type="button" class="btn-copy" data-copy="${esc(p.code)}" hidden>Kopieer meldcode</button><span class="vh" role="status"></span></dd></div>
<div class="a-sum"><dt>Indicatief subsidiebedrag</dt><dd class="amount">${fmt(p.sub)}</dd></div>
</dl>
<dl class="spec">
<div><dt>Bedrag voor een 2e warmtepomp</dt><dd>${fmt(p.sub2)}</dd></div>
<div><dt>Type</dt><dd>${esc(p.cat) || '–'}</dd></div>
<div><dt>Vermogen</dt><dd>${p.kw == null ? '–' : `${nl(p.kw)} kW`}</dd></div>
<div><dt>Koudemiddel</dt><dd>${esc(p.gas) || '–'}${p.gwp ? ` (GWP ${esc(p.gwp)})` : ''}</dd></div>
</dl>
${p.sub2 != null && p.sub2 !== p.sub ? '<p class="note">Het bedrag voor een 2e warmtepomp geldt als je twee lucht-waterwarmtepompen laat plaatsen, of als je al eerder subsidie kreeg voor een lucht-waterwarmtepomp.</p>' : ''}
<p>Vul meldcode <strong>${esc(p.code)}</strong> in bij je ISDE-aanvraag bij RVO. Het bedrag is indicatief; RVO stelt de definitieve subsidie vast. <a href="${BASE}/subsidie-uitleg/">Zo werkt de subsidie</a></p>
<p class="more"><a href="${BASE}/merk/${bs}/">${n === 1 ? `Alle modellen van ${esc(p.brand)}` : `Alle ${nl(n)} modellen van ${esc(p.brand)}`}</a></p>
${AFF}
${miniSearch('q2', 'Zoek een ander model')}
</div>${COPY}`)); }

const typeRows = byType(products).map(([c, l]) => { const s = span(l); return `<tr><th scope="row">${esc(c)}<span class="x">${count(l.length, 'model', 'modellen')}</span></th><td>${!s ? '–' : s[0] === s[1] ? fmt(s[0]) : `${fmt(s[0])} tot ${fmt(s[1])}`}</td></tr>`; }).join('');
write('subsidie-uitleg/index.html', page('Hoeveel ISDE-subsidie krijg je voor een warmtepomp?', 'Uitleg over de ISDE-subsidie voor warmtepompen: de bedragen per type, de voorwaarden en hoe je de subsidie aanvraagt.', 'subsidie-uitleg/',
`<div class="wrap prose">
<h1>Hoeveel ISDE-subsidie krijg ik voor een warmtepomp?</h1>
<p class="lead">Dat hangt af van het model. Elk goedgekeurd model heeft op de meldcodelijst van RVO een vast, indicatief bedrag. Op deze site zie je dat bedrag per model.</p>
<p>De Investeringssubsidie duurzame energie en energiebesparing (ISDE) wordt uitgevoerd door RVO. Voor een warmtepomp hangt het bedrag af van het <strong>type</strong> (lucht-water, grond-water, water-water, hybride) en het <strong>thermisch vermogen</strong>.</p>
<h2>Bedragen op ${listName}</h2>
<table class="sum"><thead><tr><th scope="col">Type</th><th scope="col">Bedrag per model</th></tr></thead><tbody>${typeRows}</tbody></table>
<p class="note">Indicatieve bedragen, zoals ze op de lijst staan. <a href="${BASE}/">Zoek je model op</a> voor het bedrag dat bij jouw warmtepomp hoort.</p>
<h2>Twee bedragen per model</h2>
<p>Op de lijst staan per model twee bedragen. Het eerste is het gewone subsidiebedrag. Het tweede geldt voor een 2e lucht-waterwarmtepomp: als je er twee laat plaatsen, of als je al eerder subsidie kreeg voor een lucht-waterwarmtepomp. Zo staat het in de toelichting bij de lijst.</p>
<h2>Wat betekenen de gegevens?</h2>
<dl class="terms"><dt>Meldcode</dt><dd>Het unieke kenmerk van het model. Je vult de meldcode in bij je ISDE-aanvraag.</dd>
<dt>Vermogen</dt><dd>Het vermogen waarmee de warmtepomp warmte afgeeft, in kilowatt (kW). Een fabrikant noemt soms een hoger vermogen, omdat die anders rekent.</dd>
<dt>Koudemiddel en GWP</dt><dd>Het koudemiddel is de stof in de warmtepomp die de warmte transporteert. De GWP (Global Warming Potential) laat zien hoe schadelijk die stof is voor het milieu. Hoe lager de GWP, hoe beter.</dd></dl>
<h2>Belangrijkste voorwaarden (samengevat)</h2><ul class="dots">
<li>Lucht-water-, grond-water- of water-waterwarmtepomp; lucht-luchtwarmtepompen komen niet in aanmerking.</li>
<li>Minimaal energielabel A++ (sinds 1 januari 2024) en geregistreerd in EPREL (tot en met 70 kW).</li>
<li>Geïnstalleerd door een installatiebedrijf.</li>
<li>Staat het apparaat niet op de lijst, dan kun je soms toch aanvragen met productbeschrijving en technische documentatie, maar RVO kan dan afwijzen.</li></ul>
<h2>Zo vraag je aan</h2><ol class="steps"><li>Zoek je warmtepomp op en noteer de meldcode.</li><li>Laat de warmtepomp installeren en bewaar factuur en betaalbewijs.</li><li>Vraag de subsidie aan via <a href="https://www.rvo.nl/subsidies-financiering/isde" rel="noopener">rvo.nl/isde</a> (let op de actuele aanvraagtermijn).</li></ol>
<p class="note">Dit is een vereenvoudigde samenvatting. De regels kunnen wijzigen; de voorwaarden op rvo.nl en in de Staatscourant zijn leidend.</p>
</div>`));

write('disclosure/index.html', page('Over ISDE-checker: bron, privacy en disclosure', 'Over ISDE-checker: waar de gegevens vandaan komen, hoe de site geld verdient en welke gegevens we over bezoekers verzamelen.', 'disclosure/',
`<div class="wrap prose">
<h1>Over deze site en disclosure</h1>
<p class="lead">ISDE-checker is een onafhankelijke hulpsite. We zijn <strong>niet</strong> verbonden aan RVO, de Rijksoverheid of een fabrikant.</p>
<h2>Data</h2><p>Alle productgegevens komen uit de openbare <a href="${RVO_LIST}" rel="noopener">ISDE Meldcodelijst Warmtepompen</a> van RVO, die RVO als open overheidsinformatie publiceert (hergebruik toegestaan, zie <a href="https://www.rvo.nl/onderwerpen/open-data" rel="noopener">RVO open data</a>). De lijst wordt wekelijks automatisch opnieuw opgehaald. Huidige versie: ${esc(monthName || src.url)} (opgehaald ${when}). Aan deze site kunnen geen rechten worden ontleend.</p>
<h2 id="affiliate">Verdienmodel: bol.com-affiliatelinks</h2><p>ISDE-checker is partner van bol.com. Op elke modelpagina (onder <a href="${BASE}/warmtepomp/">Modellen</a>) en in elke <a href="${BASE}/gidsen/">gids</a> staat een blok ‘Handig bij je warmtepomp’. Daarin staan zoeklinks naar bol.com: slimme thermostaat, P1-meter, radiatorventilator en tochtstrips.</p>
<p>Dit zijn affiliatelinks. Koop je iets via zo’n link, dan krijgen wij een kleine commissie van bol.com. Jij betaalt niets extra. De links gaan naar zoekresultaten op bol.com; wij hebben de producten niet getest en raden geen bepaald product aan.</p>
<p>De commissie heeft geen invloed op de ISDE-informatie. De meldcodes, de bedragen en de volgorde van de modellen komen uit de lijst van RVO. Verder bevat deze site geen advertenties en geen andere affiliatelinks. Verandert dat, dan staat het op deze pagina.</p>
<h2>Privacy</h2><p>We tellen bezoeken met GoatCounter. GoatCounter werkt zonder cookies en slaat geen persoonsgegevens op: we zien alleen totalen, zoals het aantal bezoeken per pagina. Deze site plaatst geen cookies.</p>
<p>Klik je op een bol.com-link, dan ga je via partner.bol.com naar bol.com. bol.com kan dan cookies plaatsen om de commissie toe te wijzen. Daarvoor geldt het privacybeleid van bol.com.</p>
<p>De site staat op GitHub Pages. GitHub registreert technische gegevens, zoals IP-adressen, om de dienst te beveiligen.</p>
</div>`));

const guides = readGuides();
const longDate = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const updatedLine = g => g.updated ? `<p class="note">Bijgewerkt op <time datetime="${g.updated}">${esc(longDate(g.updated))}</time></p>` : '';
const jsonLd = data => `\n<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
const PUBLISHER = { '@type': 'Organization', name: 'ISDE-checker', url: `${SITE}/`, logo: { '@type': 'ImageObject', url: `${SITE}/logo-512.png`, width: 512, height: 512 } };
write('gidsen/index.html', page('Gidsen over ISDE-subsidie voor je warmtepomp', 'Gidsen van ISDE-checker over de ISDE-subsidie voor warmtepompen, met per gids een korte samenvatting en de datum van de laatste update.', 'gidsen/',
`<div class="wrap prose">
<h1>Gidsen</h1>
<p class="lead">Uitleg in gewone taal over de ISDE-subsidie voor je warmtepomp.</p>
${guides.length ? `<ul class="guides">${guides.map(g => `<li><h2><a href="${BASE}/gidsen/${g.slug}/">${esc(g.title)}</a></h2><p>${esc(g.description)}</p>${updatedLine(g)}</li>`).join('')}</ul>`
  : `<div class="nohit"><p>Er staan op dit moment geen gidsen op deze site.</p><p>Wil je weten of je warmtepomp subsidie krijgt?</p><ul><li><a href="${BASE}/">Zoek je warmtepomp op</a></li><li><a href="${BASE}/subsidie-uitleg/">Lees hoe de subsidie werkt</a></li></ul></div>`}
</div>`));
for (const g of guides) { const url = `${SITE}/gidsen/${g.slug}/`, body = markdown(g.body);
  for (const [, to] of body.matchAll(new RegExp(`href="${BASE}/gidsen/([^/"#]+)/`, 'g'))) if (!guides.some(x => x.slug === to)) console.warn(`gidsen: ${g.file}: link to unknown guide "${to}"`);
  write(`gidsen/${g.slug}/index.html`, page(fit(60, `${g.title} – ISDE-checker`, g.title), fit(155, g.description), `gidsen/${g.slug}/`,
`<div class="wrap"><nav class="crumbs" aria-label="Kruimelpad"><ol><li><a href="${BASE}/gidsen/">Gidsen</a></li></ol></nav></div>
<article class="wrap prose md">
<h1>${esc(g.title)}</h1>
<p class="lead">${esc(g.description)}</p>
${updatedLine(g)}
${body}
<p class="note">Deze gids is geschreven met hulp van AI en gecontroleerd op bronnen.</p>
<p class="more"><a href="${BASE}/gidsen/">Alle gidsen</a></p>
${AFF}
${miniSearch('q2', 'Zoek je warmtepomp op')}
</article>`, { type: 'article', head: (g.updated ? `\n<meta property="article:modified_time" content="${g.updated}">` : '') + jsonLd({ '@context': 'https://schema.org', '@type': 'Article',
    headline: clip(g.title, 110), description: g.description, ...(g.updated && { dateModified: g.updated }), url, mainEntityOfPage: url, inLanguage: 'nl-NL', image: OG_IMAGE, author: PUBLISHER, publisher: PUBLISHER }) })); }

const urls = ['', 'merken/', 'warmtepomp/', 'subsidie-uitleg/', 'disclosure/', ...brands.map(b => `merk/${slug(b)}/`), ...products.map(p => `warmtepomp/${p.slug}/`)];
const lastGuide = guides.map(g => g.updated).filter(Boolean).sort().at(-1);
const guideUrls = [['gidsen/', lastGuide], ...guides.map(g => [`gidsen/${g.slug}/`, g.updated])];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${SITE}/${u}</loc><lastmod>${src.fetched}</lastmod></url>`).join('')}${guideUrls.map(([u, d]) => `<url><loc>${SITE}/${u}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`).join('')}</urlset>`);
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
write('404.html', page('Pagina niet gevonden – ISDE-checker', 'Deze pagina bestaat niet (meer). Zoek je warmtepomp op merk, model of meldcode.', '404.html',
`<div class="wrap prose">
<h1>Deze pagina bestaat niet</h1>
<p class="lead">Misschien is het adres verkeerd getypt. Of de warmtepomp staat niet meer op de meldcodelijst: dan verdwijnt ook de pagina.</p>
${miniSearch('q404', 'Zoek op merk, model of meldcode')}
<p class="more"><a href="${BASE}/merken/">Bekijk alle merken</a></p>
</div>`, { robots: 'noindex' }));
console.log(`wrote ${urls.length + guideUrls.length} pages (${guides.length} gidsen)`);
