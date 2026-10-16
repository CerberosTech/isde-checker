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
const srcLine = `Bron: <a href="${RVO_LIST}" rel="noopener">RVO ISDE Meldcodelijst Warmtepompen</a>${monthName ? ' – ' + esc(monthName) : ''} (opgehaald ${esc(src.fetched)}). Aan deze gegevens kunnen geen rechten worden ontleend; controleer altijd bij RVO.`;
const cta = `<aside class="cta"><h2>Offertes aanvragen?</h2><p>Binnenkort kun je hier vrijblijvend offertes van erkende installateurs vergelijken. Tot die tijd: vraag minimaal drie offertes aan en controleer of de meldcode op de offerte staat.</p></aside>`;
const page = (title, desc, rel, body) => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${SITE}/${rel}">
<link rel="stylesheet" href="${BASE}/style.css"></head><body>
<header><a class="logo" href="${BASE}/">ISDE-checker</a><nav><a href="${BASE}/">Zoeken</a><a href="${BASE}/merken/">Merken</a><a href="${BASE}/subsidie-uitleg/">Hoeveel subsidie?</a><a href="${BASE}/disclosure/">Over &amp; disclosure</a></nav></header>
<main>${body}</main><footer><p>${srcLine}</p><p>Onafhankelijke site, niet verbonden aan RVO of de Rijksoverheid. <a href="${BASE}/disclosure/">Disclosure</a></p></footer>${ANALYTICS}</body></html>`;
const table = list => `<table><thead><tr><th>Merk</th><th>Model</th><th>Meldcode</th><th>kW</th><th>Subsidie</th></tr></thead><tbody>${list.map(p => `<tr><td>${esc(p.brand)}</td><td><a href="${BASE}/warmtepomp/${p.slug}/">${esc(p.model)}</a></td><td><code>${esc(p.code)}</code></td><td>${p.kw ?? ''}</td><td>${fmt(p.sub)}</td></tr>`).join('')}</tbody></table>`;

fs.rmSync(OUT, { recursive: true, force: true });
const write = (rel, html) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };
fs.cpSync('src', OUT, { recursive: true });
write('products.json', JSON.stringify({ source: src, month: monthName, products: products.map(p => [p.brand, p.model, p.code, p.kw, p.sub, p.slug, p.cat]) }));
write('.nojekyll', '');
// Never remove: Google Search Console HTML verification file (exact content required).
write('google8042a96498438aa5.html', 'google-site-verification: google8042a96498438aa5.html');

write('index.html', page('ISDE subsidie warmtepomp checken – staat jouw warmtepomp op de meldcodelijst?', `Zoek op merk of model en zie direct of je warmtepomp op de ISDE-meldcodelijst staat, met meldcode en subsidiebedrag. ${products.length} warmtepompen.`, '',
`<h1>Staat jouw warmtepomp op de ISDE-lijst?</h1><p>Zoek op merk, model of meldcode in ${products.length.toLocaleString('nl-NL')} goedgekeurde warmtepompen van ${brands.length} merken.</p>
<input id="q" type="search" placeholder="Bijv. Daikin Altherma, NIBE F2120 of KA12345" autocomplete="off" autofocus><p id="count" class="muted"></p><div id="results"></div>
<noscript><p>Zonder JavaScript: bekijk de <a href="${BASE}/merken/">lijst per merk</a>.</p></noscript>${cta}
<script>window.BASE=${JSON.stringify(BASE)}</script><script src="${BASE}/search.js" defer></script>`));

write('merken/index.html', page('ISDE subsidie warmtepompen per merk', 'Alle warmtepompmerken op de ISDE-meldcodelijst van RVO.', 'merken/',
`<h1>Warmtepompen per merk</h1><ul class="cols">${brands.map(b => `<li><a href="${BASE}/merk/${slug(b)}/">${esc(b)}</a> <span class="muted">(${products.filter(p => p.brand === b).length})</span></li>`).join('')}</ul>`));
for (const b of brands) { const list = products.filter(p => p.brand === b);
  write(`merk/${slug(b)}/index.html`, page(`ISDE subsidie ${b} warmtepomp – meldcodes en bedragen`, `${list.length} ${b} warmtepompen op de ISDE-meldcodelijst, met meldcode en subsidiebedrag.`, `merk/${slug(b)}/`,
  `<h1>ISDE subsidie ${esc(b)}</h1><p>${list.length} modellen van ${esc(b)} staan op de ISDE-meldcodelijst.</p>${table(list)}${cta}`)); }
for (const p of products) {
  write(`warmtepomp/${p.slug}/index.html`, page(`ISDE subsidie ${p.brand} ${p.model} – meldcode ${p.code}`, `${p.brand} ${p.model} staat op de ISDE-meldcodelijst: meldcode ${p.code}, indicatief subsidiebedrag ${fmt(p.sub)}.`, `warmtepomp/${p.slug}/`,
  `<p class="crumbs"><a href="${BASE}/merk/${slug(p.brand)}/">${esc(p.brand)}</a> ›</p><h1>ISDE subsidie ${esc(p.brand)} ${esc(p.model)}</h1>
<p class="ok">✔ Staat op de ISDE-meldcodelijst warmtepompen</p>
<dl><dt>Meldcode</dt><dd><code>${esc(p.code)}</code></dd><dt>Indicatief subsidiebedrag</dt><dd>${fmt(p.sub)}</dd><dt>Bedrag 2e warmtepomp</dt><dd>${fmt(p.sub2)}</dd><dt>Vermogen</dt><dd>${p.kw ?? '–'} kW</dd><dt>Type</dt><dd>${esc(p.cat)}</dd><dt>Koudemiddel</dt><dd>${esc(p.gas)} (GWP ${esc(p.gwp)})</dd></dl>
<p>Vermeld de meldcode <code>${esc(p.code)}</code> in je ISDE-aanvraag bij RVO. Het bedrag is indicatief; RVO stelt de definitieve subsidie vast. <a href="${BASE}/subsidie-uitleg/">Hoe werkt de subsidie?</a></p>${cta}`)); }

write('subsidie-uitleg/index.html', page('Hoeveel ISDE subsidie krijg ik voor een warmtepomp? – uitleg', 'Uitleg over de ISDE-subsidie voor warmtepompen: voorwaarden, bedragen en hoe je aanvraagt.', 'subsidie-uitleg/',
`<h1>Hoeveel ISDE-subsidie krijg ik voor een warmtepomp?</h1>
<p>De Investeringssubsidie duurzame energie en energiebesparing (ISDE) wordt uitgevoerd door RVO. Voor een warmtepomp hangt het bedrag af van het <strong>type</strong> (lucht-water, grond-water, water-water, hybride) en het <strong>thermisch vermogen</strong>. Elk goedgekeurd apparaat heeft een vast, indicatief bedrag op de meldcodelijst – dat bedrag zie je op deze site per model.</p>
<h2>Belangrijkste voorwaarden (samengevat)</h2><ul>
<li>Lucht-water-, grond-water- of water-waterwarmtepomp; lucht-luchtwarmtepompen komen niet in aanmerking.</li>
<li>Minimaal energielabel A++ (sinds 1 januari 2024) en geregistreerd in EPREL (tot en met 70 kW).</li>
<li>Geïnstalleerd door een installatiebedrijf.</li>
<li>Staat het apparaat niet op de lijst, dan kun je soms toch aanvragen met productbeschrijving en technische documentatie, maar RVO kan dan afwijzen.</li></ul>
<h2>Zo vraag je aan</h2><ol><li>Zoek je warmtepomp op en noteer de meldcode.</li><li>Laat de warmtepomp installeren en bewaar factuur en betaalbewijs.</li><li>Vraag de subsidie aan via <a href="https://www.rvo.nl/subsidies-financiering/isde" rel="noopener">rvo.nl/isde</a> (let op de actuele aanvraagtermijn).</li></ol>
<p class="muted">Dit is een vereenvoudigde samenvatting. De regels kunnen wijzigen; de voorwaarden op rvo.nl en in de Staatscourant zijn leidend.</p>${cta}`));

write('disclosure/index.html', page('Over ISDE-checker en disclosure', 'Wie maakt deze site, waar komt de data vandaan en hoe verdienen we geld.', 'disclosure/',
`<h1>Over deze site &amp; disclosure</h1>
<p>ISDE-checker is een onafhankelijke hulpsite. We zijn <strong>niet</strong> verbonden aan RVO, de Rijksoverheid of een fabrikant.</p>
<h2>Data</h2><p>Alle productgegevens komen uit de openbare <a href="${RVO_LIST}" rel="noopener">ISDE Meldcodelijst Warmtepompen</a> van RVO, die RVO als open overheidsinformatie publiceert (hergebruik toegestaan, zie <a href="https://www.rvo.nl/onderwerpen/open-data" rel="noopener">RVO open data</a>). De lijst wordt wekelijks automatisch opnieuw opgehaald. Huidige versie: ${esc(monthName || src.url)} (opgehaald ${esc(src.fetched)}). Aan deze site kunnen geen rechten worden ontleend.</p>
<h2>Verdienmodel</h2><p>Op dit moment bevat de site geen affiliate-links of advertenties. In de toekomst kunnen we een vergoeding ontvangen als je via deze site offertes aanvraagt bij een partner. Dat melden we dan duidelijk bij de betreffende link; het heeft geen invloed op de getoonde gegevens.</p>
<h2>Privacy</h2><p>Deze site plaatst geen tracking-cookies en verzamelt geen persoonsgegevens.</p>`));

const urls = ['', 'merken/', 'subsidie-uitleg/', 'disclosure/', ...brands.map(b => `merk/${slug(b)}/`), ...products.map(p => `warmtepomp/${p.slug}/`)];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${SITE}/${u}</loc><lastmod>${src.fetched}</lastmod></url>`).join('')}</urlset>`);
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
write('404.html', page('Pagina niet gevonden – ISDE-checker', 'Pagina niet gevonden', '404.html', `<h1>Niet gevonden</h1><p><a href="${BASE}/">Terug naar zoeken</a></p>`));
console.log(`wrote ${urls.length} pages`);
