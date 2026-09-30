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
// equals dotenv.parse() for every fixture. Rules: https://github.com/motdotla/dotenv#what-rules-does-the-parsing-engine-follow
// and the LINE regex in https://github.com/motdotla/dotenv/blob/v16.6.1/lib/main.js
//
// Run: node scripts/test-env-file-parser.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

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
  const obj = {};
  E.parseEnv(text).forEach((e) => {
    if (e.type === 'ok' || e.type === 'warn') obj[e.key] = e.value;
  });
  return obj;
}
function sameAsDotenv(name, text) {
  eq(name + ' (same as dotenv.parse)', exported(text), dotenv.parse(text));
}
function entry(text, key) {
  return E.parseEnv(text).find((e) => e.key === key);
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

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
