// ISDE-checker: search the meldcode list in the browser.
// products.json: { source, month, products: [[brand, model, meldcode, kW, subsidy, slug, category], ...] }
(async () => {
  const form = document.getElementById('zoek'), q = document.getElementById('q'), out = document.getElementById('results'), cnt = document.getElementById('count');
  if (!q || !out || !cnt) return;
  const B = window.BASE || '';
  const norm = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const slug = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'; // same as build.mjs
  const e = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nl = n => n.toLocaleString('nl-NL');
  const f = n => n == null ? '–' : '€ ' + nl(n);
  const coll = new Intl.Collator('nl', { numeric: true, sensitivity: 'base' });
  const narrow = matchMedia('(max-width: 40em)'), calm = matchMedia('(prefers-reduced-motion: reduce)');
  let P = null, idx = [], moved = false;

  // Same markup as the model tables that build.mjs writes.
  const row = p => `<tr><td class="m"><a href="${B}/warmtepomp/${p[5]}/"><span class="b">${e(p[0])}</span><span class="n">${e(p[1])}</span><span class="x">${e([p[6], p[3] ? nl(p[3]) + ' kW' : ''].filter(Boolean).join(', '))}</span></a></td><td class="c"><span class="plate">${e(p[2])}</span></td><td class="s">${f(p[4])}</td></tr>`;
  // No match: if a word is (part of) a brand name, link to that brand's page.
  const brandLinks = t => {
    const hit = new Map();
    for (const p of P) if (t.some(w => w.length > 1 && norm(p[0]).includes(w))) hit.set(p[0], (hit.get(p[0]) || 0) + 1);
    return [...hit].slice(0, 3).map(([b, n]) => `<li><a href="${B}/merk/${slug(b)}/">Alle ${nl(n)} ${n === 1 ? 'model' : 'modellen'} van ${e(b)}</a></li>`);
  };
  const keep = v => { try { history.replaceState(null, '', v ? '?q=' + encodeURIComponent(v) : location.pathname); } catch { /* rate limit: ignore */ } };

  function run() {
    const v = q.value.trim(), t = norm(v).split(' ').filter(Boolean);
    keep(v);
    if (!t.length) { cnt.textContent = ''; out.innerHTML = ''; return; }
    if (!P) { cnt.textContent = 'De lijst wordt geladen…'; return; }
    const r = [];
    for (let i = 0; i < P.length; i++) if (t.every(w => idx[i].includes(w))) r.push(P[i]);
    if (!r.length) {
      const brands = brandLinks(t);
      cnt.textContent = `Geen warmtepomp gevonden voor “${v}”.`;
      out.innerHTML = '<div class="nohit">' + (brands.length ? `<p>${brands.length === 1 ? 'Dit merk staat' : 'Deze merken staan'} wel op de lijst. RVO noemt vaak de typecode in plaats van de productnaam.</p><ul>${brands.join('')}</ul>` : '') +
        '<p>Controleer de schrijfwijze, of zoek op alleen het merk of een deel van de typecode.</p>' +
        `<p>Staat je warmtepomp niet op de lijst? In de <a href="${B}/subsidie-uitleg/">uitleg</a> lees je wat je dan kunt doen.</p></div>`;
      return;
    }
    r.sort((a, b) => coll.compare(a[0], b[0]) || coll.compare(a[1], b[1]));
    cnt.textContent = r.length === 1 ? '1 warmtepomp gevonden op de ISDE-lijst' : `${nl(r.length)} warmtepompen gevonden op de ISDE-lijst`;
    out.innerHTML = `<table class="list"><thead><tr><th scope="col">Merk en model</th><th scope="col">Meldcode</th><th scope="col">Subsidie</th></tr></thead><tbody>${r.slice(0, 100).map(row).join('')}</tbody></table>` +
      (r.length > 100 ? '<p class="note">Je ziet de eerste 100. Maak je zoekopdracht specifieker, bijvoorbeeld met een deel van de typecode.</p>' : '');
  }
  // On a phone, move the search box to the top once, so the results show above the keyboard.
  const reveal = () => { if (moved || !narrow.matches || !form) return; moved = true; form.scrollIntoView({ block: 'start', behavior: calm.matches ? 'auto' : 'smooth' }); };

  q.addEventListener('input', () => { run(); if (q.value.trim()) reveal(); });
  form?.addEventListener('submit', ev => { ev.preventDefault(); run(); if (narrow.matches) q.blur(); });
  document.querySelectorAll('[data-q]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); q.value = a.dataset.q; run(); reveal(); }));
  const u = new URLSearchParams(location.search).get('q'); if (u) q.value = u;
  run();
  try {
    const res = await fetch(B + '/products.json');
    if (!res.ok) throw new Error(res.status);
    P = (await res.json()).products;
  } catch {
    cnt.textContent = 'De lijst kon niet worden geladen.';
    out.innerHTML = `<div class="nohit"><p>Controleer je internetverbinding en laad de pagina opnieuw. Je kunt ook zoeken via de <a href="${B}/merken/">lijst per merk</a>.</p></div>`;
    return;
  }
  idx = P.map(p => norm(p[0] + ' ' + p[1] + ' ' + p[2]) + ' ' + norm(p[1]).replace(/ /g, ''));
  run();
  if (u && q.value.trim()) reveal();
})();
