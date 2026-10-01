// JSON to CSV — empty nested objects, formula guard (OWASP CSV Injection), UTF-8 BOM download
//
// Read:  src/components/tools/JsonToCsvTool.astro (extracts the real engine block between the
//        `engine:start` / `engine:end` markers and the 4-language labels),
//        src/content/tools/json-to-csv/{en,zh,ja,ko}.mdx
// Write: stdout only (test results); when python3 is installed, runs `python3 -c` with the CSV
//        on stdin (no files)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: an empty nested object keeps its column and is written as {} (it used to produce no
// column with flatten on); flatten on / off, union of keys, non-object items; RFC 4180 quoting;
// formula guard per the OWASP CSV Injection page — string values (and header names) that start
// with = + - @, Tab, CR, LF or the full-width ＝＋－＠ are counted, left unchanged with the guard
// off, prefixed with ' or a Tab and quoted with the guard on; JSON numbers, booleans and
// arrays / objects (JSON text) are never changed; the download gets a UTF-8 BOM (EF BB BF) when
// the option is on and the copy text never does; every output is read back with Python's csv
// module when available; the English page examples; 4-language labels share the same keys.
//
// Run: node scripts/test-json-to-csv.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToCsvTool.astro'), 'utf8');
const START = '/* ── engine:start ── */';
const END = '/* ── engine:end ── */';
const s = source.indexOf(START);
const e = source.indexOf(END);
if (s < 0 || e <= s) {
  console.error('FAIL: could not locate the engine block in JsonToCsvTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(s, e) + '\nreturn { toRows, buildCsv, withBom, FORMULA_START };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const x = JSON.stringify(expected);
  check(name, a === x, 'got ' + a + ', expected ' + x);
}
const conv = (data, opts = {}) => E.buildCsv(E.toRows(data, opts.flatten !== false), opts.del || ',', opts.header !== false, opts.guard || 'off');

// ---------- empty nested object ----------
eq('empty nested object keeps its column', conv([{ id: 1, meta: {} }]).csv, 'id,meta\n1,{}');
eq('empty object next to a filled one', conv([{ meta: {} }, { meta: { a: 1 } }]).csv, 'meta,meta.a\n{},\n,1');
eq('empty object deep inside', conv([{ a: { b: {} } }]).csv, 'a.b\n{}');
eq('flatten off writes JSON text', conv([{ meta: {}, user: { n: 'x' } }], { flatten: false }).csv, 'meta,user\n{},"{""n"":""x""}"');
eq('flatten on, nested', conv([{ id: 1, address: { city: 'NY', zip: '10001' } }]).csv, 'id,address.city,address.zip\n1,NY,10001');
eq('non-object items', conv([1, 'two', null]).csv, 'value\n1\ntwo\n');

// ---------- formula guard ----------
const risky = ['=1+1', '+81 3 1234 5678', '-x', '@SUM(A1)', '\tx', '\rx', '\nx', '＝1+1', '＋1', '－1', '＠a'];
for (const v of risky) {
  const label = JSON.stringify(v);
  eq('pattern matches ' + label, E.FORMULA_START.test(v), true);
  const off = conv([{ v }]);
  eq(label + ' counted with guard off', off.formulaCells, 1);
  check(label + ' unchanged with guard off', !off.csv.includes("'" + v) && off.csv.includes(v.replace(/"/g, '""')), off.csv);
  eq(label + ' quote guard', conv([{ v }], { guard: 'quote' }).csv, 'v\n"\'' + v + '"');
  eq(label + ' tab guard', conv([{ v }], { guard: 'tab' }).csv, 'v\n"\t' + v + '"');
}
for (const v of ['a=1', 'A-1', 'x@y.com', ' =1', '1-2']) {
  eq('not risky: ' + JSON.stringify(v), conv([{ v }], { guard: 'quote' }).csv, 'v\n' + v);
}
eq('numbers are not guarded', conv([{ n: -5, f: -0.5 }], { guard: 'quote' }), { csv: 'n,f\n-5,-0.5', formulaCells: 0 });
eq('booleans and arrays are not guarded', conv([{ b: true, a: ['=x'] }], { guard: 'quote' }).csv, 'b,a\ntrue,"[""=x""]"');
eq('header name is guarded too', conv([{ '=cmd': 1 }], { guard: 'quote' }), { csv: '"\'=cmd"\n1', formulaCells: 1 });
eq('count over many cells', conv([{ a: '=1', b: '+2' }, { a: 'ok', b: '@3' }]).formulaCells, 3);
eq('guard and quotes in the value', conv([{ v: '=HYPERLINK("http://x")' }], { guard: 'quote' }).csv, 'v\n"\'=HYPERLINK(""http://x"")"');
eq('OWASP example with tab guard', conv([{ v: '=1+2";=1+2' }], { guard: 'tab' }).csv, 'v\n"\t=1+2"";=1+2"');

// ---------- BOM ----------
eq('BOM on', [...Buffer.from(E.withBom('a,b', true), 'utf8').subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
eq('BOM off', E.withBom('a,b', false), 'a,b');
eq('BOM added once', E.withBom('\uFEFFa', true), '\uFEFFa');
check('copy button uses the text without BOM', /writeText\(text\)/.test(source) && !/writeText\(withBom/.test(source));
check('download uses withBom', /new Blob\(\[withBom\(/.test(source));

// ---------- page examples ----------
const page = readFileSync(join(root, 'src/content/tools/json-to-csv/en.mdx'), 'utf8');
eq('page example: arrays, missing keys and quotes',
  conv([{ id: 1, name: 'Ann', tags: ['a', 'b'], address: { city: 'Paris', geo: { lat: 48.85 } } }, { id: 2, name: 'Bo, Jr.', note: 'says "hi"' }]).csv,
  'id,name,tags,address.city,address.geo.lat,note\n1,Ann,"[""a"",""b""]",Paris,48.85,\n2,"Bo, Jr.",,,,"says ""hi"""');
eq('page example: semicolon', conv([{ sku: 'A-1', price: 9.5, active: true }, { sku: 'B-2', price: null }], { del: ';' }).csv, 'sku;price;active\nA-1;9.5;true\nB-2;;');
const ex = conv([{ name: 'Ann', comment: '=HYPERLINK("http://example.com","Click")' }], { guard: 'quote' }).csv;
check('page shows the formula guard example', page.includes(ex.split('\n')[1].replace(/"/g, '&quot;')) || page.includes(ex.split('\n')[1]), ex);
check('page no longer lists the empty-object limit', !page.includes('produces no column'));

// ---------- read back with Python's csv module ----------
const py = spawnSync('python3', ['-c', 'import csv,sys,json; print(json.dumps(list(csv.reader(sys.stdin.read().splitlines(True), delimiter=sys.argv[1]))))', ','], { input: '', encoding: 'utf8' });
if (py.status === 0) {
  const readBack = (text, del) => JSON.parse(spawnSync('python3', ['-c', 'import csv,sys,json,io; print(json.dumps(list(csv.reader(io.StringIO(sys.stdin.read(), newline=""), delimiter=sys.argv[1]))))', del], { input: text, encoding: 'utf8' }).stdout);
  for (const v of risky) {
    for (const guard of ['off', 'quote', 'tab']) {
      for (const del of [',', ';', '\t']) {
        const out = conv([{ v, n: 1 }], { guard, del }).csv;
        const rows = readBack(out, del);
        const want = guard === 'off' ? v : (guard === 'quote' ? "'" : '\t') + v;
        eq('python reads ' + JSON.stringify(v) + ' ' + guard + ' ' + JSON.stringify(del), rows[1], [want, '1']);
      }
    }
  }
} else {
  console.log('SKIP: python3 not available (CSV read-back)');
}

// ---------- labels ----------
const fm = source.slice(0, source.indexOf('---', 4));
const keysOf = (lang) => {
  const m = fm.match(new RegExp('\\n  ' + lang + ': \\{([\\s\\S]*?)\\n  \\},'));
  return m ? [...m[1].matchAll(/\n    (\w+):/g)].map((x) => x[1]).sort() : [];
};
const enKeys = keysOf('en');
for (const k of ['formula', 'guardOff', 'guardQuote', 'guardTab', 'bom', 'msgFormulaRisk', 'msgFormulaGuarded']) check('en label ' + k, enKeys.includes(k));
for (const lang of ['zh', 'ja', 'ko']) eq(lang + ' labels match en', keysOf(lang), enKeys);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
