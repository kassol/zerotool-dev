// ULID Generator — monotonic within a millisecond; decoder rejects values above 128 bits
//
// Read:  src/components/tools/UlidGeneratorTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers and the frontmatter labels)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Spec: github.com/ulid/spec. "Monotonicity": within the same millisecond the random component
// is incremented by 1 in the least significant bit position (with carrying); generation fails
// when it overflows. The reference implementation (ulid/javascript monotonicFactory) also keeps
// the last timestamp when the clock goes backwards. "Overflow Errors when Parsing Base32
// Strings": the largest valid ULID is 7ZZZZZZZZZZZZZZZZZZZZZZZZZ; larger values are rejected.
// Covers: time encoding vectors (ulid/javascript README: 1469918176385 → 01ARYZ6S41), the
// README monotonic pair ...EMMVRZ → ...EMMVS0, a 100-item batch in one millisecond is strictly
// increasing and differs by 1 each step (before the fix every item had fresh random bits and
// the batch was not sorted), carry across several Z digits, a new millisecond draws fresh
// random bits, a clock that goes back keeps the previous timestamp, overflow at ZZZZ...
// throws and does not change state, decoder: first character 0–7 accepted and 8–Z rejected as
// out of range (before the fix 8ZZZZZZZZZZZZZZZZZZZZZZZZZ decoded to a date in the year 12004),
// length / alphabet errors, lower case, timestamps after year 9999 keep their milliseconds
// (before, formatMs cut the ISO string at a fixed length), the 4-language labels.
//
// Run: node scripts/test-ulid-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/UlidGeneratorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in UlidGeneratorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { encodeTime, encodeRandom, createUlidFactory, decodeUlid, formatMs: typeof formatMs === "function" ? formatMs : null };')();

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
function throws(name, fn, match) {
  try { fn(); } catch (e) { check(name, match.test(e.message), 'message ' + JSON.stringify(e.message)); return; }
  check(name, false, 'did not throw');
}

// Independent reference: Crockford Base32 of a BigInt.
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const toB32 = (n, len) => { let s = ''; for (let i = 0; i < len; i++) { s = ALPHA[Number(n & 31n)] + s; n >>= 5n; } return s; };
const fromB32 = (s) => [...s].reduce((a, c) => a * 32n + BigInt(ALPHA.indexOf(c)), 0n);

// Random source that returns the given byte arrays in turn.
function bytesFrom(list) {
  let i = 0;
  return (arr) => { const src = list[Math.min(i++, list.length - 1)]; for (let k = 0; k < arr.length; k++) arr[k] = src[k]; };
}
const clock = (list) => { let i = 0; return () => list[Math.min(i++, list.length - 1)]; };

// ---------- encoding ----------
eq('encodeTime README vector', E.encodeTime(1469918176385), '01ARYZ6S41');
eq('encodeTime 0', E.encodeTime(0), '0000000000');
eq('encodeTime max 48-bit', E.encodeTime(2 ** 48 - 1), '7ZZZZZZZZZ');
const rb = [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x0f, 0xed];
eq('encodeRandom matches BigInt reference', E.encodeRandom(rb),
  toB32(rb.reduce((a, b) => a * 256n + BigInt(b), 0n), 16));

// ---------- monotonicity (the reported defect) ----------
function randomToBytes(str) {
  let n = fromB32(str);
  const out = new Array(10);
  for (let i = 9; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; }
  return out;
}
{
  const next = E.createUlidFactory(clock([1469918176385]), bytesFrom([randomToBytes('ACTAV9WEVGEMMVRZ'), [9, 9, 9, 9, 9, 9, 9, 9, 9, 9]]));
  const a = next();
  const b = next();
  eq('first ULID uses the random bytes', a.ulid, '01ARYZ6S41ACTAV9WEVGEMMVRZ');
  eq('README pair: same millisecond increments (RZ → S0)', b.ulid, '01ARYZ6S41ACTAV9WEVGEMMVS0');
  eq('random part reported', b.randStr, 'ACTAV9WEVGEMMVS0');
  eq('timestamp reported', b.ms, 1469918176385);
}
{
  // Real crypto, frozen clock: 100 in one millisecond, like a batch on a fast machine.
  const next = E.createUlidFactory(() => 1700000000000, (a) => crypto.getRandomValues(a));
  const list = Array.from({ length: 100 }, () => next().ulid);
  const sorted = [...list].sort();
  check('100 in one millisecond are strictly increasing', list.every((u, i) => i === 0 || u > list[i - 1]));
  eq('batch already in sorted order', list.join(), sorted.join());
  check('each step adds exactly 1 to the random part',
    list.every((u, i) => i === 0 || fromB32(u.slice(10)) === fromB32(list[i - 1].slice(10)) + 1n));
  check('all share the timestamp', list.every((u) => u.slice(0, 10) === list[0].slice(0, 10)));
}
{
  const next = E.createUlidFactory(clock([5, 5]), bytesFrom([randomToBytes('0000000000000ZZZ')]));
  next();
  eq('carry across several Z digits', next().randStr, '0000000000001000');
}
{
  const zeros = new Array(10).fill(0);
  const next = E.createUlidFactory(clock([1000, 1001]), bytesFrom([randomToBytes('ZZZZZZZZZZZZZZZZ'), zeros]));
  eq('max random allowed as a first value', next().randStr, 'ZZZZZZZZZZZZZZZZ');
  eq('new millisecond draws fresh random bits', next().ulid, E.encodeTime(1001) + '0000000000000000');
}
{
  const next = E.createUlidFactory(clock([2000, 1500, 2000]), bytesFrom([randomToBytes('0000000000000001')]));
  const a = next();
  const b = next();
  const c = next();
  eq('clock goes back: previous timestamp kept', b.ms, 2000);
  check('clock goes back: still increasing', b.ulid > a.ulid && c.ulid > b.ulid, [a.ulid, b.ulid, c.ulid].join(' '));
}
{
  const next = E.createUlidFactory(clock([3000]), bytesFrom([randomToBytes('ZZZZZZZZZZZZZZZZ')]));
  const first = next();
  throws('overflow in the same millisecond throws', () => next(), /overflow/i);
  throws('overflow keeps failing in that millisecond', () => next(), /overflow/i);
  eq('first ULID unchanged', first.randStr, 'ZZZZZZZZZZZZZZZZ');
}

// ---------- decoder ----------
eq('decode README ULID', E.decodeUlid('01ARYZ6S41TSV4RRFFQ69G5FAV'), { ms: 1469918176385 });
eq('decode lower case', E.decodeUlid('01aryz6s41tsv4rrffq69g5fav'), { ms: 1469918176385 });
eq('largest valid ULID', E.decodeUlid('7ZZZZZZZZZZZZZZZZZZZZZZZZZ'), { ms: 2 ** 48 - 1 });
for (const first of '89ABCDEFGHJKMNPQRSTVWXYZ') {
  eq('first char ' + first + ' out of range', E.decodeUlid(first + 'ZZZZZZZZZZZZZZZZZZZZZZZZZ').error, 'range');
}
eq('too short', E.decodeUlid('01ARYZ6S41').error, 'invalid');
eq('too long', E.decodeUlid('01ARYZ6S41TSV4RRFFQ69G5FAVX').error, 'invalid');
eq('I / L / O / U rejected', ['I', 'L', 'O', 'U'].map((c) => E.decodeUlid('01ARYZ6S41TSV4RRFFQ69G5FA' + c).error),
  ['invalid', 'invalid', 'invalid', 'invalid']);
eq('generated ULID decodes to its timestamp', E.decodeUlid(E.createUlidFactory(() => 1759212345678, (a) => a.fill(7))().ulid),
  { ms: 1759212345678 });

// ---------- timestamp display ----------
check('formatMs is in the engine block', typeof E.formatMs === 'function');
if (E.formatMs) {
  eq('formatMs README time', E.formatMs(1469918176385), '2016-07-30 22:36:16.385 UTC');
  eq('formatMs largest ULID keeps the milliseconds', E.formatMs(2 ** 48 - 1), '+010889-08-02 05:31:50.655 UTC');
  eq('formatMs 0', E.formatMs(0), '1970-01-01 00:00:00.000 UTC');
}

// ---------- labels ----------
for (const key of ['outOfRange', 'overflow']) {
  const n = (source.match(new RegExp('^\\s+' + key + ": '[^']+',$", 'gm')) || []).length;
  eq('label ' + key + ' in 4 languages', n, 4);
}
check('labels passed to the script', /data-out-of-range=\{L\.outOfRange\}/.test(source) && /data-overflow=\{L\.overflow\}/.test(source));

// Examples on the English tool page are engine output
{
  const page = readFileSync(join(root, 'src/content/tools/ulid-generator/en.mdx'), 'utf8');
  for (const [ulid, ts, ms] of [
    ['01ARZ3NDEKTSV4RRFFQ69G5FAV', '2016-07-30 23:54:10.259 UTC', 1469922850259],
    ['7ZZZZZZZZZZZZZZZZZZZZZZZZZ', '+010889-08-02 05:31:50.655 UTC', 281474976710655],
  ]) {
    eq('page decode ' + ulid + ' ms', E.decodeUlid(ulid).ms, ms);
    eq('page decode ' + ulid + ' time', E.formatMs(ms), ts);
    check('page shows ' + ulid, page.includes(ulid) && page.includes(ts) && page.includes(String(ms)));
  }
  eq('page: 8ZZZ… out of range', E.decodeUlid('8ZZZZZZZZZZZZZZZZZZZZZZZZZ').error, 'range');
  eq('page: L is invalid', E.decodeUlid('01ARZ3NDEKTSV4RRFFQ69G5FAL').error, 'invalid');
  const at = Date.UTC(2026, 9, 1, 9, 30, 0, 123);
  const next = E.createUlidFactory(() => at, (a) => a.set([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x11, 0x22]));
  for (const want of ['01M3VCS7HV28T5CY4TQKFF0492', '01M3VCS7HV28T5CY4TQKFF0493', '01M3VCS7HV28T5CY4TQKFF0494']) {
    const got = next().ulid;
    eq('page batch example', got, want);
    check('page shows ' + want, page.includes('<code>' + want + '</code>'));
  }
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
