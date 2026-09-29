// Cron Parser — field parsing, unsupported-syntax errors and next-run regression test
//
// Read:  src/components/tools/CronParserTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: parseCron on standard 5-field syntax (*, lists, ranges, steps, month and weekday
// names, 7 = Sunday); Quartz-style extensions (#, L, W, ?) give an "unsupported" error that
// names the token and the field instead of being read as a plain number; malformed numbers
// (1.5, 5abc, 1-2-3, monday) are invalid; out-of-range values; nextRuns from a fixed start;
// 4-language STRINGS have the same keys.
//
// Run: node scripts/test-cron-parser.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CronParserTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in CronParserTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { parseCron, parseField, nextRuns, WDAY_ABBR };')();

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

// ---------- the reported defect: 1#2 must not become 1 ----------
eq('parseField 1#2 is not read as 1', E.parseField('1#2', 0, 7, E.WDAY_ABBR, 0), null);
eq('parseCron 1#2 → unsupported, names token and weekday field',
  E.parseCron('0 10 * * 1#2').error, { code: 'unsupported', token: '1#2', field: 4 });

// ---------- other Quartz-style extensions ----------
eq('L in day of month', E.parseCron('0 0 L * *').error, { code: 'unsupported', token: 'L', field: 2 });
eq('W in day of month', E.parseCron('0 0 15W * *').error, { code: 'unsupported', token: '15W', field: 2 });
eq('LW in day of month', E.parseCron('0 0 LW * *').error, { code: 'unsupported', token: 'LW', field: 2 });
eq('5L in weekday', E.parseCron('0 0 * * 5L').error, { code: 'unsupported', token: '5L', field: 4 });
eq('? in weekday', E.parseCron('0 0 1 * ?').error, { code: 'unsupported', token: '?', field: 4 });
eq('lowercase l in weekday', E.parseCron('0 0 * * 5l').error, { code: 'unsupported', token: '5l', field: 4 });
eq('# inside a list', E.parseCron('0 0 * * 1,3#1').error, { code: 'unsupported', token: '3#1', field: 4 });
eq('L in minute field', E.parseCron('L * * * *').error, { code: 'unsupported', token: 'L', field: 0 });

// ---------- malformed numbers: no silent truncation ----------
eq('1.5 invalid', E.parseCron('1.5 * * * *').error, { code: 'invalid', field: 0 });
eq('5abc invalid', E.parseCron('5abc * * * *').error, { code: 'invalid', field: 0 });
eq('1-2-3 invalid', E.parseCron('1-2-3 * * * *').error, { code: 'invalid', field: 0 });
eq('monday invalid', E.parseCron('0 0 * * monday').error, { code: 'invalid', field: 4 });
eq('*/5x invalid', E.parseCron('*/5x * * * *').error, { code: 'invalid', field: 0 });
eq('empty list item invalid', E.parseCron('1,,2 * * * *').error, { code: 'invalid', field: 0 });
eq('60 minute out of range', E.parseCron('60 * * * *').error, { code: 'invalid', field: 0 });
eq('day 0 out of range', E.parseCron('0 0 0 * *').error, { code: 'invalid', field: 2 });
eq('reversed range invalid', E.parseCron('0 0 * * 5-1').error, { code: 'invalid', field: 4 });
eq('step 0 invalid', E.parseCron('*/0 * * * *').error, { code: 'invalid', field: 0 });

// ---------- empty and field count ----------
eq('empty', E.parseCron('   ').error, { code: 'empty' });
eq('4 fields', E.parseCron('0 0 * *').error, { code: 'fields', n: 4 });
eq('6 fields', E.parseCron('0 0 0 * * *').error, { code: 'fields', n: 6 });

// ---------- standard syntax still parses ----------
function values(expr) { const r = E.parseCron(expr); return r.error ? r.error : r.values; }
eq('weekdays 9am', values('0 9 * * 1-5'), [[0], [9], range(1, 31), range(1, 12), [1, 2, 3, 4, 5]]);
eq('*/15 minutes', values('*/15 * * * *')[0], [0, 15, 30, 45]);
eq('range with step', values('10-30/10 * * * *')[0], [10, 20, 30]);
eq('list', values('0 8,12,18 * * *')[1], [8, 12, 18]);
eq('weekday names', values('0 0 * * mon-fri')[4], [1, 2, 3, 4, 5]);
eq('weekday names uppercase', values('0 0 * * MON,WED')[4], [1, 3]);
eq('month names', values('0 0 1 jan,jul *')[3], [1, 7]);
eq('7 is Sunday (kept as 7 in breakdown)', values('0 0 * * 7')[4], [7]);
eq('fields returned', E.parseCron('  0   9 * *   1-5 ').fields, ['0', '9', '*', '*', '1-5']);

// ---------- next runs from a fixed local start ----------
function runs(expr, from, n) {
  return E.nextRuns(E.parseCron(expr).fields, n, from).map((d) =>
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()));
}
const start = new Date(2026, 8, 29, 10, 30); // Tue 2026-09-29 10:30 local
eq('weekdays 9am next 3', runs('0 9 * * 1-5', start, 3), ['2026-09-30 09:00', '2026-10-01 09:00', '2026-10-02 09:00']);
eq('Sunday via 7', runs('0 0 * * 7', start, 2), ['2026-10-04 00:00', '2026-10-11 00:00']);
eq('every 20 min', runs('*/20 * * * *', start, 3), ['2026-09-29 10:40', '2026-09-29 11:00', '2026-09-29 11:20']);
eq('monthly 1st', runs('0 0 1 * *', start, 2), ['2026-10-01 00:00', '2026-11-01 00:00']);

// ---------- 4-language STRINGS have the same keys ----------
const stringsMatch = source.match(/var STRINGS = (\{[\s\S]*?\n {6}\});/);
check('STRINGS block found', !!stringsMatch);
if (stringsMatch) {
  const S = new Function('return ' + stringsMatch[1])();
  const enKeys = Object.keys(S.en).sort().join(',');
  for (const lang of ['zh', 'ja', 'ko']) eq('STRINGS ' + lang + ' keys match en', Object.keys(S[lang]).sort().join(','), enKeys);
  check('errUnsupported has {token} and {field}', /\{token\}/.test(S.en.errUnsupported || '') && /\{field\}/.test(S.en.errUnsupported || ''));
}

function range(a, b) { const out = []; for (let i = a; i <= b; i++) out.push(i); return out; }
function pad(n) { return String(n).padStart(2, '0'); }

console.log((failures ? 'FAILED' : 'PASSED') + ': ' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
