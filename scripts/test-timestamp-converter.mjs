// Timestamp Converter — reading a timestamp in seconds, milliseconds, microseconds or nanoseconds
//
// Read:  src/components/tools/TimestampConverterTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers and the 4-language STRINGS),
//        src/content/tools/timestamp-converter/{en,zh,ja,ko}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: automatic unit by the number of integer digits (≤ 12 seconds, 13–15 milliseconds, 16–18
// microseconds, ≥ 19 nanoseconds; decimals no longer count as digits — `1712160000.123` used to be
// read as milliseconds); a chosen unit overrides it, so a 13-digit seconds value (after year 33658)
// can be read; nanosecond values beyond 2^53 keep their millisecond part (BigInt); negative values
// and fractions round like Date (toward zero); invalid text and out-of-range values; the examples
// on the English page; 4-language STRINGS share the same keys.
//
// Run: node scripts/test-timestamp-converter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/TimestampConverterTool.astro'), 'utf8');
const START = '/* ── engine:start ── */';
const END = '/* ── engine:end ── */';
const s = source.indexOf(START);
const e = source.indexOf(END);
if (s < 0 || e <= s) {
  console.error('FAIL: could not locate the engine block in TimestampConverterTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(s, e) + '\nreturn { readTimestamp };')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const x = JSON.stringify(expected);
  if (a === x) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + x + '\n  actual   ' + a);
}
const iso = (raw, unit = 'auto') => {
  const r = E.readTimestamp(raw, unit);
  return r.error ? r.error : [new Date(r.ms).toISOString(), r.unit];
};

// ---------- automatic unit ----------
eq('10 digits: seconds', iso('1700000000'), ['2023-11-14T22:13:20.000Z', 's']);
eq('13 digits: milliseconds', iso('1700000000123'), ['2023-11-14T22:13:20.123Z', 'ms']);
eq('16 digits: microseconds', iso('1700000000123456'), ['2023-11-14T22:13:20.123Z', 'us']);
eq('19 digits: nanoseconds', iso('1700000000123456789'), ['2023-11-14T22:13:20.123Z', 'ns']);
eq('12 digits: seconds', iso('100000000000'), ['5138-11-16T09:46:40.000Z', 's']);
eq('decimals do not count as digits', iso('1712160000.123'), ['2024-04-03T16:00:00.123Z', 's']);
eq('zero', iso('0'), ['1970-01-01T00:00:00.000Z', 's']);
eq('negative seconds', iso('-1'), ['1969-12-31T23:59:59.000Z', 's']);
eq('negative fraction rounds toward zero like Date', iso('-1.5'), ['1969-12-31T23:59:58.500Z', 's']);
eq('plus sign and spaces', iso('  +1700000000 '), ['2023-11-14T22:13:20.000Z', 's']);
eq('leading zeros count as digits', iso('0001700000000'), ['1970-01-20T16:13:20.000Z', 'ms']);

// ---------- chosen unit ----------
eq('13-digit seconds when s is chosen', iso('1000000000000', 's'), ['+033658-09-27T01:46:40.000Z', 's']);
eq('ms chosen for 10 digits', iso('1700000000', 'ms'), ['1970-01-20T16:13:20.000Z', 'ms']);
eq('max date in ms', iso('8640000000000000', 'ms'), ['+275760-09-13T00:00:00.000Z', 'ms']);
eq('one more ms is out of range', iso('8640000000000001', 'ms'), 'range');
eq('ns beyond 2^53 keeps the ms part', iso('9007199254740993123', 'ns'), [new Date(9007199254740).toISOString(), 'ns']);
eq('µs negative', iso('-1500', 'us'), ['1969-12-31T23:59:59.999Z', 'us']);

// ---------- errors ----------
for (const bad of ['', 'abc', '1e10', '0x10', '1.2.3', '12 34', '١٢٣']) eq('invalid ' + JSON.stringify(bad), E.readTimestamp(bad, 'auto').error, bad.trim() === '' ? 'empty' : 'num');
eq('too many seconds', E.readTimestamp('9999999999999999', 's').error, 'range');

// ---------- page ----------
const page = readFileSync(join(root, 'src/content/tools/timestamp-converter/en.mdx'), 'utf8');
eq('page no longer lists microseconds as unsupported', page.includes('Microsecond and nanosecond timestamps are not recognized'), false);
eq('page no longer says 13-digit seconds are always milliseconds', page.includes('**Seconds with 13 digits.**'), false);

// ---------- strings ----------
const block = /var STRINGS = (\{[\s\S]*?\n      \});/.exec(source);
const STRINGS = new Function('return ' + block[1])();
for (const lang of ['zh', 'ja', 'ko']) eq(lang + ' keys', Object.keys(STRINGS[lang]).sort(), Object.keys(STRINGS.en).sort());
for (const k of ['unit', 'unitAuto', 'unitS', 'unitMs', 'unitUs', 'unitNs', 'readAs']) eq('en has ' + k, k in STRINGS.en, true);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
