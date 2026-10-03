// Conversion fidelity — YAML ↔ TOML, TOML ↔ JSON and YAML ↔ JSON through the page entry points
//
// Read:  src/components/tools/{YamlToml,TomlJson,YamlJson}Tool.astro (run with
//        scripts/astro-page-harness.mjs and the npm js-yaml / smol-toml they import)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Each case types into the real textarea (input event, then the 300 ms debounce timer), clicks
// the real button, presses Ctrl+Enter or Swap, and reads the other textarea, the status line and
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
      y2t: { input: 'yt-yaml', output: 'yt-toml', copy: 'yt-copy-toml', vias: ['input', 'key', 'swap'], swapFrom: 'yt-toml' },
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
      y2j: { input: 'yj-yaml', output: 'yj-json', copy: 'yj-copy-json', button: 'yj-to-json', vias: ['input', 'button', 'key'] },
      j2y: { input: 'yj-json', output: 'yj-yaml', copy: 'yj-copy-yaml', button: 'yj-to-yaml', vias: ['input', 'button', 'key'] },
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
  else if (via === 'swap') { page.el(d.input).value = ''; page.el(d.swapFrom).value = text; page.el('yt-swap').click(); page.flush(); }
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

/* ── Summary per finding ── */
console.log('\nPer finding:');
for (const [tag, c] of Object.entries(counts)) console.log(`  ${tag}: ${c.pass} passed, ${c.fail} failed`);
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
