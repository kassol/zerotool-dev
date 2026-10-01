// Timezone Converter — zone names, wall-clock conversion across DST, "Now" in the source zone
//
// Read:  src/components/tools/TimezoneConverterTool.astro (extracts the code from the zoneSet line
//        to zoneCity), src/content/tools/timezone-converter/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: isZone accepts names that Intl.DateTimeFormat accepts even when
// Intl.supportedValuesOf leaves them out (V8 lists Asia/Calcutta and no UTC, so UTC and the
// mumbai / delhi aliases used to be rejected as "Unknown timezone"); wall-clock to UTC in the
// spring-forward gap (02:30 → 03:30, RFC 5545 3.3.5; it used to give 01:30) and the fall-back
// overlap (first occurrence), checked against a brute-force search over every minute; "Now"
// gives the wall-clock time in the source zone (it used to give the browser's local time even
// after the source zone was changed); the examples on the English page.
//
// Run: node scripts/test-timezone-converter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/TimezoneConverterTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/timezone-converter/en.mdx'), 'utf8');
const start = source.indexOf('  const zoneSet = new Set(allZones);');
const end = source.indexOf('  function zoneCity(');
if (start < 0 || end <= start) {
  console.error('FAIL: could not locate the conversion code in TimezoneConverterTool.astro');
  process.exit(1);
}
const E = new Function('allZones', 'datalist', source.slice(start, end) +
  '\nreturn { isZone, wallClockToUtc, formatInZone, dstSummary, nowInZone, getOffsetMin };')(
  Intl.supportedValuesOf('timeZone'), {});

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + e + '\n  actual   ' + a);
}

// ---------- zone names ----------
for (const z of ['UTC', 'Asia/Kolkata', 'Asia/Calcutta', 'Europe/Kyiv', 'America/New_York', 'Asia/Tokyo']) eq('isZone ' + z, E.isZone(z), true);
for (const z of ['Mars/Olympus', '', 'Asia/Tokio']) eq('not a zone ' + JSON.stringify(z), E.isZone(z), false);
const aliasBlock = source.slice(source.indexOf('const ALIASES = {'), source.indexOf('};', source.indexOf('const ALIASES = {')));
for (const [, alias, zone] of aliasBlock.matchAll(/'([^']+)': '([^']+)'/g)) eq('alias ' + alias + ' is a zone', E.isZone(zone), true);
eq('typing utc resolves', /if \(lc === 'utc' \|\| lc === 'gmt'\) return 'UTC';/.test(source), true);

// ---------- wall clock → UTC against a brute-force search ----------
// All UTC minutes whose wall clock in `zone` equals the given one
function bruteForce(wall, zone) {
  const [y, mo, d, h, mi] = wall.match(/\d+/g).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const want = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}, ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  const hits = [];
  for (let t = guess - 15 * 3600000; t <= guess + 15 * 3600000; t += 60000) {
    if (fmt.format(new Date(t)) === want) hits.push(t);
  }
  return hits;
}
const cases = [];
for (const zone of ['America/New_York', 'Europe/London', 'Australia/Sydney', 'Australia/Lord_Howe', 'America/Sao_Paulo', 'Asia/Tokyo', 'Asia/Kolkata', 'Pacific/Chatham', 'America/St_Johns']) {
  for (const day of ['2026-03-08', '2026-03-29', '2026-04-05', '2026-10-04', '2026-11-01', '2026-10-25', '2026-06-15', '2026-09-27', '2026-04-05']) {
    for (const time of ['00:30', '01:30', '02:00', '02:30', '03:30', '12:00']) cases.push([day + 'T' + time, zone]);
  }
}
let gapCount = 0;
let overlapCount = 0;
let mismatch = 0;
for (const [wall, zone] of cases) {
  const got = E.wallClockToUtc(wall, zone).getTime();
  const hits = bruteForce(wall, zone);
  let want;
  if (hits.length) {
    want = hits[0];
    if (hits.length > 1) overlapCount++;
  } else {
    gapCount++;
    // skipped time: read with the offset before the gap (RFC 5545 3.3.5)
    const guess = Date.parse(wall + ':00Z');
    want = guess - E.getOffsetMin(new Date(guess - 86400000), zone) * 60000;
  }
  if (got !== want) { mismatch++; if (mismatch < 5) console.log('  mismatch', wall, zone, new Date(got).toISOString(), new Date(want).toISOString()); }
}
eq('wall clock matches brute force (' + cases.length + ' cases)', mismatch, 0);
eq('cases include gaps and overlaps', gapCount > 3 && overlapCount > 3, true);

// ---------- page examples ----------
const show = (wall, src, zone) => {
  const f = E.formatInZone(E.wallClockToUtc(wall, src), zone);
  return f.local + ', ' + f.offset + (f.abbr ? ' (' + f.abbr + ')' : '');
};
for (const [wall, src, zone, want] of [
  ['2026-10-01T09:00', 'Asia/Shanghai', 'Europe/Berlin', '2026-10-01 03:00:00, UTC+02:00'],
  ['2026-10-01T09:00', 'Asia/Shanghai', 'America/Los_Angeles', '2026-09-30 18:00:00, UTC-07:00 (PDT)'],
  ['2026-10-01T09:00', 'Asia/Shanghai', 'Asia/Seoul', '2026-10-01 10:00:00, UTC+09:00'],
  ['2026-03-25T15:00', 'Europe/London', 'America/New_York', '2026-03-25 11:00:00, UTC-04:00 (EDT)'],
  ['2026-03-25T15:00', 'Europe/London', 'Asia/Kolkata', '2026-03-25 20:30:00, UTC+05:30'],
  ['2026-03-25T15:00', 'Europe/London', 'Australia/Sydney', '2026-03-26 02:00:00, UTC+11:00'],
]) {
  eq('page: ' + wall + ' ' + src + ' → ' + zone, show(wall, src, zone), want);
  eq('page shows ' + want, page.includes('<td>' + want + '</td>'), true);
}
eq('gap: 02:30 New York → 07:30 UTC', E.wallClockToUtc('2026-03-08T02:30', 'America/New_York').toISOString(), '2026-03-08T07:30:00.000Z');
eq('overlap: 01:30 New York → 05:30 UTC', E.wallClockToUtc('2026-11-01T01:30', 'America/New_York').toISOString(), '2026-11-01T05:30:00.000Z');
eq('no DST badge zones', ['Asia/Tokyo', 'Asia/Shanghai', 'Australia/Brisbane'].map((z) => E.dstSummary(new Date(Date.UTC(2026, 5, 1)), z).observesDst), [false, false, false]);
eq('DST badge 3 days before the US change', E.dstSummary(E.wallClockToUtc('2026-03-05T12:00', 'America/New_York'), 'America/New_York').shiftDays, 3);

// ---------- Now in the source zone ----------
const instant = new Date(Date.UTC(2026, 9, 1, 0, 0, 5));
eq('now in Tokyo', E.nowInZone('Asia/Tokyo', instant), '2026-10-01T09:00:05');
eq('now in Los Angeles', E.nowInZone('America/Los_Angeles', instant), '2026-09-30T17:00:05');
eq('Now button uses the source zone', /state\.base = nowInZone\(state\.source\);/.test(source), true);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
