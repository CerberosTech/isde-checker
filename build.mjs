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

// ---------- minimal markdown (guides) ----------
// Headings, paragraphs, **bold**, *italic*, [links](url), `code`, - / 1. lists, > quotes, ``` code blocks, ---.
// All text is escaped; raw HTML in the markdown is shown as text. "#" and "##" both become <h2> (the page title is the <h1>).
const SAFE_URL = /^(https?:|mailto:|tel:|[^:]*$)/i; // other schemes (javascript: and so on) are shown as text
const GUIDE_LINK = /^(?:\.{1,2}\/)*([\w-]+)\/?$/; // "slug", "slug/", "../slug/": no scheme, no leading /, no #, no extension
const href = (u, dir) => GUIDE_LINK.test(u) ? `${BASE}/${dir}/${slug(u.match(GUIDE_LINK)[1])}/` // bare relative links point to another guide (dir: gidsen or en/guides)
  : /^\/(?!\/)/.test(u) && u !== BASE && !u.startsWith(BASE + '/') ? BASE + u : u; // root-relative links live under BASE
function inline(s, store, dir) {
  const keep = html => `\u0000${store.push(html) - 1}\u0000`;
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, t, c) => keep(`<code>${esc(c.replace(/^ (.*) $/, '$1'))}</code>`))
    .replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, (_, c) => keep(esc(c)))
    .replace(/\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"([^"]*)")?\s*\)/g, (m, text, url, title) => !SAFE_URL.test(url) ? keep(esc(m))
      : keep(`<a href="${esc(href(url, dir))}"${title ? ` title="${esc(title)}"` : ''}${/^https?:/i.test(url) ? ' rel="noopener"' : ''}>${inline(text, store, dir)}</a>`))
    .replace(/<(https?:\/\/[^\s<>]+)>/g, (_, url) => keep(`<a href="${esc(url)}" rel="noopener">${esc(url)}</a>`))
    .replace(/(^|[\s(])(https?:\/\/[^\s<>]*[^\s<>.,;:!?)'"\]*_])/g, (_, pre, url) => pre + keep(`<a href="${esc(url)}" rel="noopener">${esc(url)}</a>`)); // bare URLs (source lists)
  return esc(s)
    .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*|(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, (_, a, pre, b) => a != null ? `<strong>${a}</strong>` : `${pre}<strong>${b}</strong>`)
    .replace(/\*(?=\S)([\s\S]*?\S)\*|(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, (_, a, pre, b) => a != null ? `<em>${a}</em>` : `${pre}<em>${b}</em>`)
    .replace(/(?: {2,}|\\)\n/g, '<br>\n');
}
function markdown(src, dir = 'gidsen') {
  const store = [], ids = new Set(['main', 'q2']); // ids the page itself uses
  const il = s => inline(s, store, dir);
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

// Guides: content/gidsen/*.md (Dutch) and content/guides-en/*.md (English) with front matter (title, description, slug, optional updated: YYYY-MM-DD, else date: YYYY-MM-DD).
// A value is split from its key on the first colon only; "..." and '...' quotes are stripped.
const unquote = v => { let m = v.match(/^"((?:[^"\\]|\\.)*)"$/); if (m) return m[1].replace(/\\(["\\])/g, '$1');
  m = v.match(/^'((?:[^']|'')*)'$/); return m ? m[1].replace(/''/g, "'") : v; };
const plainText = s => squash(s.replace(/[*_`]/g, '')).replace(/ +/g, ' ').toLowerCase();
function readGuides(dir, locale) {
  const list = [], slugs = new Set(), tag = path.basename(dir);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort() : [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const fm = text.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/), meta = {};
    for (const line of (fm ? fm[1] : '').split('\n')) { const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/); if (m) meta[m[1].toLowerCase()] = unquote(m[2]); }
    const g = { file, title: squash(meta.title || ''), description: squash(meta.description || ''), slug: slug(meta.slug || file.replace(/\.md$/, '')), body: fm ? text.slice(fm[0].length) : text };
    const h1 = g.body.match(/^\s*(?:# +(.*?)(?: +#+)? *|(\S.*?) *\n=+ *)(?:\n|$)/); // the page H1 is the title: drop a body H1 that repeats it
    if (h1 && plainText(h1[1] ?? h1[2]) === plainText(g.title)) g.body = g.body.slice(h1[0].length);
    if (!g.title || !g.description) { console.warn(`${tag}: ${file} skipped (title and description are required)`); continue; }
    if (slugs.has(g.slug)) { console.warn(`${tag}: ${file} skipped (slug "${g.slug}" is already used)`); continue; }
    for (const key of ['updated', 'date']) { const v = meta[key]; if (!v || g.updated) continue; const d = new Date(`${v}T00:00:00Z`); // updated: wins; date: is the fallback
      if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(d) && d.toISOString().slice(0, 10) === v) g.updated = v;
      else console.warn(`${tag}: ${file}: ${key} "${v}" ignored (use YYYY-MM-DD)`); }
    slugs.add(g.slug); list.push(g);
  }
  return list.sort((a, b) => (b.updated || '').localeCompare(a.updated || '') || a.title.localeCompare(b.title, locale));
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
// The date of the RVO list itself (never the build date): the xlsx's own modified (else created) date in docProps/core.xml,
// else the month in RVO's file path (.../files/2026-10/...), else the day the list was fetched.
const core = unzip(buf)['docProps/core.xml']?.toString('utf8') || '';
const LIST_DATE = core.match(/<dcterms:modified[^>]*>(\d{4}-\d{2}-\d{2})/)?.[1] || core.match(/<dcterms:created[^>]*>(\d{4}-\d{2}-\d{2})/)?.[1]
  || decodeURIComponent(src.url || '').match(/\/files\/(\d{4}-\d{2})\//)?.[1] || (console.warn('no RVO list date in the xlsx, using the fetch date'), src.fetched);
console.log(`${products.length} products, ${brands.length} brands, source ${src.url} (${src.fetched}), RVO list date ${LIST_DATE}`);


// ---------- languages ----------
// Every page exists in Dutch (site root) and in English (under /en/). L is 'nl' or 'en'.
// t = tr(L); t('Nederlandse tekst', 'English text') picks the text for the page language. The data is the same in both.
const LANGS = ['nl', 'en'];
const tr = L => (nlText, enText) => L === 'en' ? enText : nlText;
const LOCALE = { nl: 'nl-NL', en: 'en-GB' };
// Paths (relative to BASE) of the pages that exist once per language.
const ROUTES = { home: { nl: '', en: 'en/' }, brands: { nl: 'merken/', en: 'en/brands/' }, models: { nl: 'warmtepomp/', en: 'en/heat-pumps/' },
  guides: { nl: 'gidsen/', en: 'en/guides/' }, explain: { nl: 'subsidie-uitleg/', en: 'en/subsidy-explained/' }, disclosure: { nl: 'disclosure/', en: 'en/disclosure/' }, about: { nl: 'over/', en: 'en/about/' }, notFound: { nl: '404.html', en: 'en/404.html' } };
const brandRel = (b, L) => L === 'en' ? `en/brand/${slug(b)}/` : `merk/${slug(b)}/`;
const modelRel = (p, L) => L === 'en' ? `en/heat-pumps/${p.slug}/` : `warmtepomp/${p.slug}/`;
// Dutch guide slug -> English guide slug. A guide without a partner links its language switch to the other guides index.
const GUIDE_PAIRS = { 'isde-subsidie-warmtepomp-2026': 'isde-heat-pump-subsidy-2026', 'isde-aanvragen-stap-voor-stap': 'isde-application-step-by-step',
  'isde-hybride-warmtepomp-2026-bedrag': 'isde-hybrid-heat-pump-2026-amount', 'isde-warmtepomp-en-isolatie-combineren': 'isde-heat-pump-and-insulation',
  'meldcode-warmtepomp-opzoeken': 'heat-pump-meldcode-lookup', 'warmtepomp-meldcode-niet-in-lijst': 'heat-pump-meldcode-not-on-list' };
// RVO's types stay Dutch in the data; English pages show a translation.
const CAT_EN = { 'Lucht-Water': 'Air-to-water', 'Grond-Water': 'Ground-to-water', 'Water-Water': 'Water-to-water', Warmtepompboiler: 'Heat pump water heater', Overig: 'Other' };
const catL = (c, L) => L === 'en' ? CAT_EN[c] || c : c;
const MONTHS_EN = { januari: 'January', februari: 'February', maart: 'March', april: 'April', mei: 'May', juni: 'June', juli: 'July', augustus: 'August', september: 'September', oktober: 'October', november: 'November', december: 'December' };

// ---------- templates ----------
const OG_IMAGE = `${SITE}/og-image.png`;
const OG_ALT = { nl: 'ISDE-checker: Staat jouw warmtepomp op de ISDE-lijst?', en: 'ISDE Checker: Is your heat pump on the ISDE list?' };
const SITE_NAME = { nl: 'ISDE-checker', en: 'ISDE Checker' };
const THEME = '#0F3D2E';
const nl = (n, L = 'nl') => n.toLocaleString(LOCALE[L]);
const fmt = (n, L = 'nl') => n == null ? '–' : L === 'en' ? '€' + nl(n, L) : '€\u00a0' + nl(n);
const count = (n, one, many, L = 'nl') => `${nl(n, L)} ${n === 1 ? one : many}`;
const fetchedAt = new Date(`${src.fetched}T00:00:00Z`);
const longDate = (iso, L = 'nl') => new Date(`${iso}T00:00:00Z`).toLocaleDateString(LOCALE[L], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fetchedLong = L => isNaN(fetchedAt) ? String(src.fetched) : longDate(src.fetched, L);
const when = L => `<time datetime="${esc(src.fetched)}">${esc(fetchedLong(L))}</time>`;
const MONTH = { nl: monthName, en: monthName.replace(/^[A-Za-z]+/, m => MONTHS_EN[m.toLowerCase()] || m) };
const listMonth = { nl: monthName ? monthName[0].toLowerCase() + monthName.slice(1) : '', en: MONTH.en };
const YEAR = monthName.match(/\d{4}/)?.[0] || String(src.fetched).slice(0, 4);
const listNames = { nl: listMonth.nl ? `de ISDE-meldcodelijst van ${esc(listMonth.nl)}` : 'de ISDE-meldcodelijst', en: listMonth.en ? `the ${esc(listMonth.en)} ISDE meldcode list` : 'the ISDE meldcode list' };
// LIST_DATE is YYYY-MM-DD, or YYYY-MM if only the month is known.
const listDateText = L => /^\d{4}-\d{2}$/.test(LIST_DATE) ? new Date(`${LIST_DATE}-01T00:00:00Z`).toLocaleDateString(LOCALE[L], { month: 'long', year: 'numeric', timeZone: 'UTC' }) : longDate(LIST_DATE, L);
const listWhen = L => `<time datetime="${esc(LIST_DATE)}">${esc(listDateText(L))}</time>`;
const srcLine = L => tr(L)(`Bron: <a href="${RVO_LIST}" rel="noopener">RVO ISDE Meldcodelijst Warmtepompen</a>${monthName ? ' – ' + esc(monthName) : ''} (RVO-lijst bijgewerkt ${listWhen(L)}, opgehaald ${when(L)}). Aan deze gegevens kunnen geen rechten worden ontleend; controleer altijd bij RVO.`,
  `Source: <a href="${RVO_LIST}" rel="noopener">RVO ISDE Meldcodelijst Warmtepompen</a>${MONTH.en ? ' – ' + esc(MONTH.en) : ''} (RVO list updated ${listWhen(L)}, fetched ${when(L)}). No rights can be derived from this data; always check with RVO.`);
// Visible on the home, list, brand and model pages.
const listStamp = (L, cls = 'stamp updated') => `<p class="${cls}">${tr(L)('RVO-lijst bijgewerkt:', 'RVO list updated:')} ${listWhen(L)} · <a href="${RVO_LIST}" rel="noopener">${tr(L)('bron: RVO', 'source: RVO')}</a></p>`;

// <title> (max 60) and meta description (max 155): use the first option that fits, else shorten at a word.
const squash = s => String(s).replace(/[^\S\u00a0]+/g, ' ').trim();
const clip = (s, max) => { s = squash(s); if (s.length <= max) return s; const cut = s.slice(0, max - 1), at = cut.lastIndexOf(' '); return (at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,.;:/(+–-]+$/, '') + '…'; };
const fit = (max, ...options) => options.map(squash).find(o => o.length <= max) ?? clip(options.at(-1), max);
const fill = (max, tpl, part) => fit(max, tpl.replace('{}', part), tpl.replace('{}', clip(part, Math.max(8, max - squash(tpl).length + 2))));
const productTitle = (p, L) => { const name = `${squash(p.brand)} ${squash(p.model)}`;
  return L === 'en' ? fit(60, `${name} ISDE subsidy ${YEAR}: meldcode and amount`, `${name} ISDE subsidy ${YEAR}: meldcode`, `${name} ISDE subsidy ${YEAR}`, fill(60, `{} ISDE subsidy ${YEAR}`, name))
    : fit(60, `ISDE-subsidie ${name} – ${p.code}`, `ISDE ${name} – ${p.code}`, fill(60, `ISDE {} – ${p.code}`, name)); };
const productDesc = (p, L) => { const name = `${squash(p.brand)} ${squash(p.model)}`;
  if (L === 'en') { const facts = `is on ${listNames.en}: meldcode ${p.code}, indicative subsidy amount ${fmt(p.sub, L)}.`;
    return fit(155, `${name} ${facts} With type, capacity and refrigerant.`, `${name} ${facts}`, fill(155, `{} ${facts}`, name)); }
  const facts = `staat op ${listNames.nl}: meldcode ${p.code}, indicatief subsidiebedrag ${fmt(p.sub)}.`;
  return fit(155, `${name} ${facts} Met type, vermogen en koudemiddel.`, `${name} ${facts}`, fill(155, `{} ${facts}`, name)); };
const brandTitle = (b, L) => L === 'en' ? fit(60, `ISDE subsidy for ${b} heat pumps: meldcodes and amounts`, `ISDE subsidy for ${b} heat pumps: meldcodes`, `ISDE subsidy for ${b} heat pumps`, fill(60, 'ISDE subsidy {}', b))
  : fit(60, `ISDE-subsidie ${b} warmtepomp: meldcodes en bedragen`, `ISDE-subsidie ${b} warmtepomp – meldcodes`, `ISDE-subsidie ${b} warmtepomp`, fill(60, 'ISDE-subsidie {}', b));
const brandDesc = (b, n, range, L) => { const listName = listNames[L];
  if (L === 'en') { const what = n === 1 ? `The ${b} heat pump on ${listName}, with its meldcode and subsidy amount` : `All ${nl(n, L)} ${b} heat pumps on ${listName}, with the meldcode and subsidy amount for each model`;
    return fit(155, `${what}${range ? ` (${range})` : ''}.`, `${what}.`, fill(155, `All {} heat pumps on ${listName}, with meldcodes and subsidy amounts.`, b)); }
  const what = n === 1 ? `De warmtepomp van ${b} op ${listName}, met meldcode en subsidiebedrag` : `Alle ${nl(n)} warmtepompen van ${b} op ${listName}, met meldcode en subsidiebedrag per model`;
  return fit(155, `${what}${range ? ` (${range})` : ''}.`, `${what}.`, fill(155, `Alle warmtepompen van {} op ${listName}, met meldcode en subsidiebedrag.`, b)); };

const NAV = [['home', 'Zoeken', 'Search'], ['brands', 'Merken', 'Brands'], ['models', 'Modellen', 'Models'], ['guides', 'Gidsen', 'Guides'], ['explain', 'Uitleg', 'Subsidy'], ['about', 'Over', 'About']];
// The language switch links to the same page in the other language (no redirects). Visible text: "EN" on Dutch pages, "NL" on English pages.
const SWITCH = { nl: ['en', 'EN', 'English version'], en: ['nl', 'NL', 'Nederlandse versie'] };
// alt: { nl, en } paths of this page in both languages. paired: false if the other path is only a fallback (no hreflang then).
const page = (L, title, desc, alt, body, { cls = '', robots = '', type = 'website', head = '', paired = true } = {}) => { const t = tr(L), rel = alt[L], [other, code, name] = SWITCH[L];
  const hreflang = paired ? `\n<link rel="alternate" hreflang="nl" href="${SITE}/${alt.nl}"><link rel="alternate" hreflang="en" href="${SITE}/${alt.en}"><link rel="alternate" hreflang="x-default" href="${SITE}/${alt.nl}">` : '';
  return `<!doctype html><html lang="${L}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${SITE}/${rel}">${robots ? `<meta name="robots" content="${robots}">` : ''}${hreflang}
<meta name="theme-color" content="${THEME}"><meta name="color-scheme" content="light">
<link rel="icon" href="${BASE}/favicon.ico" sizes="32x32"><link rel="icon" href="${BASE}/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="${BASE}/apple-touch-icon.png">
<meta property="og:type" content="${type}"><meta property="og:site_name" content="${SITE_NAME[L]}"><meta property="og:locale" content="${t('nl_NL', 'en_GB')}">${paired ? `<meta property="og:locale:alternate" content="${t('en_GB', 'nl_NL')}">` : ''}
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${SITE}/${rel}">
<meta property="og:image" content="${OG_IMAGE}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(OG_ALT[L])}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${OG_IMAGE}"><meta name="twitter:image:alt" content="${esc(OG_ALT[L])}">${head}
<link rel="stylesheet" href="${BASE}/style.css"></head><body${cls ? ` class="${cls}"` : ''}>
<a class="skip" href="#main">${t('Naar de inhoud', 'Skip to content')}</a>
<header class="site-head"><div class="wrap"><a class="brand" href="${BASE}/${ROUTES.home[L]}"><img src="${BASE}/logo.svg" alt="" width="36" height="36">${SITE_NAME[L]}</a>
<nav class="site-nav" aria-label="${t('Hoofdmenu', 'Main menu')}"><ul>${NAV.map(([k, nlLabel, enLabel]) => `<li><a href="${BASE}/${ROUTES[k][L]}"${ROUTES[k][L] === rel ? ' aria-current="page"' : ''}>${t(nlLabel, enLabel)}</a></li>`).join('')}</ul></nav>
<a class="lang" href="${BASE}/${alt[other]}" hreflang="${other}" lang="${other}">${code}<span class="vh"> – ${name}</span></a></div></header>
<main id="main" tabindex="-1">${body}</main>
<footer class="site-foot"><div class="wrap"><p>${srcLine(L)}</p><p>${t('Onafhankelijke site, niet verbonden aan RVO of de Rijksoverheid.', 'Independent site, not affiliated with RVO or the Dutch government. The RVO application form is in Dutch.')}</p>
<ul class="foot-nav"><li><a href="${BASE}/${ROUTES.brands[L]}">${t('Alle merken', 'All brands')}</a></li><li><a href="${BASE}/${ROUTES.models[L]}">${t('Alle modellen', 'All models')}</a></li><li><a href="${BASE}/${ROUTES.explain[L]}">${t('Uitleg subsidie', 'Subsidy explained')}</a></li><li><a href="${BASE}/${ROUTES.about[L]}">${t('Over ISDE-checker', 'About')}</a></li><li><a href="${BASE}/${ROUTES.disclosure[L]}">${t('Disclosure en privacy', 'Disclosure and privacy')}</a></li><li><a href="https://cerberostech.github.io/belastingcalculator/"${t('', ' hreflang="nl"')} data-goatcounter-click="footer-belastingcalculator">${t('Belastingcalculator 2026', 'Belastingcalculator 2026 (Dutch tax calculator)')}</a></li></ul></div></footer>${ANALYTICS}</body></html>`; };

// A list of models: the model name (with type and kW) links to the product page; meldcode as a plate; amount.
// Brand pages group the tables by type, so there the line under the model only gives the kW.
const typeLine = (p, withType, L) => [withType ? catL(p.cat, L) : '', p.kw ? `${nl(p.kw, L)} kW` : ''].filter(Boolean).join(', ');
const row = (p, withBrand, L) => { const x = typeLine(p, withBrand, L); return `<tr><td class="m"><a href="${BASE}/${modelRel(p, L)}">${withBrand ? `<span class="b">${esc(p.brand)}</span>` : ''}<span class="n">${esc(p.model)}</span>${x ? `<span class="x">${esc(x)}</span>` : ''}</a></td><td class="c"><span class="plate">${esc(p.code)}</span></td><td class="s">${fmt(p.sub, L)}</td></tr>`; };
const table = (list, L, { withBrand = false, label = '' } = {}) => { const t = tr(L); return `<table class="list"${label ? ` aria-labelledby="${label}"` : ''}><thead><tr><th scope="col">${withBrand ? t('Merk en model', 'Brand and model') : 'Model'}</th><th scope="col">Meldcode</th><th scope="col">${t('Subsidie', 'Subsidy')}</th></tr></thead><tbody>${list.map(p => row(p, withBrand, L)).join('')}</tbody></table>`; };
// click: GoatCounter click name of the search button (where on the site the search starts).
const miniSearch = (L, id, label, click) => { const t = tr(L); return `<form class="search search-mini" action="${BASE}/${ROUTES.home[L]}" method="get" role="search"><label for="${id}">${label}</label><div class="field"><input id="${id}" name="q" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="${t('Merk of model', 'Brand or model')}"><button type="submit" data-goatcounter-click="${click}">${t('Zoeken', 'Search')}</button></div></form>`; };
// bol.com partner search links (affiliate). Shown on every model page and every guide (both languages); disclosed on /disclosure/ and /en/disclosure/.
const bol = (query, name) => `https://partner.bol.com/click/click?t=url&s=1550553&url=${encodeURIComponent('https://www.bol.com/nl/nl/s/?searchtext=' + encodeURIComponent(query))}&f=txl&name=${name}`;
const BOL_LINKS = [['Slimme thermostaat', 'Smart thermostat', 'slimme thermostaat tado nest', 'slimme-thermostaat'], ['P1-meter', 'P1 meter', 'homewizard p1 meter', 'p1-meter'], ['Radiatorventilator', 'Radiator fan', 'radiatorventilator', 'radiatorventilator'], ['Tochtstrips en isolatie', 'Draught strips and insulation', 'tochtstrips', 'tochtstrips']];
const AFF = L => { const t = tr(L); return `<aside class="aff" aria-labelledby="aff-h"><h2 id="aff-h">${t('Handig bij je warmtepomp', 'Useful with your heat pump')}</h2><p>${t('Zoek op bol.com:', 'Search on bol.com (Dutch web shop):')}</p><ul>${BOL_LINKS.map(([nlLabel, enLabel, q, name]) => `<li><a href="${bol(q, name)}" rel="sponsored nofollow noopener" target="_blank" data-goatcounter-click="bol-${name}">${t(nlLabel, enLabel)}</a></li>`).join('')}</ul><p class="aff-note"><a href="${BASE}/${ROUTES.disclosure[L]}#affiliate">${t('Affiliatelinks: wij krijgen een kleine commissie, jij betaalt niets extra', 'Affiliate links: we earn a small commission, at no extra cost to you')}</a></p></aside>`; };
const ICON_OK ='<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="12" fill="currentColor"/><path d="M6.8 12.4l3.4 3.4 7-7.6" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_BAND = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const COPY = L => { const t = tr(L); return `<script>(()=>{const b=document.querySelector('[data-copy]');if(!b||!navigator.clipboard)return;const s=b.nextElementSibling,t=b.textContent;let k;b.hidden=false;b.addEventListener('click',()=>navigator.clipboard.writeText(b.dataset.copy).then(()=>{b.textContent='${t('Gekopieerd', 'Copied')}';s.textContent='Meldcode '+b.dataset.copy+'${t(' gekopieerd', ' copied')}';clearTimeout(k);k=setTimeout(()=>{b.textContent=t;s.textContent=''},2500)},()=>{}))})()</script>`; };

const byModel = new Intl.Collator('nl', { numeric: true, sensitivity: 'base' });
const TYPES = ['Lucht-Water', 'Grond-Water', 'Water-Water', 'Warmtepompboiler'];
const typeRank = c => { const i = TYPES.indexOf(c); return i < 0 ? TYPES.length : i; };
const byType = list => { const m = new Map(); for (const p of [...list].sort((a, b) => byModel.compare(a.model, b.model))) { const k = p.cat || 'Overig'; if (!m.has(k)) m.set(k, []); m.get(k).push(p); }
  return [...m].sort((a, b) => typeRank(a[0]) - typeRank(b[0]) || a[0].localeCompare(b[0], 'nl')); };
const span = list => { const s = list.map(p => p.sub).filter(n => n != null); return s.length ? [Math.min(...s), Math.max(...s)] : null; };
const spanText = (s, L) => !s ? '–' : s[0] === s[1] ? fmt(s[0], L) : `${fmt(s[0], L)} ${tr(L)('tot', 'to')} ${fmt(s[1], L)}`;
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
// Without JS the examples are plain links: to the model page (one hit) or the brand page (all hits of one brand); a ?q= search only if neither fits.
const hits = q => { const t = norm(q).split(' '); return products.filter((p, i) => t.every(w => hay[i].includes(w))); };
const exampleRel = (x, L) => { const m = hits(x); return m.length === 1 ? modelRel(m[0], L) : m.length && m.every(p => p.brand === m[0].brand) ? brandRel(m[0].brand, L) : null; };
const hint = examples.slice(0, -1).filter(x => x.length <= 16).at(-1) || examples[0]; // short enough for the input at 360 px
const top = [...perBrand].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'nl')).slice(0, 12).map(([b]) => b);
const brandItem = (b, L) => { const n = perBrand.get(b).length; return `<li><a href="${BASE}/${brandRel(b, L)}">${esc(b)} <span class="num">${nl(n, L)}<span class="vh"> ${n === 1 ? 'model' : tr(L)('modellen', 'models')}</span></span></a></li>`; };
const letterOf = b => { const c = b.normalize('NFKD')[0].toUpperCase(); return /[A-Z]/.test(c) ? c : '#'; };
const letters = new Map(); for (const b of brands) { const l = letterOf(b); if (!letters.has(l)) letters.set(l, []); letters.get(l).push(b); }
const letterId = (l, L) => `letter-${l === '#' ? tr(L)('overig', 'other') : l.toLowerCase()}`;
const brandId = (b, L) => `${tr(L)('merk', 'brand')}-${slug(b)}`;
// All models on one page, per brand. Without JS it is a plain list; the filter only hides rows and empty brands.
const FILTER = L => { const t = tr(L); return `<script>(()=>{const f=document.getElementById('filter'),q=document.getElementById('fq'),c=document.getElementById('fcount');if(!f||!q||!c)return;const norm=s=>String(s).toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim(),nl=n=>n.toLocaleString('${LOCALE[L]}');const G=[...document.querySelectorAll('section[data-brand]')].map(s=>({s,j:document.querySelector('.jump-brands a[href="#'+s.querySelector('h2').id+'"]'),r:[...s.querySelectorAll('tbody tr')].map(r=>{const m=r.querySelector('.n').textContent;return{r,h:norm(s.dataset.brand+' '+m+' '+r.querySelector('.plate').textContent)+' '+norm(m).replace(/ /g,'')}})}));const run=()=>{const t=norm(q.value).split(' ').filter(Boolean);let n=0;for(const g of G){let k=0;for(const x of g.r){const ok=t.every(w=>x.h.includes(w));x.r.hidden=!ok;if(ok)k++}g.s.hidden=!k;if(g.j)g.j.parentNode.hidden=!k;n+=k}c.textContent=!t.length?'':n?nl(n)+(n===1?'${t(' model gevonden', ' model found')}':'${t(' modellen gevonden', ' models found')}'):'${t('Geen model gevonden. Zoek op een deel van de typecode.', 'No model found. Search for part of the type code.')}'};f.hidden=false;f.addEventListener('submit',e=>e.preventDefault());q.addEventListener('input',run);if(q.value)run()})()</script>`; };
const typeRows = L => byType(products).map(([c, l]) => `<tr><th scope="row">${esc(catL(c, L))}<span class="x">${count(l.length, 'model', tr(L)('modellen', 'models'), L)}</span></th><td>${spanText(span(l), L)}</td></tr>`).join('');

const guides = { nl: readGuides('content/gidsen', 'nl'), en: readGuides('content/guides-en', 'en') };
// About page: content/about/over.md (Dutch, Bragi's text as-is) and content/about-en/about.md (English). Same front matter and markdown as the guides.
const ABOUT_UPDATED = '2026-10-17'; // fixed: the date of the about text (sitemap lastmod, AboutPage dateModified); change it when the text changes
const aboutText = { nl: readGuides('content/about', 'nl')[0], en: readGuides('content/about-en', 'en')[0] };
for (const L of LANGS) if (!aboutText[L]) throw new Error(`about page text (${L}) missing`);
const pairOf = { nl: g => guides.en.find(x => x.slug === GUIDE_PAIRS[g.slug]), en: g => guides.nl.find(x => GUIDE_PAIRS[x.slug] === g.slug) };
const updatedLine = (g, L) => g.updated ? `<p class="note">${tr(L)('Bijgewerkt op', 'Updated on')} <time datetime="${g.updated}">${esc(longDate(g.updated, L))}</time></p>` : '';
const jsonLd = data => `\n<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
const PUBLISHER = L => ({ '@type': 'Organization', name: SITE_NAME[L], url: `${SITE}/${ROUTES.home[L]}`, logo: { '@type': 'ImageObject', url: `${SITE}/logo-512.png`, width: 512, height: 512 } });
const sitemap = []; // [{ nl, en, lastmod }] in sitemap order; every entry is one page in both languages

// Structured data (JSON-LD, one @graph per page). The Dataset is RVO's list, the source of every meldcode and amount.
// No offers, prices or ratings: the site sells nothing and has no reviews.
const RVO_ORG = { '@type': 'GovernmentOrganization', name: 'Rijksdienst voor Ondernemend Nederland (RVO)', alternateName: 'RVO', url: 'https://www.rvo.nl/' };
const DATASET = L => ({ '@type': 'Dataset', '@id': `${SITE}/#rvo-meldcodelijst`, name: `ISDE Meldcodelijst Warmtepompen${monthName ? ` – ${monthName}` : ''}`,
  description: tr(L)('De lijst van RVO met alle warmtepompen die in aanmerking komen voor de ISDE-subsidie, met per model de meldcode, de fabrikant, het type, het vermogen, het koudemiddel en het indicatieve subsidiebedrag.',
    "RVO's list of all heat pumps that qualify for the Dutch ISDE subsidy, with the meldcode (notification code), manufacturer, type, capacity, refrigerant and indicative subsidy amount for each model."),
  url: RVO_LIST, creator: RVO_ORG, publisher: RVO_ORG, dateModified: LIST_DATE, inLanguage: 'nl', isAccessibleForFree: true,
  ...(src.url && { distribution: { '@type': 'DataDownload', encodingFormat: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentUrl: src.url } }) });
// items: [[name, path], ...] after the home page; the last one is the page itself.
const crumbsLd = (L, items) => ({ '@type': 'BreadcrumbList', itemListElement: [[SITE_NAME[L], ROUTES.home[L]], ...items].map(([name, rel], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${SITE}/${rel}` })) });
const graph = (...nodes) => jsonLd({ '@context': 'https://schema.org', '@graph': nodes.filter(Boolean) });
const brandLd = (b, L) => ({ '@type': 'Brand', '@id': `${SITE}/${brandRel(b, L)}#brand`, name: b, url: `${SITE}/${brandRel(b, L)}` });
const productLd = (p, L, extra) => ({ '@type': 'Product', '@id': `${SITE}/${modelRel(p, L)}#product`, name: `${p.brand} ${p.model}`, url: `${SITE}/${modelRel(p, L)}`,
  brand: { '@type': 'Brand', '@id': `${SITE}/${brandRel(p.brand, L)}#brand`, name: p.brand }, model: p.model, mpn: p.code, ...(p.cat && { category: catL(p.cat, L) }), ...extra });

// Model pages: a short text made from the data, so that each page says something of its own.
const TYPE_WORD = { nl: { 'Lucht-Water': ['lucht-waterwarmtepomp', 'lucht-waterwarmtepompen'], 'Grond-Water': ['grond-waterwarmtepomp', 'grond-waterwarmtepompen'], 'Water-Water': ['water-waterwarmtepomp', 'water-waterwarmtepompen'], Warmtepompboiler: ['warmtepompboiler', 'warmtepompboilers'] },
  en: { 'Lucht-Water': ['air-to-water heat pump', 'air-to-water heat pumps'], 'Grond-Water': ['ground-to-water heat pump', 'ground-to-water heat pumps'], 'Water-Water': ['water-to-water heat pump', 'water-to-water heat pumps'], Warmtepompboiler: ['heat pump water heater', 'heat pump water heaters'] } };
const typeWord = (c, L, many = false) => (TYPE_WORD[L][c] || tr(L)(['warmtepomp', 'warmtepompen'], ['heat pump', 'heat pumps']))[many ? 1 : 0];
const listNameText = { nl: listMonth.nl ? `de ISDE-meldcodelijst van ${listMonth.nl}` : 'de ISDE-meldcodelijst', en: listMonth.en ? `the ${listMonth.en} ISDE meldcode list` : 'the ISDE meldcode list' };
const perType = new Map(byType(products).map(([c, l]) => [c, l]));
const perBrandType = new Map(); for (const p of products) { const k = `${p.brand}\u0000${p.cat || 'Overig'}`; if (!perBrandType.has(k)) perBrandType.set(k, []); perBrandType.get(k).push(p); }
const summary = (p, L) => { const t = tr(L), name = `${squash(p.brand)} ${squash(p.model)}`, c = p.cat || 'Overig', one = typeWord(c, L), many = typeWord(c, L, true);
  const gas = !p.gas ? '' : t(`Het koudemiddel is ${p.gas}`, `Its refrigerant is ${p.gas}`) + (p.gwp ? t(`, met een GWP van ${p.gwp}.`, `, with a GWP of ${p.gwp}.`) : '.');
  const all = span(perType.get(c) || []), mine = perBrandType.get(`${p.brand}\u0000${c}`), own = span(mine);
  const between = (s, nlPre, enPre) => !s ? '' : s[0] === s[1] ? t(`${nlPre} overal ${fmt(s[0])}`, `${enPre} is ${fmt(s[0], L)} for all of them`) : t(`${nlPre} tussen ${fmt(s[0])} en ${fmt(s[1])}`, `${enPre} is between ${fmt(s[0], L)} and ${fmt(s[1], L)}`);
  return [
    p.kw ? t(`De ${name} is een ${one} van ${nl(p.kw)} kW.`, `The ${name} is ${/^[aeiou]/.test(one) ? 'an' : 'a'} ${one} with a capacity of ${nl(p.kw, L)} kW.`)
      : t(`De ${name} is een ${one}.`, `The ${name} is ${/^[aeiou]/.test(one) ? 'an' : 'a'} ${one}.`), gas,
    t(`Het model staat op ${listNameText.nl} met meldcode ${p.code}${p.sub != null ? ` en een indicatief subsidiebedrag van ${fmt(p.sub)}` : ''}.`,
      `It is on ${listNameText.en} with meldcode ${p.code}${p.sub != null ? ` and an indicative subsidy amount of ${fmt(p.sub, L)}` : ''}.`),
    all && (perType.get(c).length > 1 ? between(all, `Voor de ${nl(perType.get(c).length)} ${many} op de lijst ligt het bedrag`, `For the ${nl(perType.get(c).length, L)} ${many} on the list, the amount`) + '.' : ''),
    mine.length === 1 ? t(`Dit is de enige ${one} van ${p.brand} op de lijst.`, `This is the only ${one} from ${p.brand} on the list.`)
      : t(`${p.brand} heeft ${nl(mine.length)} ${many} op de lijst`, `${p.brand} has ${nl(mine.length, L)} ${many} on the list`) + (own ? (own[0] === own[1] ? t(', allemaal met hetzelfde bedrag.', ', all with the same amount.') : t(`, met bedragen van ${fmt(own[0])} tot ${fmt(own[1])}.`, `, with amounts from ${fmt(own[0], L)} to ${fmt(own[1], L)}.`)) : '.')
  ].filter(Boolean).join(' '); };
// Related models: up to 6 of the same brand, same type first, then the nearest in model order.
const sortedBrand = new Map([...perBrand].map(([b, l]) => [b, [...l].sort((x, y) => byModel.compare(x.model, y.model))]));
const siblings = (p, k = 6) => { const l = sortedBrand.get(p.brand), pos = new Map(l.map((x, j) => [x, j])), i = pos.get(p);
  return l.filter(x => x !== p).sort((a, b) => (b.cat === p.cat) - (a.cat === p.cat) || Math.abs(pos.get(a) - i) - Math.abs(pos.get(b) - i)).slice(0, k).sort((a, b) => pos.get(a) - pos.get(b)); };
// A model page with almost no data is not indexed (noindex,follow) and not in the sitemap.
const thin = p => p.sub == null || !p.cat;

// The model index is split into one page per first letter of the brand: /warmtepomp/a/, /en/heat-pumps/a/ (digits: 0-9).
const LETTERS = [...letters.keys()];
const letterSlug = l => l === '#' ? '0-9' : l.toLowerCase();
const letterLabel = l => l === '#' ? '0–9' : l;
const letterRel = (l, L) => `${ROUTES.models[L]}${letterSlug(l)}/`;
for (const l of LETTERS) if (products.some(p => p.slug === letterSlug(l))) throw new Error(`model slug "${letterSlug(l)}" is also a letter page`);
const letterModels = l => letters.get(l).reduce((n, b) => n + perBrand.get(b).length, 0);
const pager = (i, L, bottom = false) => { const t = tr(L), prev = LETTERS[i - 1], next = LETTERS[i + 1];
  const pn = `<p class="pager-pn">${prev ? `<a href="${BASE}/${letterRel(prev, L)}" rel="prev">← ${t('Vorige', 'Previous')}: ${letterLabel(prev)}</a>` : ''}${next ? `<a href="${BASE}/${letterRel(next, L)}" rel="next">${t('Volgende', 'Next')}: ${letterLabel(next)} →</a>` : ''}</p>`;
  return bottom ? `<nav class="pager" aria-label="${t('Vorige en volgende letter', 'Previous and next letter')}">${pn}</nav>`
    : `<nav class="pager" aria-label="${t('Modellen per letter', 'Models by letter')}"><div class="az"><ul>${LETTERS.map((l, j) => `<li><a href="${BASE}/${letterRel(l, L)}"${j === i ? ' aria-current="page"' : ''}>${letterLabel(l)}</a></li>`).join('')}</ul></div>${pn}</nav>`; };

for (const L of LANGS) { const t = tr(L), listName = listNames[L], home = `${BASE}/${ROUTES.home[L]}`;
const at = k => `${BASE}/${ROUTES[k][L]}`;

write(`${ROUTES.home[L]}index.html`, page(L, t('ISDE-subsidie warmtepomp checken – meldcode en bedrag', `Heat Pump Subsidy Netherlands ${YEAR} (ISDE) – Check Your Model | ISDE Checker`),
  t(`Staat je warmtepomp op de ISDE-meldcodelijst van RVO? Zoek op merk, model of meldcode en zie direct de meldcode en het subsidiebedrag.`, `Is your heat pump on RVO's ISDE meldcode list? Search by brand, model or meldcode (notification code) and see the subsidy amount straight away.`), ROUTES.home,
`<section class="hero"><div class="wrap">
<h1>${t('Staat jouw warmtepomp op de ISDE-lijst?', 'Is your heat pump on the ISDE list?')}</h1>
<p class="lead">${t(`Zoek tussen ${nl(products.length)} goedgekeurde warmtepompen van ${brands.length} merken. Je ziet direct de meldcode en het subsidiebedrag.`,
  `Search ${nl(products.length, L)} approved heat pumps from ${brands.length} brands on the meldcodelijst of RVO, the Netherlands Enterprise Agency. You see the meldcode (notification code) and the subsidy amount straight away.`)}</p>
<form id="zoek" class="search" action="${home}" method="get" role="search"><label for="q">${t('Zoek op merk, model of meldcode', 'Search by brand, model or meldcode')}</label>
<div class="field"><input id="q" name="q" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="${t('Bijv.', 'E.g.')} ${esc(hint)}"><button type="submit" data-goatcounter-click="search-home">${t('Zoeken', 'Search')}</button></div></form>
<p class="try">${t('Probeer:', 'Try:')} ${examples.map(x => `<a href="${exampleRel(x, L) ? `${BASE}/${exampleRel(x, L)}` : `${home}?q=${encodeURIComponent(x)}`}" data-q="${esc(x)}" data-goatcounter-click="search-example">${esc(x)}</a>`).join(' ')}</p>
${listStamp(L, 'stamp')}
</div></section>
<div class="wrap">
<section class="results" aria-label="${t('Zoekresultaten', 'Search results')}"><p id="count" class="count" role="status"></p><div id="results"></div>
<noscript><p>${t(`Zoeken werkt met JavaScript. Zonder JavaScript vind je alle modellen via de <a href="${at('brands')}">lijst per merk</a>.`, `Search needs JavaScript. Without JavaScript, you can find all models in the <a href="${at('brands')}">list by brand</a>.`)}</p></noscript></section>
<div class="info">
<section><h2>${t('Zo gebruik je de meldcode', 'How to use the meldcode')}</h2><ol class="steps">${t('<li>Zoek je warmtepomp op merk, model of meldcode.</li><li>Open het model. Je ziet de meldcode en het subsidiebedrag.</li><li>Vul na de installatie de meldcode in bij je ISDE-aanvraag op rvo.nl.</li>',
  '<li>Search for your heat pump by brand, model or meldcode.</li><li>Open the model. You see the meldcode and the subsidy amount.</li><li>After the installation, enter the meldcode in your ISDE application on rvo.nl. You log in with DigiD, and the application form is in Dutch.</li>')}</ol></section>
<section><h2>${t('Waar vind je het model?', 'Where do you find the model?')}</h2><ul class="dots">${t('<li>Op de offerte of factuur van je installateur.</li><li>Op het typeplaatje van de warmtepomp.</li><li>In de handleiding.</li></ul><p>Vind je niets op de hele naam? Zoek dan op een deel van de typecode. Hoofdletters, spaties en streepjes maken niet uit.</p>',
  '<li>On the quote or invoice from your installer.</li><li>On the rating plate of the heat pump.</li><li>In the manual.</li></ul><p>Nothing found for the full name? Then search for part of the type code. Capitals, spaces and hyphens do not matter.</p>')}</section>
</div>
<section class="top"><h2>${t('Merken met de meeste modellen', 'Brands with the most models')}</h2><ul class="brands">${top.map(b => brandItem(b, L)).join('')}</ul><p class="more"><a href="${at('brands')}">${t(`Alle ${brands.length} merken`, `All ${brands.length} brands`)}</a></p></section>
</div>
<script>window.BASE=${JSON.stringify(BASE)}</script><script src="${BASE}/search.js" defer></script>`, { cls: 'home', head: graph({ '@type': 'WebApplication', '@id': `${SITE}/${ROUTES.home[L]}#app`, name: SITE_NAME[L], url: `${SITE}/${ROUTES.home[L]}`,
    description: t('Zoek een warmtepomp op merk, model of meldcode en zie of hij op de ISDE-meldcodelijst van RVO staat, met de meldcode en het indicatieve subsidiebedrag.', "Search for a heat pump by brand, model or meldcode and see whether it is on RVO's ISDE meldcode list, with the meldcode and the indicative subsidy amount."),
    applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any', browserRequirements: 'Requires JavaScript', inLanguage: LOCALE[L], isAccessibleForFree: true, publisher: PUBLISHER(L), isBasedOn: { '@id': `${SITE}/#rvo-meldcodelijst` } }, DATASET(L)) }));

write(`${ROUTES.brands[L]}index.html`, page(L, t('Alle warmtepompmerken op de ISDE-meldcodelijst', 'All heat pump brands on the ISDE meldcode list'),
  t(fit(155, `Alle ${brands.length} warmtepompmerken op ${listName}. Kies een merk en zie per model de meldcode en het subsidiebedrag.`, `Alle warmtepompmerken op ${listName}.`),
    fit(155, `All ${brands.length} heat pump brands on ${listName}. Choose a brand to see the meldcode and subsidy amount for each model.`, `All heat pump brands on ${listName}.`)), ROUTES.brands,
`<div class="wrap">
<h1>${t('Alle merken op de ISDE-lijst', 'All brands on the ISDE list')}</h1>
<p class="lead">${t(`${brands.length} merken met samen ${nl(products.length)} warmtepompen op ${listName}. Kies een merk voor alle modellen, meldcodes en bedragen.`,
  `${brands.length} brands with ${nl(products.length, L)} heat pumps in total on ${listName}. Choose a brand for all its models, meldcodes and amounts.`)}</p>
${listStamp(L)}
<nav class="az" aria-label="${t('Merken per letter', 'Brands by letter')}"><ul>${[...letters.keys()].map(l => `<li><a href="#${letterId(l, L)}">${l}</a></li>`).join('')}</ul></nav>
${[...letters].map(([l, bs]) => `<section class="letter" aria-labelledby="${letterId(l, L)}"><h2 id="${letterId(l, L)}">${l}</h2><ul class="brands">${bs.map(b => brandItem(b, L)).join('')}</ul></section>`).join('\n')}
</div>`, { head: graph(crumbsLd(L, [[t('Merken', 'Brands'), ROUTES.brands[L]]]), DATASET(L)) }));

for (const b of brands) { const list = perBrand.get(b), s = span(list), groups = byType(list), n = list.length;
  write(`${brandRel(b, L)}index.html`, page(L, brandTitle(b, L), brandDesc(b, n, s ? spanText(s, L) : '', L), { nl: brandRel(b, 'nl'), en: brandRel(b, 'en') },
`<div class="wrap">
<nav class="crumbs" aria-label="${t('Kruimelpad', 'Breadcrumb')}"><ol><li><a href="${at('brands')}">${t('Merken', 'Brands')}</a></li></ol></nav>
<h1>${t(`ISDE-subsidie ${esc(b)}`, `ISDE subsidy for ${esc(b)} heat pumps`)}</h1>
<p class="lead">${t(`${n === 1 ? `Eén model van ${esc(b)} staat` : `${nl(n)} modellen van ${esc(b)} staan`} op ${listName}.${!s ? '' : s[0] === s[1] ? ` Het indicatieve subsidiebedrag is ${fmt(s[0])}.` : ` Het indicatieve subsidiebedrag ligt tussen ${fmt(s[0])} en ${fmt(s[1])}.`}`,
  `${n === 1 ? `One ${esc(b)} model is` : `${nl(n, L)} ${esc(b)} models are`} on ${listName}.${!s ? '' : s[0] === s[1] ? ` The indicative subsidy amount is ${fmt(s[0], L)}.` : ` The indicative subsidy amount is between ${fmt(s[0], L)} and ${fmt(s[1], L)}.`}`)}</p>
${listStamp(L)}
${groups.length > 1 ? `<nav class="jump" aria-label="${t('Soorten warmtepomp', 'Types of heat pump')}"><ul>${groups.map(([c, l]) => `<li><a href="#${slug(catL(c, L))}">${esc(catL(c, L))} <span class="num">${nl(l.length, L)}<span class="vh"> ${l.length === 1 ? 'model' : t('modellen', 'models')}</span></span></a></li>`).join('')}</ul></nav>` : ''}
${groups.map(([c, l]) => `<section class="group"><h2 id="${slug(catL(c, L))}">${esc(catL(c, L))} <span class="count">${count(l.length, 'model', t('modellen', 'models'), L)}</span></h2>${table(l, L, { label: slug(catL(c, L)) })}</section>`).join('\n')}
${miniSearch(L, 'q2', t('Zoek een ander model', 'Search for another model'), 'search-brand')}
</div>`, { head: graph(crumbsLd(L, [[t('Merken', 'Brands'), ROUTES.brands[L]], [b, brandRel(b, L)]]), brandLd(b, L),
    { '@type': 'ItemList', name: t(`Warmtepompen van ${b} op de ISDE-meldcodelijst`, `${b} heat pumps on the ISDE meldcode list`), numberOfItems: n,
      itemListElement: groups.flatMap(([, l]) => l).map((p, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'Product', name: `${p.brand} ${p.model}`, url: `${SITE}/${modelRel(p, L)}`, brand: { '@id': `${SITE}/${brandRel(b, L)}#brand` }, model: p.model, mpn: p.code } })) }, DATASET(L)) })); } // short items: the full Product is on the model page

// Model index: one short page that links to a page per letter (each well under 150 KB), and to every brand on those pages.
write(`${ROUTES.models[L]}index.html`, page(L, t('Alle warmtepompen op de ISDE-meldcodelijst', 'All heat pumps on the ISDE meldcode list'),
  t(fit(155, `Alle ${nl(products.length)} warmtepompen op ${listName}, per letter en merk. Kies een model en zie de meldcode en het subsidiebedrag.`, `Alle warmtepompen op ${listName}, per merk.`),
    fit(155, `All ${nl(products.length, L)} heat pumps on ${listName}, by letter and brand. Choose a model to see its meldcode and subsidy amount.`, `All heat pumps on ${listName}, by brand.`)), ROUTES.models,
`<div class="wrap">
<h1>${t('Alle warmtepompen op de ISDE-lijst', 'All heat pumps on the ISDE list')}</h1>
<p class="lead">${t(`${nl(products.length)} warmtepompen van ${brands.length} merken op ${listName}. Kies de eerste letter van het merk, of direct een merk.`,
  `${nl(products.length, L)} heat pumps from ${brands.length} brands on ${listName}. Choose the first letter of the brand, or go straight to a brand.`)}</p>
${listStamp(L)}
<nav class="az" aria-label="${t('Modellen per letter', 'Models by letter')}"><ul>${LETTERS.map(l => `<li><a href="${BASE}/${letterRel(l, L)}">${letterLabel(l)}</a></li>`).join('')}</ul></nav>
${LETTERS.map(l => `<section class="letter" aria-labelledby="${letterId(l, L)}"><h2 id="${letterId(l, L)}"><a href="${BASE}/${letterRel(l, L)}">${letterLabel(l)}</a> <span class="count">${count(letterModels(l), 'model', t('modellen', 'models'), L)}</span></h2><ul class="brands">${letters.get(l).map(b => { const n = perBrand.get(b).length; return `<li><a href="${BASE}/${letterRel(l, L)}#${brandId(b, L)}">${esc(b)} <span class="num">${nl(n, L)}<span class="vh"> ${n === 1 ? 'model' : t('modellen', 'models')}</span></span></a></li>`; }).join('')}</ul></section>`).join('\n')}
${miniSearch(L, 'q2', t('Zoek op merk, model of meldcode', 'Search by brand, model or meldcode'), 'search-models')}
</div>`, { head: graph(crumbsLd(L, [[t('Modellen', 'Models'), ROUTES.models[L]]]), DATASET(L)) }));

LETTERS.forEach((l, i) => { const bs = letters.get(l), n = letterModels(l), lab = letterLabel(l), rel = letterRel(l, L);
  write(`${rel}index.html`, page(L, t(`Warmtepompen van merken met ${lab} – ISDE-meldcodelijst`, `Heat pumps from brands starting with ${lab} – ISDE list`),
    t(fit(155, `${nl(n)} warmtepompen van ${bs.length === 1 ? `1 merk` : `${bs.length} merken`} met ${lab} op ${listName}, met meldcode en subsidiebedrag per model.`, `Warmtepompen van merken met ${lab} op ${listName}.`),
      fit(155, `${nl(n, L)} heat pumps from ${bs.length === 1 ? '1 brand' : `${bs.length} brands`} starting with ${lab} on ${listName}, with the meldcode and subsidy amount for each model.`, `Heat pumps from brands starting with ${lab} on ${listName}.`)),
    { nl: letterRel(l, 'nl'), en: letterRel(l, 'en') },
`<div class="wrap">
<nav class="crumbs" aria-label="${t('Kruimelpad', 'Breadcrumb')}"><ol><li><a href="${at('models')}">${t('Modellen', 'Models')}</a></li></ol></nav>
<h1>${t(`Warmtepompen van merken met ${lab}`, `Heat pumps from brands starting with ${lab}`)}</h1>
<p class="lead">${t(`${count(n, 'warmtepomp', 'warmtepompen')} van ${count(bs.length, 'merk', 'merken')} op ${listName}. Kies een model voor de meldcode en het subsidiebedrag.`,
  `${count(n, 'heat pump', 'heat pumps', L)} from ${count(bs.length, 'brand', 'brands', L)} on ${listName}. Choose a model for its meldcode and subsidy amount.`)}</p>
${listStamp(L)}
${pager(i, L)}
<form id="filter" class="search search-filter" action="${home}" method="get" role="search" hidden><label for="fq">${t(`Filter op deze pagina (${lab})`, `Filter this page (${lab})`)}</label>
<div class="field"><input id="fq" name="q" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="${t('Merk, model of meldcode', 'Brand, model or meldcode')}"></div></form>
<p id="fcount" class="count" role="status"></p>
${bs.length > 1 ? `<nav class="jump-brands" aria-label="${t('Merken', 'Brands')}"><details><summary>${t('Spring naar een merk', 'Jump to a brand')} (${bs.length})</summary><ul class="brands">${bs.map(b => { const k = perBrand.get(b).length; return `<li><a href="#${brandId(b, L)}">${esc(b)} <span class="num">${nl(k, L)}<span class="vh"> ${k === 1 ? 'model' : t('modellen', 'models')}</span></span></a></li>`; }).join('')}</ul></details></nav>` : ''}
${bs.map(b => { const list = sortedBrand.get(b);
  return `<section class="group" data-brand="${esc(b)}"><h2 id="${brandId(b, L)}">${esc(b)} <span class="count">${count(list.length, 'model', t('modellen', 'models'), L)}</span></h2>${table(list, L, { label: brandId(b, L) })}<p class="more"><a href="${BASE}/${brandRel(b, L)}">${t(`Merkpagina ${esc(b)}`, `${esc(b)} brand page`)}</a></p></section>`; }).join('\n')}
${pager(i, L, true)}
</div>${FILTER(L)}`, { head: (i > 0 ? `\n<link rel="prev" href="${SITE}/${letterRel(LETTERS[i - 1], L)}">` : '') + (i < LETTERS.length - 1 ? `\n<link rel="next" href="${SITE}/${letterRel(LETTERS[i + 1], L)}">` : '')
    + graph(crumbsLd(L, [[t('Modellen', 'Models'), ROUTES.models[L]], [lab, rel]]), DATASET(L)) })); });

for (const p of products) { const n = perBrand.get(p.brand).length, brandUrl = `${BASE}/${brandRel(p.brand, L)}`, about = summary(p, L), sib = siblings(p);
  write(`${modelRel(p, L)}index.html`, page(L, productTitle(p, L), productDesc(p, L), { nl: modelRel(p, 'nl'), en: modelRel(p, 'en') },
`<div class="wrap">
<nav class="crumbs" aria-label="${t('Kruimelpad', 'Breadcrumb')}"><ol><li><a href="${at('brands')}">${t('Merken', 'Brands')}</a></li><li><a href="${brandUrl}">${esc(p.brand)}</a></li></ol></nav>
<h1>${t(`ISDE-subsidie ${esc(p.brand)} ${esc(p.model)}`, `${esc(p.brand)} ${esc(p.model)} ISDE subsidy`)}</h1>
<p class="verdict">${ICON_OK}${t('Staat op', 'On')} ${listName}</p>
<dl class="answer">
<div class="a-code"><dt>${t('Meldcode', 'Meldcode (notification code)')}</dt><dd><span class="plate plate-xl"><span class="band">${ICON_BAND}</span>${esc(p.code)}</span><button type="button" class="btn-copy" data-copy="${esc(p.code)}" data-goatcounter-click="copy-meldcode" hidden>${t('Kopieer meldcode', 'Copy meldcode')}</button><span class="vh" role="status"></span></dd></div>
<div class="a-sum"><dt>${t('Indicatief subsidiebedrag', 'Indicative subsidy amount')}</dt><dd class="amount">${fmt(p.sub, L)}</dd></div>
</dl>
${listStamp(L)}
<p class="about">${esc(about)}</p>
<dl class="spec">
<div><dt>${t('Merk', 'Brand')}</dt><dd><a href="${brandUrl}">${esc(p.brand)}</a></dd></div>
<div><dt>Model</dt><dd>${esc(p.model)}</dd></div>
<div><dt>Type</dt><dd>${!p.cat ? '–' : L === 'en' && CAT_EN[p.cat] ? `${esc(CAT_EN[p.cat])} <span lang="nl">(${esc(p.cat)})</span>` : esc(p.cat)}</dd></div>
<div><dt>${t('Vermogen', 'Capacity')}</dt><dd>${p.kw == null ? '–' : `${nl(p.kw, L)} kW`}</dd></div>
<div><dt>${t('Koudemiddel', 'Refrigerant')}</dt><dd>${esc(p.gas) || '–'}${p.gwp ? ` (GWP ${esc(p.gwp)})` : ''}</dd></div>
<div><dt>${t('Bedrag voor een 2e warmtepomp', 'Amount for a 2nd heat pump')}</dt><dd>${fmt(p.sub2, L)}</dd></div>
</dl>
${p.sub2 != null && p.sub2 !== p.sub ? `<p class="note">${t('Het bedrag voor een 2e warmtepomp geldt als je twee lucht-waterwarmtepompen laat plaatsen, of als je al eerder subsidie kreeg voor een lucht-waterwarmtepomp.', 'The amount for a 2nd heat pump applies if you have two air-to-water heat pumps installed, or if you already received a subsidy for an air-to-water heat pump before.')}</p>` : ''}
<p>${t(`Vul meldcode <strong>${esc(p.code)}</strong> in bij je ISDE-aanvraag bij RVO. Het bedrag is indicatief; RVO stelt de definitieve subsidie vast. <a href="${at('explain')}">Zo werkt de subsidie</a>`,
  `Enter meldcode <strong>${esc(p.code)}</strong> in your ISDE application to RVO (the Netherlands Enterprise Agency). The application form is in Dutch. The amount is indicative; RVO sets the final subsidy. <a href="${at('explain')}">How the subsidy works</a>`)}</p>
${sib.length ? `<section class="related" aria-labelledby="rel-h"><h2 id="rel-h">${t(`Andere modellen van ${esc(p.brand)}`, `Other ${esc(p.brand)} models`)}</h2>${table(sib, L, { label: 'rel-h' })}</section>` : ''}
<p class="more"><a href="${brandUrl}">${t(n === 1 ? `Alle modellen van ${esc(p.brand)}` : `Alle ${nl(n)} modellen van ${esc(p.brand)}`, n === 1 ? `All ${esc(p.brand)} models` : `All ${nl(n, L)} ${esc(p.brand)} models`)}</a></p>
${AFF(L)}
${miniSearch(L, 'q2', t('Zoek een ander model', 'Search for another model'), 'search-model')}
</div>${COPY(L)}`, { robots: thin(p) ? 'noindex,follow' : '', head: graph(crumbsLd(L, [[t('Merken', 'Brands'), ROUTES.brands[L]], [p.brand, brandRel(p.brand, L)], [`${p.brand} ${p.model}`, modelRel(p, L)]]),
    productLd(p, L, { description: about, identifier: { '@type': 'PropertyValue', propertyID: 'ISDE-meldcode', value: p.code },
      additionalProperty: [p.kw > 0 && { '@type': 'PropertyValue', name: t('Vermogen', 'Capacity'), value: p.kw, unitCode: 'KWT', unitText: 'kW' },
        p.gas && { '@type': 'PropertyValue', name: t('Koudemiddel', 'Refrigerant'), value: p.gas }, p.gwp && { '@type': 'PropertyValue', name: 'GWP', value: p.gwp },
        p.sub != null && { '@type': 'PropertyValue', name: t('Indicatief ISDE-subsidiebedrag', 'Indicative ISDE subsidy amount'), value: p.sub, unitText: 'EUR' },
        p.sub2 != null && { '@type': 'PropertyValue', name: t('ISDE-subsidiebedrag 2e warmtepomp', 'ISDE subsidy amount for a 2nd heat pump'), value: p.sub2, unitText: 'EUR' }].filter(Boolean),
      subjectOf: { '@id': `${SITE}/#rvo-meldcodelijst` } }), DATASET(L)) })); }

write(`${ROUTES.explain[L]}index.html`, page(L, t('Hoeveel ISDE-subsidie krijg je voor een warmtepomp?', 'How much ISDE subsidy do you get for a heat pump?'),
  t('Uitleg over de ISDE-subsidie voor warmtepompen: de bedragen per type, de voorwaarden en hoe je de subsidie aanvraagt.', 'The ISDE subsidy for heat pumps in the Netherlands explained: the amounts per type, the conditions and how to apply for the subsidy.'), ROUTES.explain,
L === 'nl' ? `<div class="wrap prose">
<h1>Hoeveel ISDE-subsidie krijg ik voor een warmtepomp?</h1>
<p class="lead">Dat hangt af van het model. Elk goedgekeurd model heeft op de meldcodelijst van RVO een vast, indicatief bedrag. Op deze site zie je dat bedrag per model.</p>
<p>De Investeringssubsidie duurzame energie en energiebesparing (ISDE) wordt uitgevoerd door RVO. Voor een warmtepomp hangt het bedrag af van het <strong>type</strong> (lucht-water, grond-water, water-water, hybride) en het <strong>thermisch vermogen</strong>.</p>
<h2>Bedragen op ${listName}</h2>
<table class="sum"><thead><tr><th scope="col">Type</th><th scope="col">Bedrag per model</th></tr></thead><tbody>${typeRows(L)}</tbody></table>
<p class="note">Indicatieve bedragen, zoals ze op de lijst staan. <a href="${home}" data-goatcounter-click="search-explain">Zoek je model op</a> voor het bedrag dat bij jouw warmtepomp hoort.</p>
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
<h2>Zo vraag je aan</h2><ol class="steps"><li>Zoek je warmtepomp op en noteer de meldcode.</li><li>Laat de warmtepomp installeren en bewaar factuur en betaalbewijs.</li><li>Vraag de subsidie aan via <a href="https://www.rvo.nl/subsidies-financiering/isde" rel="noopener" data-goatcounter-click="rvo-isde-apply">rvo.nl/isde</a> (let op de actuele aanvraagtermijn).</li></ol>
<p class="note">Dit is een vereenvoudigde samenvatting. De regels kunnen wijzigen; de voorwaarden op rvo.nl en in de Staatscourant zijn leidend.</p>
</div>` : `<div class="wrap prose">
<h1>How much ISDE subsidy do I get for a heat pump?</h1>
<p class="lead">That depends on the model. Every approved model has a fixed, indicative amount on RVO's meldcodelijst (notification code list). This site shows that amount for each model.</p>
<p>The ISDE (Investeringssubsidie duurzame energie en energiebesparing, the Investment Subsidy for Sustainable Energy and Energy Saving) is run by RVO, the Netherlands Enterprise Agency. For a heat pump, the amount depends on the <strong>type</strong> (air-to-water, ground-to-water, water-to-water, hybrid) and the <strong>thermal capacity</strong>.</p>
<h2>Amounts on ${listName}</h2>
<table class="sum"><thead><tr><th scope="col">Type</th><th scope="col">Amount per model</th></tr></thead><tbody>${typeRows(L)}</tbody></table>
<p class="note">Indicative amounts, as they appear on the list. <a href="${home}" data-goatcounter-click="search-explain">Look up your model</a> to see the amount for your heat pump.</p>
<h2>Two amounts per model</h2>
<p>The list gives two amounts for each model. The first is the standard subsidy amount. The second applies to a 2nd air-to-water heat pump: if you have two installed, or if you already received a subsidy for an air-to-water heat pump before. This is how the notes to the list explain it.</p>
<h2>What does the data mean?</h2>
<dl class="terms"><dt>Meldcode (notification code)</dt><dd>The unique identifier of the model. You enter the meldcode in your ISDE application.</dd>
<dt>Capacity</dt><dd>The power at which the heat pump delivers heat, in kilowatts (kW). A manufacturer sometimes states a higher capacity, because it calculates it differently.</dd>
<dt>Refrigerant and GWP</dt><dd>The refrigerant is the substance in the heat pump that carries the heat. The GWP (Global Warming Potential) shows how harmful that substance is to the environment. The lower the GWP, the better.</dd></dl>
<h2>Main conditions (in brief)</h2><ul class="dots">
<li>You are an eigenaar-bewoner (owner-occupier): you own the home and live in it.</li>
<li>An air-to-water, ground-to-water or water-to-water heat pump; air-to-air heat pumps do not qualify.</li>
<li>At least energy label A++ (since 1 January 2024) and registered in EPREL (up to and including 70 kW).</li>
<li>Installed by an installation company.</li>
<li>If the unit is not on the list, you can sometimes still apply with a product description and technical documentation, but RVO may then reject the application.</li></ul>
<h2>How to apply</h2><ol class="steps"><li>Look up your heat pump and write down the meldcode.</li><li>Have the heat pump installed and keep the invoice and proof of payment.</li><li>Apply for the subsidy via <a href="https://www.rvo.nl/subsidies-financiering/isde" rel="noopener" data-goatcounter-click="rvo-isde-apply">rvo.nl/isde</a> (check the current application deadline). You log in with DigiD. The application form is in Dutch.</li></ol>
<p class="note">This is a simplified summary. The rules can change; the conditions on rvo.nl and in the Staatscourant (the Dutch Government Gazette) are what counts.</p>
</div>`, { head: graph(crumbsLd(L, [[t('Uitleg subsidie', 'Subsidy explained'), ROUTES.explain[L]]])) }));

write(`${ROUTES.disclosure[L]}index.html`, page(L, t('Over ISDE-checker: bron, privacy en disclosure', 'About ISDE Checker: source, privacy and disclosure'),
  t('Over ISDE-checker: waar de gegevens vandaan komen, hoe de site geld verdient en welke gegevens we over bezoekers verzamelen.', 'About ISDE Checker: where the data comes from, how the site earns money and what data we collect about visitors.'), ROUTES.disclosure,
L === 'nl' ? `<div class="wrap prose">
<h1>Over deze site en disclosure</h1>
<p class="lead">ISDE-checker is een onafhankelijke hulpsite. We zijn <strong>niet</strong> verbonden aan RVO, de Rijksoverheid of een fabrikant.</p>
<h2>Data</h2><p>Alle productgegevens komen uit de openbare <a href="${RVO_LIST}" rel="noopener">ISDE Meldcodelijst Warmtepompen</a> van RVO, die RVO als open overheidsinformatie publiceert (hergebruik toegestaan, zie <a href="https://www.rvo.nl/onderwerpen/open-data" rel="noopener">RVO open data</a>). De lijst wordt wekelijks automatisch opnieuw opgehaald. Huidige versie: ${esc(monthName || src.url)} (RVO-lijst bijgewerkt ${listWhen(L)}, opgehaald ${when(L)}). Aan deze site kunnen geen rechten worden ontleend.</p>
<h2 id="affiliate">Verdienmodel: bol.com-affiliatelinks</h2><p>ISDE-checker is partner van bol.com. Op elke modelpagina (onder <a href="${at('models')}">Modellen</a>) en in elke <a href="${at('guides')}">gids</a> staat een blok ‘Handig bij je warmtepomp’. Daarin staan zoeklinks naar bol.com: slimme thermostaat, P1-meter, radiatorventilator en tochtstrips.</p>
<p>Dit zijn affiliatelinks. Koop je iets via zo’n link, dan krijgen wij een kleine commissie van bol.com. Jij betaalt niets extra. De links gaan naar zoekresultaten op bol.com; wij hebben de producten niet getest en raden geen bepaald product aan.</p>
<p>De commissie heeft geen invloed op de ISDE-informatie. De meldcodes, de bedragen en de volgorde van de modellen komen uit de lijst van RVO. Verder bevat deze site geen advertenties en geen andere affiliatelinks. Verandert dat, dan staat het op deze pagina.</p>
<h2>Privacy</h2><p>We tellen bezoeken met GoatCounter. GoatCounter werkt zonder cookies en slaat geen persoonsgegevens op: we zien alleen totalen, zoals het aantal bezoeken per pagina. Deze site plaatst geen cookies.</p>
<p>Klik je op een bol.com-link, dan ga je via partner.bol.com naar bol.com. bol.com kan dan cookies plaatsen om de commissie toe te wijzen. Daarvoor geldt het privacybeleid van bol.com.</p>
<p>De site staat op GitHub Pages. GitHub registreert technische gegevens, zoals IP-adressen, om de dienst te beveiligen.</p>
</div>` : `<div class="wrap prose">
<h1>About this site and disclosure</h1>
<p class="lead">ISDE Checker is an independent help site. We are <strong>not</strong> affiliated with RVO, the Dutch government or any manufacturer.</p>
<h2>Data</h2><p>All product data comes from RVO's public <a href="${RVO_LIST}" rel="noopener">ISDE Meldcodelijst Warmtepompen</a> (the ISDE notification code list for heat pumps), which RVO publishes as open government information (reuse permitted, see <a href="https://www.rvo.nl/onderwerpen/open-data" rel="noopener">RVO open data</a>). The list is fetched again automatically every week. Current version: ${esc(MONTH.en || src.url)} (RVO list updated ${listWhen(L)}, fetched ${when(L)}). No rights can be derived from this site.</p>
<h2 id="affiliate">How we earn money: bol.com affiliate links</h2><p>ISDE Checker is a bol.com partner. Every model page (under <a href="${at('models')}">Models</a>) and every <a href="${at('guides')}">guide</a> has a box called ‘Useful with your heat pump’. It contains search links to bol.com, a Dutch web shop: smart thermostat, P1 meter, radiator fan and draught strips.</p>
<p>These are affiliate links. If you buy something through such a link, we get a small commission from bol.com. You pay nothing extra. The links go to search results on bol.com; we have not tested the products and do not recommend any particular product.</p>
<p>The commission has no influence on the ISDE information. The meldcodes, the amounts and the order of the models come from RVO's list. Apart from this, the site contains no advertising and no other affiliate links. If that changes, it will be stated on this page.</p>
<h2>Privacy</h2><p>We count visits with GoatCounter. GoatCounter works without cookies and does not store personal data: we only see totals, such as the number of visits per page. This site does not set cookies.</p>
<p>If you click a bol.com link, you go to bol.com via partner.bol.com. bol.com may then set cookies to assign the commission. bol.com's privacy policy applies to this.</p>
<p>The site is hosted on GitHub Pages. GitHub records technical data, such as IP addresses, to keep the service secure.</p>
</div>`, { head: graph(crumbsLd(L, [[t('Over deze site', 'About this site'), ROUTES.disclosure[L]]])) }));

{ const a = aboutText[L], url = `${SITE}/${ROUTES.about[L]}`;
write(`${ROUTES.about[L]}index.html`, page(L, fit(60, a.title), fit(155, a.description), ROUTES.about,
`<article class="wrap prose md">
<h1>${esc(a.title)}</h1>
<p class="lead">${esc(a.description)}</p>
${markdown(a.body, ROUTES.guides[L].slice(0, -1))}
<p class="more"><a href="${at('disclosure')}">${t('Privacy, affiliatelinks en disclosure', 'Privacy, affiliate links and disclosure')}</a></p>
</article>`, { head: graph({ '@type': 'AboutPage', '@id': `${url}#page`, url, name: a.title, description: a.description, inLanguage: LOCALE[L], dateModified: ABOUT_UPDATED,
    isPartOf: { '@type': 'WebSite', name: SITE_NAME[L], url: `${SITE}/${ROUTES.home[L]}` }, about: PUBLISHER(L), publisher: PUBLISHER(L) },
  crumbsLd(L, [[t('Over ISDE-checker', 'About'), ROUTES.about[L]]])) })); }

write(`${ROUTES.guides[L]}index.html`, page(L, t('Gidsen over ISDE-subsidie voor je warmtepomp', 'Guides to the ISDE subsidy for your heat pump'),
  t('Gidsen van ISDE-checker over de ISDE-subsidie voor warmtepompen, met per gids een korte samenvatting en de datum van de laatste update.', 'Guides from ISDE Checker to the Dutch ISDE subsidy for heat pumps, each with a short summary and the date of the last update.'), ROUTES.guides,
`<div class="wrap prose">
<h1>${t('Gidsen', 'Guides')}</h1>
<p class="lead">${t('Uitleg in gewone taal over de ISDE-subsidie voor je warmtepomp.', 'Plain-English explanations of the Dutch ISDE subsidy for your heat pump.')}</p>
${guides[L].length ? `<ul class="guides">${guides[L].map(g => `<li><h2><a href="${at('guides')}${g.slug}/">${esc(g.title)}</a></h2><p>${esc(g.description)}</p>${updatedLine(g, L)}</li>`).join('')}</ul>`
  : `<div class="nohit"><p>${t('Er staan op dit moment geen gidsen op deze site.', 'There are no guides on this site at the moment.')}</p><p>${t('Wil je weten of je warmtepomp subsidie krijgt?', 'Do you want to know if your heat pump gets a subsidy?')}</p><ul><li><a href="${home}" data-goatcounter-click="search-guides-empty">${t('Zoek je warmtepomp op', 'Look up your heat pump')}</a></li><li><a href="${at('explain')}">${t('Lees hoe de subsidie werkt', 'Read how the subsidy works')}</a></li></ul></div>`}
</div>`, { head: graph(crumbsLd(L, [[t('Gidsen', 'Guides'), ROUTES.guides[L]]])) }));
for (const g of guides[L]) { const rel = `${ROUTES.guides[L]}${g.slug}/`, url = `${SITE}/${rel}`, dir = ROUTES.guides[L].slice(0, -1), body = markdown(g.body, dir), pair = pairOf[L](g);
  for (const [, to] of body.matchAll(new RegExp(`href="${BASE}/${dir}/([^/"#]+)/`, 'g'))) if (!guides[L].some(x => x.slug === to)) console.warn(`${dir}: ${g.file}: link to unknown guide "${to}"`);
  const alt = pair ? { [L]: rel, [L === 'en' ? 'nl' : 'en']: `${ROUTES.guides[L === 'en' ? 'nl' : 'en']}${pair.slug}/` } : { ...ROUTES.guides, [L]: rel };
  write(`${rel}index.html`, page(L, fit(60, `${g.title} – ${SITE_NAME[L]}`, g.title), fit(155, g.description), alt,
`<div class="wrap"><nav class="crumbs" aria-label="${t('Kruimelpad', 'Breadcrumb')}"><ol><li><a href="${at('guides')}">${t('Gidsen', 'Guides')}</a></li></ol></nav></div>
<article class="wrap prose md">
<h1>${esc(g.title)}</h1>
<p class="lead">${esc(g.description)}</p>
${updatedLine(g, L)}
${body}
<p class="note">${t('Deze gids is geschreven met hulp van AI en gecontroleerd op bronnen.', 'This guide was written with the help of AI and checked against its sources.')}</p>
<p class="more"><a href="${at('guides')}">${t('Alle gidsen', 'All guides')}</a></p>
${AFF(L)}
${miniSearch(L, 'q2', t('Zoek je warmtepomp op', 'Look up your heat pump'), 'search-guide')}
</article>`, { type: 'article', paired: !!pair, head: (g.updated ? `\n<meta property="article:modified_time" content="${g.updated}">` : '') + graph({ '@type': 'Article',
    headline: clip(g.title, 110), description: g.description, ...(g.updated && { dateModified: g.updated }), url, mainEntityOfPage: url, inLanguage: t('nl-NL', 'en-GB'), image: OG_IMAGE, author: PUBLISHER(L), publisher: PUBLISHER(L) },
    crumbsLd(L, [[t('Gidsen', 'Guides'), ROUTES.guides[L]], [g.title, rel]])) })); }

write(ROUTES.notFound[L], page(L, t('Pagina niet gevonden – ISDE-checker', 'Page not found – ISDE Checker'), t('Deze pagina bestaat niet (meer). Zoek je warmtepomp op merk, model of meldcode.', 'This page does not exist (any more). Look up your heat pump by brand, model or meldcode.'), ROUTES.notFound,
`<div class="wrap prose">
<h1>${t('Deze pagina bestaat niet', 'This page does not exist')}</h1>
<p class="lead">${t('Misschien is het adres verkeerd getypt. Of de warmtepomp staat niet meer op de meldcodelijst: dan verdwijnt ook de pagina.', 'Perhaps the address was mistyped. Or the heat pump is no longer on the meldcode list: then its page is removed too.')}</p>
${miniSearch(L, 'q404', t('Zoek op merk, model of meldcode', 'Search by brand, model or meldcode'), 'search-404')}
<p class="more"><a href="${at('brands')}">${t('Bekijk alle merken', 'See all brands')}</a></p>
</div>`, { robots: 'noindex' }));
}

// Sitemap: every indexable page in both languages, each with its hreflang alternates (nl, en, x-default = nl).
// lastmod: the RVO list date for pages made from the list, the guide's updated: date for guides; never the build date.
// Unpaired guides are listed without alternates. Stays one file: about 6,100 URLs, far below the 50,000 limit.
const fixed = [ROUTES.home, ROUTES.brands, ROUTES.models, ROUTES.explain, ROUTES.disclosure].map(r => ({ ...r, lastmod: LIST_DATE })).concat({ ...ROUTES.about, lastmod: ABOUT_UPDATED });
const lastGuide = L => guides[L].map(g => g.updated).filter(Boolean).sort().at(-1);
const indexed = products.filter(p => !thin(p));
sitemap.push(...fixed, ...LETTERS.map(l => ({ nl: letterRel(l, 'nl'), en: letterRel(l, 'en'), lastmod: LIST_DATE })),
  ...brands.map(b => ({ nl: brandRel(b, 'nl'), en: brandRel(b, 'en'), lastmod: LIST_DATE })), ...indexed.map(p => ({ nl: modelRel(p, 'nl'), en: modelRel(p, 'en'), lastmod: LIST_DATE })));
console.log(`${LETTERS.length} letter pages per language; ${products.length - indexed.length} thin model pages (noindex,follow, not in the sitemap)`);
const entries = sitemap.flatMap(e => LANGS.map(L => ({ loc: e[L], lastmod: e.lastmod, alt: e })));
entries.push(...LANGS.map(L => ({ loc: ROUTES.guides[L], lastmod: lastGuide(L), alt: { ...ROUTES.guides } })));
for (const L of LANGS) for (const g of guides[L]) { const pair = pairOf[L](g), rel = `${ROUTES.guides[L]}${g.slug}/`, other = L === 'en' ? 'nl' : 'en';
  entries.push({ loc: rel, lastmod: g.updated, alt: pair && { [L]: rel, [other]: `${ROUTES.guides[other]}${pair.slug}/` } }); }
const xhtml = a => !a ? '' : `<xhtml:link rel="alternate" hreflang="nl" href="${SITE}/${a.nl}"/><xhtml:link rel="alternate" hreflang="en" href="${SITE}/${a.en}"/><xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/${a.nl}"/>`;
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.map(e => `<url><loc>${SITE}/${e.loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}${xhtml(e.alt)}</url>`).join('')}</urlset>`);
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`wrote ${entries.length} pages in the sitemap (${guides.nl.length} gidsen, ${guides.en.length} English guides)`);
