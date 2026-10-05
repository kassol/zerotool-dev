// Conversion fidelity — YAML ↔ TOML, TOML ↔ JSON and YAML ↔ JSON through the page entry points
//
// Read:  src/components/tools/{YamlToml,TomlJson,YamlJson}Tool.astro (run with
//        scripts/astro-page-harness.mjs and the npm js-yaml / smol-toml they import)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Each case types into the real textarea (input event, then the 300 ms debounce timer), clicks
// the real button or presses Ctrl+Enter, and reads the other textarea, the status line and
// the copy button. When a value cannot be written to the target format without changing it, the
// page must name the field (JSON Pointer) and the value, clear the earlier output and disable
// the copy button for that output; the next convertible input enables it again. Values that the
// target can hold keep converting. Results are counted per finding (stableId).
//
// Run: node scripts/test-conversion-fidelity.mjs

import { parse as tomlParse } from 'smol-toml';
import { loadPage } from './astro-page-harness.mjs';
import { FIDELITY_TEXT } from '../src/components/tools/conversion-fidelity.js';

const counts = {};
let passes = 0, failures = 0;
function check(tag, name, ok, detail) {
  counts[tag] = counts[tag] || { pass: 0, fail: 0 };
  if (ok) { passes++; counts[tag].pass++; console.log('PASS [' + tag + '] ' + name); }
  else { failures++; counts[tag].fail++; console.log('FAIL [' + tag + '] ' + name + (detail ? '\n  ' + detail : '')); }
}

const TOOLS = {
  'yaml-toml': {
    file: 'src/components/tools/YamlTomlTool.astro', wrap: '.yt-wrap', status: 'yt-status',
    dirs: {
      y2t: { input: 'yt-yaml', output: 'yt-toml', copy: 'yt-copy-toml', vias: ['input', 'key'] },
      t2y: { input: 'yt-toml', output: 'yt-yaml', copy: 'yt-copy-yaml', vias: ['input', 'key'] },
    },
  },
  'toml-json': {
    file: 'src/components/tools/TomlJsonTool.astro', wrap: '.tj-wrap', status: 'tj-status',
    dirs: {
      t2j: { input: 'tj-toml', output: 'tj-json', copy: 'tj-copy-json', button: 'tj-to-json', vias: ['input', 'button', 'key'] },
      j2t: { input: 'tj-json', output: 'tj-toml', copy: 'tj-copy-toml', button: 'tj-to-toml', vias: ['input', 'button', 'key'] },
    },
  },
  'yaml-json': {
    file: 'src/components/tools/YamlJsonTool.astro', wrap: '.yj-wrap', status: 'yj-status',
    dirs: {
      y2j: { input: 'yj-yaml', output: 'yj-json', copy: 'yj-copy-json', vias: ['input'] },
      j2y: { input: 'yj-json', output: 'yj-yaml', copy: 'yj-copy-yaml', vias: ['input'] },
    },
  },
};

function open(tool, lang = 'en') {
  const t = TOOLS[tool];
  return loadPage(t.file, { lang, stringsSelector: t.wrap });
}

function convert(page, tool, dir, text, via) {
  const d = TOOLS[tool].dirs[dir];
  if (via === 'input') page.type(d.input, text);
  else if (via === 'button') { page.el(d.input).value = text; page.el(d.button).click(); page.flush(); }
  else if (via === 'key') { page.el(d.input).value = text; page.key(d.input, { key: 'Enter', ctrlKey: true }); }
  return { out: page.el(d.output), copy: page.el(d.copy), status: page.el(TOOLS[tool].status) };
}

const VALID = { y2t: 'name: demo\nport: 8080', t2y: 'name = "demo"\nport = 8080', t2j: 'name = "demo"\nport = 8080', j2t: '{"name":"demo","port":8080}', y2j: 'name: demo\nport: 8080', j2y: '{"name":"demo","port":8080}' };

/* Valid output first, then the lossy input: the old output must go, with the field named. */
function expectRejected(tag, tool, dir, text, path, raw, lang = 'en') {
  for (const via of TOOLS[tool].dirs[dir].vias) {
    const page = open(tool, lang);
    const name = `${tool} ${dir} via ${via} (${lang}) ${JSON.stringify(text).slice(0, 60)}`;
    const ok = convert(page, tool, dir, VALID[dir], via);
    check(tag, name + ': valid input converts and enables copy', ok.out.value !== '' && !ok.copy.disabled, 'out=' + JSON.stringify(ok.out.value) + ' copy.disabled=' + ok.copy.disabled);
    const r = convert(page, tool, dir, text, via);
    check(tag, name + ': earlier output cleared', r.out.value === '', 'out=' + JSON.stringify(r.out.value));
    check(tag, name + ': copy disabled', r.copy.disabled === true);
    const before = page.clipboard.length;
    r.copy.click(); page.flush();
    check(tag, name + ': copy writes nothing', page.clipboard.length === before);
    const s = r.status.textContent;
    check(tag, name + ': status is an error naming ' + path + ' and ' + raw,
      /\berror\b/.test(r.status.className) && s.includes(path) && s.includes(raw), 'status=' + JSON.stringify(s) + ' class=' + r.status.className);
    if (lang !== 'en' || via === 'input') {
      check(tag, name + ': status uses the page language', s.startsWith(FIDELITY_TEXT[lang].title.split('{target}')[0]), 'status=' + JSON.stringify(s));
    }
    const again = convert(page, tool, dir, VALID[dir], via);
    check(tag, name + ': next valid input converts and enables copy', again.out.value !== '' && !again.copy.disabled);
  }
}

function expectConverted(tag, tool, dir, text, verify, label) {
  for (const via of TOOLS[tool].dirs[dir].vias) {
    const page = open(tool);
    const r = convert(page, tool, dir, text, via);
    let ok = false, detail = 'out=' + JSON.stringify(r.out.value) + ' status=' + JSON.stringify(r.status.textContent);
    try { ok = verify(r.out.value); } catch (e) { detail += ' ' + e.message; }
    check(tag, `${tool} ${dir} via ${via}: ${label}`, ok && !r.copy.disabled && !/\berror\b/.test(r.status.className), detail);
  }
}

const deep = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ptomlDeep = (want) => (out) => deep(JSON.parse(JSON.stringify(tomlParse(out))), want);

/* ── A-YAML-TOML-INTEGER ── */
const INT = 'A-YAML-TOML-INTEGER';
for (const n of ['9007199254740993', '9007199254740992', '-9007199254740992', '9223372036854775807', '-9223372036854775808', '9223372036854775808']) {
  expectRejected(INT, 'yaml-toml', 'y2t', `a:\n  ids: [1, ${n}]`, '/a/ids/1', n);
  expectRejected(INT, 'yaml-json', 'y2j', `a:\n  ids: [1, ${n}]`, '/a/ids/1', n);
  expectRejected(INT, 'yaml-json', 'j2y', `{"a":{"ids":[1,${n}]}}`, '/a/ids/1', n);
  expectRejected(INT, 'toml-json', 'j2t', `{"a":{"ids":[1,${n}]}}`, '/a/ids/1', n);
}
expectRejected(INT, 'yaml-toml', 'y2t', 'id: 0x20000000000001', '/id', '0x20000000000001');
expectRejected(INT, 'yaml-json', 'y2j', 'id: 9007199254740993', '/id', '9007199254740993', 'zh');
expectRejected(INT, 'toml-json', 'j2t', '{"id":9007199254740993}', '/id', '9007199254740993', 'ja');
expectRejected(INT, 'yaml-json', 'j2y', '{"id":9007199254740993}', '/id', '9007199254740993', 'ko');
expectRejected(INT, 'yaml-toml', 'y2t', 'id: 9007199254740993', '/id', '9007199254740993', 'ko');
for (const n of ['9007199254740991', '-9007199254740991']) {
  expectConverted(INT, 'yaml-toml', 'y2t', `id: ${n}`, (o) => o.includes(`id = ${n}\n`) && !o.includes('.0'), 'safe integer ' + n + ' kept');
  expectConverted(INT, 'yaml-json', 'y2j', `id: ${n}`, (o) => o.includes(`"id": ${n}`), 'safe integer ' + n + ' kept');
  expectConverted(INT, 'yaml-json', 'j2y', `{"id":${n}}`, (o) => o === `id: ${n}\n`, 'safe integer ' + n + ' kept');
  expectConverted(INT, 'toml-json', 'j2t', `{"id":${n}}`, (o) => o === `id = ${n}\n`, 'safe integer ' + n + ' kept');
}
expectConverted(INT, 'toml-json', 'j2t', '{"big":1e20,"x":1.5}', (o) => tomlParse(o).big === 1e20 && tomlParse(o).x === 1.5, 'float literal 1e20 is not an integer and converts');
// The TOML parser already rejects these; the page must still clear the old output and disable copy.
for (const [tool, dir] of [['toml-json', 't2j'], ['yaml-toml', 't2y']]) {
  for (const via of TOOLS[tool].dirs[dir].vias) {
    const page = open(tool);
    convert(page, tool, dir, VALID[dir], via);
    const r = convert(page, tool, dir, 'big = 9223372036854775807', via);
    check(INT, `${tool} ${dir} via ${via}: TOML 64-bit max rejected by the parser, output cleared, copy disabled`,
      r.out.value === '' && r.copy.disabled && /\berror\b/.test(r.status.className) && r.status.textContent.includes('losslessly'),
      'out=' + JSON.stringify(r.out.value) + ' status=' + JSON.stringify(r.status.textContent));
  }
}

/* ── A-TOML-NULL-DROP ── */
const NUL = 'A-TOML-NULL-DROP';
expectRejected(NUL, 'toml-json', 'j2t', '{"x":null,"y":1}', '/x', 'null');
expectRejected(NUL, 'toml-json', 'j2t', '{"x":{"a":null}}', '/x/a', 'null');
expectRejected(NUL, 'toml-json', 'j2t', '{"x":[1,null,2]}', '/x/1', 'null');
expectRejected(NUL, 'toml-json', 'j2t', '{"a b":{"c/d":null}}', '/a b/c~1d', 'null');
expectRejected(NUL, 'yaml-toml', 'y2t', 'x: ~\ny: 1', '/x', 'null');
expectRejected(NUL, 'yaml-toml', 'y2t', 'x:\n  a:', '/x/a', 'null');
expectRejected(NUL, 'yaml-toml', 'y2t', 'x: [1, null, 2]', '/x/1', 'null');
expectRejected(NUL, 'yaml-toml', 'y2t', 'x: ~', '/x', 'null', 'zh');
expectRejected(NUL, 'toml-json', 'j2t', '{"x":null}', '/x', 'null', 'ko');
expectConverted(NUL, 'toml-json', 'j2t', '{"a":[],"b":{},"c":{"d":[]}}', ptomlDeep({ a: [], b: {}, c: { d: [] } }), 'empty array and table kept');
expectConverted(NUL, 'yaml-toml', 'y2t', 'a: []\nb: {}\nc:\n  d: []', ptomlDeep({ a: [], b: {}, c: { d: [] } }), 'empty array and table kept');
expectConverted(NUL, 'yaml-toml', 'y2t', 'x: "null"\ny: ""', ptomlDeep({ x: 'null', y: '' }), 'the string "null" and "" are kept');

/* ── A-YAML-TOML-DATE ── */
const DATE = 'A-YAML-TOML-DATE';
const tomlValue = (out, key) => tomlParse(out)[key];
expectConverted(DATE, 'yaml-toml', 'y2t', 'd: 2026-10-01', (o) => o === 'd = 2026-10-01\n' && tomlValue(o, 'd').isDate(), 'date stays a local date');
expectConverted(DATE, 'yaml-toml', 'y2t', 't: 2026-10-01T09:30:00+09:00', (o) => o === 't = 2026-10-01T09:30:00.000+09:00\n' && tomlValue(o, 't').isDateTime() && !tomlValue(o, 't').isLocal(), 'offset date-time keeps +09:00');
expectConverted(DATE, 'yaml-toml', 'y2t', 'u: 2001-12-14 21:59:43.10 -5', (o) => o === 'u = 2001-12-14T21:59:43.100-05:00\n', 'space-separated timestamp with -5 offset');
expectConverted(DATE, 'yaml-toml', 'y2t', 'z: 2001-12-14t21:59:43.10Z', (o) => o === 'z = 2001-12-14T21:59:43.100Z\n', 'lower-case t and Z');
expectConverted(DATE, 'yaml-toml', 'y2t', 'n: 2001-12-14 21:59:43', (o) => o === 'n = 2001-12-14T21:59:43.000Z\n', 'no time zone means UTC (YAML timestamp type)');
expectConverted(DATE, 'yaml-toml', 'y2t', 'm: 2026-1-5T7:05:00+05:30', (o) => o === 'm = 2026-01-05T07:05:00.000+05:30\n', 'one-digit month, day and hour');
expectConverted(DATE, 'yaml-toml', 'y2t', 's: "2026-10-01"', (o) => o === 's = "2026-10-01"\n', 'quoted date stays a string');
expectConverted(DATE, 'yaml-toml', 'y2t', 'ds: [2026-10-01, 2026-10-02]\nev:\n  at: 2026-10-01T00:00:00Z', (o) => tomlValue(o, 'ds').every((x) => x.isDate()) && tomlValue(o, 'ev').at.toISOString() === '2026-10-01T00:00:00.000Z', 'dates in arrays and nested tables');
expectRejected(DATE, 'yaml-toml', 'y2t', 'ev:\n  t: 2026-10-01T09:30:00.123456Z', '/ev/t', '2026-10-01T09:30:00.123456Z');
expectRejected(DATE, 'yaml-toml', 'y2t', 'd: 2026-02-31', '/d', '2026-02-31');
expectRejected(DATE, 'yaml-toml', 'y2t', 't: 2026-10-01T09:30:60Z', '/t', '2026-10-01T09:30:60Z', 'ja');
expectConverted(DATE, 'yaml-toml', 'y2t', 't: 2026-10-01T09:30:00.120000Z', (o) => o === 't = 2026-10-01T09:30:00.120Z\n', 'trailing zeros after milliseconds are not a loss');

/* ── A-CONVERSION-NONFINITE ── */
const NF = 'A-CONVERSION-NONFINITE';
expectRejected(NF, 'toml-json', 't2j', 'x = inf', '/x', 'inf');
expectRejected(NF, 'toml-json', 't2j', 'y = -inf', '/y', '-inf');
expectRejected(NF, 'toml-json', 't2j', 'z = nan', '/z', 'nan');
expectRejected(NF, 'toml-json', 't2j', '[a]\nb = [1.0, inf]', '/a/b/1', 'inf');
expectRejected(NF, 'toml-json', 't2j', '[[p]]\nq = 1\n[[p]]\nq = nan', '/p/1/q', 'nan', 'zh');
expectRejected(NF, 'yaml-json', 'y2j', 'x: .inf', '/x', 'inf');
expectRejected(NF, 'yaml-json', 'y2j', 'y: -.Inf', '/y', '-inf');
expectRejected(NF, 'yaml-json', 'y2j', 'z: .NaN', '/z', 'nan');
expectRejected(NF, 'yaml-json', 'y2j', 'a:\n  - {b: [.inf]}', '/a/0/b/0', 'inf', 'ja');
expectRejected(NF, 'toml-json', 'j2t', '{"x":1e400}', '/x', '1e400');
expectRejected(NF, 'yaml-json', 'j2y', '{"x":-1e400}', '/x', '-1e400', 'ko');
expectConverted(NF, 'toml-json', 't2j', 'x = 1.5\ny = -0.25\nz = 1e300', (o) => deep(JSON.parse(o), { x: 1.5, y: -0.25, z: 1e300 }), 'finite floats unchanged');
expectConverted(NF, 'yaml-json', 'y2j', 'x: 1.5\ny: -2.5e-3', (o) => deep(JSON.parse(o), { x: 1.5, y: -0.0025 }), 'finite floats unchanged');
expectConverted(NF, 'yaml-toml', 'y2t', 'x: .inf\ny: -.inf\nz: .nan', (o) => o === 'x = inf\ny = -inf\nz = nan\n', 'TOML has inf and nan, so YAML → TOML keeps them');

/* ── B-TOML-DATETIME-PRECISION ──
   smol-toml keeps milliseconds (TOML 1.0 lets a parser truncate further digits), so a TOML
   date-time or time with non-zero digits after the third fractional digit would reach JSON /
   YAML changed. Literals inside strings and comments are text and stay as they are. */
const TP = 'B-TOML-DATETIME-PRECISION';
for (const [tool, dir] of [['toml-json', 't2j'], ['yaml-toml', 't2y']]) {
  expectRejected(TP, tool, dir, 't = 2026-10-01T09:30:00.123456Z', '/t', '2026-10-01T09:30:00.123456Z');
  expectRejected(TP, tool, dir, '[ev]\nat = 2026-10-01 09:30:00.1234+09:00', '/ev/at', '2026-10-01 09:30:00.1234+09:00');
  expectRejected(TP, tool, dir, 'local = 1979-05-27T07:32:00.999999', '/local', '1979-05-27T07:32:00.999999');
  expectRejected(TP, tool, dir, 'times = [09:30:00.5, 09:30:00.0001]', '/times/1', '09:30:00.0001');
  expectRejected(TP, tool, dir, 'x = { "a/b" = 2026-10-01T00:00:00.0000001z }', '/x/a~1b', '2026-10-01T00:00:00.0000001z');
  expectRejected(TP, tool, dir, '[[runs]]\nn = 1\n[[runs]]\nat = 2026-10-01T09:30:00.123456789-05:00', '/runs/1/at', '2026-10-01T09:30:00.123456789-05:00', 'ja');
}
expectRejected(TP, 'toml-json', 't2j', 't = 2026-10-01T09:30:00.123456Z', '/t', '2026-10-01T09:30:00.123456Z', 'zh');
expectRejected(TP, 'yaml-toml', 't2y', 't = 2026-10-01T09:30:00.123456Z', '/t', '2026-10-01T09:30:00.123456Z', 'ko');
expectConverted(TP, 'toml-json', 't2j', 't = 2026-10-01T09:30:00.123Z\nu = 2026-10-01T09:30:00.120000+09:00\nv = 09:30:00.5000',
  (o) => deep(JSON.parse(o), { t: '2026-10-01T09:30:00.123Z', u: '2026-10-01T09:30:00.120+09:00', v: '09:30:00.500' }), 'millisecond precision and trailing zeros convert');
expectConverted(TP, 'toml-json', 't2j',
  's = "2026-10-01T09:30:00.123456Z"\nl = \'09:30:00.1234\'\nm = """\n2026-10-01T09:30:00.123456Z\n"""\nk = \'\'\'09:30:00.1234\'\'\'\n# at = 2026-10-01T09:30:00.123456Z\n"2026-10-01T09:30:00.123456Z" = 1',
  (o) => deep(JSON.parse(o), { s: '2026-10-01T09:30:00.123456Z', l: '09:30:00.1234', m: '2026-10-01T09:30:00.123456Z\n', k: '09:30:00.1234', '2026-10-01T09:30:00.123456Z': 1 }), 'date-time text in strings, keys and comments is not a date');
expectConverted(TP, 'toml-json', 't2j', 'e = "say \\"09:30:00.1234\\""\nq = """a""""\nv2 = 1.5 # 09:30:00.1234',
  (o) => deep(JSON.parse(o), { e: 'say "09:30:00.1234"', q: 'a"', v2: 1.5 }), 'escaped quotes, a closing """" and a trailing comment');
expectRejected(TP, 'toml-json', 't2j', 'q = """a""""\nt = 09:30:00.1234 # after a multi-line string', '/t', '09:30:00.1234');
expectConverted(TP, 'yaml-toml', 't2y', 't = 2026-10-01T09:30:00.123+09:00', (o) => o === 't: 2026-10-01T09:30:00.123+09:00\n', 'millisecond date-time keeps its offset in YAML');

/* ── B-NEGATIVE-ZERO ── smol-toml writes -0 as `0`; TOML has -0.0 (TOML 1.0 float). */
const NZ = 'B-NEGATIVE-ZERO';
const negZero = (key) => (o) => Object.is(tomlParse(o)[key], -0);
expectConverted(NZ, 'yaml-toml', 'y2t', 'x: -0.0', (o) => o === 'x = -0.0\n' && negZero('x')(o), 'YAML -0.0 becomes TOML -0.0');
expectConverted(NZ, 'toml-json', 'j2t', '{"x":-0.0}', (o) => o === 'x = -0.0\n' && negZero('x')(o), 'JSON -0.0 becomes TOML -0.0');
expectConverted(NZ, 'toml-json', 'j2t', '{"a":[-0.0,1],"b":{"c":-0.0},"t":[{"z":-0.0}]}',
  (o) => { const d = tomlParse(o); return Object.is(d.a[0], -0) && d.a[1] === 1 && Object.is(d.b.c, -0) && Object.is(d.t[0].z, -0) && o.includes('a = [ -0.0, 1 ]'); }, 'nested -0 in arrays, tables and arrays of tables');
expectConverted(NZ, 'yaml-toml', 'y2t', 'x: 0.0\ny: 0', (o) => o === 'x = 0.0\ny = 0\n', 'positive zero keeps its type');

/* ── C-NEGZERO-JSON ── JSON.stringify(-0) is "0"; JSON text can write -0.0, which JSON.parse reads
   as -0 and parsers that keep integers apart (Python json) read as a float with its sign. */
const NJ = 'C-NEGZERO-JSON';
const jsonNegZero = (path) => (o) => Object.is(path(JSON.parse(o)), -0);
expectConverted(NJ, 'toml-json', 't2j', 'x = -0.0', (o) => o === '{\n  "x": -0.0\n}' && jsonNegZero((d) => d.x)(o), 'TOML -0.0 becomes JSON -0.0');
expectConverted(NJ, 'toml-json', 't2j', 'a = [-0.0, 0.0, 1.5]\n[t]\nz = -0.0\nzero = -0',
  (o) => { const d = JSON.parse(o); return Object.is(d.a[0], -0) && Object.is(d.a[1], 0) && Object.is(d.t.z, -0) && Object.is(d.t.zero, 0) && o.includes('-0.0,') && o.includes('"zero": 0\n'); }, 'nested -0.0; integer -0 stays 0');
expectConverted(NJ, 'yaml-json', 'y2j', 'x: -0.0\ny: [-0.0, 0]\nz: -0', (o) => o === '{\n  "x": -0.0,\n  "y": [\n    -0.0,\n    0\n  ],\n  "z": 0\n}', 'YAML -0.0 becomes JSON -0.0; YAML integer -0 is 0');
expectConverted(NJ, 'yaml-json', 'y2j', '-0.0', (o) => o === '-0.0', '-0.0 as the whole document');
expectConverted(NJ, 'yaml-json', 'y2j', 's: "\\0zt-neg0"\nx: -0.0', (o) => { const d = JSON.parse(o); return d.s === '\u0000zt-neg0' && Object.is(d.x, -0); }, 'a string that looks like the internal marker stays a string');

/* ── C-JSON-INT-NEGZERO ── JSON integer -0 is the integer zero (TOML 1.0: "-0 and +0 are valid
   and identical to an unprefixed zero"; YAML 1.2 core int); -0.0 is the negative float zero. */
const JZ = 'C-JSON-INT-NEGZERO';
expectConverted(JZ, 'yaml-json', 'j2y', '{"a":-0,"b":-0.0,"c":[-0,-0e0]}', (o) => o === 'a: 0\nb: -0.0\nc:\n  - 0\n  - -0.0\n', 'JSON -0 becomes YAML 0, -0.0 and -0e0 become -0.0');
expectConverted(JZ, 'toml-json', 'j2t', '{"x":-0,"y":-0.0}', (o) => o === 'x = 0\ny = -0.0\n', 'JSON -0 becomes TOML 0, -0.0 becomes -0.0');

/* ── C-YAML-FLOAT-TOML ── smol-toml writes whole floats as integers; TOML has 1.0. */
const YF = 'C-YAML-FLOAT-TOML';
expectConverted(YF, 'yaml-toml', 'y2t', 'a: 1.0\nb: 1e3\nc: [2.0, 3, 0.5]\nd: 1\ne: 1.5\nf: -3.0\ng: 1e21\nh: !!float 4',
  (o) => o === 'a = 1.0\nb = 1000.0\nc = [ 2.0, 3, 0.5 ]\nd = 1\ne = 1.5\nf = -3.0\ng = 1e+21\nh = 4.0\n' && deep(tomlParse(o).c, [2, 3, 0.5]), 'whole YAML floats stay TOML floats; integers stay integers');
expectConverted(YF, 'yaml-toml', 'y2t', 'server:\n  ratio: 1.0\nlist:\n  - {w: 2.0}', (o) => o.includes('ratio = 1.0\n') && o.includes('w = 2.0'), 'nested tables and arrays of tables');

/* ── C-TOML-LOCAL-DATETIME ── a TOML local date-time has no offset; YAML reads a timestamp
   without one as UTC (YAML timestamp type), so TOML → YAML would change its meaning. */
const LD = 'C-TOML-LOCAL-DATETIME';
expectRejected(LD, 'yaml-toml', 't2y', 'started = 1979-05-27T07:32:00', '/started', '1979-05-27T07:32:00');
expectRejected(LD, 'yaml-toml', 't2y', '[run]\nat = [1979-05-27 07:32:00.5]', '/run/at/0', '1979-05-27 07:32:00.5');
expectRejected(LD, 'yaml-toml', 't2y', 'x = { t = 1979-05-27t07:32:00 }', '/x/t', '1979-05-27t07:32:00', 'zh');
expectRejected(LD, 'yaml-toml', 't2y', 'started = 1979-05-27T07:32:00', '/started', '1979-05-27T07:32:00', 'ja');
expectRejected(LD, 'yaml-toml', 't2y', 'started = 1979-05-27T07:32:00', '/started', '1979-05-27T07:32:00', 'ko');
expectConverted(LD, 'yaml-toml', 't2y', 'a = 1979-05-27T07:32:00Z\nb = 1979-05-27\nc = 07:32:00\nd = "1979-05-27T07:32:00"\n# e = 1979-05-27T07:32:00',
  (o) => o === "a: 1979-05-27T07:32:00.000Z\nb: 1979-05-27\nc: 07:32:00.000\nd: '1979-05-27T07:32:00'\n", 'offset date-times, local dates, local times and strings convert');
expectConverted(LD, 'toml-json', 't2j', 'started = 1979-05-27T07:32:00', (o) => o === '{\n  "started": "1979-05-27T07:32:00.000"\n}', 'TOML → JSON keeps the local date-time as text without an offset');

/* ── C-VALIDATOR-NEGZERO ── the yaml-validator preview writes -0.0 like the converters. */
{
  const VZ = 'C-VALIDATOR-NEGZERO';
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const src = readFileSync(new URL('../src/components/tools/YamlValidatorTool.astro', import.meta.url), 'utf8');
  const labels = vm.runInNewContext(src.slice(src.indexOf('const labels = '), src.indexOf('const L = labels')) + '\n;labels');
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const page = loadPage('src/components/tools/YamlValidatorTool.astro', { lang, dataset: { '.yv-wrap': { lang, msgValid: labels[lang].msgValid, msgValidMulti: labels[lang].msgValidMulti } } });
    page.el('yv-input').value = 'x: -0.0\ny: [-0.0, 0]\nz: -0'; page.el('yv-validate').click();
    const t = page.el('yv-preview-content').textContent;
    check(VZ, `yaml-validator ${lang}: preview writes -0.0 and no note`, t === '{\n  "x": -0.0,\n  "y": [\n    -0.0,\n    0\n  ],\n  "z": 0\n}' && page.el('yv-preview-note').hidden === true, t);
    page.el('yv-input').value = 'a: 1\n---\n-0.0'; page.el('yv-validate').click();
    const t2 = page.el('yv-preview-content').textContent;
    check(VZ, `yaml-validator ${lang}: -0.0 as a whole document in a multi-document preview`, t2 === '[\n  {\n    "a": 1\n  },\n  -0.0\n]', t2);
  }
}

/* ── B-YAML-JSON-DATE ── js-yaml builds a Date with Date.UTC, which rolls impossible dates over. */
const YD = 'B-YAML-JSON-DATE';
expectRejected(YD, 'yaml-json', 'y2j', 'due: 2026-02-31', '/due', '2026-02-31');
expectRejected(YD, 'yaml-json', 'y2j', 'd:\n  - 2026-13-01', '/d/0', '2026-13-01');
expectRejected(YD, 'yaml-json', 'y2j', 't: 2026-10-01T24:00:00Z', '/t', '2026-10-01T24:00:00Z');
expectRejected(YD, 'yaml-json', 'y2j', 't: 2026-02-29 10:00:00', '/t', '2026-02-29 10:00:00', 'zh');
expectRejected(YD, 'yaml-json', 'y2j', 't: 2026-10-01T09:30:00.123456Z', '/t', '2026-10-01T09:30:00.123456Z', 'ja');
expectRejected(YD, 'yaml-json', 'y2j', 'due: 2026-02-31', '/due', '2026-02-31', 'ko');
expectConverted(YD, 'yaml-json', 'y2j', 'a: 2024-02-29\nb: 2026-10-01T09:30:00+09:00\nc: 2001-12-14 21:59:43.10 -5\nd: "2026-02-31"\ne: 2026-10-01T09:30:00.120000Z',
  (o) => deep(JSON.parse(o), { a: '2024-02-29T00:00:00.000Z', b: '2026-10-01T00:30:00.000Z', c: '2001-12-15T02:59:43.100Z', d: '2026-02-31', e: '2026-10-01T09:30:00.120Z' }), 'valid dates and quoted text convert as before');
expectConverted(YD, 'yaml-json', 'y2j', '2026-10-01', (o) => o === '"2026-10-01T00:00:00.000Z"', 'a date as the whole document');
expectConverted(YD, 'yaml-json', 'y2j', 'base: &d 2026-10-01\nagain: *d', (o) => deep(JSON.parse(o), { base: '2026-10-01T00:00:00.000Z', again: '2026-10-01T00:00:00.000Z' }), 'an alias of a date');
expectRejected(YD, 'yaml-json', 'y2j', '2026-02-31', '(root)', '2026-02-31');

/* ── B-YAML-VALIDATOR-PREVIEW ── the JSON preview cannot show .inf / .nan, integers outside
   ±(2^53 − 1) or impossible dates as written; the page keeps validating and names them. */
{
  const VP = 'B-YAML-VALIDATOR-PREVIEW';
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const src = readFileSync(new URL('../src/components/tools/YamlValidatorTool.astro', import.meta.url), 'utf8');
  const labels = vm.runInNewContext(src.slice(src.indexOf('const labels = '), src.indexOf('const L = labels')) + '\n;labels');
  const validate = (text, lang = 'en') => {
    const L = labels[lang];
    const dataset = { lang, msgEmpty: L.msgEmpty, msgValid: L.msgValid, msgInvalid: L.msgInvalid, msgValidMulti: L.msgValidMulti, msgInvalidMulti: L.msgInvalidMulti, docTitle: L.docTitle, docLines: L.docLines, docValid: L.docValid, copyJson: L.copyJson, copied: L.copied, errTitle: L.errTitle, errLine: L.errLine, errLineCol: L.errLineCol };
    const page = loadPage('src/components/tools/YamlValidatorTool.astro', { lang, dataset: { '.yv-wrap': dataset } });
    page.el('yv-input').value = text;
    page.el('yv-validate').click();
    return { page, L, note: page.el('yv-preview-note'), status: page.el('yv-status'), preview: page.el('yv-preview-content') };
  };
  const cases = [
    ['size: .inf', [['/size', 'inf']]],
    ['a:\n  - -.Inf\n  - .nan', [['/a/0', '-inf'], ['/a/1', 'nan']]],
    ['id: 9007199254740993', [['/id', '9007199254740993']]],
    ['due: 2026-02-31', [['/due', '2026-02-31']]],
    ['x: 1\n---\ny: .inf\nz: 12345678901234567890', [['/1/y', 'inf'], ['/1/z', '12345678901234567890']]],
  ];
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    for (const [text, items] of cases) {
      const r = validate(text, lang);
      const s = r.note.textContent || '';
      check(VP, `yaml-validator ${lang} ${JSON.stringify(text)}: still valid with a preview`, /\bsuccess\b/.test(r.status.className) && r.preview.textContent !== '', r.status.textContent);
      check(VP, `yaml-validator ${lang} ${JSON.stringify(text)}: note shown and names every path and value`,
        r.note.hidden === false && items.every(([p, raw]) => s.includes(p) && s.includes(raw)) && s.startsWith(FIDELITY_TEXT[lang].preview.split('{target}')[0]), 'note=' + JSON.stringify(s) + ' hidden=' + r.note.hidden);
    }
    const ok = validate('n: 9007199254740991\nf: 1.5\nd: 2024-02-29\ns: ".inf"', lang);
    check(VP, `yaml-validator ${lang}: values JSON can show need no note`, ok.note.hidden === true && !ok.note.textContent, JSON.stringify(ok.note.textContent));
    check(VP, `yaml-validator ${lang}: preview of safe values unchanged`, ok.preview.textContent === JSON.stringify({ n: 9007199254740991, f: 1.5, d: '2024-02-29T00:00:00.000Z', s: '.inf' }, null, 2), ok.preview.textContent);
  }
  // A later valid input without such values clears the note; an invalid input hides it too.
  const r = validate('size: .inf');
  r.page.el('yv-input').value = 'size: 1'; r.page.el('yv-validate').click();
  check(VP, 'note cleared by the next input', r.note.hidden === true && !r.note.textContent);
  r.page.el('yv-input').value = 'size: .inf'; r.page.el('yv-validate').click();
  r.page.el('yv-input').value = 'a: [1'; r.page.el('yv-validate').click();
  check(VP, 'note hidden when the YAML is invalid', r.note.hidden === true && !r.note.textContent);
  r.page.el('yv-input').value = 'size: .inf'; r.page.el('yv-validate').click();
  r.page.el('yv-clear').click();
  check(VP, 'note cleared by Clear', r.note.hidden === true && !r.note.textContent);
}

/* ── yaml-json pages: the stop and limit messages are quoted as the page shows them ── */
{
  const { readFileSync } = await import('node:fs');
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const text = readFileSync(new URL('../src/content/tools/yaml-json/' + lang + '.mdx', import.meta.url), 'utf8');
    const page = open('yaml-json', lang);
    convert(page, 'yaml-json', 'y2j', 'size: .inf\nid: 9007199254740993', 'input');
    const stop = page.el('yj-status').textContent;
    check('PAGE-TEXT', `yaml-json ${lang} page quotes the stop message`, text.includes('`' + stop + '`') && text.includes('size: .inf\n  id: 9007199254740993'), stop);
    convert(page, 'yaml-json', 'y2j', 'a: ' + '['.repeat(101) + ']'.repeat(101), 'input');
    const limit = page.el('yj-status').textContent;
    check('PAGE-TEXT', `yaml-json ${lang} page quotes the nesting limit message`, text.includes('`' + limit + '`'), limit);
    check('PAGE-TEXT', `yaml-json ${lang} page names js-yaml 4.3.2 and no longer says only the first document converts`,
      text.includes('js-yaml 4.3.2') && !/js-yaml 4\.1\b/.test(text) && !/only the first document|仅转换第一个/.test(text));
  }
}

/* ── Pages quote the new stop messages, the -0.0 result and the validator note as the page shows them ── */
{
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const mdx = (tool, lang) => readFileSync(new URL(`../src/content/tools/${tool}/${lang}.mdx`, import.meta.url), 'utf8');
  const shown = (tool, dir, text, lang) => { const page = open(tool, lang); const r = convert(page, tool, dir, text, 'input'); return { out: r.out.value, status: r.status.textContent }; };
  const vsrc = readFileSync(new URL('../src/components/tools/YamlValidatorTool.astro', import.meta.url), 'utf8');
  const labels = vm.runInNewContext(vsrc.slice(vsrc.indexOf('const labels = '), vsrc.indexOf('const L = labels')) + '\n;labels');
  const BUILD = '[build]\nstarted = 2026-10-01T09:30:00.123456Z';
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const tj = mdx('toml-json', lang), yt = mdx('yaml-toml', lang), yj = mdx('yaml-json', lang), yv = mdx('yaml-validator', lang);
    const a = shown('toml-json', 't2j', BUILD, lang);
    check('PAGE-TEXT-B', `toml-json ${lang} quotes the precision stop`, a.out === '' && tj.includes('`' + a.status + '`') && tj.includes('`started = 2026-10-01T09:30:00.123456Z`'), a.status);
    const z = shown('toml-json', 'j2t', '{"offset":-0.0}', lang);
    check('PAGE-TEXT-B', `toml-json ${lang} shows {"offset":-0.0} → offset = -0.0`, z.out === 'offset = -0.0\n' && tj.includes('`{"offset":-0.0}`') && tj.includes('`offset = -0.0`'), z.out);
    const b = shown('yaml-toml', 't2y', BUILD, lang);
    check('PAGE-TEXT-B', `yaml-toml ${lang} quotes the TOML → YAML precision stop`, b.out === '' && yt.includes('<code>' + b.status + '</code>'), b.status);
    const z2 = shown('yaml-toml', 'y2t', 'offset: -0.0', lang);
    check('PAGE-TEXT-B', `yaml-toml ${lang} says YAML -0.0 becomes TOML -0.0`, z2.out === 'offset = -0.0\n' && yt.split('<code>-0.0</code>').length === 3, z2.out);
    const c = shown('yaml-json', 'y2j', 'due: 2026-02-31\nat: 2026-10-01T09:30:00.123456Z', lang);
    check('PAGE-TEXT-B', `yaml-json ${lang} quotes the date stop`, c.out === '' && yj.includes('`' + c.status + '`') && yj.includes('due: 2026-02-31\n  at: 2026-10-01T09:30:00.123456Z'), c.status);
    const L = labels[lang];
    const page = loadPage('src/components/tools/YamlValidatorTool.astro', { lang, dataset: { '.yv-wrap': { lang, msgValid: L.msgValid } } });
    page.el('yv-input').value = 'size: .inf\nid: 9007199254740993\ndue: 2026-02-31'; page.el('yv-validate').click();
    const note = page.el('yv-preview-note').textContent, prev = JSON.parse(page.el('yv-preview-content').textContent);
    check('PAGE-TEXT-B', `yaml-validator ${lang} quotes the preview note and the preview values`,
      yv.includes('`' + note + '`') && yv.includes('size: .inf\n  id: 9007199254740993\n  due: 2026-02-31') &&
      prev.size === null && String(prev.id) === '9007199254740992' && prev.due === '2026-03-03T00:00:00.000Z' &&
      yv.includes('`null`') && yv.includes('`9007199254740992`') && yv.includes('`"2026-03-03T00:00:00.000Z"`'), note);
  }
}

/* ── Pages quote the -0 / whole-float / local date-time / UTC offset behavior as the page shows it ── */
{
  const { readFileSync } = await import('node:fs');
  const mdx = (tool, lang) => readFileSync(new URL(`../src/content/tools/${tool}/${lang}.mdx`, import.meta.url), 'utf8');
  const shown = (tool, dir, text, lang = 'en') => { const page = open(tool, lang); const r = convert(page, tool, dir, text, 'input'); return { out: r.out.value, status: r.status.textContent }; };
  const tz = shown('toml-json', 't2j', 'offset = -0.0').out, jz = shown('toml-json', 'j2t', '{"count":-0}').out;
  const yf = shown('yaml-toml', 'y2t', 'ratio: 1.0').out;
  const yo = shown('yaml-json', 'y2j', 'at: 2026-10-01T09:30:00+09:00\nzero: -0.0').out, jy = shown('yaml-json', 'j2y', '{"count":-0,"offset":-0.0}').out;
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const tj = mdx('toml-json', lang), yt = mdx('yaml-toml', lang), yj = mdx('yaml-json', lang), yv = mdx('yaml-validator', lang);
    check('PAGE-TEXT-C', `toml-json ${lang}: -0.0 both ways and the integer -0`,
      tz === '{\n  "offset": -0.0\n}' && jz === 'count = 0\n' && tj.includes('`offset = -0.0`') && tj.includes('`"offset": -0.0`') && tj.includes('`{"count":-0}`') && tj.includes('`count = 0`'), tz + ' | ' + jz);
    const l = shown('yaml-toml', 't2y', '[build]\nstarted = 2026-10-01T09:30:00', lang);
    check('PAGE-TEXT-C', `yaml-toml ${lang}: local date-time stop and whole floats`,
      l.out === '' && yt.includes('<code>' + l.status + '</code>') && yt.includes('<code>started = 2026-10-01T09:30:00</code>') &&
      yf === 'ratio = 1.0\n' && yt.includes('<code>ratio: 1.0</code>') && yt.includes('<code>ratio = 1.0</code>'), l.status);
    check('PAGE-TEXT-C', `yaml-json ${lang}: offsets become UTC, -0.0 kept, JSON -0 becomes 0`,
      yo === '{\n  "at": "2026-10-01T00:30:00.000Z",\n  "zero": -0.0\n}' && yj.includes('| `at: 2026-10-01T09:30:00+09:00` | `"2026-10-01T00:30:00.000Z"` |') && yj.includes('| `zero: -0.0` | `-0.0` |') &&
      jy === 'count: 0\noffset: -0.0\n' && yj.includes('`{"count":-0,"offset":-0.0}`') && yj.includes('`count: 0`') && yj.includes('`offset: -0.0`'), yo + ' | ' + jy);
    check('PAGE-TEXT-C', `yaml-validator ${lang}: preview writes -0.0 and UTC`,
      yv.includes('`-0.0`') && yv.includes('`2026-10-01T09:30:00+09:00`') && yv.includes('`"2026-10-01T00:30:00.000Z"`'));
  }
  // the validator preview really shows the offset example in UTC
  const page = loadPage('src/components/tools/YamlValidatorTool.astro', { dataset: { '.yv-wrap': { lang: 'en', msgValid: 'Valid' } } });
  page.el('yv-input').value = 'at: 2026-10-01T09:30:00+09:00'; page.el('yv-validate').click();
  check('PAGE-TEXT-C', 'yaml-validator preview shows the offset example in UTC', page.el('yv-preview-content').textContent === '{\n  "at": "2026-10-01T00:30:00.000Z"\n}');
}

/* ── Summary per finding ── */
console.log('\nPer finding:');
for (const [tag, c] of Object.entries(counts)) console.log(`  ${tag}: ${c.pass} passed, ${c.fail} failed`);
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
