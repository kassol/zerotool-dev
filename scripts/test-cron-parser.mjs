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
// day of month OR day of week when both are restricted (cronie / POSIX, sources at that section),
// a field starting with * counts as unrestricted, month always ANDed; runs years ahead (Jan 1st,
// Feb 29 across 2100, Feb 30 never) within a time limit; non-existent DST times skipped; a step
// after a single number (5/10) is an error; 4-language STRINGS have the same keys.
//
// Run: node scripts/test-cron-parser.mjs

process.env.TZ = 'America/New_York'; // fixed zone: run times are local, and one case needs a DST gap

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
const E = new Function(block + '\nreturn { parseCron, parseField, nextRuns, humanizeCron, WDAY_ABBR };')();

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

// ---------- day of month OR day of week ----------
// cronie crontab(5), https://man7.org/linux/man-pages/man5/crontab.5.html : "If both fields are
// restricted (i.e., do not contain the "*" character), the command will be run when either field
// matches the current time. For example, "30 4 1,15 * 5" would cause a command to be run at 4:30 am
// on the 1st and 15th of each month, plus every Friday."
// POSIX crontab, https://pubs.opengroup.org/onlinepubs/9799919799/utilities/crontab.html : "if either
// the month or day of month is specified as an element or list, and the day of week is also
// specified as an element or list, then any day matching either the month and day of month, or
// the day of week, shall be matched."
// Where the two differ we follow cronie's code (src/cron.c, DOM_STAR / DOW_STAR): a field counts as
// unrestricted when it starts with "*" (so "*/2" is unrestricted), and the month field is always
// ANDed. POSIX has no steps, and would also OR a restricted month with a restricted weekday.
eq('0 0 1 * 1: the 1st or any Monday', runs('0 0 1 * 1', start, 5),
  ['2026-10-01 00:00', '2026-10-05 00:00', '2026-10-12 00:00', '2026-10-19 00:00', '2026-10-26 00:00']);
eq('cronie man page example 30 4 1,15 * 5', runs('30 4 1,15 * 5', start, 5),
  ['2026-10-01 04:30', '2026-10-02 04:30', '2026-10-09 04:30', '2026-10-15 04:30', '2026-10-16 04:30']);
eq('*/2 day of month counts as unrestricted: odd days that are Mondays', runs('0 0 */2 * 1', start, 3),
  ['2026-10-05 00:00', '2026-10-19 00:00', '2026-11-09 00:00']);
eq('month is still ANDed: Jan 1st or Mondays in January', runs('0 0 1 1 1', start, 4),
  ['2027-01-01 00:00', '2027-01-04 00:00', '2027-01-11 00:00', '2027-01-18 00:00']);
check('description says "or" when both day fields are restricted', / or on /.test(E.humanizeCron(['0', '0', '1', '*', '1'])), E.humanizeCron(['0', '0', '1', '*', '1']));
check('description says "and" when day of month starts with *', / and on /.test(E.humanizeCron(['0', '0', '*/2', '*', '1'])), E.humanizeCron(['0', '0', '*/2', '*', '1']));

// ---------- next runs far in the future ----------
eq('yearly Jan 1st', runs('0 0 1 1 *', start, 3), ['2027-01-01 00:00', '2028-01-01 00:00', '2029-01-01 00:00']);
eq('yearly Jan 1st, 10 runs', runs('0 0 1 1 *', start, 10).length, 10);
eq('Feb 29 only in leap years', runs('0 0 29 2 *', start, 3), ['2028-02-29 00:00', '2032-02-29 00:00', '2036-02-29 00:00']);
eq('Feb 29 across 2100 (not a leap year)', runs('0 0 29 2 *', new Date(2096, 2, 1), 1), ['2104-02-29 00:00']);
eq('Feb 30 never matches', runs('0 0 30 2 *', start, 3), []);
eq('every minute', runs('* * * * *', start, 3), ['2026-09-29 10:31', '2026-09-29 10:32', '2026-09-29 10:33']);
eq('start is exclusive', runs('30 10 * * *', start, 1), ['2026-09-30 10:30']);
eq('Dec 31 23:59 rolls into next year', runs('59 23 31 12 *', start, 2), ['2026-12-31 23:59', '2027-12-31 23:59']);
let t0 = Date.now();
runs('0 0 29 2 *', start, 10);
runs('0 0 30 2 *', start, 10);
runs('* * * * *', start, 10);
check('10 Feb 29 runs, an impossible date and every minute take < 500 ms', Date.now() - t0 < 500, (Date.now() - t0) + ' ms');
// America/New_York (set at the top): 2027-03-14 02:30 does not exist, cronie never matches it
eq('non-existent DST time is skipped', runs('30 2 * * *', new Date(2027, 2, 13, 0, 0), 2), ['2027-03-13 02:30', '2027-03-15 02:30']);

// ---------- steps need * or a range ----------
// cronie crontab(5): "Step values can be used in conjunction with ranges ... Step values are also
// permitted after an asterisk". cronie's parser (src/entry.c get_range, state R_NUM1) rejects "/"
// after a single number, so "5/10" is an error there too.
eq('5/10 is an error', E.parseCron('5/10 * * * *').error, { code: 'step', token: '5/10', field: 0 });
eq('mon/2 is an error', E.parseCron('0 0 * * mon/2').error, { code: 'step', token: 'mon/2', field: 4 });
eq('5/10 inside a list', E.parseCron('0 1,5/10 * * *').error, { code: 'step', token: '5/10', field: 1 });
eq('5-59/10 works', values('5-59/10 * * * *')[0], [5, 15, 25, 35, 45, 55]);
eq('*/10 works', values('*/10 * * * *')[0], [0, 10, 20, 30, 40, 50]);

// ---------- 4-language STRINGS have the same keys ----------
const stringsMatch = source.match(/var STRINGS = (\{[\s\S]*?\n {6}\});/);
check('STRINGS block found', !!stringsMatch);
if (stringsMatch) {
  const S = new Function('return ' + stringsMatch[1])();
  const enKeys = Object.keys(S.en).sort().join(',');
  for (const lang of ['zh', 'ja', 'ko']) eq('STRINGS ' + lang + ' keys match en', Object.keys(S[lang]).sort().join(','), enKeys);
  for (const key of ['errUnsupported', 'errStep']) {
    for (const lang of ['en', 'zh', 'ja', 'ko']) check(key + ' ' + lang + ' has {token} and {field}', /\{token\}/.test(S[lang][key] || '') && /\{field\}/.test(S[lang][key] || ''));
  }
}

function range(a, b) { const out = []; for (let i = a; i <= b; i++) out.push(i); return out; }
function pad(n) { return String(n).padStart(2, '0'); }

console.log((failures ? 'FAILED' : 'PASSED') + ': ' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
