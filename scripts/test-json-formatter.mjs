// JSON Formatter — parser, JSON5 conversion, serializer, notes, file decoding, page examples
//
// Read:  src/components/tools/json-formatter-engine.js (the real `engine:start` / `engine:end`
//        block); json-formatter-run.js and json-formatter.worker.js (the worker runner, client
//        and entry, run here); JsonFormatterTool.astro (the frontmatter STRINGS and the page
//        script); the engine block of
//        JsonSchemaValidatorTool.astro (jsonSyntaxError and lineCol are copied from it and must
//        stay identical); scripts/test-json-formatter.fixtures.json (JSONTestSuite and json5
//        2.2.3 results, written by gen-json-formatter-fixtures.mjs);
//        src/content/tools/json-formatter/*.mdx (`{/* jf: … */}` annotations); src/data/persistence.ts
// Write: stdout only; the jq and Python comparisons pipe text through child processes.
// Exit:  0 if all PASS, 1 if any FAIL
//
// Sources of expected values: JSON.parse / JSON.stringify (the RFC 8259 reference in every
// browser) for random documents; JSONTestSuite y_ / n_ files (accept / reject); json5 2.2.3 for
// JSON5 input; jq 1.7.1 (`jq .`, `-c`, `-S`, `--tab`, `--indent 4`) and Python 3.12
// `python3 -m json.tool` when those exact versions are installed (other versions: SKIP).
//
// Run: node scripts/test-json-formatter.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// Timing limits catch order-of-magnitude regressions; CI runners are several times slower than a dev machine.
const PERF_SLACK = process.env.CI ? 4 : 1;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonFormatterTool.astro'), 'utf8');
function block(src, name) {
  const s = src.indexOf('/* ── engine:start ── */');
  const e = src.indexOf('/* ── engine:end ── */');
  if (s < 0 || e <= s) { console.error('FAIL: engine block not found in ' + name); process.exit(1); }
  return src.slice(s, e);
}
const engine = block(readFileSync(join(root, 'src/components/tools/json-formatter-engine.js'), 'utf8'), 'json-formatter-engine.js');
const E = new Function(engine + `
return { fmt, escSeg, pointerOf, jqPathOf, lineCol, jsonSyntaxError, parseJson, decCanon, numberChange, analyze, innerJson, hintFor,
  cmpCodePoint, orderOf, quote, numberOut, scalarOut, serialize, highlight, codeFrame, firstBadUtf8, decodeBytes, kindOf, childrenOf };`)();
const jsvEngine = block(readFileSync(join(root, 'src/components/tools/JsonSchemaValidatorTool.astro'), 'utf8'), 'json-schema-validator');
const runSource = readFileSync(join(root, 'src/components/tools/json-formatter-run.js'), 'utf8');
const fixtures = JSON.parse(readFileSync(join(root, 'scripts/test-json-formatter.fixtures.json'), 'utf8'));

let failures = 0, passes = 0, skips = 0;
function check(name, ok, detail) { if (ok) passes++; else { failures++; console.log('FAIL: ' + name + (detail === undefined ? '' : ' — ' + detail)); } }
function eq(name, got, want) { const a = JSON.stringify(got), b = JSON.stringify(want); check(name, a === b, 'got ' + a + ', want ' + b); }
function skip(name, why) { skips++; console.log('SKIP: ' + name + ' — ' + why); }

// Deterministic PRNG (mulberry32)
let seed = 20261002;
function rnd() { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ri = (n) => Math.floor(rnd() * n);

const OPT = (o) => Object.assign({ indent: '  ', sortKeys: false, ascii: false, numbers: 'raw', dupes: 'keep' }, o);
const fmtOut = (text, o, a) => { const r = E.analyze(text, a || {}); if (!r.ok) throw new Error('not ok: ' + JSON.stringify(r.error || r)); return E.serialize(r.root, OPT(o)); };

// ---------- 1. functions copied from the JSON Schema Validator ----------
function extractDecl(src, name) {
  const re = new RegExp('(^|\\n)([ \\t]*)function ' + name + '\\(');
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index + m[1].length;
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}
for (const name of ['jsonSyntaxError', 'lineCol']) {
  const a = extractDecl(engine, name), b = extractDecl(jsvEngine, name);
  check('copy: ' + name + ' found in both files', a !== null && b !== null);
  check('copy: ' + name + ' is identical to json-schema-validator', a !== null && a === b);
}

// ---------- 2. JSONTestSuite ----------
function suiteBytes(f) {
  if (f.generated) return new Uint8Array(Buffer.from(f.generated.repeat.repeat(f.generated.times) + f.generated.tail));
  return new Uint8Array(Buffer.from(f.base64, 'base64'));
}
function pipeline(u8, json5) {
  const d = E.decodeBytes(u8);
  if (d.error) return { ok: false, decode: d };
  const r = E.analyze(d.text, { json5: !!json5 });
  r.decoded = d;
  return r;
}
const suite = fixtures.jsonTestSuite.files;
const names = Object.keys(suite);
check('JSONTestSuite: 318 files (95 y_, 188 n_, 35 i_)', names.length === 318 && names.filter((n) => n.startsWith('y_')).length === 95 && names.filter((n) => n.startsWith('n_')).length === 188);
// i_ files: what this tool does with each (implementation-defined in RFC 8259).
const I_EXPECT = {
  i_number_double_huge_neg_exp: 'ok', i_number_huge_exp: 'ok', i_number_neg_int_huge_exp: 'ok', i_number_pos_double_huge_exp: 'ok',
  i_number_real_neg_overflow: 'ok', i_number_real_pos_overflow: 'ok', i_number_real_underflow: 'ok', i_number_too_big_neg_int: 'ok',
  i_number_too_big_pos_int: 'ok', i_number_very_big_negative_int: 'ok',
  i_object_key_lone_2nd_surrogate: 'ok', i_string_1st_surrogate_but_2nd_missing: 'ok', i_string_1st_valid_surrogate_2nd_invalid: 'ok',
  i_string_incomplete_surrogate_and_escape_valid: 'ok', i_string_incomplete_surrogate_pair: 'ok', i_string_incomplete_surrogates_escape_valid: 'ok',
  i_string_invalid_lonely_surrogate: 'ok', i_string_invalid_surrogate: 'ok', 'i_string_inverted_surrogates_U+1D11E': 'ok', i_string_lone_second_surrogate: 'ok',
  'i_string_UTF-16LE_with_BOM': 'ok', 'i_structure_UTF-8_BOM_empty_object': 'ok', i_structure_500_nested_arrays: 'ok',
  'i_string_UTF-8_invalid_sequence': 'notUtf8', 'i_string_UTF8_surrogate_U+D800': 'notUtf8', 'i_string_invalid_utf-8': 'notUtf8',
  i_string_iso_latin_1: 'notUtf8', i_string_lone_utf8_continuation_byte: 'notUtf8', i_string_not_in_unicode_range: 'notUtf8',
  i_string_overlong_sequence_2_bytes: 'notUtf8', i_string_overlong_sequence_6_bytes: 'notUtf8', i_string_overlong_sequence_6_bytes_null: 'notUtf8',
  'i_string_truncated-utf-8': 'notUtf8', i_string_utf16BE_no_BOM: 'utf16NoBom', i_string_utf16LE_no_BOM: 'utf16NoBom',
};
let yOk = 0, nRej = 0, iOk = 0, iTotal = 0, agreeNative = 0, nativeTotal = 0, rtOk = 0, rtTotal = 0;
const iBad = [], yBad = [], nBad = [], nativeBad = [], rtBad = [];
for (const name of names) {
  const u8 = suiteBytes(suite[name]);
  const r = pipeline(u8);
  const kind = name.slice(0, 2);
  if (kind === 'y_') { if (r.ok) yOk++; else yBad.push(name); }
  if (kind === 'n_') { if (!r.ok) nRej++; else nBad.push(name); }
  if (kind === 'i_') {
    iTotal++;
    const want = I_EXPECT[name.replace(/\.json$/, '')];
    const got = r.ok ? 'ok' : r.decode ? r.decode.error : 'reject';
    if (want === got) iOk++; else iBad.push(name + ' ' + got + ' (want ' + want + ')');
  }
  // The parser accepts exactly what JSON.parse accepts (after UTF-8 decoding; a BOM is removed first).
  if (!r.decode) {
    nativeTotal++;
    let native = true;
    try { JSON.parse(r.decoded.text.replace(/^\ufeff/, '')); } catch (e) { native = false; }
    if (native === !!r.ok) agreeNative++; else nativeBad.push(name);
    if (r.ok) {
      // With numbers as JavaScript reads them and the last duplicate kept, the output equals
      // JSON.stringify(JSON.parse(text)) — except numbers JSON.stringify turns into null.
      rtTotal++;
      const hasOverflow = r.numbers.some((x) => x.kind === 'overflow');
      const want = JSON.stringify(JSON.parse(r.decoded.text.replace(/^\ufeff/, '')));
      const got = E.serialize(r.root, OPT({ indent: '', numbers: 'js', dupes: 'last' }));
      if (hasOverflow || got === want) rtOk++; else rtBad.push(name);
    }
  }
}
check('JSONTestSuite: all 95 y_ files are accepted', yOk === 95, yBad.join(', '));
check('JSONTestSuite: all 188 n_ files are rejected', nRej === 188, nBad.join(', '));
check('JSONTestSuite: all 35 i_ files behave as documented', iOk === iTotal && iTotal === 35, iBad.join('; '));
check('JSONTestSuite: acceptance equals JSON.parse on every decodable file (' + nativeTotal + ')', agreeNative === nativeTotal, nativeBad.join(', '));
check('JSONTestSuite: minified output (JS numbers, last duplicate) equals JSON.stringify(JSON.parse()) (' + rtTotal + ' files)', rtOk === rtTotal, rtBad.join(', '));
{
  const r = pipeline(suiteBytes(suite['n_structure_100000_opening_arrays.json']));
  check('100,000 unclosed [ : rejected without a stack overflow', !r.ok && r.error.code !== undefined);
  const deep = '['.repeat(100000) + ']'.repeat(100000);
  const d = E.analyze(deep, {});
  check('100,000 nested arrays: parsed (iterative parser)', d.ok && d.stats.depth === 100000);
  check('100,000 nested arrays: minified output equals the input', d.ok && E.serialize(d.root, OPT({ indent: '' })) === deep);
  const d3 = E.analyze('['.repeat(3000) + ']'.repeat(3000), {});
  const pretty = E.serialize(d3.root, OPT({ indent: ' ' }));
  check('3,000 nested arrays: pretty output has 5,999 lines and parses back', pretty.split('\n').length === 5999 && E.parseJson(pretty, false).ok);
}

// ---------- 3. random documents vs JSON.parse / JSON.stringify ----------
const STR_POOL = ['', 'a', 'key', 'Hello, World', '名前', 'こんにちは', '한국어', 'é', 'e\u0301', '😀', '👨‍👩‍👧', '\u2028', '\u2029', '\u007f', '\u0000', '\u001f', '\b\f\n\r\t', '"quoted"', 'back\\slash', '</script>', '\ue000', '\uffff', '__proto__', 'constructor', 'a/b~c', ' '];
function randStr() {
  let s = '';
  const n = ri(4);
  for (let i = 0; i < n; i++) s += pick(STR_POOL);
  return s;
}
function encStr(s) {
  // Write a string with random (valid) escapes
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"' || ch === '\\' || c < 0x20) { out += JSON.stringify(ch).slice(1, -1); continue; }
    const r = rnd();
    if (r < 0.15) {
      if (c > 0xffff) { const hi = 0xd800 + ((c - 0x10000) >> 10), lo = 0xdc00 + ((c - 0x10000) & 0x3ff); out += '\\u' + hi.toString(16) + '\\u' + lo.toString(16).toUpperCase(); }
      else out += '\\u' + c.toString(16).padStart(4, '0');
    } else if (r < 0.2 && ch === '/') out += '\\/';
    else out += ch;
  }
  return out + '"';
}
const NUM_POOL = ['0', '-0', '1', '-1', '42', '1.0', '0.10', '3.14159', '1e2', '1E+2', '1.5e-7', '-2.5E-3', '9007199254740991', '9007199254740993',
  '12345678901234567890', '-98765432109876543210', '0.1', '1e-400', '1e400', '-1e400', '3.141592653589793238', '100000000000000000000000000001.5',
  '123456789', '0.000001', '1e21', '1e-7', '5e-324', '1.7976931348623157e308'];
function randNum(intOnly, noExp) {
  if (intOnly) return pick(['0', '-1', '42', String(ri(1e9)), '9007199254740993', '12345678901234567890', '-98765432109876543210', '100']);
  const pool = noExp ? NUM_POOL.filter((x) => !/[eE]/.test(x)) : NUM_POOL;
  return pick(pool);
}
function randDoc(depth, cfg) {
  const r = rnd();
  const ws = () => (cfg.ws ? pick(['', ' ', '\n', '\t', '\r\n', '  ']) : '');
  if (depth > 4 || r < 0.35) {
    const s = rnd();
    if (s < 0.4) return encStr(cfg.str ? cfg.str() : randStr());
    if (s < 0.75) return randNum(cfg.intOnly, cfg.noExp);
    return pick(['true', 'false', 'null']);
  }
  if (r < 0.65) {
    const n = ri(5), parts = [];
    for (let i = 0; i < n; i++) parts.push(ws() + randDoc(depth + 1, cfg) + ws());
    return '[' + parts.join(',') + ws() + ']';
  }
  const n = ri(5), parts = [], keys = [];
  for (let i = 0; i < n; i++) {
    let k = cfg.str ? cfg.str() : randStr();
    if (cfg.dups && keys.length && rnd() < 0.25) k = pick(keys);
    keys.push(k);
    parts.push(ws() + encStr(k) + ws() + ':' + ws() + randDoc(depth + 1, cfg) + ws());
  }
  return '{' + parts.join(',') + ws() + '}';
}
{
  let ok = 0, total = 0, bad = '';
  for (let t = 0; t < 3000; t++) {
    const text = randDoc(0, { ws: true, dups: true });
    const r = E.analyze(text, {});
    if (!r.ok) { bad = bad || text; total++; continue; }
    if (r.numbers.some((x) => x.kind === 'overflow')) continue;
    const v = JSON.parse(text);
    for (const [ind, nat] of [['  ', 2], ['    ', 4], ['\t', '\t'], ['', undefined]]) {
      total++;
      const got = E.serialize(r.root, OPT({ indent: ind, numbers: 'js', dupes: 'last' }));
      const want = JSON.stringify(v, null, nat);
      if (got === want) ok++; else if (!bad) bad = JSON.stringify(text) + ' indent ' + JSON.stringify(ind) + ': ' + got + ' vs ' + want;
    }
  }
  check('random documents: output (JS numbers, last duplicate, 2 / 4 / Tab / minified) equals JSON.stringify(JSON.parse(), null, n) (' + total + ')', ok === total, bad);
}
{
  // Keep-as-written mode: idempotent, number lexemes untouched, duplicates kept.
  let ok = 0, total = 0, bad = '';
  const numTokens = (s) => { const r = E.analyze(s, {}); const out = []; const walk = (v) => { if (v && typeof v === 'object') { if (v.t === 'n') out.push(v.r); else v.v.forEach(walk); } }; walk(r.root); return out; };
  for (let t = 0; t < 1500; t++) {
    const text = randDoc(0, { ws: true, dups: true });
    const r = E.analyze(text, {});
    total++;
    const once = E.serialize(r.root, OPT({ indent: '  ' }));
    const r2 = E.analyze(once, {});
    const twice = r2.ok ? E.serialize(r2.root, OPT({ indent: '  ' })) : null;
    const sameNums = JSON.stringify(numTokens(text)) === JSON.stringify(numTokens(once));
    const keysKept = r.stats.keys === r2.stats.keys;
    if (twice === once && sameNums && keysKept) ok++; else if (!bad) bad = text;
  }
  check('random documents (keep as written): idempotent, number literals unchanged, every key kept (' + total + ')', ok === total, bad);
}
{
  // The strict parser accepts exactly what JSON.parse accepts; on rejection jsonSyntaxError names an error.
  let agree = 0, total = 0, named = 0, rejected = 0, bad = '';
  const MUT = ['', ',', ':', '"', "'", '{', '}', '[', ']', '\\', '0', '-', '.', 'e', '+', ' ', '\n', '\u0000', '\u001f', '\ufeff', '\u00a0', '\u3000', 'x', 'tru', '/', '/*', '//', '\ud800', '01', 'NaN'];
  for (let t = 0; t < 3000; t++) {
    let text = randDoc(0, { ws: true, dups: true });
    const k = 1 + ri(2);
    for (let m = 0; m < k; m++) {
      const p = ri(text.length + 1), op = rnd();
      if (op < 0.4) text = text.slice(0, p) + pick(MUT) + text.slice(p);
      else if (op < 0.8) text = text.slice(0, p) + text.slice(p + 1);
      else text = text.slice(0, p) + pick(MUT) + text.slice(p + 1);
    }
    total++;
    let native = true;
    try { JSON.parse(text); } catch (e) { native = false; }
    const mine = E.parseJson(text, false).ok;
    if (native === mine) agree++; else if (!bad) bad = JSON.stringify(text) + ' JSON.parse ' + native + ' parser ' + mine;
    if (!mine) { rejected++; if (E.jsonSyntaxError(text)) named++; }
  }
  check('3,000 mutated texts: strict parser agrees with JSON.parse', agree === total, bad);
  check('3,000 mutated texts: every rejected text gets a named error from jsonSyntaxError (' + rejected + ')', named === rejected);
}

// ---------- 4. numbers ----------
eq('numberChange: 9007199254740993 → precision', E.numberChange('9007199254740993'), { kind: 'precision', js: '9007199254740992' });
eq('numberChange: 12345678901234567890 → precision', E.numberChange('12345678901234567890'), { kind: 'precision', js: '12345678901234567000' });
eq('numberChange: 1e400 → overflow (JSON.stringify writes null)', E.numberChange('1e400'), { kind: 'overflow', js: 'null' });
eq('numberChange: 1e-400 → underflow', E.numberChange('1e-400'), { kind: 'underflow', js: '0' });
eq('numberChange: -0 and -0.0 → negZero', [E.numberChange('-0'), E.numberChange('-0.0')], [{ kind: 'negZero', js: '0' }, { kind: 'negZero', js: '0' }]);
eq('numberChange: spelling only (1.0, 1e2, 0.10, 1E+2, 1.50e1) → null', ['1.0', '1e2', '0.10', '1E+2', '1.50e1', '0.1', '5e-324', '100'].map(E.numberChange), [null, null, null, null, null, null, null, null]);
eq('numberChange: 3.141592653589793238 → precision', E.numberChange('3.141592653589793238').kind, 'precision');
eq('decCanon', ['1.50e1', '15', '0.000', '-0', '1200', '0.0012'].map(E.decCanon), ['15e0', '15e0', '0', '-0', '12e2', '12e-4']);
{
  const r = E.analyze('{"id":1830000000000000001,"price":19.90,"big":1e400,"z":-0}', {});
  eq('analyze: numbers that change are listed with kind and path', r.numbers.map((x) => [x.raw, x.kind, E.pointerOf(x.path)]), [['1830000000000000001', 'precision', '/id'], ['1e400', 'overflow', '/big'], ['-0', 'negZero', '/z']]);
  eq('keep as written: literals unchanged', E.serialize(r.root, OPT({ indent: '' })), '{"id":1830000000000000001,"price":19.90,"big":1e400,"z":-0}');
  eq('as JavaScript reads them: like JSON.stringify, but 1e400 stays (JSON.stringify would write null)', E.serialize(r.root, OPT({ indent: '', numbers: 'js' })), '{"id":1830000000000000000,"price":19.9,"big":1e400,"z":0}');
}

// ---------- 5. strings, keys, options ----------
eq('escaping matches JSON.stringify (well-formed: lone surrogates as \\udxxx)', E.quote('a"\\\b\f\n\r\t\u0000\u001f\u007f\u2028😀\ud800\udfff', false), JSON.stringify('a"\\\b\f\n\r\t\u0000\u001f\u007f\u2028😀\ud800\udfff'));
eq('ASCII only: lowercase \\uXXXX, astral as a surrogate pair, DEL escaped (Python ensure_ascii)', E.quote('é😀\u007f~', true), '"\\u00e9\\ud83d\\ude00\\u007f~"');
{
  const keys = ['b', 'a', 'Z', 'é', '\ue000', '😀', '', 'aa', 'a\u0000'];
  const want = [...keys].sort((x, y) => { const a = [...x].map((c) => c.codePointAt(0)), b = [...y].map((c) => c.codePointAt(0)); for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; });
  eq('cmpCodePoint: code point order (U+E000 before U+1F600; JS < puts it after)', [...keys].sort(E.cmpCodePoint), want);
  let ok = 0;
  for (let t = 0; t < 2000; t++) {
    const a = randStr(), b = randStr();
    const ca = [...a].map((c) => c.codePointAt(0)), cb = [...b].map((c) => c.codePointAt(0));
    let w = 0;
    for (let i = 0; i < Math.min(ca.length, cb.length) && !w; i++) w = ca[i] - cb[i];
    if (!w) w = ca.length - cb.length;
    if (Math.sign(E.cmpCodePoint(a, b)) === Math.sign(w)) ok++;
  }
  check('cmpCodePoint: 2,000 random pairs agree with comparing code point arrays', ok === 2000);
}
{
  const r = E.analyze('{"b":1,"a":2,"b":3,"c":{"y":1,"x":2}}', {});
  eq('analyze: duplicate key listed with path and offset', r.dups.map((d) => [d.key, E.pointerOf(d.path), d.offset]), [['b', '', 13]]);
  eq('dupes keep: every member, in order', E.serialize(r.root, OPT({ indent: '' })), '{"b":1,"a":2,"b":3,"c":{"y":1,"x":2}}');
  eq('dupes last: last value at the first position (JSON.parse)', E.serialize(r.root, OPT({ indent: '', dupes: 'last' })), JSON.stringify(JSON.parse('{"b":1,"a":2,"b":3,"c":{"y":1,"x":2}}')));
  eq('sortKeys + keep: stable, duplicates stay in order', E.serialize(r.root, OPT({ indent: '', sortKeys: true })), '{"a":2,"b":1,"b":3,"c":{"x":2,"y":1}}');
  eq('sortKeys + last', E.serialize(r.root, OPT({ indent: '', sortKeys: true, dupes: 'last' })), '{"a":2,"b":3,"c":{"x":2,"y":1}}');
  eq('childrenOf marks later duplicates (keep mode only)', E.childrenOf(r.root, OPT({})).map((c) => [c.seg, c.dup]), [['b', false], ['a', false], ['b', true], ['c', false]]);
  eq('childrenOf in last mode', E.childrenOf(r.root, OPT({ dupes: 'last' })).map((c) => [c.seg, c.dup]), [['b', false], ['a', false], ['c', false]]);
  const big = '{' + Array.from({ length: 40 }, (_, i) => '"k' + (i % 30) + '":' + i).join(',') + '}';
  eq('duplicate detection in a 40-key object (Map path)', E.analyze(big, {}).dupCount, 10);
  eq('__proto__ and constructor keys are ordinary keys', E.serialize(E.analyze('{"__proto__":1,"constructor":2,"__proto__":3}', {}).root, OPT({ indent: '', dupes: 'last' })), '{"__proto__":3,"constructor":2}');
}
eq('empty containers stay on one line', fmtOut('{"a":{},"b":[],"c":[{}]}', {}), '{\n  "a": {},\n  "b": [],\n  "c": [\n    {}\n  ]\n}');
eq('scalar root', [fmtOut(' 1.0 ', {}), fmtOut('"x"', {}), fmtOut('null', {})], ['1.0', '"x"', 'null']);
eq('Tab indent', fmtOut('{"a":[1]}', { indent: '\t' }), '{\n\t"a": [\n\t\t1\n\t]\n}');
{
  const r = E.analyze('["\\ud800", "ok", {"\\udc00": "\\ud83d\\ude00"}, "\\ud83d"]', {});
  eq('unpaired surrogates: counted with paths (a valid pair is not)', [r.surrogateCount, r.surrogates.map((x) => E.pointerOf(x.path))], [3, ['/0', '/2/\udc00', '/3']]);
  eq('unpaired surrogates are written as \\udxxx (JSON.stringify)', E.serialize(r.root, OPT({ indent: '' })), '["\\ud800","ok",{"\\udc00":"😀"},"\\ud83d"]');
}
{
  const r = E.analyze('\ufeff{"a":1}', {});
  check('BOM: removed and reported; offsets count from after it', r.ok && r.bom && r.base === 1);
  eq('stats', E.analyze('{"a":[1,"x",true,null,{"b":false}]}', {}).stats, { objects: 2, arrays: 1, strings: 1, numbers: 1, booleans: 2, nulls: 1, keys: 2, depth: 3 });
  check('whitespace-only input is empty', E.analyze(' \n\t', {}).empty === true && E.analyze('', {}).empty === true);
  check('U+00A0 alone is not JSON whitespace: invalid, not empty', E.analyze('\u00a0', {}).empty !== true && !E.analyze('\u00a0', {}).ok);
}

// ---------- 6. errors and hints ----------
function errAt(text) { const r = E.analyze(text, {}); if (r.ok || r.empty) return null; const lc = E.lineCol(text, r.error.offset + r.base); return [r.error.code, lc.line, lc.col]; }
eq('error: trailing comma', errAt('{"a":1,}'), ['trailingComma', 1, 7]);
eq('error: single quote', errAt("{'a':1}"), ['singleQuote', 1, 2]);
eq('error: unquoted key', errAt('{a:1}'), ['unquotedKey', 1, 2]);
eq('error: missing comma (line 3)', errAt('{\n  "a": 1\n  "b": 2\n}'), ['missingComma', 3, 3]);
eq('error: comment', errAt('{"a":1} // x'), ['comment', 1, 9]);
eq('error: curly quote from an IME', errAt('{“a”:1}'), ['smartQuote', 1, 2]);
eq('error: full-width colon', errAt('{"a"：1}'), ['fullWidth', 1, 5]);
eq('error: leading zero (reported at the digit after the 0)', errAt('[01]'), ['badNumber', 1, 3]);
eq('error: raw line break in a string', errAt('["a\nb"]'), ['controlChar', 1, 4]);
eq('error: unclosed', errAt('{"a":[1,2'), ['unexpectedEnd', 1, 10]);
eq('error: BOM shifts nothing (column counts the BOM)', errAt('\ufeff{"a":1,}'), ['trailingComma', 1, 8]);
eq('hint: Markdown code fence', E.analyze('```json\n{"a": 1}\n```', {}).hint, { code: 'fence', text: '{"a": 1}' });
eq('hint: escaped JSON', E.analyze('{\\"a\\":1,\\"b\\":\\"x\\"}', {}).hint, { code: 'escaped', text: '{"a":1,"b":"x"}' });
eq('hint: JSON Lines', E.analyze('{"a":1}\n{"a":2}\n\n{"a":3}\n', {}).hint, { code: 'jsonl', n: 3 });
eq('hint: Python literal', E.analyze('{"ok": True, "v": None}', {}).hint, { code: 'python', word: 'True', fix: 'true', offset: 7 });
eq('hint: undefined', E.analyze('{"a": undefined}', {}).hint.code, 'undefined');
eq('hint: NaN / Infinity', [E.analyze('[NaN]', {}).hint.code, E.analyze('[-Infinity]', {}).hint.code, E.analyze('[Infinity]', { json5: true }).error.code], ['nonFinite', 'nonFinite', 'nonFinite']);
eq('inner JSON: a JSON string holding JSON', E.analyze('"{\\"a\\":[1,2]}"', {}).inner, '{"a":[1,2]}');
eq('inner JSON: a plain string is not', E.analyze('"hello"', {}).inner, null);
{
  const f = E.codeFrame('{\n  "a": 1,\n}', 12);
  eq('codeFrame: previous line, error line and caret', f, { line: 3, col: 1, text: '2 |   "a": 1,\n3 | }\n  | ^' });
  const long = '[' + '1,'.repeat(200) + 'x]';
  const g = E.codeFrame(long, long.indexOf('x'));
  const lines = g.text.split('\n');
  check('codeFrame: a long line is cut around the column and the caret points at the error', lines[0].length <= 80 && lines[1].indexOf('^') === lines[0].indexOf('x'), g.text);
}

// ---------- 7. JSON5 / JSONC ----------
{
  const cases = fixtures.json5.cases;
  let ok = 0, bad = [];
  for (const c of cases) {
    const r = E.analyze(c.text, { json5: true });
    let good;
    if (!c.ok) good = !r.ok;
    else if (c.nonFinite && /Infinity|NaN/.test(c.text)) good = !r.ok && r.error.code === 'nonFinite';
    else if (!r.ok) good = !!r.empty && false;
    else good = JSON.stringify(JSON.parse(E.serialize(r.root, OPT({ indent: '', numbers: 'js', dupes: 'last' })))) === c.json;
    if (good) ok++; else bad.push(JSON.stringify(c.text) + ' json5 ' + (c.ok ? c.json : 'error') + ' tool ' + (r.ok ? E.serialize(r.root, OPT({ indent: '' })) : JSON.stringify(r.error)));
  }
  check('JSON5: ' + cases.length + ' cases agree with json5 2.2.3 (NaN / Infinity rejected on purpose)', ok === cases.length, bad.join('\n  '));
  const j = E.analyze("{\n  // config\n  name: 'api',\n  port: 0x1F90,\n  ratio: .75,\n  tags: ['a', 'b',],\n}", { json5: true });
  eq('JSON5 → JSON output', E.serialize(j.root, OPT({ indent: '' })), '{"name":"api","port":8080,"ratio":0.75,"tags":["a","b"]}');
  eq('JSON5 change counts', j.changes, { comments: 1, trailingCommas: 2, singleQuotes: 3, unquotedKeys: 4, numbers: 2, escapes: 0, whitespace: 0 });
  const off = E.analyze('{a:1, /* x */ b:2,}', {});
  check('JSON5 off: an error plus the offer with the changes', !off.ok && off.json5 && off.json5.comments === 1 && off.json5.trailingCommas === 1 && off.json5.unquotedKeys === 2);
  eq('JSON5: hex beyond 2^53 is exact (BigInt)', E.serialize(E.analyze('0xFFFFFFFFFFFFFFFFF', { json5: true }).root, OPT({})), '295147905179352825855');
  eq('JSON5: VS Code settings.json style', fmtOut('{\n  // Editor\n  "editor.tabSize": 2,\n  "files.exclude": { "**/.git": true, },\n}', { indent: '' }, { json5: true }), '{"editor.tabSize":2,"files.exclude":{"**/.git":true}}');
}

// ---------- 8. file bytes ----------
{
  const enc = new TextEncoder();
  eq('decodeBytes: UTF-8 keeps a BOM for analyze to report', E.decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x5b, 0x5d])), { text: '\ufeff[]', encoding: 'UTF-8' });
  eq('decodeBytes: UTF-16LE with BOM', E.decodeBytes(new Uint8Array([0xff, 0xfe, 0x5b, 0, 0x5d, 0])), { text: '[]', encoding: 'UTF-16LE' });
  eq('decodeBytes: UTF-16BE with BOM', E.decodeBytes(new Uint8Array([0xfe, 0xff, 0, 0x5b, 0, 0x5d])), { text: '[]', encoding: 'UTF-16BE' });
  eq('decodeBytes: UTF-16 without BOM', E.decodeBytes(new Uint8Array([0x5b, 0, 0x22, 0, 0xe9, 0, 0x22, 0, 0x5d, 0])).error, 'utf16NoBom');
  // "中文" in GBK is D6 D0 CE C4; Shift_JIS "日本" is 93 FA 96 7B; EUC-KR "한국" is C7 D1 B1 B9.
  eq('decodeBytes: GBK bytes → not UTF-8 at the first bad byte', E.decodeBytes(new Uint8Array([...enc.encode('{"name":"'), 0xd6, 0xd0, 0xce, 0xc4, ...enc.encode('"}')])), { error: 'notUtf8', offset: 9 });
  eq('decodeBytes: Shift_JIS bytes', E.decodeBytes(new Uint8Array([0x5b, 0x22, 0x93, 0xfa, 0x96, 0x7b, 0x22, 0x5d])), { error: 'notUtf8', offset: 2 });
  eq('decodeBytes: EUC-KR bytes', E.decodeBytes(new Uint8Array([0x5b, 0x22, 0xc7, 0xd1, 0xb1, 0xb9, 0x22, 0x5d])), { error: 'notUtf8', offset: 2 });
  let ok = 0;
  for (let t = 0; t < 3000; t++) {
    const u8 = new Uint8Array(ri(12)).map(() => (rnd() < 0.5 ? 0x80 + ri(128) : ri(256)));
    let fatal = true;
    try { new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { fatal = false; }
    if ((E.firstBadUtf8(u8) < 0) === fatal) ok++;
  }
  check('firstBadUtf8 agrees with TextDecoder fatal on 3,000 random byte strings', ok === 3000);
}

// ---------- 9. paths, highlighting ----------
eq('jqPathOf', [E.jqPathOf([]), E.jqPathOf(['a', 0, 'b c', 'd_1']), E.jqPathOf([0]), E.jqPathOf(['名前'])], ['.', '.a[0]["b c"].d_1', '.[0]', '.["名前"]']);
eq('pointerOf (RFC 6901 escapes)', [E.pointerOf([]), E.pointerOf(['a/b', '~', 0, ''])], ['', '/a~1b/~0/0/']);
{
  const out = fmtOut('{"x":"</script><img src=x onerror=alert(1)>","n":-1.5e3,"t":true,"z":null,"k\\"q":"a\\\\"}', {});
  const h = E.highlight(out);
  check('highlight: HTML is escaped (only span tags remain)', !/<(?!\/?span\b)/.test(h), h);
  eq('highlight: text content equals the output', h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'), out);
  eq('highlight: classes', (h.match(/class="jf-\w"/g) || []).join(' '), 'class="jf-k" class="jf-s" class="jf-k" class="jf-n" class="jf-k" class="jf-b" class="jf-k" class="jf-z" class="jf-k" class="jf-s"');
}

// ---------- 10. jq 1.7.1 and Python 3.12 ----------
function tool(cmd, args, input) {
  const p = spawnSync(cmd, args, { input, encoding: 'utf8', maxBuffer: 1 << 26 });
  return p.status === 0 ? p.stdout : null;
}
const jqVersion = (() => { try { return execFileSync('jq', ['--version'], { encoding: 'utf8' }).trim(); } catch (e) { return null; } })();
if (jqVersion && /^jq-1\.7\.1(-|$)/.test(jqVersion)) {
  // jq 1.7.1 keeps number literals but rewrites exponents (1e2 → 1E+2), escapes DEL, and
  // rejects unpaired high surrogates; the corpus avoids those three.
  const str = () => { let s = randStr(); return s.replace(/\u007f/g, '').replace(/[\ud800-\udfff]/g, ''); };
  const docs = [];
  for (let t = 0; t < 400; t++) docs.push(randDoc(0, { ws: true, dups: true, noExp: true, str }));
  const joined = docs.join('\n');
  const variants = [[['.'], { indent: '  ' }], [['-c', '.'], { indent: '' }], [['-S', '.'], { indent: '  ', sortKeys: true }], [['--tab', '.'], { indent: '\t' }], [['--indent', '4', '.'], { indent: '    ' }]];
  for (const [args, o] of variants) {
    const got = tool('jq', args, joined);
    const mine = docs.map((d) => fmtOut(d, Object.assign({ dupes: 'last' }, o))).join('\n') + '\n';
    check('jq 1.7.1 `jq ' + args.join(' ') + '`: 400 documents identical (keep as written, last duplicate)', got === mine, got === null ? 'jq failed' : 'first difference at ' + [...got].findIndex((c, i) => c !== mine[i]));
  }
  // The number table on the ja page and the en / zh text: jq keeps literals but rewrites exponents.
  eq('jq 1.7.1 number literals (ja page table)', tool('jq', ['-c', '.'], '[1.0, 1e2, 12345678901234567890, 1e400, 1.5e-7]'), '[1.0,1E+2,12345678901234567890,1E+400,1.5E-7]\n');
  eq('jq 1.7.1 rejects an unpaired high surrogate and replaces an unpaired low one (surrogate note)', [tool('jq', ['-c', '.'], '["\\ud800"]'), tool('jq', ['-c', '.'], '["\\udc00"]')], [null, '["\uFFFD"]\n']);
} else skip('jq comparison', 'needs jq 1.7.1, found ' + (jqVersion || 'none'));
const pyVersion = (() => { try { return execFileSync('python3', ['-c', 'import sys;print("%d.%d.%d"%sys.version_info[:3])'], { encoding: 'utf8' }).trim(); } catch (e) { return null; } })();
if (pyVersion && /^3\.12\./.test(pyVersion)) {
  // Python keeps integers exactly but rewrites floats (1e2 → 100.0), so the corpus uses integers.
  const docs = [];
  for (let t = 0; t < 120; t++) docs.push(randDoc(0, { ws: true, dups: true, intOnly: true, str: () => randStr().replace(/[\ud800-\udfff]/g, '') }));
  const variants = [[[], { indent: '    ', ascii: true }], [['--sort-keys'], { indent: '    ', ascii: true, sortKeys: true }], [['--compact'], { indent: '', ascii: true }],
    [['--tab', '--no-ensure-ascii'], { indent: '\t' }], [['--indent', '2', '--no-ensure-ascii'], { indent: '  ' }]];
  for (const [args, o] of variants) {
    let ok = 0, bad = '';
    for (const d of docs) {
      const got = tool('python3', ['-m', 'json.tool', ...args], d);
      const mine = fmtOut(d, Object.assign({ dupes: 'last' }, o)) + '\n';
      if (got === mine) ok++; else if (!bad) bad = d + '\n' + got + '\n' + mine;
    }
    check('Python ' + pyVersion + ' `python3 -m json.tool ' + args.join(' ') + '`: ' + docs.length + ' documents identical', ok === docs.length, bad);
  }
  eq('Python 3.12 number literals (ja page table): 1e2 → 100.0, 1e400 → Infinity', tool('python3', ['-m', 'json.tool', '--compact'], '[1.0, 1e2, 12345678901234567890, 1e400]'), '[1.0,100.0,12345678901234567890,Infinity]\n');
  eq('Python 3.12 escapes Korean by default (ko page)', tool('python3', ['-m', 'json.tool', '--compact'], '"홍길동"'), '"\\ud64d\\uae38\\ub3d9"\n');
} else skip('Python json.tool comparison', 'needs Python 3.12, found ' + (pyVersion || 'none'));

// ---------- 11. performance ----------
{
  const items = [];
  for (let i = 0; i < 30000; i++) items.push({ id: 1e15 + i, name: 'user ' + i + ' 名前', score: i * 1.25, tags: ['a', 'b'], active: i % 2 === 0, meta: { created: '2026-10-02T00:00:00Z', n: null } });
  const text = JSON.stringify(items);
  const t0 = performance.now();
  const r = E.analyze(text, {});
  const out = E.serialize(r.root, OPT({ indent: '  ', sortKeys: true }));
  const ms = performance.now() - t0;
  check('performance: ' + (text.length / 1e6).toFixed(1) + ' MB parsed and formatted with sorted keys in under 3 s (' + Math.round(ms) + ' ms)', ms < 3000 * PERF_SLACK && out.length > text.length);
}

// ---------- 12. strings, page script, persistence ----------
const fm = source.slice(source.indexOf('const STRINGS = '), source.indexOf('const S = STRINGS'));
const STRINGS = new Function('return ' + fm.slice('const STRINGS = '.length).replace(/;\s*$/, ''))();
function shape(o, p = '') { return Object.keys(o).sort().flatMap((k) => (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? shape(o[k], p + k + '.') : [p + k + (Array.isArray(o[k]) ? '[' + o[k].length + ']' : '')])); }
function leaves(o, p = '') { return Object.keys(o).flatMap((k) => (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? leaves(o[k], p + k + '.') : Array.isArray(o[k]) ? o[k].map((x, i) => [p + k + '[' + i + ']', x]) : [[p + k, o[k]]])); }
const enShape = shape(STRINGS.en);
for (const lang of ['zh', 'ja', 'ko']) {
  eq('STRINGS ' + lang + ': same keys as en', shape(STRINGS[lang]), enShape);
  const en = Object.fromEntries(leaves(STRINGS.en)), other = Object.fromEntries(leaves(STRINGS[lang]));
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  const badPh = Object.keys(en).filter((k) => ph(en[k]) !== ph(other[k]));
  check('STRINGS ' + lang + ': same placeholders as en', badPh.length === 0, badPh.join(', '));
}
{
  const script = source.slice(source.indexOf('<script>'), source.indexOf('</script>'));
  const used = new Set([...script.matchAll(/\bT\.([A-Za-z0-9]+(?:\.[A-Za-z0-9]+)?)/g)].map((m) => m[1]));
  const missing = [...used].filter((k) => k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), STRINGS.en) === undefined);
  check('page script: every T.* key exists', missing.length === 0, missing.join(', '));
  const parseCodes = [...new Set([...engine.matchAll(/(?:fail|err)\('(\w+)'/g)].map((m) => m[1]))];
  const noMsg = parseCodes.filter((c) => !STRINGS.en.parse[c]);
  check('every error code the parsers raise has a message', noMsg.length === 0, noMsg.join(', '));
  // highlight() now runs in the worker (json-formatter-run.js); the page writes its result.
  check('page script: no network, no direct storage; innerHTML only for highlight()', !/\bfetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie/.test(script) && (script.match(/innerHTML/g) || []).length === 1 && /innerHTML = res\.html;/.test(script)
    && (runSource.match(/\.html = /g) || []).length === 1 && /v\.html = blockHtml\(highlight\(out\)\)/.test(runSource));
  check('persistence: json-formatter uses the default input policy', !/'json-formatter'/.test(readFileSync(join(root, 'src/data/persistence.ts'), 'utf8')));
}

// ---------- 13. examples on the tool pages ----------
{
  const dir = join(root, 'src/content/tools/json-formatter');
  let count = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mdx'))) {
    const mdx = readFileSync(join(dir, f), 'utf8');
    const re = /\{\/\* jf: (\{.*?\}) \*\/\}\s*```[\w]*\n([\s\S]*?)\n```\s*(?:[^`]*?)```[\w]*\n([\s\S]*?)\n```/g;
    let m;
    while ((m = re.exec(mdx))) {
      count++;
      const spec = JSON.parse(m[1]);
      const input = m[2], expected = m[3];
      const r = E.analyze(input, { json5: !!spec.json5 });
      if (spec.error) {
        const lc = r.ok || r.empty ? null : E.lineCol(input, r.error.offset + r.base);
        const want = spec.error;
        check(f + ' example ' + count + ': error ' + want.code + ' at ' + want.line + ':' + want.col, lc && r.error.code === want.code && lc.line === want.line && lc.col === want.col && expected === E.codeFrame(input, r.error.offset + r.base).text, lc ? [r.error.code, lc.line, lc.col] : 'parsed');
      } else {
        const got = r.ok ? E.serialize(r.root, OPT(spec.opts || {})) : 'ERROR ' + JSON.stringify(r.error);
        check(f + ' example ' + count + ' output', got === expected, got);
      }
    }
  }
  check('tool pages: at least 12 annotated examples (' + count + ')', count >= 12);
}

// ---------- 14. worker runner, client protocol, real worker entry ----------
{
  const { viewOf, createFormatterRunner, createFormatterClient, HIGHLIGHT_LIMIT } = await import('../src/components/tools/json-formatter-run.js');
  // Undo blockHtml: each block is <span class="jf-blk" style="…: auto {lines × 1.5}em">…</span>.
  const blockRe = /<span class="jf-blk" style="contain-intrinsic-height: auto ([\d.]+)em">/g;
  let blockBad = '';
  function unblock(html) {
    const parts = html.split(blockRe);
    if (parts[0] !== '') blockBad = 'text before the first block';
    let out = '';
    for (let x = 1; x < parts.length; x += 2) {
      const body = parts[x + 1];
      if (!body.endsWith('</span>')) blockBad = 'block not closed';
      const inner = body.slice(0, -7);
      const lines = inner.split('\n').length - (inner.endsWith('\n') ? 1 : 0);
      if (Number(parts[x]) !== lines * 1.5) blockBad = 'height hint ' + parts[x] + ' for ' + lines + ' lines';
      if ((inner.match(/<span/g) || []).length !== (inner.match(/<\/span>/g) || []).length) blockBad = 'a highlight span crosses a block';
      out += inner;
    }
    return out;
  }
  const pathOf = (segs) => (segs.length ? E.pointerOf(segs) : null);
  // What the page computed itself before the worker (JsonFormatterTool.astro at v1.138.57).
  function legacy(text, o) {
    const res = E.analyze(text, { json5: !!o.json5 });
    const v = { ok: !!res.ok, empty: !!res.empty, bom: !!res.bom };
    if (res.ok) {
      const out = E.serialize(res.root, o);
      Object.assign(v, { out, inSize: new Blob([text]).size, outSize: new Blob([out]).size, big: out.length > 1_000_000 });
      if (!v.big) v.html = E.highlight(out);
      else { const cut = out.lastIndexOf('\n', 1_000_000); v.display = out.slice(0, cut > 0 ? cut : 1_000_000) + '\n…'; }
      v.dups = res.dups.map((d) => ({ key: d.key, path: pathOf(d.path), line: E.lineCol(text, d.offset + res.base).line }));
      v.numbers = res.numbers.map((x) => ({ kind: x.kind, raw: x.raw, js: x.js, path: pathOf(x.path), line: E.lineCol(text, x.offset + res.base).line }));
      v.surrogates = res.surrogates.map((x) => ({ path: pathOf(x.path), line: E.lineCol(text, x.offset + res.base).line }));
      v.counts = [res.dupCount, res.numberCount, res.surrogateCount];
      v.rest = [res.mode, res.inner, res.changes, res.stats];
    } else if (!res.empty) {
      const off = res.error.offset + res.base;
      v.frame = E.codeFrame(text, off);
      v.errorRange = [off, Math.min(text.length, off + 1)];
      v.ch = res.error.ch || text.charAt(res.error.offset) || '';
      v.error = [res.error.code, res.error.offset];
      v.hint = res.hint || null; v.json5 = res.json5 || null;
    }
    return { v, res };
  }
  const nl = (n) => '\n'.repeat(n);
  const docs = [
    '{"id":1830000000000000001,"name":"ZeroTool","price":19.90,"tags":["json","formatter"],"owner":{"login":"kassol","verified":true},"notes":null}',
    '{\n "b": 1,\n "a": 2,' + nl(40) + ' "b": 3,\n "x": {"k":1,"k":2,"z":null,"k":[1e400,-0,1e-400]},\n "s": "\\ud800",\n "é": "\\ud83d\\ude00"\n}',
    '\ufeff[1, 2,\n 3,,]', '\ufeff{"a": True}', '   ', '', '{"a":1,} // c', '```json\n{"a":1}\n```', '"{\\"a\\":1}"',
    '{"a":1}\n{"b":2}', '[NaN]', '{"k": undefined}', '{\n"a":\n\t"x"\u3000}', '"{\\"inner\\":[1,2]}"',
  ];
  const optSets = [OPT({}), OPT({ indent: '', sortKeys: true, ascii: true, numbers: 'js', dupes: 'last' }), OPT({ indent: '\t', dupes: 'last' }), OPT({ json5: true, indent: '    ' })];
  let same = 0, total = 0, bad = '';
  for (const d of docs) for (const o of optSets) {
    total++;
    const { v: want } = legacy(d, o);
    const got = viewOf(E.analyze(d, { json5: !!o.json5 }), d, o);
    const g = { ok: got.ok, empty: got.empty, bom: got.bom };
    if (got.ok) {
      Object.assign(g, { out: got.out, inSize: got.inSize, outSize: got.outSize, big: got.big });
      if (got.html !== undefined) g.html = unblock(got.html); else g.display = got.display;
      Object.assign(g, { dups: got.dups, numbers: got.numbers, surrogates: got.surrogates, counts: [got.dupCount, got.numberCount, got.surrogateCount], rest: [got.mode, got.inner, got.changes, got.stats] });
    } else if (!got.empty) Object.assign(g, { frame: got.frame, errorRange: got.errorRange, ch: got.error.ch, error: [got.error.code, got.error.offset], hint: got.hint, json5: got.json5 });
    if (JSON.stringify(g) === JSON.stringify(want)) same++; else if (!bad) bad = JSON.stringify(d) + '\n' + JSON.stringify(g) + '\n' + JSON.stringify(want);
  }
  {
    const items = []; for (let i = 0; i < 4400; i++) items.push({ id: 1e15 + i, s: 'a "q" <b>&' + i, n: [i, null, true] });
    const t = JSON.stringify(items); const o = OPT({});
    const got = viewOf(E.analyze(t, {}), t, o);
    const blocks = (got.html.match(blockRe) || []).length;
    check('highlighted output under 1 MB is split into ' + blocks + ' line-aligned blocks that join back to highlight()', !got.big && blocks > 30 && unblock(got.html) === E.highlight(E.serialize(E.analyze(t, {}).root, o)) && !blockBad, blockBad);
  }
  check('runner view equals the page computation before the worker: ' + same + '/' + total + ' document × option sets', same === total, bad);
  {
    const items = []; for (let i = 0; i < 12000; i++) items.push({ id: i, name: 'user ' + i + ' 名前', v: [i, 1.5, null] });
    const big = JSON.stringify(items);
    const o = OPT({});
    const { v: want } = legacy(big, o);
    const got = viewOf(E.analyze(big, {}), big, o);
    check('runner: output over 1 MB is cut at a line end as before (' + (got.out.length / 1e6).toFixed(1) + ' MB)', got.big && got.html === undefined && got.display === want.display && got.out === want.out && HIGHLIGHT_LIMIT === 1_000_000);
    const tree = viewOf(E.analyze(big, {}), big, Object.assign({}, o, { text: false }));
    check('runner: tree view skips the display text but keeps the full output', tree.display === undefined && tree.html === undefined && tree.out === want.out);
  }
  // Tree pages equal childrenOf + the page preview, at every level of a document with duplicates.
  {
    const text = '{"z":[1,"x",{"k":true}],"a":{"d":1,"d":"' + 'y'.repeat(300) + '","c":[],"d":{}},"m":null,"a":[' + Array.from({ length: 450 }, (_, i) => i).join(',') + ']}';
    const res = E.analyze(text, {});
    const run = createFormatterRunner();
    run({ type: 'analyze', text, json5: false, opts: OPT({}), docId: 3 });
    let pages = 0, ok = true, why = '';
    const previewOf = (v, o) => { const k = E.kindOf(v); if (k === 'object') return { count: v.k.length }; if (k === 'array') return { count: v.v.length }; const s = E.scalarOut(v, o); return { preview: s.length > 200 ? s.slice(0, 199) + '…' : s }; };
    for (const o of [OPT({}), OPT({ sortKeys: true }), OPT({ dupes: 'last' }), OPT({ sortKeys: true, dupes: 'last', numbers: 'js' })]) {
      const walk = (node, idxs) => {
        const want = E.childrenOf(node, o);
        const got = [];
        for (let from = 0; ; from += 200) {
          const p = run({ type: 'children', docId: 3, path: idxs, from, count: 200, opts: o });
          pages++;
          if (p.total !== want.length) { ok = false; why = 'total ' + idxs; }
          got.push(...p.rows);
          if (from + 200 >= p.total) break;
        }
        got.forEach((r, x) => {
          const w = want[x], pv = previewOf(w.value, o);
          const exp = { seg: w.seg, kind: E.kindOf(w.value), dup: !!w.dup, ...pv, hasKids: pv.count > 0 };
          const g = { seg: r.seg, kind: r.kind, dup: r.dup, ...(r.count !== undefined ? { count: r.count } : { preview: r.preview }), hasKids: r.hasKids };
          if (JSON.stringify(g) !== JSON.stringify(exp) || node.v[r.idx] !== w.value) { ok = false; why = JSON.stringify([idxs, g, exp]); }
          if (r.hasKids) walk(w.value, idxs.concat([r.idx]));
        });
      };
      walk(res.root, []);
    }
    check('tree pages (' + pages + ' requests) equal childrenOf rows and previews, duplicates and sorting included', ok, why);
    check('stale tree and render requests are reported, not answered from another document', run({ type: 'children', docId: 2, path: [], from: 0, count: 1, opts: OPT({}) }).stale === true && run({ type: 'render', docId: 2, opts: OPT({}) }).stale === true && run({ type: 'children', docId: 3, path: [9, 9], from: 0, count: 1, opts: OPT({}) }).stale === true);
    check('render request reformats the kept document', run({ type: 'render', docId: 3, opts: OPT({ indent: '' }) }).out === E.serialize(res.root, OPT({ indent: '' })));
    const bytes = new TextEncoder().encode('\ufeff{"a":1}');
    const u16 = new Uint8Array([0xff, 0xfe, ...Array.from('[1]').flatMap((c) => [c.charCodeAt(0), 0])]);
    const dec = run({ type: 'decode', buffer: bytes.buffer, json5: false, opts: OPT({}), docId: 4 });
    const dec16 = run({ type: 'decode', buffer: u16.buffer, json5: false, opts: OPT({}), docId: 5 });
    const decBad = run({ type: 'decode', buffer: new Uint8Array([0x7b, 0xc3, 0x28]).buffer, json5: false, opts: OPT({}), docId: 6 });
    check('decode request: bytes decoded like decodeBytes, then parsed (BOM, UTF-16LE, bad UTF-8)', dec.decoded.text === '\ufeff{"a":1}' && dec.view.bom && dec.view.out === '{\n  "a": 1\n}'
      && dec16.decoded.encoding === 'UTF-16LE' && dec16.view.out === '[\n  1\n]' && decBad.decoded.error === 'notUtf8' && decBad.decoded.offset === 1 && !decBad.view);
    check('a failed decode keeps the previous document', run({ type: 'render', docId: 5, opts: OPT({}) }).out === '[\n  1\n]');
  }
  // Client: a new analyze terminates a busy worker; tree requests do not.
  {
    const workers = [];
    const client = createFormatterClient(() => { const w = { messages: [], transfers: [], terminated: false, postMessage(m, t) { this.messages.push(m); this.transfers.push(t); }, terminate() { this.terminated = true; } }; workers.push(w); return w; });
    const first = client.analyze('old', false, OPT({})).catch((e) => e.name);
    check('client is busy while a parse runs', client.busy === true);
    let settledNew = false;
    const second = client.analyze('new', false, OPT({})).then((r) => { settledNew = true; return r; });
    const [w0, w1] = workers;
    check('a new analyze terminates the busy worker and rejects the old request', w0.terminated && await first === 'AbortError');
    w0.onmessage({ data: { id: w0.messages[0].id, type: 'result', result: 'stale' } });
    await Promise.resolve();
    check('late results from a terminated worker are ignored', !settledNew);
    w1.onmessage({ data: { id: w1.messages[0].id, type: 'result', result: { ok: true } } });
    const r2 = await second;
    check('the new request resolves with its document id', r2.docId === w1.messages[0].docId && r2.view.ok === true && !client.busy);
    const kids = client.children(r2.docId, [], 0, 200, OPT({}));
    const kids2 = client.children(r2.docId, [0], 0, 200, OPT({}));
    check('tree requests do not terminate the worker or mark it busy', !w1.terminated && !client.busy);
    w1.onmessage({ data: { id: w1.messages[2].id, type: 'result', result: 'b' } });
    w1.onmessage({ data: { id: w1.messages[1].id, type: 'result', result: 'a' } });
    check('responses reach their own request in any order', await kids === 'a' && await kids2 === 'b');
    const buf = new ArrayBuffer(4);
    const dec = client.decode(buf, false, OPT({}));
    check('decode transfers the file buffer instead of copying it', w1.transfers[3][0] === buf);
    const errored = dec.catch((e) => e.message);
    w1.onerror({ message: 'out of memory' });
    check('worker failure rejects with its message; the next request starts a new worker', await errored === 'out of memory' && w1.terminated);
    const again = client.analyze('x', false, OPT({}));
    workers[2].onmessage({ data: { id: workers[2].messages[0].id, type: 'error', message: 'boom' } });
    check('an error reply rejects only its request', await again.catch((e) => e.message) === 'boom' && !workers[2].terminated);
    const idle = client.render(1, OPT({})).catch((e) => e.name);
    client.dispose();
    check('page disposal terminates the worker', workers[2].terminated && await idle === 'AbortError');
  }
  // The page keeps no parser or serializer on the main thread.
  {
    const script = source.slice(source.indexOf('<script>'), source.indexOf('</script>'));
    check('page creates the Vite worker and has no synchronous parse / serialize / highlight / decode / lineCol', script.includes("./json-formatter.worker.js?worker")
      && !/(?<![.\w])(analyze|serialize|parseJson|highlight|codeFrame|decodeBytes|lineCol|childrenOf)\s*\(/.test(script) && /import \{ fmt, pointerOf, jqPathOf \} from/.test(script));
  }
  // The real worker entry, in a Node worker thread.
  {
    const { Worker } = await import('node:worker_threads');
    const entry = new URL('../src/components/tools/json-formatter.worker.js', import.meta.url).href;
    const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(`
      import { parentPort } from 'node:worker_threads';
      globalThis.self = { postMessage: (data) => parentPort.postMessage(data) };
      await import(${JSON.stringify(entry)});
      parentPort.on('message', (data) => self.onmessage({ data }));
    `)), { type: 'module' });
    try {
      const ask = (m) => new Promise((resolve, reject) => {
        const on = (d) => { if (d.id === m.id) { worker.off('message', on); resolve(d); } };
        worker.on('message', on); worker.once('error', reject); worker.postMessage(m);
      });
      const text = '{"b":[1,2],"a":1830000000000000001}';
      const a = await ask({ id: 1, type: 'analyze', text, json5: false, opts: OPT({ sortKeys: true }), docId: 9 });
      const c = await ask({ id: 2, type: 'children', docId: 9, path: [], from: 0, count: 200, opts: OPT({ sortKeys: true }) });
      const e = await ask({ id: 3, type: 'nope' });
      check('real worker entry: analyze, children and error replies keep request ids', a.type === 'result' && a.result.out === fmtOut(text, { sortKeys: true })
        && c.result.rows.map((r) => r.seg).join() === 'a,b' && c.result.rows[1].idx === 0 && e.type === 'error' && /Unknown request/.test(e.message));
    } finally { await worker.terminate(); }
  }
}

console.log((failures ? 'FAILED' : 'OK') + ': ' + passes + ' passed, ' + failures + ' failed, ' + skips + ' skipped');
process.exit(failures ? 1 : 0);
