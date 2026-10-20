#!/usr/bin/env node
// Every generated HTML page has the sister-tools footer: one heading and exactly four plain links, once each.
// Run after `node build.mjs`. No dependencies.
import fs from 'node:fs';
import path from 'node:path';

const NL = [
  ['https://cerberostech.github.io/stroomprijs/', 'Stroomprijs vandaag per uur'],
  ['https://cerberostech.github.io/belastingcalculator/', 'Belastingcalculator 2026'],
  ['https://cerberostech.github.io/woningmarkt/', 'Woningmarkt NL'],
  ['https://cerberostech.github.io/deadorsupported/', 'DeadOrSupported: wanneer stopt de support van je apparaat'],
];
const EN = [
  ['https://cerberostech.github.io/stroomprijs/en/', 'Dutch electricity price today (hourly)'],
  ['https://cerberostech.github.io/belastingcalculator/en/', 'Dutch tax calculator 2026'],
  ['https://cerberostech.github.io/woningmarkt/en/', 'Dutch housing market: house prices, map and mortgage'],
  ['https://cerberostech.github.io/deadorsupported/', 'DeadOrSupported: device support end dates'],
];
const HEAD = { nl: 'Meer gratis tools van CerberosTech', en: 'More free tools from CerberosTech' };
const SHARED = 'https://cerberostech.github.io/deadorsupported/';
const count = (hay, needle) => hay.split(needle).length - 1;
const walk = (dir, acc = []) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
};

if (!fs.existsSync('dist')) {
  console.error('dist/ is missing; run node build.mjs first');
  process.exit(1);
}
const html = walk('dist').filter(file => file.endsWith('.html'));
const problems = [];
let ok = 0;
const byLang = {};
for (const file of html) {
  const text = fs.readFileSync(file, 'utf8');
  const lang = (text.match(/<html lang="([^"]+)"/) || [])[1];
  if (!lang) continue; // verification files are not generated pages
  byLang[lang] = (byLang[lang] || 0) + 1;
  if (lang !== 'nl' && lang !== 'en') {
    problems.push(`${file}: unexpected lang ${lang}`);
    continue;
  }
  const links = lang === 'en' ? EN : NL;
  const other = (lang === 'en' ? NL : EN).filter(([url]) => url !== SHARED);
  const hrefCounts = links.map(([url]) => count(text, `href="${url}"`));
  const labelCounts = links.map(([, label]) => count(text, label));
  const heading = count(text, HEAD[lang]);
  const otherHrefs = other.map(([url]) => count(text, `href="${url}"`));
  const badTags = [...text.matchAll(/<a\b[^>]*href="https:\/\/cerberostech\.github\.io\/(?:stroomprijs|belastingcalculator|woningmarkt|deadorsupported)[^"]*"[^>]*>/g)]
    .map(match => match[0])
    .filter(tag => /\srel=/.test(tag) || /[?&]/.test(tag));
  const good = hrefCounts.every(n => n === 1) && labelCounts.every(n => n === 1) && heading === 1 && otherHrefs.every(n => n === 0) && badTags.length === 0;
  if (good) ok += 1;
  else problems.push(`${file}: hrefs=${hrefCounts.join(',')} labels=${labelCounts.join(',')} heading=${heading} other=${otherHrefs.join(',')} badTags=${badTags.length}`);
}

const pages = (byLang.nl || 0) + (byLang.en || 0);
console.log(`html pages: ${pages} (nl ${byLang.nl || 0}, en ${byLang.en || 0})`);
console.log(`pages with all 4 links exactly once: ${ok}`);
if (!pages || ok !== pages || problems.length) {
  for (const problem of problems.slice(0, 30)) console.error(problem);
  process.exit(1);
}
