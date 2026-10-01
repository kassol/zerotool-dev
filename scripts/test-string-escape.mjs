// String Escape / Unescape — regression test against reference implementations
//
// Read:  src/components/tools/StringEscapeTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers and the frontmatter STRINGS table, so this
//        test cannot drift from the shipped source); src/content/tools/string-escape/*.mdx
//        (examples quoted on the tool pages are recomputed by the engine)
// Write: temporary Java / C / SQL / shell files under os.tmpdir() (deleted at the end);
//        stdout (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Every format is checked against the language itself or its reference library, not against
// expected strings written by hand:
// - JSON: escape equals JSON.stringify (and Python json.dumps with ensure_ascii); unescape
//   equals JSON.parse on 3,000 random bodies, errors where JSON.parse throws.
// - JavaScript: escaped output is evaluated as a strict-mode "", '' and `` literal and gives
//   the input back; unescape equals strict-mode evaluation on 3,000 random bodies.
// - Java: escaped output and hand-picked bodies are compiled with javac and printed.
// - C: escaped output and bodies are compiled with cc and their bytes printed.
// - Python: escape equals repr() / ascii(); unescape equals ast.literal_eval().
// - HTML: escaped output decoded by the `entities` package (WHATWG decoding) gives the input.
// - XML: escaped output parsed by Python ElementTree gives the input (text and attribute).
// - CSV: escaped output read by Python csv gives one field equal to the input.
// - SQL: standard-SQL output evaluated by sqlite3 gives the input bytes.
// - Regex: escaped output matches exactly the input with JS flags "", u, v and Python re.
// - Shell: escape equals shlex.quote; output passed through /bin/sh gives the input bytes;
//   unescape equals shlex.split on random words, $'…' equals bash.
// Tools that are not installed (javac, cc, python3, sqlite3, bash) are reported as SKIP.
//
// Before this test the tool had three formats and these bugs: JSON unescape of `say \"hi\"`
// threw "Unexpected non-whitespace character"; HTML escape wrote 😀 as two surrogate
// references (&#55357;&#56832;) that browsers decode as two U+FFFD; HTML unescape of
// &#128512; returned U+F600; JavaScript escape of NUL followed by "1" gave \01, a legacy
// octal escape (U+0001 in sloppy mode, SyntaxError in strict mode); JavaScript unescape left
// \u{1F600}, \b, \f and line continuations untouched and accepted \x4 silently.
//
// Run: node scripts/test-string-escape.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { decodeHTML } from 'entities';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/StringEscapeTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in StringEscapeTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { convert, fill, MODES, DEFAULT_OPTS, decodeUtf8, codePoints };')();

const stringsStart = source.indexOf('const STRINGS = {');
const stringsEnd = source.indexOf('\n};', stringsStart);
const STRINGS = stringsStart >= 0 && stringsEnd > stringsStart
  ? new Function(source.slice(stringsStart, stringsEnd + 3) + '\nreturn STRINGS;')()
  : null;

let failures = 0;
let passes = 0;
const skips = [];
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}
const show = (s) => JSON.stringify(s);
const env = { decodeHtml: decodeHTML };
const esc = (mode, s, o) => E.convert(mode, 'escape', s, o, env);
const une = (mode, s, o) => E.convert(mode, 'unescape', s, o, env);
const out = (r) => (r.error ? 'ERROR ' + r.error : r.output);
const hasNote = (r, key) => !!(r.notes && r.notes.some((n) => n.key === key));

function have(cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return !r.error && r.status === 0;
}
const HAVE = {
  python: have('python3'),
  javac: have('javac', ['-version']),
  cc: have('cc', ['--version']),
  sqlite: have('sqlite3', ['-version']),
  bash: have('bash', ['--version']),
};
const work = mkdtempSync(join(tmpdir(), 'zt-string-escape-'));

// Run a Python snippet that reads JSON from stdin and writes JSON to stdout.
function py(code, input) {
  const r = spawnSync('python3', ['-c', 'import sys, json\n' + code], { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error('python failed: ' + r.stderr);
  return JSON.parse(r.stdout);
}

// ── Corpus ─────────────────────────────────────────────────────────────────────
let seed = 20261001;
function rand() { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
function pick(a) { return a[Math.floor(rand() * a.length)]; }
const ATOMS = ['a', 'Z', '0', '1', '7', '8', ' ', '"', "'", '`', '\\', '/', '$', '{', '}', '?', '?', '&', '<', '>', ';', ',', '=', '-', '+', '@', '*', '.', '(', '|', '#', '~',
  '\n', '\r', '\r\n', '\t', '\0', '\x01', '\x1b', '\x1a', '\x7f', '\u0085', '\u00a0', '\u00e9', '\u4e2d', '\u6587', '\ud55c', '\u3042', '\uff76',
  '\u200b', '\u200d', '\u202e', '\ufeff', '\u2028', '\u2029', '\u3164', '\u{1F600}', '\u{1F468}\u200d\u{1F469}', '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', '\uD800', '\uDC00'];
function randomString(atoms = ATOMS, max = 12) {
  let s = '';
  const n = Math.floor(rand() * max) + 1;
  for (let i = 0; i < n; i++) s += pick(atoms);
  return s;
}
const FIXED = ['', 'abc', 'He said "hi"', "it's", 'C:\\temp\\new', 'a\0' + '1', '\0', 'line1\nline2\r\n', 'tab\there', '${name}', '`tick`', '??=', '???', '\\u0041',
  '中文', '한글', 'こんにちは', '😀', '👨‍👩‍👧', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'e\u0301', '\u2028\u2029', '\u200b\u202e\ufeff', '\u3164', '\u0085', '\x7f', '\x1a'];
const noLone = (s) => !/[\uD800-\uDFFF]/u.test(s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''));
const CORPUS = FIXED.concat(Array.from({ length: 400 }, () => randomString()));
const CORPUS_WF = CORPUS.filter(noLone); // well-formed: no unpaired surrogates

// ── Engine surface ─────────────────────────────────────────────────────────────
eq('11 formats', E.MODES, ['json', 'js', 'java', 'c', 'python', 'html', 'xml', 'csv', 'sql', 'regex', 'shell']);
for (const m of E.MODES) {
  check(m + ': escape returns output', typeof esc(m, 'abc').output === 'string');
  const r = une(m, 'abc');
  check(m + ': unescape returns output', typeof r.output === 'string', show(r));
}

// ── JSON ───────────────────────────────────────────────────────────────────────
{
  let bad = [];
  for (const s of CORPUS) {
    if (esc('json', s).output !== JSON.stringify(s).slice(1, -1)) bad.push(s);
    const back = une('json', esc('json', s).output);
    if (back.output !== s) bad.push('round trip ' + s);
    const backA = une('json', esc('json', s, { jsonAscii: true }).output);
    if (backA.output !== s) bad.push('ascii round trip ' + s);
  }
  eq('JSON escape equals JSON.stringify and round-trips (' + CORPUS.length + ' strings)', bad.map(show), []);
  if (HAVE.python) {
    const ref = py('print(json.dumps([json.dumps(s)[1:-1] for s in json.load(sys.stdin)]))', CORPUS);
    bad = CORPUS.filter((s, i) => esc('json', s, { jsonAscii: true }).output !== ref[i]);
    eq('JSON ASCII-only escape equals Python json.dumps(ensure_ascii=True)', bad.map(show), []);
  } else skips.push('Python json.dumps');
  // unescape vs JSON.parse
  const TOK = ['a', '0', 'F', 'u', 'x', '/', ' ', 'é', '\\"', '\\\\', '\\/', '\\b', '\\f', '\\n', '\\r', '\\t', '\\u0041', '\\u00e9', '\\ud83d', '\\ude00', '\\u12', '\\x41', "\\'", '\\a', '\\', '"', '\n', '\t'];
  bad = [];
  for (let k = 0; k < 3000; k++) {
    let body = '';
    const n = Math.floor(rand() * 6) + 1;
    for (let i = 0; i < n; i++) body += pick(TOK);
    if (/^\s*".*"\s*$/s.test(body)) continue; // whole-literal input is unwrapped on purpose
    let expected;
    try { expected = JSON.parse('"' + body + '"'); } catch { expected = null; }
    const r = une('json', body);
    if (expected === null ? !r.error : r.output !== expected) bad.push(body + ' → ' + out(r));
  }
  eq('JSON unescape agrees with JSON.parse on 3,000 random bodies', bad.slice(0, 5), []);
  eq('JSON unescape of escaped quotes (was a SyntaxError)', out(une('json', 'say \\"hi\\"')), 'say "hi"');
  eq('JSON unescape of double-encoded JSON', out(une('json', '{\\"a\\":1,\\"b\\":\\"\\u4e2d\\"}')), '{"a":1,"b":"中"}');
  const lit = une('json', '  "a\\nb"\n');
  eq('JSON unescape removes the surrounding quotes of a whole literal', out(lit), 'a\nb');
  check('JSON: unwrapped note', hasNote(lit, 'unwrapped'));
  const e1 = une('json', 'abc\\q');
  eq('JSON: \\q error and position', [e1.error, e1.pos, e1.seq], ['badEscape', 4, '\\q']);
  eq("JSON: \\' has its own hint", une('json', "it\\'s").error, 'jsonSingleQuote');
  eq('JSON: \\x has its own hint', une('json', '\\x41').error, 'jsonHex');
  eq('JSON: short \\u', [une('json', 'a\\u12').error, une('json', 'a\\u12').seq], ['badU4', '\\u12']);
  const e2 = une('json', 'one\ntwo');
  eq('JSON: raw line break is an error with line and column', [e2.error, e2.line, e2.col, e2.cp, e2.fix], ['rawControl', 1, 4, 'U+000A', '\\n']);
  const e3 = une('js', 'ab\nc\\x4');
  eq('errors on line 2 give line and column', [e3.error, e3.line, e3.col, e3.multiline], ['badHex2', 2, 2, true]);
  eq('JSON: unescaped quote', [une('json', 'ab"c').error, une('json', 'ab"c').pos], ['rawQuote', 3]);
  eq('JSON: trailing backslash', une('json', 'abc\\').error, 'trailingBackslash');
  check('JSON: lone surrogate result is reported', hasNote(une('json', '\\ud800'), 'loneResult'));
  check('JSON: lone surrogate input is reported', hasNote(esc('json', 'a\uD800'), 'loneEscaped'));
  eq('JSON ASCII-only: 中文 😀', esc('json', '中文 😀', { jsonAscii: true }).output, '\\u4e2d\\u6587 \\ud83d\\ude00');
  eq('JSON keeps U+2028 raw unless ASCII-only (as JSON.stringify)', [esc('json', '\u2028').output, esc('json', '\u2028', { jsonAscii: true }).output], ['\u2028', '\\u2028']);
}

// ── JavaScript ─────────────────────────────────────────────────────────────────
{
  const evalLit = (q, body) => new Function('"use strict"; return ' + q + body + q + ';')();
  let bad = [];
  for (const q of ['"', "'", '`']) {
    for (const mode of ['escape', 'braces', 'keep']) {
      for (const s of CORPUS) {
        const o = esc('js', s, { jsQuote: q, jsNonAscii: mode }).output;
        let v;
        try { v = evalLit(q, o); } catch (e) { v = 'THROWS ' + e.message; }
        if (v !== s) bad.push(q + mode + ' ' + show(s) + ' → ' + show(o));
        // A value that starts and ends with an unescaped quote of another kind ("`tick`")
        // is read back as a quoted literal; the tool says so in a note.
        const back = une('js', o);
        if (out(back) !== s && !hasNote(back, 'unwrapped')) bad.push('round trip ' + q + mode + ' ' + show(s));
      }
    }
  }
  eq('JavaScript escape evaluates back to the input in strict mode ("", \'\', ``; 3 non-ASCII modes)', bad.slice(0, 5), []);
  eq('JavaScript default writes non-ASCII as \\uXXXX', esc('js', '中 😀 \u200b \u202e').output, '\\u4e2d \\ud83d\\ude00 \\u200b \\u202e');
  eq('JavaScript \\u{…} mode', esc('js', 'é😀', { jsNonAscii: 'braces' }).output, '\\u00e9\\u{1f600}');
  eq('JavaScript keep mode keeps visible text, escapes invisible characters',
    esc('js', '中文 é 😀 \u200b\u00a0\ufeff\u3164\u0085 👨‍👩‍👧 🏴󠁧󠁢󠁳󠁣󠁴󠁿', { jsNonAscii: 'keep' }).output,
    '中文 é 😀 \\u200b\\u00a0\\ufeff\\u3164\\x85 👨‍👩‍👧 🏴󠁧󠁢󠁳󠁣󠁴󠁿');
  eq('JavaScript NUL before a digit is \\x00 (was the legacy octal \\01)', esc('js', 'a\u00001').output, 'a\\x001');
  eq('JavaScript NUL alone is \\0', esc('js', 'a\u0000b').output, 'a\\0b');
  eq('JavaScript always escapes U+2028 / U+2029', esc('js', '\u2028\u2029', { jsNonAscii: 'keep' }).output, '\\u2028\\u2029');
  eq('JavaScript template literal escapes ` and ${ only', esc('js', '`a` ${b} $c "d"', { jsQuote: '`' }).output, '\\`a\\` \\${b} $c "d"');
  eq('JavaScript single quote mode leaves " alone', esc('js', `"it's"`, { jsQuote: "'" }).output, `"it\\'s"`);

  const TOK = ['a', '0', '1', '8', 'x', 'u', '{', '}', 'F', '$', '`', "'", ' ', 'é', '😀',
    '\\n', '\\b', '\\f', '\\v', '\\0', '\\00', '\\01', '\\1', '\\7', '\\8', '\\9', '\\x4', '\\x41', '\\u004', '\\u0041', '\\u{1F600}', '\\u{110000}', '\\u{}', '\\a', '\\q', '\\"', "\\'", '\\\\', '\\\n', '\\\r\n', '\\\u2028', '\\`', '\\$', '\\😀'];
  bad = [];
  for (let k = 0; k < 3000; k++) {
    let body = '';
    const n = Math.floor(rand() * 6) + 1;
    for (let i = 0; i < n; i++) body += pick(TOK);
    if (/^\s*(["'`]).*\1\s*$/s.test(body)) continue;
    let expected;
    try { expected = evalLit('"', body); } catch { expected = null; }
    const r = une('js', body);
    if (expected === null ? !r.error : r.output !== expected) bad.push(show(body) + ' → ' + out(r));
  }
  eq('JavaScript unescape agrees with strict-mode evaluation on 3,000 random bodies', bad.slice(0, 5), []);
  eq('JavaScript unescape: \\u{1F600}, \\b, \\f (were left as is)', out(une('js', '\\u{1F600}\\b\\f')), '😀\b\f');
  const oct = une('js', 'a\\01b');
  eq('JavaScript unescape: legacy octal error suggests \\x', [oct.error, oct.seq, oct.fix, oct.pos], ['jsOctal', '\\01', '\\x01', 2]);
  eq('JavaScript unescape: \\x4 is an error (was kept silently)', une('js', '\\x4').error, 'badHex2');
  const id = une('js', 'C:\\new\\data');
  eq('JavaScript unescape: \\d gives d with a note', [out(id), hasNote(id, 'jsIdentity')], ['C:\newdata', true]);
  eq('JavaScript unescape: whole quoted literal', out(une('js', "'it\\'s'")), "it's");
  eq('JavaScript unescape: "a" + "b" is not unwrapped', out(une('js', '"a" + "b"')), '"a" + "b"');
}

// ── Java ───────────────────────────────────────────────────────────────────────
function javaRun(literals) {
  // Prints every literal's UTF-16 code units in hex, one literal per line.
  const dir = mkdtempSync(join(work, 'java-'));
  const lines = literals.map((l, i) => `    s[${i}] = "${l}";`).join('\n');
  const prog = `public class T {\n  public static void main(String[] a) throws Exception {\n    String[] s = new String[${literals.length}];\n${lines}\n    StringBuilder sb = new StringBuilder();\n    for (String x : s) { for (int i = 0; i < x.length(); i++) { if (i > 0) sb.append(' '); sb.append(Integer.toHexString(x.charAt(i))); } sb.append('\\n'); }\n    System.out.write(sb.toString().getBytes("US-ASCII"));\n  }\n}\n`;
  writeFileSync(join(dir, 'T.java'), prog, 'utf8');
  const c = spawnSync('javac', ['-encoding', 'UTF-8', 'T.java'], { cwd: dir, encoding: 'utf8' });
  if (c.status !== 0) return { error: c.stderr };
  const r = spawnSync('java', ['-cp', dir, 'T'], { encoding: 'utf8' });
  return { lines: r.stdout.split('\n').slice(0, literals.length) };
}
const units = (s) => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16)).join(' ');
{
  let bad = [];
  for (const s of CORPUS) {
    for (const m of ['escape', 'keep']) if (out(une('java', esc('java', s, { javaNonAscii: m }).output)) !== s) bad.push(m + ' ' + show(s));
  }
  eq('Java escape round-trips through unescape', bad.slice(0, 5), []);
  eq('Java escape: line break is \\n, not \\u000a (javac would see a real line break)', esc('java', 'a\nb"').output, 'a\\nb\\"');
  eq('Java escape: \\u0041 typed as text stays text', esc('java', '\\u0041').output, '\\\\u0041');
  eq('Java escape: non-ASCII as \\uXXXX', esc('java', '日本語😀').output, '\\u65e5\\u672c\\u8a9e\\ud83d\\ude00');
  if (HAVE.javac) {
    const lits = [];
    const expected = [];
    for (const s of CORPUS.slice(0, 250)) {
      for (const m of ['escape', 'keep']) { lits.push(esc('java', s, { javaNonAscii: m }).output); expected.push(units(s)); }
    }
    const r = javaRun(lits);
    if (r.error) check('javac compiles the escaped literals', false, r.error.slice(0, 400));
    else {
      bad = lits.filter((l, i) => r.lines[i] !== expected[i]);
      eq('javac: ' + lits.length + ' escaped literals equal the input', bad.slice(0, 5), []);
    }
    const bodies = ['a\\bb\\sc\\td\\ne\\ff\\rg\\"h\\\'i\\\\j', '\\0\\7\\07\\377\\400\\1234', '\\u0041\\uuu0042', '\\\\u0041', '\\\\\\u0041', '\\u005cn', '\\u005c\\u005c', '中\\u6587😀', '\\uD83D\\uDE00'];
    const r2 = javaRun(bodies);
    if (r2.error) check('javac compiles the unescape bodies', false, r2.error.slice(0, 400));
    else bodies.forEach((b, i) => eq('Java unescape equals javac: ' + b, units(out(une('java', b))), r2.lines[i]));
    for (const b of ['\\u000a', '\\u0022', '\\q', '\\u00g1', '"']) {
      const single = javaRun([b]);
      check('javac rejects ' + show(b), !!single.error);
    }
  } else skips.push('javac');
  const lt = une('java', 'a\\u000ab');
  eq('Java unescape: \\u000a is reported (javac sees a line break)', [lt.error, lt.seq, lt.fix], ['javaUnicodeLineTerm', '\\u000a', '\\n']);
  eq('Java unescape: \\u0022 is reported', une('java', '\\u0022').error, 'javaUnicodeQuote');
  eq('Java unescape: \\q', une('java', 'a\\qb').error, 'badEscape');
  eq('Java unescape: raw quote', une('java', 'a"b').error, 'rawQuote');
  eq('Java unescape: Java 15 \\s is a space', out(une('java', 'a\\sb')), 'a b');
}

// ── C / C++ ────────────────────────────────────────────────────────────────────
function cRun(literals, extra = []) {
  const dir = mkdtempSync(join(work, 'c-'));
  const body = literals.map((l, i) => `  { static const char s${i}[] = "${l}"; dump(s${i}, sizeof s${i} - 1); }`).join('\n');
  const prog = `#include <stdio.h>\nstatic void dump(const char *s, unsigned long n) { for (unsigned long i = 0; i < n; i++) printf(i ? " %02x" : "%02x", (unsigned char)s[i]); printf("\\n"); }\nint main(void) {\n${body}\n  return 0;\n}\n`;
  writeFileSync(join(dir, 't.c'), prog, 'utf8');
  const c = spawnSync('cc', ['-std=c11', '-Werror=trigraphs', ...extra, '-o', join(dir, 't'), join(dir, 't.c')], { encoding: 'utf8' });
  if (c.status !== 0) return { error: c.stderr };
  const r = spawnSync(join(dir, 't'), [], { encoding: 'utf8' });
  return { lines: r.stdout.split('\n').slice(0, literals.length) };
}
const utf8hex = (s) => [...Buffer.from(s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD'), 'utf8')].map((b) => b.toString(16).padStart(2, '0')).join(' ');
{
  let bad = [];
  for (const s of CORPUS_WF) {
    for (const m of ['octal', 'ucn', 'keep']) if (out(une('c', esc('c', s, { cNonAscii: m }).output)) !== s) bad.push(m + ' ' + show(s));
  }
  eq('C escape round-trips through unescape', bad.slice(0, 5), []);
  eq('C escape: UTF-8 bytes as octal', esc('c', '中').output, '\\344\\270\\255');
  eq('C escape: ?? is broken up (trigraph)', esc('c', '??=').output, '?\\?=');
  eq('C escape: control characters as 3-digit octal', esc('c', '\x01' + '9\x1b').output, '\\0019\\033');
  if (HAVE.cc) {
    const lits = [];
    const expected = [];
    for (const s of CORPUS.slice(0, 250)) {
      for (const m of ['octal', 'ucn', 'keep']) { lits.push(esc('c', s, { cNonAscii: m }).output); expected.push(utf8hex(s)); }
    }
    const r = cRun(lits, ['-trigraphs']);
    if (r.error) check('cc compiles the escaped literals', false, r.error.slice(0, 400));
    else {
      bad = lits.filter((l, i) => r.lines[i] !== expected[i]);
      eq('cc: ' + lits.length + ' escaped literals equal the UTF-8 bytes of the input (trigraphs on)', bad.slice(0, 5), []);
    }
    const bodies = ['\\a\\b\\f\\n\\r\\t\\v\\?\\\'\\"\\\\', '\\0\\7\\101\\1012', '\\x41\\x4a', '\\u00e9\\U0001F600', '\\344\\270\\255', 'ab\\\ncd', '\\xe4\\xb8\\xad'];
    const r2 = cRun(bodies);
    if (r2.error) check('cc compiles the unescape bodies', false, r2.error.slice(0, 400));
    else bodies.forEach((b, i) => eq('C unescape equals cc: ' + show(b), utf8hex(out(une('c', b))), r2.lines[i]));
    check('cc rejects \\x41BC (hex escape sequence out of range)', !!cRun(['\\x41BC']).error);
    check('cc rejects \\777 (octal escape sequence out of range)', !!cRun(['\\777']).error);
  } else skips.push('cc');
  const hx = une('c', '\\x41BC');
  eq('C unescape: \\x41BC reads every hex digit and overflows', [hx.error, hx.seq], ['cHexRange', '\\x41BC']);
  eq('C unescape: \\777 is above \\377', une('c', '\\777').error, 'cOctalRange');
  const nu = une('c', '\\xff\\xfe');
  check('C unescape: invalid UTF-8 is reported', hasNote(nu, 'notUtf8'), show(nu));
  eq('C unescape: \\e is not standard', une('c', '\\e').error, 'badEscape');
}

// ── Python ─────────────────────────────────────────────────────────────────────
{
  let bad = [];
  for (const s of CORPUS) {
    for (const q of ["'", '"']) for (const a of [false, true]) if (out(une('python', esc('python', s, { pyQuote: q, pyAscii: a }).output)) !== s) bad.push(q + a + show(s));
  }
  eq('Python escape round-trips through unescape', bad.slice(0, 5), []);
  if (HAVE.python) {
    // repr() picks its own quote; compare with the same quote. Characters whose category
    // changed between Unicode versions are not in the corpus.
    const ref = py("out = []\nfor s in json.load(sys.stdin):\n  r = repr(s); a = ascii(s)\n  out.append([r[0], r[1:-1], a[0], a[1:-1]])\nprint(json.dumps(out))", CORPUS);
    bad = [];
    CORPUS.forEach((s, i) => {
      const [rq, rb, aq, ab] = ref[i];
      if (esc('python', s, { pyQuote: rq }).output !== rb) bad.push('repr ' + show(s) + ' ' + show(esc('python', s, { pyQuote: rq }).output) + ' vs ' + show(rb));
      if (esc('python', s, { pyQuote: aq, pyAscii: true }).output !== ab) bad.push('ascii ' + show(s));
    });
    eq('Python escape equals repr() / ascii() on ' + CORPUS.length + ' strings', bad.slice(0, 5), []);
    const TOK = ['a', '0', '8', 'x', 'é', '😀', ' ', '"', '\\\\', "\\'", '\\"', '\\a', '\\b', '\\f', '\\n', '\\r', '\\t', '\\v', '\\0', '\\7', '\\101', '\\777', '\\x41', '\\u00e9', '\\U0001F600', '\\q', '\\d', '\\\n'];
    const bodies = [];
    for (let k = 0; k < 2000; k++) {
      let b = '';
      const n = Math.floor(rand() * 6) + 1;
      for (let i = 0; i < n; i++) b += pick(TOK);
      if (/^\s*(["']).*\1\s*$/s.test(b)) continue;
      bodies.push(b);
    }
    const ref2 = py("import ast, warnings\nwarnings.simplefilter('ignore')\nout = []\nfor b in json.load(sys.stdin):\n  try: out.append(ast.literal_eval(\"'''\" + b + \"'''\"))\n  except Exception as e: out.append(None)\nprint(json.dumps(out))", bodies);
    bad = bodies.filter((b, i) => (b.endsWith("'") ? false : (ref2[i] === null ? !une('python', b).error : out(une('python', b)) !== ref2[i])));
    eq('Python unescape equals ast.literal_eval on ' + bodies.length + ' random bodies', bad.slice(0, 5).map(show), []);
  } else skips.push('Python repr / literal_eval');
  eq('Python escape: printable non-ASCII kept like repr()', esc('python', "中 😀 é\u200b\u00a0").output, '中 😀 é\\u200b\\xa0');
  eq('Python \\N{…} is not supported and says so', une('python', '\\N{BULLET}').error, 'pyNamed');
  const inv = une('python', 'C:\\data');
  eq('Python unknown escape keeps the backslash with a note', [out(inv), hasNote(inv, 'pyInvalid')], ['C:\\data', true]);
}

// ── HTML ───────────────────────────────────────────────────────────────────────
{
  let bad = [];
  for (const s of CORPUS_WF) {
    for (const a of [false, true]) {
      const o = esc('html', s, { htmlNonAscii: a }).output;
      if (decodeHTML(o) !== s) bad.push(a + ' ' + show(s) + ' → ' + show(o));
    }
  }
  eq('HTML escape decodes back to the input (entities.decodeHTML, WHATWG rules)', bad.slice(0, 5), []);
  eq('HTML escape of 😀 is one reference (was &#55357;&#56832;)', esc('html', '😀', { htmlNonAscii: true }).output, '&#x1F600;');
  eq('HTML escape default only escapes & < > " \'', esc('html', `<a href="?a=1&b=2">Tom's 中文</a>`).output, '&lt;a href=&quot;?a=1&amp;b=2&quot;&gt;Tom&#39;s 中文&lt;/a&gt;');
  const c1 = esc('html', '\u0080', { htmlNonAscii: true });
  eq('HTML escape keeps C1 controls raw (&#x80; would decode to €)', [c1.output, hasNote(c1, 'htmlC1'), decodeHTML('&#x80;')], ['\u0080', true, '€']);
  eq('HTML unescape uses the WHATWG decoder (&#128512; was U+F600)', out(une('html', '&#128512; &notit; &amp &#x80;')), '😀 ¬it; & €');
}

// ── XML ────────────────────────────────────────────────────────────────────────
{
  const xmlOk = CORPUS_WF.filter((s) => !/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/.test(s));
  let bad = [];
  for (const s of xmlOk) if (out(une('xml', esc('xml', s).output)) !== s) bad.push(show(s));
  eq('XML escape round-trips through unescape', bad.slice(0, 5), []);
  if (HAVE.python) {
    const docs = xmlOk.map((s) => `<a b="${esc('xml', s, { xmlAttr: true }).output}">${esc('xml', s).output}</a>`);
    const ref = py("import xml.etree.ElementTree as ET\nout = []\nfor d in json.load(sys.stdin):\n  e = ET.fromstring(d)\n  out.append([e.text or '', e.get('b')])\nprint(json.dumps(out))", docs);
    bad = xmlOk.filter((s, i) => ref[i][0] !== s || ref[i][1] !== s);
    eq('XML: ElementTree reads text and attribute values back unchanged (' + xmlOk.length + ')', bad.slice(0, 5).map(show), []);
  } else skips.push('ElementTree');
  eq('XML escape writes CR as &#xD; (parsers turn raw CR into LF)', esc('xml', 'a\r\nb').output, 'a&#xD;\nb');
  eq('XML attribute mode also escapes tab and LF', esc('xml', 'a\tb\nc', { xmlAttr: true }).output, 'a&#x9;b&#xA;c');
  const inv = esc('xml', 'a\u0001b');
  eq('XML escape: U+0001 cannot be represented', [inv.error, inv.cp, inv.pos], ['xmlInvalidChar', 'U+0001', 2]);
  eq('XML unescape: &#1; is not allowed', une('xml', '&#1;').error, 'xmlBadCharRef');
  const nb = une('xml', 'a&nbsp;b & c');
  eq('XML unescape keeps &nbsp; and bare & with notes', [out(nb), hasNote(nb, 'xmlUnknownEntity'), hasNote(nb, 'xmlBareAmp')], ['a&nbsp;b & c', true, true]);
  eq('XML unescape: 5 entities and numeric references', out(une('xml', '&lt;&gt;&amp;&quot;&apos;&#20013;&#x1F600;')), '<>&"\'中😀');
}

// ── CSV ────────────────────────────────────────────────────────────────────────
{
  const vals = CORPUS_WF.filter((s) => s !== '' && !s.includes('\0'));
  let bad = [];
  for (const d of [',', ';', '\t']) for (const s of vals) if (out(une('csv', esc('csv', s, { csvDelim: d }).output, { csvDelim: d })) !== s && !(esc('csv', s, { csvDelim: d }).output === s)) bad.push(show(d) + show(s));
  eq('CSV escape round-trips through unescape', bad.slice(0, 5), []);
  if (HAVE.python) {
    const cases = [];
    for (const d of [',', ';', '\t']) for (const s of vals) for (const always of [false, true]) cases.push({ d, s, o: esc('csv', s, { csvDelim: d, csvAlways: always }).output });
    const ref = py("import csv, io\nout = []\nfor c in json.load(sys.stdin):\n  rows = list(csv.reader(io.StringIO(c['o'], newline=''), delimiter=c['d']))\n  out.append(rows)\nprint(json.dumps(out))", cases);
    bad = cases.filter((c, i) => JSON.stringify(ref[i]) !== JSON.stringify([[c.s]]));
    eq('CSV: Python csv reads exactly one field equal to the input (' + cases.length + ')', bad.slice(0, 5).map((c) => show(c.s) + ' → ' + show(c.o)), []);
  } else skips.push('Python csv');
  eq('CSV: quotes only when needed', [esc('csv', 'abc').output, esc('csv', 'a,b').output, esc('csv', 'say "hi"').output], ['abc', '"a,b"', '"say ""hi"""']);
  const f = esc('csv', '=HYPERLINK("http://x")');
  check('CSV: formula start is reported', hasNote(f, 'csvFormulaRisk'));
  eq('CSV: formula guard adds \'', esc('csv', '=1+1', { csvFormula: true }).output, "'=1+1");
  eq('CSV unescape errors', [une('csv', '"abc').error, une('csv', '"a"b"').error, une('csv', 'a"b').error], ['csvUnclosed', 'csvAfterQuote', 'csvBareQuote']);
  const nq = une('csv', 'a,b,c');
  eq('CSV unescape of an unquoted row', [out(nq), hasNote(nq, 'csvNotQuoted'), (nq.notes.find((n) => n.key === 'csvFields') || {}).n], ['a,b,c', true, 3]);
}

// ── SQL ────────────────────────────────────────────────────────────────────────
{
  // The sqlite3 shell drops a CR at the end of each input line, so CR is left out of its check.
  const vals = CORPUS_WF.filter((s) => !s.includes('\0') && !s.includes('\r'));
  eq('SQL standard escape doubles single quotes', esc('sql', "O'Brien's").output, "O''Brien''s");
  check('SQL escape always carries the OWASP note', hasNote(esc('sql', 'x'), 'sqlOwasp') && hasNote(esc('sql', 'x', { sqlDialect: 'mysql' }), 'sqlOwasp'));
  check('SQL standard escape warns about backslashes for MySQL', hasNote(esc('sql', 'C:\\new'), 'sqlBackslash'));
  eq('SQL MySQL escape (mysql_real_escape_string set)', esc('sql', "\\'\"\0\n\r\x1a\t", { sqlDialect: 'mysql' }).output, "\\\\\\'\\\"\\0\\n\\r\\Z\t");
  let bad = [];
  for (const d of ['standard', 'mysql']) for (const s of CORPUS_WF) if (out(une('sql', esc('sql', s, { sqlDialect: d }).output, { sqlDialect: d })) !== s) bad.push(d + show(s));
  eq('SQL escape round-trips through unescape', bad.slice(0, 5), []);
  if (HAVE.sqlite) {
    const sql = vals.map((s) => `SELECT hex(CAST('${esc('sql', s).output}' AS BLOB));`).join('\n');
    const file = join(work, 't.sql');
    writeFileSync(file, sql, 'utf8');
    const r = spawnSync('sqlite3', [':memory:', '.read ' + file], { encoding: 'utf8' });
    const lines = r.stdout.split('\n');
    bad = vals.filter((s, i) => (lines[i] || '').toLowerCase() !== utf8hex(s).replace(/ /g, ''));
    eq('sqlite3 reads ' + vals.length + ' escaped literals back as the input bytes', bad.slice(0, 5).map(show), []);
  } else skips.push('sqlite3');
  const lone = une('sql', "O'Brien");
  eq('SQL unescape: lone quote', [lone.error, lone.pos], ['sqlLoneQuote', 2]);
  eq("SQL unescape of a quoted literal 'O''Brien'", out(une('sql', "'O''Brien'")), "O'Brien");
  eq('MySQL unescape: Table 11.1, \\% stays \\%, unknown \\x is x', out(une('sql', "\\0\\'\\\"\\b\\n\\r\\t\\Z\\\\\\%\\_\\x", { sqlDialect: 'mysql' })), "\0'\"\b\n\r\t\x1a\\\\%\\_x");
}

// ── Regex ──────────────────────────────────────────────────────────────────────
{
  let bad = [];
  for (const s of CORPUS_WF) {
    const o = esc('regex', s).output;
    for (const fl of ['', 'u', 'v']) {
      let ok;
      try { ok = new RegExp('^(?:' + o + ')$', fl).test(s); } catch (e) { ok = false; }
      if (!ok) bad.push(fl + ' ' + show(s) + ' → ' + show(o));
    }
    if (out(une('regex', o)) !== s) bad.push('round trip ' + show(s));
  }
  eq('Regex escape matches exactly the input with flags "", u, v and round-trips', bad.slice(0, 5), []);
  if (HAVE.python) {
    const pats = CORPUS_WF.map((s) => esc('regex', s).output);
    const ref = py("import re\nd = json.load(sys.stdin)\nprint(json.dumps([bool(re.fullmatch(p, s)) for p, s in zip(d[0], d[1])]))", [pats, CORPUS_WF]);
    bad = CORPUS_WF.filter((s, i) => !ref[i]);
    eq('Python re.fullmatch accepts every escaped pattern', bad.slice(0, 5).map(show), []);
  } else skips.push('Python re');
  eq('Regex escape', esc('regex', 'price: $9.99 (USD)? a/b').output, 'price: \\$9\\.99 \\(USD\\)\\? a\\/b');
  eq('Regex escape leaves - alone (\\- is a SyntaxError with the u flag)', esc('regex', 'a-b').output, 'a-b');
  eq('Regex unescape errors', [une('regex', 'a.b').error, une('regex', '\\d+').error, une('regex', '(a)\\1').error], ['regexMeta', 'regexClass', 'regexMeta']);
  eq('Regex unescape: backreference', une('regex', 'a\\1').error, 'regexBackref');
}

// ── Shell ──────────────────────────────────────────────────────────────────────
{
  const vals = CORPUS_WF.filter((s) => !s.includes('\0'));
  if (HAVE.python) {
    const ref = py('import shlex\nprint(json.dumps([shlex.quote(s) for s in json.load(sys.stdin)]))', vals);
    const bad = vals.filter((s, i) => esc('shell', s).output !== ref[i]);
    eq('Shell escape equals shlex.quote on ' + vals.length + ' strings', bad.slice(0, 5).map(show), []);
  } else skips.push('shlex.quote');
  {
    const file = join(work, 't.sh');
    writeFileSync(file, vals.map((s) => `printf '%s\\0' ${esc('shell', s).output}`).join('\n') + '\n', 'utf8');
    const r = spawnSync('/bin/sh', [file]);
    const parts = r.stdout.toString('utf8').split('\0');
    const bad = vals.filter((s, i) => parts[i] !== s);
    eq('/bin/sh prints every quoted value back unchanged (' + vals.length + ')', bad.slice(0, 5).map(show), []);
  }
  let bad = [];
  for (const s of vals) if (out(une('shell', esc('shell', s).output)) !== s) bad.push(show(s));
  eq('Shell escape round-trips through unescape', bad.slice(0, 5), []);
  {
    // Reference: the shell itself. (Python's shlex.split is not POSIX inside double quotes:
    // it keeps the backslash of "\$" and "\`".)
    // bash is used when present: dash (/bin/sh on Debian and Ubuntu) may not support $'…'.
    const TOK = ['a', 'é', '😀', '.', '-', '=', '\\ ', '\\\\', '\\"', "\\'", '\\a', "'x y'", "'it'\"'\"'s'", '"a b"', '"\\$"', '"\\`"', '"\\a"', '"\\""', '"\\\\"', '"it\'s"', "''", '""'].concat(HAVE.bash ? ["$'\\n'", "$'\\x41'"] : []);
    const words = [];
    for (let k = 0; k < 1000; k++) {
      let w = '';
      const n = Math.floor(rand() * 4) + 1;
      for (let i = 0; i < n; i++) w += pick(TOK);
      words.push(w);
    }
    const file = join(work, 'u.sh');
    writeFileSync(file, words.map((w) => `printf '%s\\0' ${w}`).join('\n') + '\n', 'utf8');
    const parts = spawnSync(HAVE.bash ? 'bash' : '/bin/sh', [file]).stdout.toString('utf8').split('\0');
    bad = words.filter((w, i) => out(une('shell', w)) !== parts[i]);
    eq('Shell unescape equals the shell on 1,000 random words', bad.slice(0, 5).map(show), []);
  }
  if (HAVE.bash) {
    const major = Number((spawnSync('bash', ['-c', 'echo ${BASH_VERSINFO[0]}${BASH_VERSINFO[1]}'], { encoding: 'utf8' }).stdout || '0').trim());
    const ansi = ["$'a\\nb'", "$'tab\\there'", "$'\\x41\\101'", "$'it\\'s'", "$'\\e[1m'", "$'\\cA'", "$'\\q'", "pre$'\\t'post"];
    if (major >= 42) ansi.push("$'\\u00e9\\U0001F600'");
    else skips.push('bash 4.2+ for $\'\\u\' (found ' + major + ')');
    for (const a of ansi) {
      const r = spawnSync('bash', ['-c', "printf '%s' " + a]);
      eq('Shell $\'…\' equals bash: ' + a, out(une('shell', a)), r.stdout.toString('utf8'));
    }
  } else skips.push('bash');
  eq("Shell $'\\u00e9\\U0001F600' (bash 4.2+)", out(une('shell', "$'\\u00e9\\U0001F600'")), 'é😀');
  eq('Shell escape', [esc('shell', "it's").output, esc('shell', 'safe-name_1.txt').output, esc('shell', '').output], ["'it'\"'\"'s'", 'safe-name_1.txt', "''"]);
  eq('Shell unescape errors', [une('shell', '$HOME/x').error, une('shell', 'a b').error, une('shell', "'abc").error, une('shell', 'a|b').error, une('shell', '"$(id)"').error],
    ['shellExpansion', 'shellWords', 'shellUnclosed', 'shellOperator', 'shellExpansion']);
  eq('Shell unescape: printf %q style', out(une('shell', 'hello\\ world\\!')), 'hello world!');
  check('Shell unescape: unquoted * is reported', hasNote(une('shell', 'a*'), 'shellGlob'));
}

// ── Yen / won signs ───────────────────────────────────────────────────────────
{
  const y = une('json', 'C:¥new¥data');
  eq('¥n is not an escape; the note names the character', [out(y), (y.notes.find((n) => n.key === 'backslashLookalike') || {}).cp], ['C:¥new¥data', 'U+00A5']);
  check('₩n in Java mode gets the same note', hasNote(une('java', 'a₩nb'), 'backslashLookalike'));
  check('no note for ¥100 or ¥0', !hasNote(une('json', '¥100 ¥0'), 'backslashLookalike'));
}

// ── Positions ──────────────────────────────────────────────────────────────────
{
  const r = une('json', '😀😀\\q');
  eq('positions count code points, not UTF-16 units', r.pos, 3);
  const m = une('json', 'a\\n\nb\\q');
  eq('multi-line errors give line and column', [m.error, m.line, m.col], ['rawControl', 1, 4]);
}

// ── Performance ────────────────────────────────────────────────────────────────
{
  const big = 'He said "hi" 中文 😀\n'.repeat(20000);
  for (const m of E.MODES) {
    const t0 = performance.now();
    const r = esc(m, big);
    const t1 = performance.now();
    if (!r.error) une(m, r.output);
    const t2 = performance.now();
    check(m + ': 360,000 characters escape + unescape under 1.5 s', t2 - t0 < 1500, (t1 - t0).toFixed(0) + ' + ' + (t2 - t1).toFixed(0) + ' ms');
  }
}

// ── STRINGS ────────────────────────────────────────────────────────────────────
{
  check('STRINGS table found', STRINGS && STRINGS.en && STRINGS.zh && STRINGS.ja && STRINGS.ko);
  if (STRINGS) {
    const keys = (o, p = '') => Object.keys(o).flatMap((k) => (typeof o[k] === 'object' && !Array.isArray(o[k]) ? keys(o[k], p + k + '.') : [p + k])).sort();
    const ph = (o) => keys(o).map((k) => k + ':' + [...new Set(String(k.split('.').reduce((a, b) => a[b], o)).match(/\{\w+\}/g) || [])].sort().join(','));
    for (const l of ['zh', 'ja', 'ko']) {
      eq('STRINGS.' + l + ' has the same keys as en', keys(STRINGS[l]), keys(STRINGS.en));
      eq('STRINGS.' + l + ' has the same placeholders as en', ph(STRINGS[l]), ph(STRINGS.en));
    }
    const engineSrc = source.slice(startIndex, endIndex);
    const errKeys = [...new Set([...engineSrc.matchAll(/fail\('(\w+)'/g)].map((m) => m[1]))];
    eq('every engine error has a message', errKeys.filter((k) => !(k in STRINGS.en.err)), []);
    const noteKeys = [...new Set([...engineSrc.matchAll(/key: '(\w+)'/g)].map((m) => m[1]))];
    eq('every engine note has a message', noteKeys.filter((k) => !(k in STRINGS.en.note)), []);
    eq('every format has a name', E.MODES.filter((m) => !(m in STRINGS.en.modes)), []);
  }
}

// ── Script hygiene ─────────────────────────────────────────────────────────────
{
  const script = source.slice(source.indexOf('<script'), source.indexOf('</script>'));
  check('component script does not use the network', !/\bfetch\(|XMLHttpRequest|sendBeacon/.test(script));
  check('HTML decoding uses an inert document', /createHTMLDocument/.test(script));
}

// ── Tool page examples ─────────────────────────────────────────────────────────
{
  const dir = join(root, 'src/content/tools/string-escape');
  for (const f of readdirSync(dir)) {
    const mdx = readFileSync(join(dir, f), 'utf8');
    // Lines of the form  <!-- check: mode direction | input-json | output-json -->
    for (const m of mdx.matchAll(/\{\/\* check: (\w+) (escape|unescape) (\{[^}]*\})? ?\| (.+?) \| (.+?) \*\/\}/g)) {
      const [, mode, dir2, opts, input, expected] = m;
      const r = E.convert(mode, dir2, JSON.parse(input), opts ? JSON.parse(opts) : {}, env);
      const got = r.error ? 'error:' + r.error : r.output;
      eq(f + ': ' + mode + ' ' + dir2 + ' ' + input, got, JSON.parse(expected));
    }
  }
}

rmSync(work, { recursive: true, force: true });
for (const s of skips) console.log('SKIP: ' + s + ' not available');
console.log(`\n${passes} passed, ${failures} failed${skips.length ? ', ' + skips.length + ' skipped' : ''}`);
process.exit(failures ? 1 : 0);
