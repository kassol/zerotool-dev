// JSON ↔ XML Converter — JSON → XML output and element names
//
// Read:  src/components/tools/JsonXmlConverterTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers)
// Write: a temporary file under os.tmpdir() when xmllint is available (removed); stdout
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the examples on the en tool page (simple object, nested object with an array of
// objects and null, top-level array as <item>, array of strings, compact output); key names
// that are not valid XML names. Before the fix a key or root name starting with a digit, '-'
// or '.' was written as is (<2026>, <123_data>), which is not well-formed XML (XML 1.0 §2.3:
// a name must start with a letter, '_' or ':'); it now gets a '_' prefix. 2,000 random objects
// produce only tag names matching NameStartChar NameChar*. When xmllint is installed, the page
// examples and 200 random outputs are also checked with `xmllint --noout`; otherwise SKIP.
// XML → JSON uses the browser's DOMParser and is not tested here.
//
// Run: node scripts/test-json-xml-converter.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonXmlConverterTool.astro'), 'utf8');
const a = source.indexOf('/* ── engine:start ── */');
const b = source.indexOf('/* ── engine:end ── */');
if (a < 0 || b <= a) { console.error('FAIL: engine block not found'); process.exit(1); }
const E = new Function(source.slice(a, b) + '\nreturn { buildXml, xmlName };')();

let passes = 0, failures = 0;
function eq(name, got, want) {
  if (got === want) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + '\n  got:      ' + JSON.stringify(got) + '\n  expected: ' + JSON.stringify(want)); }
}
const D = '<?xml version="1.0" encoding="UTF-8"?>\n';
const x = (j, pretty = true, rootName = 'root') => E.buildXml(JSON.parse(j), rootName, pretty);

const pageCases = [
  ['simple object', '{"name": "Alice", "age": 30, "active": true}',
    D + '<root>\n  <name>Alice</name>\n  <age>30</age>\n  <active>true</active>\n</root>'],
  ['nested object', '{"server": {"host": "localhost", "port": 8080}}',
    D + '<root>\n  <server>\n    <host>localhost</host>\n    <port>8080</port>\n  </server>\n</root>'],
  ['array of strings', '{"tags": ["js", "xml", "api"]}',
    D + '<root>\n  <tags>js</tags>\n  <tags>xml</tags>\n  <tags>api</tags>\n</root>'],
  ['order with items and null', '{"order":{"id":1001,"items":[{"sku":"A-1","qty":2},{"sku":"B-7","qty":1}],"note":null}}',
    D + '<root>\n  <order>\n    <id>1001</id>\n    <items>\n      <sku>A-1</sku>\n      <qty>2</qty>\n    </items>\n    <items>\n      <sku>B-7</sku>\n      <qty>1</qty>\n    </items>\n    <note></note>\n  </order>\n</root>'],
  ['top-level array uses item', '[{"id":1},{"id":2}]',
    D + '<root>\n  <item>\n    <id>1</id>\n  </item>\n  <item>\n    <id>2</id>\n  </item>\n</root>'],
  ['key names fixed and text escaped', '{"2026":"q","first name":"Ann","a&b":"x<y"}',
    D + '<root>\n  <_2026>q</_2026>\n  <first_name>Ann</first_name>\n  <a_b>x&lt;y</a_b>\n</root>'],
];
for (const [name, j, want] of pageCases) eq(name, x(j), want);
eq('compact output', x('{"a":1}', false, '123 data'), '<?xml version="1.0" encoding="UTF-8"?><_123_data><a>1</a></_123_data>');
eq('root name default', x('{"a":1}', false, '   '), '<?xml version="1.0" encoding="UTF-8"?><root><a>1</a></root>');
for (const [k, want] of [['-x', '_-x'], ['.x', '_.x'], ['9', '_9'], ['', '_key'], ['ok', 'ok'], ['_ok', '_ok'], ['名前', '__']]) eq('xmlName ' + JSON.stringify(k), E.xmlName(k), want);

// Random keys: every tag name must be a valid (ASCII) XML name
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const alphabet = 'aZ09_-.: &<>"\'é名1';
const randKey = () => { let s = ''; const n = Math.floor(rnd() * 5); for (let i = 0; i < n; i++) s += alphabet[Math.floor(rnd() * alphabet.length)]; return s; };
const randVal = (d) => {
  const r = rnd();
  if (d > 2 || r < 0.4) return r < 0.1 ? null : r < 0.2 ? 42 : 'v<&>' + randKey();
  if (r < 0.7) { const o = {}; for (let i = 0; i < 3; i++) o[randKey()] = randVal(d + 1); return o; }
  return [randVal(d + 1), randVal(d + 1)];
};
const NAME = /^[A-Za-z_:][A-Za-z0-9_:.\-]*$/;
let bad = 0;
const samples = [];
for (let i = 0; i < 2000; i++) {
  const v = {}; v[randKey()] = randVal(0); v[randKey()] = randVal(0);
  const out = E.buildXml(v, randKey(), rnd() < 0.5);
  if (i < 200) samples.push(out);
  for (const m of out.matchAll(/<\/?([^\s>?/]+)/g)) if (!NAME.test(m[1])) { bad++; if (bad < 4) console.log('  bad name: ' + m[1]); }
}
eq('2,000 random objects: all tag names are valid XML names', bad, 0);

let hasXmllint = true;
try { execFileSync('xmllint', ['--version'], { stdio: 'ignore' }); } catch { hasXmllint = false; }
if (!hasXmllint) {
  console.log('SKIP xmllint well-formedness (xmllint not installed)');
} else {
  const dir = mkdtempSync(join(tmpdir(), 'jx-test-'));
  try {
    const all = pageCases.map((c) => x(c[1])).concat(samples);
    let ok = 0;
    all.forEach((xml, i) => {
      const f = join(dir, i + '.xml');
      writeFileSync(f, xml);
      try { execFileSync('xmllint', ['--noout', f], { stdio: 'pipe' }); ok++; } catch (e) { console.log('  not well-formed:\n' + xml.slice(0, 300)); }
    });
    eq('xmllint accepts page examples and 200 random outputs', ok, all.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
