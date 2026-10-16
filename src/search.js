(async()=>{const q=document.getElementById('q'),out=document.getElementById('results'),cnt=document.getElementById('count');
const d=await (await fetch(BASE+'/products.json')).json();const P=d.products;
const norm=s=>String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const idx=P.map(p=>norm(p[0]+' '+p[1]+' '+p[2])+' '+norm(p[1]).replace(/ /g,''));
const e=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const f=n=>n==null?'–':'€\u00a0'+n.toLocaleString('nl-NL');
function run(){const t=norm(q.value).split(' ').filter(Boolean);if(!t.length){out.innerHTML='';cnt.textContent='';return}
const r=[];for(let i=0;i<P.length;i++)if(t.every(w=>idx[i].includes(w)))r.push(P[i]);
cnt.textContent=r.length?r.length+' resultaten op de ISDE-lijst':'';
out.innerHTML=r.length?'<table><thead><tr><th>Merk</th><th>Model</th><th>Meldcode</th><th>kW</th><th>Subsidie</th></tr></thead><tbody>'+r.slice(0,100).map(p=>`<tr><td>${e(p[0])}</td><td><a href="${BASE}/warmtepomp/${p[5]}/">${e(p[1])}</a></td><td><code>${e(p[2])}</code></td><td>${p[3]??''}</td><td>${f(p[4])}</td></tr>`).join('')+'</tbody></table>'+(r.length>100?'<p class="muted">Eerste 100 getoond, verfijn je zoekopdracht.</p>':'')
:'<p class="no">✘ Geen warmtepomp gevonden die hierop lijkt. Controleer de schrijfwijze of zoek op alleen het merk. Niet op de lijst? Je kunt soms toch aanvragen met technische documentatie – zie de <a href="'+BASE+'/subsidie-uitleg/">uitleg</a>.</p>'}
q.addEventListener('input',run);const u=new URLSearchParams(location.search).get('q');if(u){q.value=u;}run();})();
