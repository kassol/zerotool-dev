// .env File Parser — keys and values follow dotenv's parsing rules
//
// Read:  src/components/tools/EnvFileParserTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
//        node_modules/dotenv (installed with @qwik.dev/partytown; its parse() is the reference)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: `export KEY=` prefix (was part of the key), inline `# comment` after unquoted and
// quoted values (was part of the value), `#` inside quotes kept, `#` right after a value
// (dotenv cuts there; the parser adds a note), single / double / backtick quotes, `\n` expanded
// only in double quotes, whitespace trimming, quoted values over several lines, unclosed quotes,
// text after a closing quote, empty values, duplicates (last wins), CRLF; the exported object
// equals dotenv.parse() for every fixture; notes, errors and the status line come from the
// 4-language STRINGS (they were English on every page). Rules: https://github.com/motdotla/dotenv#what-rules-does-the-parsing-engine-follow
// and the LINE regex in https://github.com/motdotla/dotenv/blob/v16.6.1/lib/main.js
//
// Guide: the sample file, the parser-comparison table (parser, dotenv, util.parseEnv, python-dotenv
// 1.2.4 when installed), the parser notes table and the compare-env.mjs block in
// src/content/blog/env-file-parser-guide/en.mdx are recomputed.
//
// Run: node scripts/test-env-file-parser.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/EnvFileParserTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in EnvFileParserTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { parseEnv };')();

let failures = 0;
let passes = 0;
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
// Same as the Export JSON button: ok and warn entries, later keys win.
function exported(text) {
  const obj = Object.create(null);
  E.parseEnv(text).forEach((e) => {
    if (e.type === 'ok' || e.type === 'warn') obj[e.key] = e.value;
  });
  return obj;
}
function sameAsDotenv(name, text) {
  eq(name + ' (same as dotenv.parse)', { ...exported(text) }, dotenv.parse(text));
}
function entry(text, key) {
  return E.parseEnv(text).find((e) => e.key === key);
}

// ---------- P3 dotenv dialect: exercise the complete Parse / Export JSON handlers ----------
async function pageExport(text, lang = 'en') {
  const elements = new Map(), downloads = [], docEvents = {}, timers = [];
  function element() { const events = {}; return { value: '', disabled: false, textContent: '', innerHTML: '', style: {}, children: [],
    addEventListener(k, fn) { events[k] = fn; }, click() { if (this.disabled) return; if (this.download) downloads.push(this.href); events.click?.(); },
    fire(k) { events[k]?.(); }, appendChild(child) { this.children.push(child); } }; }
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  vm.runInNewContext(source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1], {
    document: { documentElement: { lang }, getElementById: get, querySelectorAll: () => [], createElement: element,
      get activeElement() { return get('efp-input'); }, querySelector: () => ({ contains: el => [...elements.values()].includes(el) }),
      addEventListener(k, fn) { docEvents[k] = fn; } },
    window: {}, Blob, URL: { createObjectURL: blob => blob, revokeObjectURL() {} }, setTimeout: fn => timers.push(fn)
  });
  get('efp-input').value = text; get('efp-parse').click(); const parseStatus = get('efp-status').textContent; get('efp-export-json').click();
  return { parseStatus, output: downloads.length ? JSON.parse(await downloads[0].text()) : {}, status: get('efp-status').textContent, get, downloads,
    pageClear() { get('efp-input').value = ''; docEvents.keydown?.({ key: 'l', ctrlKey: true }); timers.splice(0).forEach(fn => fn()); } };
}
eq('reference is dotenv 16.6.1', require('dotenv/package.json').version, '16.6.1');
const dialectCases = [
  'KEY: value', 'KEY:value', 'MY KEY=1', 'MY KEY: 1', 'my-key=1\nmy.key=2\n9KEY=3',
  'export KEY: value', 'export   KEY = 1', 'KEY : value', 'KEY:\tvalue', 'KEY:\nNEXT=1',
  'KEY:\n  "line1\nline2"\nNEXT=1', 'A: "a#b" # note\nB=2', '__proto__=value\nconstructor=ok',
  '中文=1\nA=2', 'A/B=1\nA=2', 'GOOD=1\nMY KEY=2\nGOOD=3', 'KEY: \nNEXT=1'
];
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  for (const [n, text] of dialectCases.entries()) {
    const p = await pageExport(text, lang);
    const expected = dotenv.parse(text);
    if (text.includes('__proto__=')) Object.defineProperty(expected, '__proto__', { value: 'value', enumerable: true });
     eq(lang + ' Parse/Export dialect ' + n, Object.entries(p.output).sort(), Object.entries(expected).sort());
  }
  for (const action of ['empty', 'edit', 'clear', 'page-clear']) {
    const p = await pageExport('A=old', lang);
    p.get('efp-input').value = action === 'edit' ? 'A=new' : '';
    if (action === 'empty') p.get('efp-parse').click();
    else if (action === 'edit') p.get('efp-input').fire('input');
    else if (action === 'clear') p.get('efp-clear').click();
    else p.pageClear();
    check(lang + ' ' + action + ' disables export', p.get('efp-export-json').disabled);
    p.get('efp-export-json').click();
    eq(lang + ' ' + action + ' cannot export old data', p.downloads.length, 1);
    if (action === 'page-clear') eq(lang + ' page clear hides the old table', [p.get('efp-result').style.display, p.get('efp-status').textContent], ['none', '']);
  }
}
eq('dotenv drops __proto__; tool intentionally keeps this key', Object.keys(dotenv.parse('__proto__=value')), []);
// Lines dotenv skips name their cause: a valid key with a malformed `:` separator was reported
// as "Non-standard key name".
for (const [line, note] of [['PORT:8080', 'colonForm'], ['KEY : value', 'colonForm'], ['export KEY :v', 'colonForm'],
  ['MY KEY=1', 'nonStandard'], ['MY KEY: 1', 'nonStandard'], ['SMTP\u3000HOST=x', 'nonStandard'], ['A/B=1', 'nonStandard'], ['BROKEN LINE', 'missingEq'], ['=1', 'emptyKey']]) {
  const e = E.parseEnv(line)[0];
  const NOTE = { colonForm: 'Use KEY=value, or KEY: value with a space after the colon and none before it', nonStandard: 'Non-standard key name', missingEq: 'Missing = sign', emptyKey: 'Empty key' };
  eq('skipped line ' + line, [e.type, e.error], ['error', NOTE[note]]);
  eq('dotenv skips ' + line, Object.keys(dotenv.parse(line)), []);
}

// ---------- the reported defect ----------
eq('export prefix is not part of the key', exported('export DB_HOST=localhost'), { DB_HOST: 'localhost' });
eq('inline comment is not part of the value', exported('PORT=5432 # default port'), { PORT: '5432' });
eq('# inside double quotes kept', exported('SECRET_HASH="something-with-a-#-hash"'), { SECRET_HASH: 'something-with-a-#-hash' });
eq('# inside quotes, then a comment', exported("A='a#b' # note"), { A: 'a#b' });
eq('export with extra spaces and a comment', exported('   export   API_URL="https://example.com/#x"  # prod'),
  { API_URL: 'https://example.com/#x' });
eq('a key named export', exported('export=1'), { export: '1' });
eq('"export" followed by = is not a prefix', exported('export =1'), { export: '1' });
{
  const e = entry('COLOR=#fff', 'COLOR');
  eq('value starting with # is empty (dotenv)', e.value, '');
  check('note explains the # cut', e.notes.some((n) => /#/.test(n)), JSON.stringify(e.notes));
}
{
  const e = entry('URL=http://x/a#frag', 'URL');
  eq('# right after text cuts the value', e.value, 'http://x/a');
  check('note for # right after text', e.notes.some((n) => /#/.test(n)), JSON.stringify(e.notes));
}
eq('no # note for a spaced comment', entry('A=1 # c', 'A').notes, []);
eq('export line has no warning', entry('export A=1', 'A').type, 'ok');

// ---------- quotes ----------
eq('double quotes expand \\n', exported('A="l1\\nl2"'), { A: 'l1\nl2' });
eq('single quotes keep \\n', exported("A='l1\\nl2'"), { A: 'l1\\nl2' });
eq('backticks', exported('A=`it\'s "x"`'), { A: 'it\'s "x"' });
eq('quoted whitespace kept', exported('A="  x  "'), { A: '  x  ' });
eq('unquoted whitespace trimmed', exported('A=   x y   '), { A: 'x y' });
eq('inner quotes kept', exported('JSON={"foo": "bar"}'), { JSON: '{"foo": "bar"}' });
{
  const text = 'KEY="-----BEGIN-----\nabc\n-----END-----"\nNEXT=1';
  const entries = E.parseEnv(text);
  eq('multiline quoted value', exported(text), { KEY: '-----BEGIN-----\nabc\n-----END-----', NEXT: '1' });
  eq('continuation lines are not separate entries', entries.map((e) => e.lineNo), [1, 4]);
  check('multiline note gives the lines', /1-3/.test(entries[0].notes.join()), JSON.stringify(entries[0].notes));
}
{
  const e = entry('A="x', 'A');
  eq('unclosed quote keeps the raw text (dotenv)', e.value, '"x');
  check('unclosed quote note', e.notes.includes('Unclosed quote'), JSON.stringify(e.notes));
}
{
  const e = entry('A="x" y', 'A');
  eq('text after closing quote (dotenv)', e.value, '"x" y');
  check('text after closing quote note', e.notes.includes('Text after closing quote'), JSON.stringify(e.notes));
}

// ---------- other lines ----------
eq('empty value', entry('A=', 'A').notes, ['Empty value']);
eq('empty value with comment', exported('A= # none\nB=2'), { A: '', B: '2' });
eq('missing = is an error', E.parseEnv('JUSTTEXT')[0].type, 'error');
eq('empty key is an error', E.parseEnv('=1')[0].type, 'error');
eq('comment line', E.parseEnv('# hello')[0].type, 'comment');
eq('duplicate: last wins', exported('A=1\nA=2'), { A: '2' });
check('duplicate note', entry('A=1\nA=2', 'A').notes.length === 0 && E.parseEnv('A=1\nA=2')[1].notes.includes('Duplicate key'));
check('constructor is not a duplicate', !E.parseEnv('constructor=1')[0].notes.includes('Duplicate key'));
eq('CRLF', exported('A=1\r\nB="x" # c\r\n'), { A: '1', B: 'x' });
eq('line numbers after a multiline value', E.parseEnv("A='1\n2'\n\n# c\nB=3").map((e) => e.lineNo), [1, 4, 5]);
eq('spaces around =', exported('A = 1'), { A: '1' });

// ---------- dotenv.parse() is the reference ----------
[
  'export DB_HOST=localhost\nDB_PORT=5432 # default\nDB_PASS="p#ss word" # quoted',
  "A='single' # c\nB=`back # tick`\nC=\"dq \\\"inner\\\" x\"",
  'URL=http://x/a#frag\nCOLOR=#fff\nEMPTY=\nSPACED =  value with spaces  ',
  'KEY="line1\nline2" # c\nNEXT=2\nexport   LAST = last',
  'A="x" y\nB="unclosed\nC=3',
  '# only a comment\n\n   \nX=1\nX=2',
  "PRIVATE='-----BEGIN-----\nMIIB\n-----END-----'\nAFTER=ok # done",
  'A=a\\nb\nB="a\\nb"\nC=\'a\\nb\'',
].forEach((text, n) => sameAsDotenv('fixture ' + (n + 1), text));

// ---------- en tool page example ----------
{
  const PAGE = '# Database config\nDB_HOST=localhost\nDB_PORT=5432 # default port\nDB_PASSWORD="s3cr3t#1"\nAPI_KEY=\nAPP_ENV=development\nAPP_ENV=production\nexport NODE_ENV=production\nCOLOR=#fff\nPRIVATE_KEY="-----BEGIN KEY-----\nabc\n-----END KEY-----"\nGREETING="Hello\\nWorld"\nSINGLE=\'Hello\\nWorld\'\nmy-key=1\nBROKEN LINE\n';
  sameAsDotenv('page example', PAGE);
  const rows = E.parseEnv(PAGE).filter((e) => e.type !== 'comment').map((e) => [e.lineNo, e.type, e.key || '', e.type === 'error' ? e.error : (e.notes || []).join('; ')]);
  eq('page example rows', rows, [
    [2, 'ok', 'DB_HOST', ''], [3, 'ok', 'DB_PORT', ''], [4, 'ok', 'DB_PASSWORD', ''], [5, 'warn', 'API_KEY', 'Empty value'],
    [6, 'ok', 'APP_ENV', ''], [7, 'warn', 'APP_ENV', 'Duplicate key'], [8, 'ok', 'NODE_ENV', ''],
    [9, 'warn', 'COLOR', 'Text after # is a comment; quote the value to keep it; Empty value'],
    [10, 'warn', 'PRIVATE_KEY', 'Multiline value (lines 10-12)'], [13, 'ok', 'GREETING', ''], [14, 'ok', 'SINGLE', ''],
    [15, 'warn', 'my-key', 'Non-standard key name'], [16, 'error', '', 'Missing = sign'],
  ]);
  eq('page example export has 11 keys', Object.keys(exported(PAGE)).length, 11);
  eq('__proto__ key is exported as a property', JSON.stringify(exported('__proto__=x\nA=1')), '{"__proto__":"x","A":"1"}');
  check('Export JSON uses a null-prototype object and counts unique keys', /var obj = Object\.create\(null\);[\s\S]*?var keyCount = Object\.keys\(obj\)\.length;[\s\S]*?replace\('\{n\}', keyCount\)/.test(source));
}

// ---------- guide (src/content/blog/env-file-parser-guide/en.mdx) ----------
// The code block after {/* env-sample */} is the sample file (its last line is read with CRLF, as the
// guide says). In the table after {/* env-table */}, cells are JSON values in inline code ("—" = not
// set): column 2 must equal the parser's export and dotenv.parse(), column 3 util.parseEnv() (Node's
// --env-file parser), column 4 python-dotenv dotenv_values() when python-dotenv 1.2.4 is installed
// (SKIP otherwise). godotenv and Compose columns were measured once (see the guide) and are not rerun.
// The rows after {/* env-notes */} are the parser's notes for the sample. The Node block after
// {/* env-run: {"expect":…} */} is run next to the sample (from .generated/, so `dotenv` resolves).
{
  const { existsSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const util = await import('node:util');
  const rel = 'src/content/blog/env-file-parser-guide/en.mdx';
  const text = readFileSync(join(root, rel), 'utf8');
  const sm = text.match(/\{\/\* env-sample \*\/\}\s*```bash\n([\s\S]*?)```/);
  check(rel + ' has the sample block', !!sm);
  const sample = sm ? sm[1].replace(/\n(CRLF=value)\n$/, '\n$1\r\n') : '';
  check(rel + ' sample ends with a CRLF line', sample.endsWith('CRLF=value\r\n'));
  const tool = exported(sample);
  const viaDotenv = dotenv.parse(sample);
  const viaNode = typeof util.parseEnv === 'function' ? util.parseEnv(sample) : null;
  let py = null;
  try {
    const out = execFileSync('python3', ['-c', 'import json,importlib.metadata as m;from dotenv import dotenv_values;import io,sys;print(m.version("python-dotenv"));print(json.dumps(dotenv_values(stream=io.StringIO(sys.stdin.read()))))'], { input: sample, stdio: ['pipe', 'pipe', 'ignore'] }).toString().split('\n');
    if (out[0] === '1.2.4') py = JSON.parse(out[1]);
    else console.log('SKIP python-dotenv column (installed ' + out[0] + ', guide measured 1.2.4)');
  } catch { console.log('SKIP python-dotenv column (python-dotenv not installed)'); }
  const cell = (c) => {
    c = c.trim();
    if (c === '—') return undefined;
    const m = c.match(/^(`+)\s?([\s\S]*?)\s?\1$/);
    return m ? JSON.parse(m[2]) : c;
  };
  const tableAfter = (mark) => {
    const lines = text.slice(text.indexOf(mark)).split('\n').slice(1);
    const first = lines.findIndex((l) => l.startsWith('|'));
    const out = [];
    for (let i = first; i >= 0 && i < lines.length && lines[i].startsWith('|'); i++) out.push(lines[i]);
    return out.slice(2);
  };
  const rows = tableAfter('{/* env-table */}');
  let n = 0;
  for (const line of rows) {
    if (!line.startsWith('| ')) break;
    const cols = line.slice(2, -2).split(' | ');
    const key = cols[0];
    n++;
    eq('guide table ' + key + ': parser', tool[key], cell(cols[1]));
    eq('guide table ' + key + ': dotenv', viaDotenv[key], cell(cols[1]));
    if (viaNode) eq('guide table ' + key + ': util.parseEnv', viaNode[key], cell(cols[2]));
    if (py) eq('guide table ' + key + ': python-dotenv', py[key], cell(cols[3]));
  }
  check('guide table has 16 rows', n === 16, n);
  const noteRows = tableAfter('{/* env-notes */}').map((l) => l.slice(2, -2).split(' | '));
  const actual = E.parseEnv(sample).filter((e) => e.type === 'error' || (e.notes && e.notes.length)).map((e) => [String(e.lineNo), e.key || '—', e.type === 'error' ? e.error : e.notes.join('; ')]);
  eq('guide notes table', noteRows, actual);
  const run = text.match(/\{\/\* env-run: (\{.*?\}) \*\/\}\s*```js\n([\s\S]*?)```/);
  check(rel + ' has a runnable block', !!run);
  if (run && viaNode) {
    const spec = JSON.parse(run[1]);
    mkdirSync(join(root, '.generated'), { recursive: true });
    const dir = mkdtempSync(join(root, '.generated', 'env-run-'));
    try {
      writeFileSync(join(dir, '.env'), sample);
      writeFileSync(join(dir, 'compare-env.mjs'), run[2]);
      const out = execFileSync(process.execPath, ['compare-env.mjs'], { cwd: dir }).toString().trim();
      eq('guide compare-env.mjs output', out, spec.expect);
      eq('guide compare-env.mjs output comment', [...run[2].matchAll(/^\/\/ (ESCAPED.+)$/gm)].map((x) => x[1]).join('\n'), out);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const tpl = [/^## What (is|are) /mi, /^## .*Online/mi, /^## .* in Code$/mi, /^## (Summary|Conclusion)/mi].filter((re) => re.test(text));
  check(rel + ' has no template headings', tpl.length === 0, tpl.map(String));
  check(rel + ' sample has no provider key formats', !/\b(AKIA|sk_live_|sk_test_|ghp_|xox[bp]-|AIza)/.test(text));
}

// ---------- tool pages: {/* efp-check: {...} */} ----------
// The next ``` block is the .env text, the following ```json block the Export JSON download (the
// Parse / Export handlers run in the page language). status: the status line after Parse, which
// must appear in the page; rows: [line, type, key, note] as the table shows them, every note in the
// page; toolOnly: keys the export keeps and dotenv.parse() drops; node: util.parseEnv() output
// (checked when Node has util.parseEnv).
{
  const util = await import('node:util');
  const STRS = new Function('return ' + /var STRINGS = (\{[\s\S]*?\n      \});/.exec(source)[1])();
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const rel = 'src/content/tools/env-file-parser/' + lang + '.mdx';
    const mdx = readFileSync(join(root, rel), 'utf8');
    let n = 0;
    for (const m of mdx.matchAll(/\{\/\* efp-check: (\{.*?\}) \*\/\}/g)) {
      n++;
      const spec = JSON.parse(m[1]);
      const fences = [...mdx.slice(m.index).matchAll(/```\w*\n([\s\S]*?)```/g)].map((f) => f[1]);
      const text = fences[0], expected = JSON.parse(fences[1]);
      const p = await pageExport(text, lang);
      eq(rel + ' example ' + n + ' export', JSON.stringify(p.output), JSON.stringify(expected));
      const ref = dotenv.parse(text);
      for (const k of spec.toolOnly || []) { check(rel + ' dotenv drops ' + k, !Object.keys(ref).includes(k)); Object.defineProperty(ref, k, { value: expected[k], enumerable: true }); }
      eq(rel + ' example ' + n + ' keys as dotenv', Object.entries(p.output).sort(), Object.entries(ref).sort());
      eq(rel + ' example ' + n + ' status', p.parseStatus, spec.status);
      check(rel + ' example ' + n + ' status in page', mdx.includes(spec.status), spec.status);
      if (spec.rows) {
        const rows = E.parseEnv(text, STRS[lang].notes).filter((e) => e.type !== 'comment')
          .map((e) => [e.lineNo, e.type, e.key || '', e.type === 'error' ? e.error : e.notes.join(STRS[lang].stSep)]);
        eq(rel + ' example ' + n + ' rows', rows, spec.rows);
        spec.rows.forEach((r) => r[3] && check(rel + ' note in page: ' + r[3], mdx.includes(r[3])));
      }
      if (spec.node && typeof util.parseEnv === 'function') eq(rel + ' example ' + n + ' util.parseEnv', { ...util.parseEnv(text) }, spec.node);
    }
    check(rel + ' has checked examples', n >= 2, n);
    check(rel + ' drops the old FAQ claims', !/don't match \[A-Za-z_\]\[A-Za-z0-9_\]\*\)\./.test(mdx) && !/first or last wins|取哪个值取决于|どの値が使われるかは|어떤 값이 사용될지는/.test(mdx));
  }
}

// ---------- notes and status line in the page language ----------
// The notes, errors and the status line were English on every language version of the page
{
  const STR = new Function('return ' + /var STRINGS = (\{[\s\S]*?\n      \});/.exec(source)[1])();
  const enKeys = Object.keys(STR.en.notes || {}).sort();
  eq('en notes keys', enKeys, ['afterQuote', 'colonForm', 'duplicate', 'emptyKey', 'emptyValue', 'hashComment', 'missingEq', 'multiline', 'nonStandard', 'unclosed']);
  for (const lang of ['zh', 'ja', 'ko']) {
    eq(lang + ' notes keys', Object.keys(STR[lang].notes || {}).sort(), enKeys);
    eq(lang + ' top-level keys', Object.keys(STR[lang]).sort(), Object.keys(STR.en).sort());
    check(lang + ' multiline keeps {from} and {to}', /\{from\}/.test(STR[lang].notes.multiline) && /\{to\}/.test(STR[lang].notes.multiline));
  }
  const zh = E.parseEnv('A=\nB="x\ny"\nNOEQ', STR.zh.notes);
  eq('zh empty value', zh[0].notes, [STR.zh.notes.emptyValue]);
  eq('zh multiline', zh[1].notes, [STR.zh.notes.multiline.replace('{from}', '2').replace('{to}', '3')]);
  eq('zh missing =', zh[2].error, STR.zh.notes.missingEq);
  eq('English stays the default', E.parseEnv('A=')[0].notes, ['Empty value']);
  check('status line built from STRINGS', /t\.stValid/.test(source) && !/' valid'/.test(source));
  check('page no longer says messages are English', !readFileSync(join(root, 'src/content/tools/env-file-parser/en.mdx'), 'utf8').includes('Messages are in English'));
}

// ---------- complete page and real shared Ctrl/Command+L ----------
// DOM, timer delivery and download capture are controlled; parser/render/export handlers are real.
console.log('Existing checks: '+passes+' passed, '+failures+' failed');
const lifecycleStart=passes;
const {parseFragment,defaultTreeAdapter}=require('parse5');
const sharedSource=readFileSync(join(root,'src/layouts/ToolLayout.astro'),'utf8');
const sharedShortcut=sharedSource.slice(sharedSource.indexOf('// ── Keyboard shortcuts:'),sharedSource.indexOf('// ── Copy button visual feedback'));
if(!sharedShortcut.includes('window.ztPersist.clear(_slug)'))throw Error('Missing actual shared shortcut');
const pageStrings=vm.runInNewContext(source.slice(source.indexOf('var STRINGS ='),source.indexOf('var pageLang ='))+';STRINGS;');
function fullPage(lang,order){
  const timers=[],downloads=[],urls=new Map(),clears=[];let doc;
  const descendants=e=>e.children.flatMap(c=>[c,...descendants(c)]);
  function matches(el,selector){return selector.split(',').some(part=>{
    const s=part.trim(),space=s.lastIndexOf(' ');if(space>=0)return matches(el,s.slice(space+1))&&!!el.parentNode?.closest(s.slice(0,space));
    const tag=/^[a-z][\w-]*/i.exec(s)?.[0],id=/#([\w-]+)/.exec(s)?.[1];
    return(!tag||el.tagName===tag.toUpperCase())&&(!id||el.id===id)&&[...s.matchAll(/\.([\w-]+)/g)].every(m=>el.className.split(/\s+/).includes(m[1]))&&[...s.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(m=>m[2]===undefined?el.getAttribute(m[1])!==null:el.getAttribute(m[1])===m[2]);
  });}
  class Element{
    constructor(tag){Object.assign(this,{tagName:tag.toUpperCase(),children:[],parentNode:null,attributes:{},listeners:{},style:{},className:'',id:'',disabled:false,text:'',_value:null});}
    get value(){return this._value??(this.tagName==='TEXTAREA'?this.textContent:'');}set value(v){this._value=String(v);}
    get textContent(){return this.text+this.children.map(c=>c.textContent).join('');}set textContent(v){this.children.forEach(c=>{c.parentNode=null;});this.children=[];this.text=String(v);}
    set innerHTML(v){this.textContent='';const context=defaultTreeAdapter.createElement(this.tagName.toLowerCase(),'http://www.w3.org/1999/xhtml',[]);for(const n of parseFragment(context,String(v)).childNodes)this.appendChild(convert(n));}
    setAttribute(k,v){this.attributes[k]=String(v);if(k==='id')this.id=String(v);if(k==='class')this.className=String(v);if(k==='disabled')this.disabled=true;if(k==='style')for(const d of String(v).split(';')){const i=d.indexOf(':');if(i>=0)this.style[d.slice(0,i).trim()]=d.slice(i+1).trim();}}
    getAttribute(k){return this.attributes[k]??null;}
    appendChild(c){this.children.push(c);c.parentNode=this;return c;}
    contains(e){return e===this||descendants(this).includes(e);}
    closest(sel){for(let e=this;e;e=e.parentNode)if(matches(e,sel))return e;return null;}
    querySelectorAll(sel){return descendants(this).filter(e=>matches(e,sel));}querySelector(sel){return this.querySelectorAll(sel)[0]??null;}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    dispatch(type,extra={}){const e={type,target:this,bubbles:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...extra};for(let n=this;n;n=n.parentNode){e.currentTarget=n;for(const fn of n.listeners[type]||[])fn.call(n,e);}return e;}
    focus(){doc.activeElement=this;}
    click(){if(this.disabled)return;if(this.tagName==='A'&&this.download)downloads.push({name:this.download,blob:urls.get(this.href)});this.dispatch('click');}
  }
  function convert(n){const el=new Element(n.tagName||n.nodeName);if(n.nodeName==='#text')el.text=n.value;for(const a of n.attrs||[])el.setAttribute(a.name,a.value);for(const c of n.childNodes||[])if(c.nodeName!=='#comment')el.appendChild(convert(c));return el;}
  doc=new Element('#document');doc.documentElement=new Element('html');doc.documentElement.lang=lang;doc.appendChild(doc.documentElement);doc.body=new Element('body');doc.documentElement.appendChild(doc.body);
  const widget=new Element('section');widget.className='tool-widget';doc.body.appendChild(widget);
  const esc=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  widget.innerHTML=source.replace(/^---\n[\s\S]*?\n---\s*/,'').split('<script')[0].replace(/placeholder=\{("(?:[^"\\]|\\.)*")\}/g,(_,v)=>'placeholder="'+esc(JSON.parse(v))+'"');
  doc.getElementById=id=>descendants(doc).find(e=>e.id===id)??null;doc.createElement=tag=>new Element(tag);doc.activeElement=doc.body;
  const get=id=>{const e=doc.getElementById(id);if(!e)throw Error('Missing real markup ID '+id);return e;};
  const sandbox={document:doc,Blob,console,_slug:'env-file-parser',ztPersist:{clear(slug){clears.push(slug);}},setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},URL:{createObjectURL(blob){const key='blob:'+urls.size;urls.set(key,blob);return key;},revokeObjectURL(key){urls.delete(key);}},navigator:{clipboard:{writeText(){throw Error('Unexpected clipboard request');},write(){throw Error('Unexpected clipboard request');}}}};
  sandbox.window=sandbox;const ctx=vm.createContext(sandbox);
  if(order==='shared-before')vm.runInContext(sharedShortcut,ctx);
  vm.runInContext(source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1],ctx,{filename:'EnvFileParserTool.astro:complete-page',timeout:1000});
  if(order==='shared-after')vm.runInContext(sharedShortcut,ctx);
  return{doc,get,timers,downloads,clears,input(v){get('efp-input').value=v;get('efp-input').dispatch('input');},flush(){for(const t of timers.splice(0))t.fn();},key(target,key='l',mod='ctrlKey'){const el=target==='outside'?doc.body:get(target);el.focus();return el.dispatch('keydown',{key,[mod]:true});}};
}
function envSnapshot(h){return{input:h.get('efp-input').value,status:h.get('efp-status').textContent,statusClass:h.get('efp-status').className,display:h.get('efp-result').style.display,rows:h.get('efp-tbody').children.length,disabled:h.get('efp-export-json').disabled};}
const clearState={input:'',status:'',statusClass:'efp-status ',display:'none',rows:0,disabled:true};
for(const lang of ['en','zh','ja','ko'])for(const order of ['shared-before','shared-after']){
  const h=fullPage(lang,order),prefix=lang+' '+order+' ';
  h.input('A=one\nA=two\nB=3\n__proto__=kept\nBROKEN');h.get('efp-parse').click();h.get('efp-export-json').click();
  eq(prefix+'real export name',h.downloads[0].name,'env.json');
  eq(prefix+'real export complete bytes',await h.downloads[0].blob.text(),'{\n  "A": "two",\n  "B": "3",\n  "__proto__": "kept"\n}');
  eq(prefix+'real table rows',h.get('efp-tbody').children.length,5);
  const valid=envSnapshot(h);eq(prefix+'outside valid CtrlL not intercepted',h.key('outside').defaultPrevented,false);h.flush();eq(prefix+'outside valid CtrlL retains state',envSnapshot(h),valid);
  for(const mod of ['ctrlKey','metaKey'])for(const key of ['l','L']){
    h.input('');h.get('efp-parse').click();eq(prefix+'empty Parse gives actual prompt',h.get('efp-status').textContent,pageStrings[lang].pastePrompt);
    const prompt=envSnapshot(h),before=h.clears.length;
    eq(prefix+'outside empty '+mod+'/'+key+' not intercepted',h.key('outside',key,mod).defaultPrevented,false);h.flush();
    eq(prefix+'outside empty '+mod+'/'+key+' keeps prompt',envSnapshot(h),prompt);
    eq(prefix+'outside empty never persists clear',h.clears.length,before);
    h.input('A=old');h.get('efp-parse').click();const downloads=h.downloads.length;
    eq(prefix+'inside '+mod+'/'+key+' clears through shared handler',h.key('efp-input',key,mod).defaultPrevented,true);h.flush();
    eq(prefix+'inside clears cache/table/status',envSnapshot(h),clearState);eq(prefix+'shared clear called once',h.clears.length,before+1);
    h.get('efp-export-json').click();eq(prefix+'cleared data cannot export',h.downloads.length,downloads);
  }
  h.input('A=old');h.get('efp-parse').click();h.input('A=new');eq(prefix+'input invalidates shown result',[h.get('efp-result').style.display,h.get('efp-export-json').disabled,h.get('efp-tbody').children.length],['none',true,0]);
  h.key('efp-input','Enter');h.get('efp-export-json').click();eq(prefix+'CtrlEnter parses fresh value',await h.downloads.at(-1).blob.text(),'{\n  "A": "new"\n}');
  h.get('efp-clear').click();eq(prefix+'explicit Clear',envSnapshot(h),clearState);
  h.input('BROKEN');h.get('efp-parse').click();eq(prefix+'error rows disable export',[h.get('efp-result').style.display,h.get('efp-export-json').disabled,h.get('efp-tbody').children.length],['',true,1]);
  h.input('C=recovered');h.get('efp-parse').click();h.get('efp-export-json').click();eq(prefix+'valid recovery exports no old keys',await h.downloads.at(-1).blob.text(),'{\n  "C": "recovered"\n}');
}
const fullEngine=source.slice(startIndex,endIndex+END_MARK.length);
eq('engine byte-exact',[Buffer.byteLength(fullEngine),createHash('sha256').update(fullEngine).digest('hex')],[5008, "3531606be715b93b36c21593441c8ef399bd9248c0e99d598532b1f28f4bd4d7"]);
console.log('Page lifecycle: '+(passes-lifecycleStart)+' passed, '+failures+' total failures');

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
