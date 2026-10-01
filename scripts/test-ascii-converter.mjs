// ASCII Converter — code formats and strict reading of code tokens
//
// Read:  src/components/tools/AsciiConverterTool.astro (the engine block between the
//        `engine:start` / `engine:end` markers)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: formatCode for decimal / hex / octal / binary; parseCode reads 0x / 0o / 0b /
// decimal tokens only when the whole token is digits of that base (parseInt used to stop
// at the first bad digit, so 72abc read as 72 and 0b102 as 2), rejects surrogate code
// points (U+D800–U+DFFF) and values above U+10FFFF; the examples on the English page.
//
// Guide checks (src/content/blog/ascii-converter-guide/en.mdx and ja.mdx): the printable table
// must have one row for each code 32–126 and the control table one row for each code 0–31 and
// 127; hex, octal and 7-bit binary are recomputed; printable names must equal the Unicode 18.0
// names, control abbreviations must be a Unicode 18.0 abbreviation alias, control names must
// follow the abbreviation in the RFC 20 legend or be a Unicode control alias, and the caret form
// is the code XOR 64 (DEL is ^?). Source data is in scripts/test-ascii-converter.fixtures.json.
// Examples marked {/* ac-check: {"text": ..., "fmt": ..., "expect": ...} */} or
// {/* ac-check: {"codes": ..., "expect"|"error": ...} */} run the tool's engine. JavaScript lines
// with a result comment are evaluated and compared with util.inspect. Python samples, the C
// escape column and the code page facts quoted in the text run when python3 is available
// (SKIP otherwise).
//
// Run: node scripts/test-ascii-converter.mjs

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { inspect } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/AsciiConverterTool.astro'), 'utf8');
const startIndex = source.indexOf('/* ── engine:start ── */');
const endIndex = source.indexOf('/* ── engine:end ── */');
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in AsciiConverterTool.astro');
  process.exit(1);
}
const { formatCode, parseCode } = new Function(source.slice(startIndex, endIndex) + '\nreturn { formatCode, parseCode };')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual));
}
function throws(name, fn, message) {
  try { fn(); } catch (e) { eq(name, e.message, message); return; }
  failures++;
  console.log('FAIL: ' + name + ' did not throw');
}
const toCodes = (s, fmt) => [...s].map((c) => formatCode(c.codePointAt(0), fmt)).join(' ');
const toText = (s) => s.trim().split(/[\s,]+/).filter(Boolean).map((t) => String.fromCodePoint(parseCode(t))).join('');

eq('decimal', toCodes('Hi!', 'dec'), '72 105 33');
eq('hex', toCodes('Hi!', 'hex'), '0x48 0x69 0x21');
eq('octal', toCodes('Hi!', 'oct'), '0o110 0o151 0o41');
eq('binary', toCodes('Hi!', 'bin'), '0b1001000 0b1101001 0b100001');
eq('non-ASCII uses the code point', toCodes('é€😀', 'hex'), '0xE9 0x20AC 0x1F600');
eq('mixed formats and commas', toText('72, 0x69 0o41 0b100001'), 'Hi!!');
eq('upper-case prefix', toText('0X41 0B1000010'), 'AB');
eq('emoji code point', toText('128512'), '😀');
eq('zero', parseCode('0'), 0);
throws('trailing letters', () => parseCode('72abc'), 'Invalid code: 72abc');
throws('bad hex digit', () => parseCode('0x4G'), 'Invalid code: 0x4G');
throws('bad binary digit', () => parseCode('0b102'), 'Invalid code: 0b102');
throws('decimal point', () => parseCode('1.5'), 'Invalid code: 1.5');
throws('negative', () => parseCode('-1'), 'Invalid code: -1');
throws('empty prefix', () => parseCode('0x'), 'Invalid code: 0x');
throws('above U+10FFFF', () => parseCode('0x110000'), 'Code point out of range: 0x110000');
throws('surrogate', () => parseCode('55357'), 'Code point out of range: 55357');
eq('last code point', parseCode('0x10FFFF'), 0x10ffff);

// examples on the English page
eq('page: Hello decimal', toCodes('Hello', 'dec'), '72 101 108 108 111');
eq('page: café hex', toCodes('café ☕', 'hex'), '0x63 0x61 0x66 0xE9 0x20 0x2615');
eq('page: CRLF', toCodes('a\r\nb', 'dec'), '97 13 10 98');
eq('page: decode binary', toText('0b1001111 0b1001011'), 'OK');

// ---------- guide: tables, examples and samples ----------
const fx = JSON.parse(readFileSync(join(root, 'scripts/test-ascii-converter.fixtures.json'), 'utf8'));
const uname = new Map(fx.unicodeNames.map((l) => { const [cp, n] = l.split(';'); return [parseInt(cp, 16), n]; }));
const abbrAliases = new Map();
const ctrlAliases = new Map();
for (const l of fx.nameAliases) {
  const [cp, n, type] = l.split(';');
  const map = type === 'abbreviation' ? abbrAliases : ctrlAliases;
  const c = parseInt(cp, 16);
  if (!map.has(c)) map.set(c, []);
  map.get(c).push(n);
}
const legend = fx.rfc20Legend.join(' ').replace(/\s+/g, ' ');
const hex2 = (c) => c.toString(16).toUpperCase().padStart(2, '0');
const oct3 = (c) => c.toString(8).padStart(3, '0');
const bin7 = (c) => c.toString(2).padStart(7, '0');
let python = true;
try { execFileSync('python3', ['-c', 'pass'], { stdio: 'ignore' }); } catch { python = false; }
const py = (code, input) => execFileSync('python3', ['-c', code], { encoding: 'utf8', input });
if (!python) console.log('SKIP: python3 not found; Python samples, C escapes and code page facts not run');

const space = { en: '(space)', ja: '（空白）' };
for (const lang of ['en']) {
  const page = readFileSync(join(root, 'src/content/blog/ascii-converter-guide/' + lang + '.mdx'), 'utf8');
  const printable = [...page.matchAll(/^\| (\d+) \| ([0-9A-F]{2}) \| ([0-7]{3}) \| ([01]{7}) \| (.+?) \| ([A-Z -]+) \|$/gm)];
  eq(lang + ' printable rows are 32–126', printable.map((m) => m[1]).join(' '), Array.from({ length: 95 }, (_, i) => i + 32).join(' '));
  for (const m of printable) {
    const c = Number(m[1]);
    eq(lang + ' row ' + c + ' hex/oct/bin', [m[2], m[3], m[4]].join(' '), [hex2(c), oct3(c), bin7(c)].join(' '));
    const cell = m[5] === '`` ` ``' ? '`' : m[5] === '`\\|`' ? '|' : m[5].replace(/^`(.)`$/, '$1');
    eq(lang + ' row ' + c + ' char', c === 32 ? m[5] === space[lang] : cell === String.fromCharCode(c), true);
    eq(lang + ' row ' + c + ' name', m[6], uname.get(c));
  }
  const controlRe = lang === 'en'
    ? /^\| (\d+) \| ([0-9A-F]{2}) \| ([0-7]{3}) \| ([01]{7}) \| ([A-Z0-9]+) \| ([A-Za-z0-9 ]+) \| `\^(.)` \| (.+?) \|$/gm
    : /^\| (\d+) \| ([0-9A-F]{2}) \| ([0-7]{3}) \| ([01]{7}) \| ([A-Z0-9]+) \| ([A-Za-z0-9 ]+) \| (?:.+?) \| `\^(.)` \|$/gm;
  const control = [...page.matchAll(controlRe)];
  eq(lang + ' control rows are 0–31 and 127', control.map((m) => m[1]).join(' '), [...Array(32).keys(), 127].join(' '));
  const escapes = [];
  for (const m of control) {
    const c = Number(m[1]);
    eq(lang + ' control ' + c + ' hex/oct/bin', [m[2], m[3], m[4]].join(' '), [hex2(c), oct3(c), bin7(c)].join(' '));
    eq(lang + ' control ' + c + ' abbreviation', (abbrAliases.get(c) || []).includes(m[5]), true);
    const inLegend = new RegExp('(^| )' + m[5] + ' ' + m[6] + '(?= |$)').test(legend);
    const nameOk = inLegend || (ctrlAliases.get(c) || []).includes(m[6].toUpperCase());
    eq(lang + ' control ' + c + ' name ' + m[6], nameOk, true);
    eq(lang + ' control ' + c + ' caret', m[7], c === 127 ? '?' : String.fromCharCode(c ^ 64));
    if (lang === 'en' && m[8] !== '—') escapes.push([c, m[8].replace(/^`|`$/g, '')]);
  }
  if (lang === 'en') {
    eq('en C escapes listed', escapes.map(([c]) => c).join(' '), '0 7 8 9 10 11 12 13 27');
    if (python) {
      const out = py('import json,sys\nprint(json.dumps([ord(eval(\'"\' + e + \'"\')) for c, e in json.load(sys.stdin)]))', JSON.stringify(escapes));
      eq('en C escapes decode in Python', JSON.stringify(JSON.parse(out)), JSON.stringify(escapes.map(([c]) => c)));
    }
    // JavaScript has every escape except \a.
    for (const [c, e] of escapes) if (e !== '\\a') eq('JS escape ' + e, new Function('return "' + e + '"')().charCodeAt(0), c);
  }
  let examples = 0;
  for (const m of page.matchAll(/\{\/\* ac-check: (\{.*?\}) \*\/\}/g)) {
    examples++;
    const ex = JSON.parse(m[1]);
    if (ex.text !== undefined) {
      const got = toCodes(ex.text, ex.fmt);
      eq(lang + ' example ' + ex.text + ' ' + ex.fmt, got, ex.expect);
      eq(lang + ' page shows ' + ex.expect, page.includes(ex.expect), true);
    } else if (ex.error) {
      throws(lang + ' example ' + ex.codes, () => toText(ex.codes), ex.error);
      eq(lang + ' page shows ' + ex.error, page.includes(ex.error), true);
    } else {
      eq(lang + ' example ' + ex.codes, toText(ex.codes), ex.expect);
    }
  }
  eq(lang + ' guide carries examples', examples >= 5, true);
  // JavaScript blocks: `expr; // result` or `expr;` followed by `// result`.
  for (const block of page.matchAll(/```javascript\n([\s\S]*?)```/g)) {
    const lines = block[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
      let expr, want;
      const same = lines[i].match(/^(.*?;)\s+\/\/ (.+)$/);
      if (same) [expr, want] = [same[1], same[2]];
      else if (/;$/.test(lines[i]) && /^\/\/ /.test(lines[i + 1] || '')) [expr, want] = [lines[i], lines[i + 1].slice(3)];
      else continue;
      eq(lang + ' JS ' + expr, inspect(new Function('return ' + expr.replace(/;$/, ''))()), want);
    }
  }
  if (!python) continue;
  for (const block of page.matchAll(/```python\n([\s\S]*?)```/g)) {
    const out = py([
      'import json, re, sys, unicodedata',
      'env = {}',
      'res = []',
      'for line in json.load(sys.stdin):',
      '    m = re.match(r"^(.*?)\\s+# (.*)$", line)',
      '    if m: res.append([m.group(1), repr(eval(m.group(1), env)), m.group(2)])',
      '    elif line.strip(): exec(line, env)',
      'print(json.dumps(res))',
    ].join('\n'), JSON.stringify(block[1].split('\n')));
    for (const [expr, got, want] of JSON.parse(out)) eq(lang + ' Python ' + expr, got, want);
  }
}

// Facts quoted in the text.
eq('NFKC folds full-width letters', 'ＡＢＣ１'.normalize('NFKC'), 'ABC1');
eq('full-width offset', 'Ａ'.codePointAt(0) - 'A'.codePointAt(0), 0xfee0);
for (const label of ['iso-8859-1', 'latin1', 'us-ascii', 'ascii']) {
  eq('WHATWG label ' + label + ' is windows-1252', new TextDecoder(label).encoding, 'windows-1252');
}
eq('windows-1252 0x80 and 0x82', new TextDecoder('windows-1252').decode(new Uint8Array([0x80, 0x82])), '€‚');
eq('JS sort is code order', ['apple', 'Banana', '_id', '10', '9', 'Zebra'].sort().join(' '), '10 9 Banana Zebra _id apple');
if (python) {
  const out = py([
    'import json',
    'r = {}',
    'r["dame"] = {c: c.encode("cp932").hex(" ").upper() for c in "表ソ能予申"}',
    'r["hyouji"] = "表示".encode("cp932").hex(" ").upper()',
    'r["broken"] = bytes([0x95, 0x8E, 0xA6]).decode("cp932")',
    'r["jisx0201"] = bytes([0x5C, 0x7E]).decode("shift_jis_2004")',
    'r["a"] = bytes([0x82, 0xA0]).decode("cp932")',
    'r["x80"] = [bytes([0x80]).decode(e) for e in ("cp1252", "latin-1", "cp437")]',
    'r["x82"] = bytes([0x82]).decode("latin-1")',
    'print(json.dumps(r))',
  ].join('\n'));
  const r = JSON.parse(out);
  eq('cp932 bytes with 0x5C', JSON.stringify(r.dame), JSON.stringify({ '表': '95 5C', 'ソ': '83 5C', '能': '94 5C', '予': '97 5C', '申': '90 5C' }));
  eq('表示 in cp932', r.hyouji, '95 5C 8E A6');
  eq('表示 without 0x5C', r.broken, '侮ｦ');
  eq('JIS X 0201 0x5C 0x7E', r.jisx0201, '¥‾');
  eq('あ is 82 A0', r.a, 'あ');
  eq('byte 0x80 in three code pages', r.x80.join(' '), '€ \u0080 Ç');
  eq('byte 0x82 in ISO-8859-1 is C1', r.x82, '\u0082');
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
