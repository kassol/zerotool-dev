// Cron Job Generator — field parsing, next runs in UTC and local time, day-field rule
//
// Read:  src/components/tools/CronJobGeneratorTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers), src/content/tools/cron-job-generator/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: parseField takes whole decimal numbers only (1.5, 5abc and the Quartz form 1#2 used to be
// read by parseInt as 1 or 5), a step needs * or a range before it (cronie get_range), names for
// months and weekdays; nextRuns in UTC matches a minute-by-minute reference that applies the
// cronie day rule (a day field starting with * does not restrict; when neither does, either field
// may match) for a set of expressions; the "UTC" list used to evaluate the schedule in the
// browser's time zone and only print it in UTC, so with TZ=Asia/Tokyo `0 9 * * 1-5` showed
// 00:00 UTC; local mode still evaluates in local time; the description says "or" when either day
// field may match; the next-run examples on the English page.
//
// Run: node scripts/test-cron-job-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.TZ = 'Asia/Tokyo';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CronJobGeneratorTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/cron-job-generator/en.mdx'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in CronJobGeneratorTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { parseField, humanizeCron, nextRuns, MONTH_ABBR, WDAY_ABBR };')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + e + '\n  actual   ' + a);
}

// ---------- parseField ----------
for (const bad of ['1.5', '5abc', '1#2', '5/10', '*/5abc', '1-2-3', 'L', '?', '', '*/0', '60', '3-1', '*/2/3']) {
  eq('minute field rejects ' + JSON.stringify(bad), E.parseField(bad, 0, 59, null, 0), null);
}
eq('*/15', E.parseField('*/15', 0, 59, null, 0), [0, 15, 30, 45]);
eq('1-10/3', E.parseField('1-10/3', 0, 59, null, 0), [1, 4, 7, 10]);
eq('list and range', E.parseField('30,0,5-7', 0, 59, null, 0), [0, 5, 6, 7, 30]);
eq('mon-fri', E.parseField('mon-fri', 0, 7, E.WDAY_ABBR, 0), [1, 2, 3, 4, 5]);
eq('jan,jul', E.parseField('jan,jul', 1, 12, E.MONTH_ABBR, 1), [1, 7]);
eq('monday is not a name', E.parseField('monday', 0, 7, E.WDAY_ABBR, 0), null);

// ---------- reference: minute by minute, cronie day rule ----------
function reference(expr, from, count) {
  const f = expr.split(' ');
  const [mins, hrs, doms, mons] = [
    E.parseField(f[0], 0, 59, null, 0), E.parseField(f[1], 0, 23, null, 0),
    E.parseField(f[2], 1, 31, null, 0), E.parseField(f[3], 1, 12, E.MONTH_ABBR, 1),
  ];
  const dows = E.parseField(f[4], 0, 7, E.WDAY_ABBR, 0).map((v) => (v === 7 ? 0 : v));
  const domStar = f[2][0] === '*';
  const dowStar = f[4][0] === '*';
  const out = [];
  let t = Math.floor(from / 60000) * 60000 + 60000;
  for (let i = 0; i < 6 * 366 * 1440 && out.length < count; i++, t += 60000) {
    const d = new Date(t);
    const domOk = doms.includes(d.getUTCDate());
    const dowOk = dows.includes(d.getUTCDay());
    const dayOk = domStar || dowStar ? domOk && dowOk : domOk || dowOk;
    if (mins.includes(d.getUTCMinutes()) && hrs.includes(d.getUTCHours()) && mons.includes(d.getUTCMonth() + 1) && dayOk) {
      out.push(d.toISOString());
    }
  }
  return out;
}

const FROM = Date.UTC(2026, 9, 1, 10, 0, 0); // Thursday 2026-10-01 10:00 UTC
for (const expr of [
  '0 9 * * 1-5', '*/15 * * * *', '0 0 1,15 * 1', '0 0 */2 * 1', '0 0 * * 1', '30 2 29 2 *',
  '0 12 1 jan,jul *', '5 4 * * sun', '0 0 31 * *', '0 */6 * * *', '0 8-17/3 * * mon-fri', '0 0 1-7 * 5',
]) {
  const runs = E.nextRuns(expr.split(' '), 10, true, FROM).map((d) => d.toISOString());
  const ref = reference(expr, FROM, 10); // a six-year window: fewer than 10 for 29 Feb
  eq('reference finds runs for ' + expr, ref.length >= 2, true);
  eq('UTC runs for ' + expr, runs.slice(0, ref.length), ref);
}
eq('never matches: empty list', E.nextRuns('0 0 30 2 *'.split(' '), 10, true, FROM), []);

// ---------- UTC list is evaluated in UTC, local list in local time ----------
eq('UTC: 0 9 * * 1-5 runs at 09:00 UTC',
  E.nextRuns('0 9 * * 1-5'.split(' '), 2, true, FROM).map((d) => d.toISOString()),
  ['2026-10-02T09:00:00.000Z', '2026-10-05T09:00:00.000Z']);
eq('local (Asia/Tokyo): 0 9 * * 1-5 runs at 09:00 JST = 00:00 UTC',
  E.nextRuns('0 9 * * 1-5'.split(' '), 2, false, FROM).map((d) => d.toISOString()),
  ['2026-10-02T00:00:00.000Z', '2026-10-05T00:00:00.000Z']);

// ---------- description ----------
eq('either day field: or', E.humanizeCron('0 0 1,15 * 1'.split(' ')), 'At midnight, on day 1, 15 of the month or on Monday');
eq('day field starts with *: and', /and on Monday$/.test(E.humanizeCron('0 0 */2 * 1'.split(' '))), true);
eq('weekdays 9', E.humanizeCron('0 9 * * 1-5'.split(' ')), 'At 9:00, on Monday through Friday');

// ---------- English page examples ----------
for (const [expr, runs] of [
  ['0 9 * * 1-5', ['2026-10-02 09:00 UTC', '2026-10-05 09:00 UTC', '2026-10-06 09:00 UTC']],
  ['0 0 1,15 * 1', ['2026-10-05 00:00 UTC', '2026-10-12 00:00 UTC', '2026-10-15 00:00 UTC', '2026-10-19 00:00 UTC']],
  ['0 0 */2 * 1', ['2026-10-05 00:00 UTC', '2026-10-19 00:00 UTC', '2026-11-09 00:00 UTC']],
]) {
  const got = E.nextRuns(expr.split(' '), runs.length, true, FROM).map((d) => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
  eq('page runs for ' + expr, got, runs);
  eq('page shows runs for ' + expr, page.includes(runs.join(', ')), true);
  eq('page shows description for ' + expr, page.includes(E.humanizeCron(expr.split(' '))), true);
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
