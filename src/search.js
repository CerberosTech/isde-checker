// ISDE-checker: search the meldcode list in the browser.
// products.json: { source, month, products: [[brand, model, meldcode, kW, subsidy, slug, category], ...] }
// The page language (<html lang>) picks the texts and the links: Dutch pages at the root, English pages under /en/.
(async () => {
  const form = document.getElementById('zoek'), q = document.getElementById('q'), out = document.getElementById('results'), cnt = document.getElementById('count');
  if (!q || !out || !cnt) return;
  const B = window.BASE || '';
  const EN = document.documentElement.lang === 'en', tx = (nl, en) => EN ? en : nl;
  const R = EN ? { model: '/en/heat-pumps/', brand: '/en/brand/', explain: '/en/subsidy-explained/', brands: '/en/brands/' } : { model: '/warmtepomp/', brand: '/merk/', explain: '/subsidie-uitleg/', brands: '/merken/' };
  const CAT_EN = { 'Lucht-Water': 'Air-to-water', 'Grond-Water': 'Ground-to-water', 'Water-Water': 'Water-to-water', Warmtepompboiler: 'Heat pump water heater' }; // same as build.mjs
  const cat = c => EN ? CAT_EN[c] || c : c;
  const norm = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const slug = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'; // same as build.mjs
  const e = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nl = n => n.toLocaleString(EN ? 'en-GB' : 'nl-NL');
  const f = n => n == null ? '–' : EN ? '€' + nl(n) : '€ ' + nl(n);
  const coll = new Intl.Collator('nl', { numeric: true, sensitivity: 'base' });
  const narrow = matchMedia('(max-width: 40em)'), calm = matchMedia('(prefers-reduced-motion: reduce)');
  let P = null, idx = [], moved = false;

  // Same markup as the model tables that build.mjs writes.
  const row = p => `<tr><td class="m"><a href="${B}${R.model}${p[5]}/"><span class="b">${e(p[0])}</span><span class="n">${e(p[1])}</span><span class="x">${e([cat(p[6]), p[3] ? nl(p[3]) + ' kW' : ''].filter(Boolean).join(', '))}</span></a></td><td class="c"><span class="plate">${e(p[2])}</span></td><td class="s">${f(p[4])}</td></tr>`;
  // No match: if a word is (part of) a brand name, link to that brand's page.
  const brandLinks = t => {
    const hit = new Map();
    for (const p of P) if (t.some(w => w.length > 1 && norm(p[0]).includes(w))) hit.set(p[0], (hit.get(p[0]) || 0) + 1);
    return [...hit].slice(0, 3).map(([b, n]) => `<li><a href="${B}${R.brand}${slug(b)}/">${tx(`Alle ${nl(n)} ${n === 1 ? 'model' : 'modellen'} van ${e(b)}`, `All ${nl(n)} ${e(b)} ${n === 1 ? 'model' : 'models'}`)}</a></li>`);
  };
  const keep = v => { try { history.replaceState(null, '', v ? '?q=' + encodeURIComponent(v) : location.pathname); } catch { /* rate limit: ignore */ } };
  // GoatCounter: count a search (no search text is sent) once per query: on submit, on an example, for a ?q= link, or after a typing pause.
  // count.js loads async and can be blocked: wait for the page load if it is not there yet, and never let it break the search.
  let counted = '', pause;
  const gc = () => { try { window.goatcounter?.count?.({ path: 'search', event: true }); } catch { /* analytics unavailable: ignore */ } };
  const track = () => { const v = norm(q.value); clearTimeout(pause); if (!v || v === counted) return; counted = v;
    if (window.goatcounter?.count || document.readyState === 'complete') gc(); else addEventListener('load', gc, { once: true }); };

  function run() {
    const v = q.value.trim(), t = norm(v).split(' ').filter(Boolean);
    keep(v);
    if (!t.length) { cnt.textContent = ''; out.innerHTML = ''; return; }
    if (!P) { cnt.textContent = tx('De lijst wordt geladen…', 'Loading the list…'); return; }
    const r = [];
    for (let i = 0; i < P.length; i++) if (t.every(w => idx[i].includes(w))) r.push(P[i]);
    if (!r.length) {
      const brands = brandLinks(t);
      cnt.textContent = tx(`Geen warmtepomp gevonden voor “${v}”.`, `No heat pump found for “${v}”.`);
      out.innerHTML = '<div class="nohit">' + (brands.length ? `<p>${tx(`${brands.length === 1 ? 'Dit merk staat' : 'Deze merken staan'} wel op de lijst. RVO noemt vaak de typecode in plaats van de productnaam.`, `${brands.length === 1 ? 'This brand is' : 'These brands are'} on the list. RVO often gives the type code instead of the product name.`)}</p><ul>${brands.join('')}</ul>` : '') +
        `<p>${tx('Controleer de schrijfwijze, of zoek op alleen het merk of een deel van de typecode.', 'Check the spelling, or search for only the brand or part of the type code.')}</p>` +
        tx(`<p>Staat je warmtepomp niet op de lijst? In de <a href="${B}${R.explain}">uitleg</a> lees je wat je dan kunt doen.</p></div>`, `<p>Is your heat pump not on the list? The <a href="${B}${R.explain}">subsidy explanation</a> tells you what you can do then.</p></div>`);
      return;
    }
    r.sort((a, b) => coll.compare(a[0], b[0]) || coll.compare(a[1], b[1]));
    cnt.textContent = r.length === 1 ? tx('1 warmtepomp gevonden op de ISDE-lijst', '1 heat pump found on the ISDE list') : tx(`${nl(r.length)} warmtepompen gevonden op de ISDE-lijst`, `${nl(r.length)} heat pumps found on the ISDE list`);
    out.innerHTML = `<table class="list"><thead><tr><th scope="col">${tx('Merk en model', 'Brand and model')}</th><th scope="col">Meldcode</th><th scope="col">${tx('Subsidie', 'Subsidy')}</th></tr></thead><tbody>${r.slice(0, 100).map(row).join('')}</tbody></table>` +
      (r.length > 100 ? `<p class="note">${tx('Je ziet de eerste 100. Maak je zoekopdracht specifieker, bijvoorbeeld met een deel van de typecode.', 'You see the first 100. Make your search more specific, for example with part of the type code.')}</p>` : '');
  }
  // On a phone, move the search box to the top once, so the results show above the keyboard.
  const reveal = () => { if (moved || !narrow.matches || !form) return; moved = true; form.scrollIntoView({ block: 'start', behavior: calm.matches ? 'auto' : 'smooth' }); };

  q.addEventListener('input', () => { run(); if (q.value.trim()) reveal(); clearTimeout(pause); pause = setTimeout(track, 2000); });
  form?.addEventListener('submit', ev => { ev.preventDefault(); run(); track(); if (narrow.matches) q.blur(); });
  document.querySelectorAll('[data-q]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); q.value = a.dataset.q; run(); reveal(); track(); }));
  const u = new URLSearchParams(location.search).get('q'); if (u) { q.value = u; track(); }
  run();
  try {
    const res = await fetch(B + '/products.json');
    if (!res.ok) throw new Error(res.status);
    P = (await res.json()).products;
  } catch {
    cnt.textContent = tx('De lijst kon niet worden geladen.', 'The list could not be loaded.');
    out.innerHTML = `<div class="nohit"><p>${tx(`Controleer je internetverbinding en laad de pagina opnieuw. Je kunt ook zoeken via de <a href="${B}${R.brands}">lijst per merk</a>.`, `Check your internet connection and reload the page. You can also search the <a href="${B}${R.brands}">list by brand</a>.`)}</p></div>`;
    return;
  }
  idx = P.map(p => norm(p[0] + ' ' + p[1] + ' ' + p[2]) + ' ' + norm(p[1]).replace(/ /g, ''));
  run();
  if (u && q.value.trim()) reveal();
})();
