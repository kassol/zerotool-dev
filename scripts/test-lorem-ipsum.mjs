// Lorem Ipsum Generator — sentence pool, classic paragraph and the numbers quoted in the guide
//
// Read:  src/components/tools/LoremIpsumTool.astro (SENTENCES, CLASSIC_START, the paragraph and
//        count rules); scripts/test-lorem-ipsum.fixtures.json (Latin of De finibus 1.32–33 from the
//        1914 Loeb edition and from The Latin Library, English letter frequencies from Norvig);
//        src/content/blog/lorem-ipsum-generator-guide/en.mdx (`lorem-*` annotations and tables)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the classic paragraph is the first five pool sentences joined (69 words, 445
// characters); paragraph size 3–6 sentences and the 1–20 count clamp with default 5 as written
// in the component; the guide's word mapping (each lorem word is in the classic paragraph, each
// Cicero word in the Loeb text), the 41 of 69 words found unchanged in sections 32–33, the
// edition spellings (eiusmodi / occaecati in Loeb, obcaecati in The Latin Library), the letter
// statistics table against the classic paragraph and Norvig's English counts, the pool figures
// (8–17 words per sentence, 26–89 words per paragraph, 104 distinct words in the 15 extra
// sentences, 20 of them in Cicero). The guide's Python block (`lorem-run-py`) runs when python3
// is installed and must print 69 and the 12-word sentence quoted below it.
//
// Run: node scripts/test-lorem-ipsum.mjs

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/LoremIpsumTool.astro'), 'utf8');
const fx = JSON.parse(readFileSync(join(root, 'scripts/test-lorem-ipsum.fixtures.json'), 'utf8'));
const guide = readFileSync(join(root, 'src/content/blog/lorem-ipsum-generator-guide/en.mdx'), 'utf8');
const body = guide.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

let passes = 0, failures = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}
const ann = (name) => [...guide.matchAll(new RegExp('\\{/\\* ' + name + ': (\\{.*?\\}) \\*/\\}', 'g'))].map((m) => JSON.parse(m[1]));
const tokens = (s) => s.toLowerCase().match(/[a-z]+/g) || [];

const poolBlock = source.match(/var SENTENCES = \[([\s\S]*?)\];/);
const SENTENCES = poolBlock ? [...poolBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
const CLASSIC = (source.match(/var CLASSIC_START = '([^']+)';/) || [])[1] || '';
check('sentence pool found', SENTENCES.length > 0, String(SENTENCES.length));
check('classic paragraph found', CLASSIC.length > 0);
check('classic paragraph = first five pool sentences', SENTENCES.slice(0, 5).join(' ') === CLASSIC);
check('paragraph uses 3–6 sentences', source.includes('var count = 3 + Math.floor(Math.random() * 4);'));
check('count clamped to 1–20, default 5', source.includes("Math.min(20, Math.max(1, parseInt(document.getElementById('li-count').value) || 5))"));
check('Copy All joins paragraphs with a blank line', source.includes("output.dataset.text = paragraphs.join('\\n\\n');"));

const loebSet = new Set(tokens(fx.loeb1914.text));
const llSet = new Set(tokens(fx.latinLibrary.text));
const classicWords = tokens(CLASSIC);

for (const c of ann('lorem-classic')) {
  check(`classic paragraph has ${c.words} words`, classicWords.length === c.words, String(classicWords.length));
  check(`classic paragraph has ${c.chars} characters`, CLASSIC.length === c.chars, String(CLASSIC.length));
  check(`classic paragraph has ${c.sentences} sentences`, CLASSIC.split(/(?<=\.)\s+/).length === c.sentences);
  check('tool writes "elit. Sed" where the canonical text has "elit, sed"', CLASSIC.includes('elit. Sed do eiusmod') && body.includes('"elit, sed"'));
}
for (const c of ann('lorem-stat')) {
  const verbatim = classicWords.filter((w) => loebSet.has(w)).length;
  check(`${c.verbatim} of ${c.words} classic words occur in sections 32–33`, verbatim === c.verbatim && classicWords.length === c.words, String(verbatim));
  check('guide states the counts', body.includes(`Of its ${c.words} words, ${c.verbatim} appear unchanged`));
}
const maps = ann('lorem-map');
check('guide has the word mapping', maps.length >= 15, String(maps.length));
for (const m of maps) {
  check(`lorem "${m.lorem}" is in the classic paragraph`, classicWords.includes(m.lorem));
  check(`Cicero "${m.cicero}" is in the Loeb text`, loebSet.has(m.cicero));
  check(`"${m.lorem}" is not itself in the Loeb text`, !loebSet.has(m.lorem));
  check(`mapping table row for ${m.lorem}`, new RegExp('\\|[^|\\n]*\\b' + m.lorem + '\\b[^|\\n]*\\|[^|\\n]*' + m.cicero.replace(/^do/, '(?:\\(do\\))?') + '\\b', 'i').test(body));
}
const pb = fx.loeb1914.pageBreak;
check('page break text matches the Loeb Latin', fx.loeb1914.text.includes(pb.endsWith.replace(/-$/, '') + 'lorem ipsum quia dolor sit amet, consectetur, adipisci'));
check('guide quotes the page break', body.includes(pb.endsWith) && body.includes(pb.nextStartsWith.replace(' adipisci', ' adipisci velit')));
for (const e of ann('lorem-ed')) {
  check(`${e.word} in Loeb = ${e.loeb}`, loebSet.has(e.word) === e.loeb);
  check(`${e.word} in The Latin Library = ${e.latinLibrary}`, llSet.has(e.word) === e.latinLibrary);
}
check('The Latin Library splits "eius modi"', fx.latinLibrary.text.includes('non numquam eius modi') && fx.loeb1914.text.includes('nonnumquam eiusmodi'));

for (const c of ann('lorem-letters')) {
  const letters = CLASSIC.toLowerCase().replace(/[^a-z]/g, '');
  const pct = (ch) => ((letters.split(ch).length - 1) / letters.length * 100).toFixed(1);
  const missing = 'abcdefghijklmnopqrstuvwxyz'.split('').filter((ch) => !letters.includes(ch)).join('');
  check(`letters missing from the classic paragraph: ${c.missing}`, missing === c.missing, missing);
  for (const ch of ['h', 'u', 'q', 'i']) {
    check(`classic ${ch} = ${c[ch]}%`, pct(ch) === c[ch], pct(ch));
    check(`guide row ${ch}: ${c[ch]}% vs English ${fx.english.percent[ch]}%`, new RegExp('\\| ' + ch + ' \\| ' + c[ch].replace('.', '\\.') + '% \\| ' + String(fx.english.percent[ch]).replace('.', '\\.') + '% \\|').test(body));
  }
  const avg = (classicWords.join('').length / classicWords.length).toFixed(2);
  check(`classic average word length ${c.avg}`, avg === c.avg, avg);
  check('guide shows English average 4.79', body.includes(`${c.avg} letters | ${fx.english.avgWordLength} letters`));
  const longest = classicWords.reduce((a, w) => (w.length > a.length ? w : a), '');
  check(`longest classic word ${c.longest}`, longest === c.longest && body.includes(`${longest.length} letters (*${longest}*)`), longest);
}
for (const c of ann('lorem-pool')) {
  const lens = SENTENCES.map((s) => tokens(s).length).sort((a, b) => a - b);
  check(`pool has ${c.sentences} sentences`, SENTENCES.length === c.sentences);
  check(`pool starts with the ${c.classic} classic sentences`, SENTENCES.slice(0, c.classic).join(' ') === CLASSIC);
  check(`sentences are ${c.minWords}–${c.maxWords} words`, lens[0] === c.minWords && lens[lens.length - 1] === c.maxWords, lens.join(','));
  const min = lens.slice(0, c.perParagraph[0]).reduce((a, b) => a + b, 0);
  const max = lens.slice(-c.perParagraph[1]).reduce((a, b) => a + b, 0);
  check(`paragraph is ${c.paraMin}–${c.paraMax} words`, min === c.paraMin && max === c.paraMax, `${min}–${max}`);
  const extra = new Set(SENTENCES.slice(c.classic).flatMap(tokens));
  const inCicero = [...extra].filter((w) => loebSet.has(w)).length;
  check(`extra sentences use ${c.extraDistinct} distinct words`, extra.size === c.extraDistinct, String(extra.size));
  check(`${c.extraInCicero} of them occur in sections 32–33`, inCicero === c.extraInCicero, String(inCicero));
  check('Pellentesque sentence quoted from the pool', SENTENCES.includes('Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas.') && body.includes('"Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas."'));
}

const py = guide.match(/\{\/\* lorem-run-py \*\/\}\s*```python\n([\s\S]*?)```/);
check('Python block found', !!py);
let havePy = true;
try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); } catch { havePy = false; }
if (py && havePy) {
  const out = execFileSync('python3', ['-c', py[1]], { encoding: 'utf8' }).trim().split('\n');
  check('Python block prints 69', out[0] === '69', out[0]);
  check('Python block prints the 12-word sentence', out[1] === 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor.', out[1]);
  check('guide quotes the Python output', body.includes('`' + out[1] + '`'));
} else if (!havePy) {
  console.log('SKIP Python block (python3 not installed)');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
