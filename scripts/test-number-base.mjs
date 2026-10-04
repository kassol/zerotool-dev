// Number Base Converter — parsing, base conversion and two's complement regression test
//
// Read:  src/components/tools/NumberBaseTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers and the STRINGS table in the frontmatter,
//        so this test cannot drift from the shipped source); the 4 tool pages in
//        src/content/tools/number-base/ (examples marked `{/* nb: {...} */}` are recomputed)
//        and the actual keyboard shortcut handler in src/layouts/ToolLayout.astro.
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: integers of any size in bases 2–36 against JavaScript BigInt parsing and, when
// python3 is installed, against Python int(s, base) and format() on 3,000 random inputs
// (signs, underscores, matching 0b / 0o / 0x prefixes, Python's rejections of misplaced
// underscores and wrong digits); input clean-up that Python does not do (spaces and
// apostrophes between digits, thousands commas in base 10, full-width digits and letters,
// Unicode minus signs, a 0x / 0o / 0b prefix in decimal mode, # in base 16) and the error
// position (in code points) for every rejected input; fractions in any base, checked by
// evaluating the output (repeating block in parentheses, or 64 digits cut and marked …)
// back to the exact fraction; N-bit two's complement output and signed input against
// BigInt.asIntN / asUintN and Python; digit grouping and prefixes against Python format();
// the worked steps; 4-language STRINGS; examples on the tool pages; clipboard callbacks
// after Clear, Ctrl/Cmd+L, replacement input and subsequent copies in the complete page.
// Before this test: only bases 2 / 8 / 10 / 16; "1_000", "1 000", "２５５", "-0xFF" and
// "0.1" were rejected with "Invalid input for base N." and no position; negative numbers
// had no two's complement form; every keystroke sent a GA event.
//
// Run: node scripts/test-number-base.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
// Timing limits catch order-of-magnitude regressions; CI runners are several times slower than a dev machine.
const PERF_SLACK = process.env.CI ? 4 : 1;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/NumberBaseTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in NumberBaseTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { parseNumber, formatValue, twosComplement, stepsToDecimal, stepsFromDecimal, groupDigits, allowedDigits, bitLength, fill, MAX_DIGITS, MAX_FRAC };')();

let failures = 0;
let passes = 0;
let skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
const show = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() + 'n' : x));
function eq(name, actual, expected) {
  const a = show(actual);
  const e = show(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}
function skip(name, why) { skips++; console.log('SKIP: ' + name + ' — ' + why); }

// Deterministic PRNG (mulberry32) so failures are reproducible.
let seed = 0x5eed1234;
function rnd() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const DIG = '0123456789abcdefghijklmnopqrstuvwxyz';

const P = (raw, base = 10, opts) => E.parseNumber(raw, base, opts);
const val = (raw, base = 10, opts) => { const r = P(raw, base, opts); return r.error ? r.error : r.d === 1n ? r.n : [r.n, r.d]; };
const F = (raw, inBase, outBase, opts) => { const r = P(raw, inBase); return r.error ? r.error : E.formatValue(r.n, r.d, outBase, opts).text; };

// ---------- integers: known values ----------
eq('255 → binary', F('255', 10, 2), '11111111');
eq('255 → octal', F('255', 10, 8), '377');
eq('255 → hex', F('255', 10, 16), 'FF');
eq('255 → hex lowercase', F('255', 10, 16, { lower: true }), 'ff');
eq('255 → base 36', F('255', 10, 36), '73');
eq('hex FF → decimal', F('FF', 16, 10), '255');
eq('binary 101010 → decimal', F('101010', 2, 10), '42');
eq('0 → binary', F('0', 10, 2), '0');
eq('-0 → 0', F('-0', 10, 10), '0');
eq('leading zeros', F('000101', 2, 10), '5');
// 2^53 + 1: a Number-based converter returns ...000 here.
eq('2^53+1 → hex', F('9007199254740993', 10, 16), '20000000000001');
eq('2^53+1 → binary ends in 1', F('9007199254740993', 10, 2), '1' + '0'.repeat(52) + '1');
eq('2^64-1 from hex', F('FFFFFFFFFFFFFFFF', 16, 10), '18446744073709551615');
eq('2^64+1 → hex', F('18446744073709551617', 10, 16), '10000000000000001');
eq('2^128 → hex', F('340282366920938463463374607431768211456', 10, 16), '1' + '0'.repeat(32));
eq('negative decimal → binary', F('-10', 10, 2), '-1010');
eq('negative hex → decimal', F('-FF', 16, 10), '-255');
eq('plus sign', F('+42', 10, 2), '101010');
eq('base 36 zz → decimal', F('ZZ', 36, 10), '1295');
eq('base 3 → decimal', F('2102', 3, 10), '65');
eq('mixed-case hex', F('aBcD', 16, 10), '43981');

// ---------- integers: JavaScript BigInt parsing as the reference (bases 2, 8, 16) ----------
{
  const prefix = { 2: '0b', 8: '0o', 16: '0x' };
  let bad = 0;
  for (let k = 0; k < 2000; k++) {
    const base = [2, 8, 16][k % 3];
    const len = ri(1, 120);
    let s = DIG[ri(1, base - 1)];
    for (let j = 1; j < len; j++) s += DIG[ri(0, base - 1)];
    const r = P(s, base);
    const ref = BigInt(prefix[base] + s);
    if (r.error || r.n !== ref || r.d !== 1n) { bad++; if (bad < 4) console.log('  BigInt mismatch', base, s, show(r)); }
    for (const out of [2, 8, 10, 16]) {
      const text = E.formatValue(ref, 1n, out, { lower: true }).text;
      if (text !== ref.toString(out)) { bad++; if (bad < 4) console.log('  format mismatch', out, s, text); }
    }
  }
  check('2,000 random integers agree with BigInt parsing and toString', bad === 0, bad + ' mismatches');
}
// Long numbers: 20,000 digits is the limit, and it is fast.
{
  const big = '7'.repeat(E.MAX_DIGITS);
  const t0 = performance.now();
  const r = P(big, 10);
  const outs = [2, 8, 16, 36].map((b) => E.formatValue(r.n, r.d, b, {}).text.length);
  const ms = performance.now() - t0;
  eq('20,000-digit decimal parses to BigInt', r.n, BigInt(big));
  check('20,000-digit decimal converts to 4 bases in under 2 s', ms < 2000 * PERF_SLACK, Math.round(ms) + ' ms');
  check('20,000-digit decimal has 66,439 binary digits', outs[0] === 66439, outs[0]);
  eq('20,001 digits is rejected', P('7'.repeat(E.MAX_DIGITS + 1), 10).error, { code: 'tooLong', max: E.MAX_DIGITS });
}

// ---------- integers: Python int(s, base) and format() ----------
function have(cmd) {
  const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
}
const python = have('python3');
function py(code, input) {
  const r = spawnSync('python3', ['-c', 'import sys, json\n' + code], { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}
const PY_REPR = `
def to_base(n, b):
    if n == 0: return '0'
    neg = n < 0; n = abs(n); d = []
    while n: n, r = divmod(n, b); d.append('0123456789abcdefghijklmnopqrstuvwxyz'[r])
    return ('-' if neg else '') + ''.join(reversed(d))
`;
if (python) {
  // Valid inputs in Python's own syntax: optional sign, a prefix that matches the base,
  // single underscores between digits.
  const cases = [];
  for (let k = 0; k < 3000; k++) {
    const base = ri(2, 36);
    const len = ri(1, 60);
    let s = '';
    for (let j = 0; j < len; j++) {
      if (j > 0 && rnd() < 0.08) s += '_';
      const d = DIG[ri(0, base - 1)];
      s += rnd() < 0.5 ? d.toUpperCase() : d;
    }
    const pfx = { 2: '0b', 8: '0o', 16: '0x' }[base];
    if (pfx && rnd() < 0.4) s = (rnd() < 0.5 ? pfx.toUpperCase() : pfx) + (rnd() < 0.2 ? '_' : '') + s;
    if (rnd() < 0.3) s = (rnd() < 0.5 ? '-' : '+') + s;
    const other = ri(2, 36);
    cases.push({ s, base, other });
  }
  const ref = py(PY_REPR + `
out = []
for c in json.load(sys.stdin):
    n = int(c['s'], c['base'])
    out.append({'n': str(n), 'b': format(n, 'b'), 'o': format(n, 'o'), 'x': format(n, 'x'), 'X': format(n, 'X'),
                'gb': format(n, '_b'), 'go': format(n, '_o'), 'gx': format(n, '#_x'), 'gd': format(n, '_d'),
                'other': to_base(n, c['other'])})
print(json.dumps(out))
`, cases);
  let bad = 0;
  cases.forEach((c, k) => {
    const r = P(c.s, c.base);
    const p = ref[k];
    const fmt = (b, o) => E.formatValue(r.n, r.d, b, o).text;
    const got = r.error ? { error: r.error } : {
      n: r.n.toString(), b: fmt(2, { lower: true }), o: fmt(8, { lower: true }), x: fmt(16, { lower: true }), X: fmt(16, {}),
      gb: fmt(2, { group: 'underscore' }), go: fmt(8, { group: 'underscore' }), gx: fmt(16, { group: 'underscore', prefix: true, lower: true }),
      gd: fmt(10, { group: 'underscore' }), other: fmt(c.other, { lower: true })
    };
    if (show(got) !== show(p)) { bad++; if (bad < 5) console.log('  python mismatch', show(c), show(got), show(p)); }
  });
  check('3,000 random inputs agree with Python int(s, base) and format()', bad === 0, bad + ' mismatches');

  // Python's rejections that the tool shares: misplaced or doubled underscores, digits
  // too large for the base, a prefix that does not match the base (bases where the
  // prefix letter is not a digit), lone signs and prefixes.
  const rejects = [];
  for (let k = 0; k < 1500; k++) {
    const base = ri(2, 36);
    let s = '';
    const len = ri(1, 12);
    for (let j = 0; j < len; j++) s += DIG[ri(0, base - 1)];
    const m = ri(0, 5);
    if (m === 0) s = '_' + s;
    else if (m === 1) s = s + '_';
    else if (m === 2 && s.length > 1) s = s[0] + '__' + s.slice(1);
    else if (m === 3 && base < 36) s = s + DIG[ri(base, 35)];
    else if (m === 4) s = ['-', '+', '0x', '0b', '0o', '-0x', '+_1'][ri(0, 6)] + (rnd() < 0.5 ? '' : s);
    else s = s[0] + ['-', '.', '!', '/'][ri(0, 3)].replace('.', '-') + s;
    if (base === 10 && /^[+-]?0[box]/i.test(s)) continue; // decimal mode reads prefixes (documented difference)
    rejects.push({ s, base });
  }
  const pyOk = py(`
out = []
for c in json.load(sys.stdin):
    try: out.append(str(int(c['s'], c['base'])))
    except ValueError: out.append(None)
print(json.dumps(out))
`, rejects);
  let disagree = 0;
  rejects.forEach((c, k) => {
    const r = P(c.s, c.base);
    const mine = r.error || r.empty ? null : r.n.toString();
    if (mine !== pyOk[k]) { disagree++; if (disagree < 5) console.log('  accept/reject differs', show(c), show(r), pyOk[k]); }
  });
  check(rejects.length + ' mutated inputs: accepted and rejected exactly where Python is', disagree === 0, disagree + ' differ');
} else {
  skip('Python int(s, base) cross-check', 'python3 not installed');
  skip('Python rejection cross-check', 'python3 not installed');
}

// ---------- input clean-up beyond Python, and error positions ----------
eq('spaces between digits', val('1111 0000', 2), 240n);
eq('line break between digits', val('1111\n0000', 2), 240n);
eq('apostrophe (C++14 separator)', val("0b1111'0000", 2), 240n);
eq('space-grouped decimal', val('1 000 000'), 1000000n);
eq('thousands commas', val('1,234,567'), 1234567n);
eq('thousands commas with fraction', val('12,345.5'), [24691n, 2n]);
eq('comma grouping wrong', P('1,00').error, { code: 'comma', pos: 2 });
eq('comma grouping too long first group', P('1000,000').error, { code: 'comma', pos: 5 });
eq('European decimal comma', P('3,14').error, { code: 'comma', pos: 2 });
eq('comma in binary', P('1,0', 2).error, { code: 'comma', pos: 2 });
eq('full-width digits', val('２５５'), 255n);
eq('full-width digits give a note', P('２５５').notes, [{ code: 'fullwidth' }]);
eq('full-width hex letters', val('ｆｆ', 16), 255n);
eq('full-width minus', val('－５'), -5n);
eq('U+2212 minus sign', val('\u221242'), -42n);
eq('ideographic space separator', val('1\u30000', 2), 2n);
eq('no-break space separator', val('1\u00a0000'), 1000n);
eq('surrounding whitespace', val('  \t42\n '), 42n);
eq('0x prefix in decimal mode', val('0x1F'), 31n);
eq('0x prefix note', P('0x1F').notes, [{ code: 'prefix', prefix: '0x', base: 16 }]);
eq('-0b101 in decimal mode', val('-0b101'), -5n);
eq('0o17 in decimal mode', val('0o17'), 15n);
eq('uppercase prefix', val('0XFF', 16), 255n);
eq('underscore after prefix (PEP 515)', val('0x_ff', 16), 255n);
eq('0b in base 16 is digits (as Python)', val('0b1', 16), 177n);
eq('0b in base 16 note', P('0b1', 16).notes, [{ code: 'prefixDigits', prefix: '0b', base: 16 }]);
eq('0x in base 2', P('0x1F', 2).error, { code: 'prefixMismatch', prefix: '0x', prefixBase: 16, base: 2, pos: 1 });
eq('0x in base 8', P('-0x1F', 8).error, { code: 'prefixMismatch', prefix: '0x', prefixBase: 16, base: 8, pos: 2 });
eq('# in base 16', val('#FF5733', 16), 16734003n);
eq('# note', P('#FF5733', 16).notes, [{ code: 'hash' }]);
eq('# in decimal', P('#FF').error, { code: 'invalidChar', char: '#', pos: 1 });
eq('digit 2 in binary', P('10102', 2).error, { code: 'invalidDigit', char: '2', pos: 5, base: 2, hex: false });
eq('hex letter in decimal', P('1F').error, { code: 'invalidDigit', char: 'F', pos: 2, base: 10, hex: true });
eq('z in decimal is not a hex hint', P('1z').error, { code: 'invalidDigit', char: 'z', pos: 2, base: 10, hex: false });
eq('G in hex', P('FG', 16).error, { code: 'invalidDigit', char: 'G', pos: 2, base: 16, hex: false });
eq('full-width bad digit reports the typed character', P('１０２', 2).error, { code: 'invalidDigit', char: '２', pos: 3, base: 2, hex: false });
eq('position counts code points (emoji)', P('😀1').error, { code: 'invalidChar', char: '😀', pos: 1 });
eq('position after emoji', P('1😀').error, { code: 'invalidChar', char: '😀', pos: 2 });
eq('position counts leading spaces', P('  12x').error, { code: 'invalidDigit', char: 'x', pos: 5, base: 10, hex: false });
eq('superscript is not a digit', P('2²').error, { code: 'invalidChar', char: '²', pos: 2 });
eq('circled digit is not a digit', P('①').error, { code: 'invalidChar', char: '①', pos: 1 });
eq('Arabic-Indic digit is not read', P('٣').error, { code: 'invalidChar', char: '٣', pos: 1 });
eq('leading underscore', P('_12').error, { code: 'sepPlace', char: '_', pos: 1 });
eq('trailing underscore', P('12_').error, { code: 'sepPlace', char: '_', pos: 3 });
eq('double underscore', P('1__2').error, { code: 'sepPlace', char: '_', pos: 3 });
eq('separator before point', P('1_.5').error, { code: 'sepPlace', char: '_', pos: 2 });
eq('separator after point', P('1._5').error, { code: 'sepPlace', char: '_', pos: 3 });
eq('second point', P('1.2.3').error, { code: 'secondPoint', pos: 4 });
eq('sign in the middle', P('5-3').error, { code: 'signPlace', char: '-', pos: 2 });
eq('double sign', P('--5').error, { code: 'signPlace', char: '-', pos: 2 });
eq('blank', P('   '), { empty: true });
eq('lone sign', P('-').error, { code: 'noDigits' });
eq('lone prefix', P('0x', 16).error, { code: 'noDigits' });
eq('lone point', P('.').error, { code: 'noDigits' });

// ---------- fractions ----------
// Evaluate a formatted value ("-I.P(R)" or "I.P…") back to an exact fraction; independent of
// the formatter's long-division loop.
function evalFormatted(text, base) {
  const B = BigInt(base);
  let s = text.replace(/[_ ]/g, '');
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const m = s.match(/^([0-9a-z]+)(?:\.([0-9a-z]*)(?:\(([0-9a-z]+)\))?(…)?)?$/i);
  if (!m) return null;
  const dig = (x) => [...x.toLowerCase()].reduce((a, c) => a * B + BigInt(DIG.indexOf(c)), 0n);
  const p = m[2] || '', r = m[3] || '';
  let n = dig(m[1]) * B ** BigInt(p.length) + (p ? dig(p) : 0n);
  let d = B ** BigInt(p.length);
  if (r) {
    const rp = B ** BigInt(r.length) - 1n;
    n = n * rp + dig(r);
    d = d * rp;
  }
  const g = (a, b) => { while (b) [a, b] = [b, a % b]; return a < 0n ? -a : a; };
  const k = g(n, d);
  return { n: (neg ? -1n : 1n) * n / k, d: d / k, cut: !!m[4], fracLen: p.length };
}
eq('decimal 0.1 → binary', F('0.1', 10, 2), '0.0(0011)');
eq('decimal 0.1 → hex', F('0.1', 10, 16), '0.1(9)');
eq('decimal 0.1 → octal', F('0.1', 10, 8), '0.0(6314)');
eq('decimal 0.5 → binary', F('0.5', 10, 2), '0.1');
eq('decimal -2.75 → binary', F('-2.75', 10, 2), '-10.11');
eq('binary 0.1 → decimal', F('0.1', 2, 10), '0.5');
eq('binary 101.101 → decimal', F('101.101', 2, 10), '5.625');
eq('hex 0.8 → decimal', F('0.8', 16, 10), '0.5');
eq('hex FF.8 → binary', F('FF.8', 16, 2), '11111111.1');
eq('base 3 0.1 → decimal', F('0.1', 3, 10), '0.(3)');
eq('decimal 1/7 period', F('0.142857', 10, 10), '0.142857');
eq('.5 without integer part', F('.5', 10, 2), '0.1');
eq('5. is an integer', P('5.').d, 1n);
eq('fraction note-less value 2.50', val('2.50'), [5n, 2n]);
eq('fraction grouping only groups the integer part', E.formatValue(4097n * 2n + 1n, 2n, 2, { group: 'space' }).text, '1 0000 0000 0001.1');
eq('prefix with fraction and sign', E.formatValue(-11n, 4n, 2, { prefix: true }).text, '-0b10.11');
{
  const cut = F('0.123456789', 10, 2);
  check('long period is cut at 64 digits with …', cut.endsWith('…') && cut.length === 2 + E.MAX_FRAC + 1, cut);
  const ev = evalFormatted(cut, 2);
  // floor(0.123456789 × 2^64) written in 64 binary digits.
  eq('cut digits are the truncated (not rounded) value', ev.n, (123456789n * 2n ** 64n) / 1000000000n);
}
{
  let bad = 0;
  for (let k = 0; k < 2000; k++) {
    const inBase = ri(2, 36), outBase = ri(2, 36);
    let ip = '', fp = '';
    for (let j = ri(1, 6); j > 0; j--) ip += DIG[ri(0, inBase - 1)];
    for (let j = ri(1, 6); j > 0; j--) fp += DIG[ri(0, inBase - 1)];
    const neg = rnd() < 0.3;
    const s = (neg ? '-' : '') + ip + '.' + fp;
    const r = P(s, inBase);
    const B = BigInt(inBase);
    const dig = (x) => [...x].reduce((a, c) => a * B + BigInt(DIG.indexOf(c)), 0n);
    // Reference value built directly from the digits.
    let rn = dig(ip) * B ** BigInt(fp.length) + dig(fp), rd = B ** BigInt(fp.length);
    if (neg) rn = -rn;
    const f = E.formatValue(r.n, r.d, outBase, { lower: true });
    const ev = evalFormatted(f.text, outBase);
    let ok;
    if (!ev) ok = false;
    // Truncated: the shown digits are floor(|x| × base^64).
    else if (ev.cut) ok = checkCut(ev, rn, rd, outBase);
    else ok = ev.n * rd === rn * ev.d;
    if (!ok) { bad++; if (bad < 5) console.log('  fraction mismatch', s, inBase, '→', outBase, f.text); }
  }
  check('2,000 random fractions in bases 2–36 read back to the exact value', bad === 0, bad + ' mismatches');
}
function checkCut(ev, rn, rd, outBase) {
  const OB = BigInt(outBase) ** BigInt(E.MAX_FRAC);
  const absN = rn < 0n ? -rn : rn;
  const want = absN * OB / rd; // floor
  const got = (ev.n < 0n ? -ev.n : ev.n) * OB / ev.d;
  return ev.fracLen === E.MAX_FRAC && got === want;
}
if (python) {
  // Python's Fraction as a second reference for the parsed value.
  const fr = [];
  for (let k = 0; k < 500; k++) {
    const base = ri(2, 36);
    let ip = '', fp = '';
    for (let j = ri(1, 8); j > 0; j--) ip += DIG[ri(0, base - 1)];
    for (let j = ri(1, 8); j > 0; j--) fp += DIG[ri(0, base - 1)];
    fr.push({ ip, fp, base });
  }
  const ref = py(`
from fractions import Fraction
out = []
for c in json.load(sys.stdin):
    v = Fraction(int(c['ip'], c['base'])) + Fraction(int(c['fp'], c['base']), c['base'] ** len(c['fp']))
    out.append([str(v.numerator), str(v.denominator)])
print(json.dumps(out))
`, fr);
  let bad = 0;
  fr.forEach((c, k) => {
    const r = P(c.ip + '.' + c.fp, c.base);
    if (r.n.toString() !== ref[k][0] || r.d.toString() !== ref[k][1]) bad++;
  });
  check('500 fractions parse to the same reduced fraction as Python Fraction', bad === 0, bad + ' mismatches');
} else skip('Python Fraction cross-check', 'python3 not installed');

// ---------- two's complement ----------
const TC = (raw, base, w, opts) => { const r = P(raw, base); return E.twosComplement(r.n, r.d, w, opts || {}); };
eq('-1 in 8 bits', TC('-1', 10, 8), { bin: '11111111', hex: 'FF', unsigned: '255', signed: '-1' });
eq('-128 in 8 bits', TC('-128', 10, 8), { bin: '10000000', hex: '80', unsigned: '128', signed: '-128' });
eq('255 in 8 bits (unsigned range)', TC('255', 10, 8).signed, '-1');
eq('-129 in 8 bits', TC('-129', 10, 8), { error: 'range', min: '-128', max: '255' });
eq('256 in 8 bits', TC('256', 10, 8).error, 'range');
eq('-10 in 16 bits', TC('-10', 10, 16).bin, '1111111111110110');
eq('-1 in 32 bits hex', TC('-1', 10, 32).hex, 'FFFFFFFF');
eq('-2 in 64 bits hex', TC('-2', 10, 64).hex, 'FFFFFFFFFFFFFFFE');
eq('2^127 in 128 bits is signed min', TC('170141183460469231731687303715884105728', 10, 128).signed, '-170141183460469231731687303715884105728');
eq('two\'s complement grouped with prefix', TC('-10', 10, 8, { group: 'underscore', prefix: true }), { bin: '0b1111_0110', hex: '0xF6', unsigned: '246', signed: '-10' });
eq('fraction has no two\'s complement', TC('1.5', 10, 8), { error: 'fraction' });
{
  let bad = 0;
  for (let k = 0; k < 3000; k++) {
    const w = [8, 16, 32, 64, 128][k % 5];
    const W = BigInt(w);
    const span = (1n << W) + (1n << (W - 1n));
    let n = 0n;
    for (let j = 0; j < w / 16 + 1; j++) n = (n << 16n) | BigInt(ri(0, 65535));
    n = n % span - (1n << (W - 1n));
    const r = E.twosComplement(n, 1n, w, {});
    const u = BigInt.asUintN(w, n);
    if (r.error || BigInt('0b' + r.bin) !== u || BigInt('0x' + r.hex) !== u || r.bin.length !== w || r.hex.length !== w / 4 || r.signed !== BigInt.asIntN(w, n).toString()) bad++;
  }
  check('3,000 random values: pattern equals BigInt.asUintN and signed equals asIntN', bad === 0, bad + ' mismatches');
}
if (python) {
  const vals = [];
  for (let k = 0; k < 300; k++) { const w = [8, 16, 32, 64][k % 4]; vals.push({ n: String(BigInt(ri(-(2 ** 30), 2 ** 30)) * BigInt(ri(1, 9))), w }); }
  const ref = py(`
out = []
for c in json.load(sys.stdin):
    n, w = int(c['n']), c['w']
    if -(1 << (w - 1)) <= n < (1 << w):
        b = (n & ((1 << w) - 1)).to_bytes(w // 8, 'big')
        out.append([format(int.from_bytes(b, 'big'), '0%db' % w), b.hex().upper(), str(int.from_bytes(b, 'big', signed=True))])
    else:
        out.append(None)
print(json.dumps(out))
`, vals);
  let bad = 0;
  vals.forEach((c, k) => {
    const r = E.twosComplement(BigInt(c.n), 1n, c.w, {});
    const got = r.error ? null : [r.bin, r.hex, r.signed];
    if (show(got) !== show(ref[k])) bad++;
  });
  check('300 values: pattern agrees with Python int.to_bytes / from_bytes(signed=True)', bad === 0, bad + ' mismatches');
} else skip('Python two\'s complement cross-check', 'python3 not installed');

// Signed input: the typed digits are an N-bit pattern.
eq('FF as signed 8-bit', val('FF', 16, { signedWidth: 8 }), -1n);
eq('7F as signed 8-bit', val('7F', 16, { signedWidth: 8 }), 127n);
eq('80 as signed 8-bit', val('80', 16, { signedWidth: 8 }), -128n);
eq('signed note', P('80', 16, { signedWidth: 8 }).notes, [{ code: 'signedNeg', n: 8, value: '-128' }]);
eq('0x80000000 as signed 32-bit', val('0x80000000', 16, { signedWidth: 32 }), -2147483648n);
eq('FFFFFFFFFFFFFFFF as signed 64-bit', val('FFFFFFFFFFFFFFFF', 16, { signedWidth: 64 }), -1n);
eq('11110110 as signed 8-bit', val('11110110', 2, { signedWidth: 8 }), -10n);
eq('100 (hex) does not fit 8 bits', P('100', 16, { signedWidth: 8 }).error, { code: 'signedWide', bits: 9, n: 8 });
eq('-129 is outside signed 8-bit', P('-129', 10, { signedWidth: 8 }).error, { code: 'signedRange', value: '-129', n: 8, min: '-128', max: '127' });
eq('-128 is inside signed 8-bit', val('-128', 10, { signedWidth: 8 }), -128n);
eq('fraction cannot be signed input', P('1.5', 10, { signedWidth: 8 }).error, { code: 'signedFraction' });

// ---------- grouping and prefixes ----------
eq('groupDigits by 4', E.groupDigits('11111111', 4, ' '), '1111 1111');
eq('groupDigits uneven', E.groupDigits('101010', 4, '_'), '10_1010');
eq('groupDigits short', E.groupDigits('101', 4, '_'), '101');
eq('decimal groups by 3', E.formatValue(1234567n, 1n, 10, { group: 'space' }).text, '1 234 567');
eq('prefix only for 2 / 8 / 16', [2, 8, 10, 16, 36].map((b) => E.formatValue(255n, 1n, b, { prefix: true }).text), ['0b11111111', '0o377', '255', '0xFF', '73']);
eq('negative with prefix (as Python hex(-255))', E.formatValue(-255n, 1n, 16, { prefix: true, lower: true }).text, '-0xff');
eq('allowedDigits', [2, 8, 10, 16, 36].map(E.allowedDigits), ['0–1', '0–7', '0–9', '0–9, A–F', '0–9, A–Z']);
eq('bitLength', [0n, 1n, 255n, 256n, -255n].map(E.bitLength), [0, 1, 8, 9, 8]);

// ---------- worked steps ----------
{
  const s = E.stepsToDecimal('11111111', 2);
  eq('expansion of 11111111', [s.terms.length, s.terms[0], s.sum], [8, { digit: '1', power: 7, product: '128' }, '255']);
  const h = E.stepsToDecimal('2a', 16);
  eq('expansion of 2A', h, { terms: [{ digit: '2', power: 1, product: '32' }, { digit: 'A', power: 0, product: '10' }], sum: '42' });
  const d = E.stepsFromDecimal(42n, 2);
  eq('division of 42 by 2', d.rows.map((x) => x.dividend + '/' + x.quotient + '/' + x.remainder), ['42/21/0', '21/10/1', '10/5/0', '5/2/1', '2/1/0', '1/0/1']);
  eq('division result', d.result, '101010');
  eq('division of 255 by 16', E.stepsFromDecimal(255n, 16).result, 'FF');
  eq('division of 0', E.stepsFromDecimal(0n, 2), { rows: [], result: '0' });
  eq('expansion over 64 digits', E.stepsToDecimal('1'.repeat(65), 2), null);
  eq('division over 64 digits', E.stepsFromDecimal(10n ** 64n, 2), null);
}

// ---------- 4-language STRINGS ----------
const stringsMatch = source.match(/const STRINGS = (\{[\s\S]*?\n\}) as const;/);
check('STRINGS block found', !!stringsMatch);
if (stringsMatch) {
  const STRINGS = new Function('return ' + stringsMatch[1] + ';')();
  const shape = (o) => Object.keys(o).sort().map((k) => (o[k] && typeof o[k] === 'object' ? k + ':{' + shape(o[k]) + '}' : k)).join(',');
  ['zh', 'ja', 'ko'].forEach((lang) => eq('STRINGS ' + lang + ' keys', shape(STRINGS[lang]), shape(STRINGS.en)));
  const fields = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const errorCodes = [...block.matchAll(/code: '(\w+)'/g)].map((m) => m[1]).filter((c) => !['prefix', 'prefixDigits', 'hash', 'fullwidth', 'signedNeg'].includes(c));
  eq('every engine error code has a message', [...new Set(errorCodes)].sort(), Object.keys(STRINGS.en.err).filter((k) => k !== 'hintHex').sort());
  let bad = 0;
  for (const lang of ['zh', 'ja', 'ko']) {
    const walk = (a, b, path) => {
      for (const k of Object.keys(a)) {
        if (typeof a[k] === 'object') walk(a[k], b[k], path + k + '.');
        else if (show(fields(a[k])) !== show(fields(b[k]))) { bad++; console.log('  placeholder mismatch', lang, path + k, fields(a[k]), fields(b[k])); }
      }
    };
    walk(STRINGS.en, STRINGS[lang], '');
  }
  check('placeholders are the same in all 4 languages', bad === 0, bad + ' mismatches');
}

// ---------- examples on the tool pages ----------
// An example is written as {/* nb: {"in": "...", "base": 10, "out": 2, "opts": {...}, "expect": "..."} */}
// (or "twos": 8 for a two's complement pattern, "signed": 8 for signed input, "error": "code").
{
  const dir = join(root, 'src/content/tools/number-base');
  let count = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.mdx'))) {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const m of text.matchAll(/\{\/\* nb: (\{.*?\}) \*\/\}/g)) {
      count++;
      const ex = JSON.parse(m[1]);
      const r = P(ex.in, ex.base, ex.signed ? { signedWidth: ex.signed } : {});
      let got;
      if (ex.error) got = r.error && r.error.code;
      else if (r.error) got = 'error ' + r.error.code;
      else if (ex.twos) { const tc = E.twosComplement(r.n, r.d, ex.twos, ex.opts || {}); got = tc.error || (ex.field === 'hex' ? tc.hex : ex.field === 'signed' ? tc.signed : tc.bin); }
      else got = E.formatValue(r.n, r.d, ex.out, ex.opts || {}).text;
      const want = ex.error || ex.expect;
      check(file + ' example ' + m[1], got === want, 'got ' + show(got));
      // The expected text must appear in the page right after the marker's paragraph.
      if (!ex.error) check(file + ' shows ' + want, text.includes(want), 'not found in page');
    }
  }
  check('tool pages carry examples', count >= 12, count + ' examples');
}

// ---------- guide: practice table, step listings and code samples ----------
{
  const guide = readFileSync(join(root, 'src/content/blog/number-base-converter-guide/en.mdx'), 'utf8');
  const rows = [...guide.matchAll(/^\| `([01]+)` \| (\d+) \| ([0-9A-F]+) \| ([0-7]+) \|$/gm)];
  check('guide practice table has 10 rows', rows.length === 10, rows.length);
  for (const m of rows) {
    eq('guide table ' + m[1], [10, 16, 8].map((b) => F(m[1], 2, b)), [m[2], m[3], m[4]]);
  }
  const s = E.stepsToDecimal('11010110', 2);
  const expansion = ['Positional expansion, base 2 to decimal:'].concat(s.terms.map((x) => '  ' + x.digit + ' × 2^' + x.power + ' = ' + x.product), ['  Sum = ' + s.sum]).join('\n');
  check('guide shows the converter\'s expansion of 11010110', guide.includes(expansion));
  const d = E.stepsFromDecimal(214n, 2);
  const division = ['Repeated division, decimal to base 2:'].concat(d.rows.map((x) => '  ' + x.dividend + ' ÷ 2 = ' + x.quotient + ', remainder ' + x.remainder), ['  Remainders read from bottom to top: ' + d.result]).join('\n');
  check('guide shows the converter\'s division of 214', guide.includes(division));
  // JavaScript sample: every line `expr; // value` must evaluate to the value.
  const js = guide.match(/```javascript\n([\s\S]*?)```/)[1];
  for (const line of js.split('\n').filter((l) => l.includes('//'))) {
    const [expr, comment] = line.split('//');
    const want = comment.trim().split(/[ ,]/)[0];
    const got = new Function('return ' + expr.trim().replace(/;$/, ''))();
    const text = typeof got === 'bigint' ? got + 'n' : typeof got === 'string' ? "'" + got + "'" : String(got);
    eq('guide JS: ' + expr.trim(), text, want);
  }
  eq('guide: parseInt stops at the bad digit', parseInt('10102', 2), 10);
  eq('guide: parseInt of sixty 1-bits', String(parseInt('1'.repeat(60), 2)), '1152921504606847000');
  if (python) {
    const pyCode = guide.match(/```python\n([\s\S]*?)```/)[1];
    const lines = pyCode.split('\n').filter((l) => l.includes('#'));
    const out = py(`
res = []
for line in json.load(sys.stdin):
    expr, comment = line.split('#', 1)
    res.append([repr(eval(expr.strip())), comment.strip().split(' ')[0].rstrip(',')])
print(json.dumps(res))
`, lines);
    out.forEach(([got, want], k) => eq('guide Python: ' + lines[k].split('#')[0].trim(), got, want));
  } else skip('guide Python sample', 'python3 not installed');
}

// ---------- page script hygiene ----------
{
  const script = source.slice(source.indexOf('<script'), source.indexOf('</script>'));
  check('no innerHTML in the page script', !/innerHTML|insertAdjacentHTML|outerHTML/.test(script));
  check('no network calls', !/fetch\(|XMLHttpRequest|sendBeacon/.test(script));
  check('no direct storage access (ztPersist only)', !/localStorage|sessionStorage|document\.cookie/.test(script));
  check('GA event is debounced, not sent per keystroke', /trackTimer = setTimeout/.test(script) && !/addEventListener\('input', function \(\) \{[^}]*trackTool/.test(script));
  const persistence = readFileSync(join(root, 'src/data/persistence.ts'), 'utf8');
  check('persistence policy is preference', /'number-base': 'preference'/.test(persistence));
}

// ---------- complete page: clipboard callbacks belong to the current result ----------
// Run the real page IIFE and ToolLayout shortcut handler. Only browser boundaries
// (DOM, timers, clipboard and preference storage) are controlled here.
{
  const beforePasses = passes, beforeFailures = failures;
  const strings = new Function('return ' + stringsMatch[1] + ';')();
  const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  const shell = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
  const shortcut = shell.slice(shell.indexOf('// ── Keyboard shortcuts:'), shell.indexOf('// ── Copy button visual feedback'));
  const resultBases = new Function('return ' + source.match(/const resultBases = (.*?);/)[1].replace(/\bas const\b/g, '') + ';')();
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

  function page(shellFirst = false) {
    const ids = new Map(), copies = [], timers = new Map(), documentEvents = {}, clears = [];
    let timerId = 0, now = 0;
    const document = { activeElement: null };
    function simpleMatch(el, selector) {
      const attrs = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
      selector = selector.replace(/\[[^\]]+\]/g, '');
      const tag = /^[\w-]+/.exec(selector), id = /#([\w-]+)/.exec(selector);
      const classes = [...selector.matchAll(/\.([\w-]+)/g)];
      return (!tag || el.tagName === tag[0].toUpperCase()) && (!id || el.id === id[1]) &&
        classes.every(m => el.classList.contains(m[1])) &&
        attrs.every(m => m[2] === undefined ? el.getAttribute(m[1]) !== null : el.getAttribute(m[1]) === m[2]);
    }
    function matches(el, selector) {
      return selector.split(',').some(part => {
        const parts = part.trim().split(/\s+(?![^\[]*\])/);
        if (!simpleMatch(el, parts.pop())) return false;
        let ancestor = el.parentElement;
        while (parts.length) {
          while (ancestor && !simpleMatch(ancestor, parts.at(-1))) ancestor = ancestor.parentElement;
          if (!ancestor) return false;
          parts.pop(); ancestor = ancestor.parentElement;
        }
        return true;
      });
    }
    class Element {
      constructor(tag = 'div') {
        Object.assign(this, { tagName: tag.toUpperCase(), id: '', className: '', value: '', textContent: '',
          hidden: false, disabled: false, checked: false, open: false, attributes: {}, style: {},
          children: [], parentElement: null, listeners: {} });
      }
      setAttribute(key, value) {
        this.attributes[key] = String(value);
        if (['id', 'type', 'value', 'class'].includes(key)) this[key === 'class' ? 'className' : key] = String(value);
      }
      getAttribute(key) { return this.attributes[key] ?? null; }
      get classList() {
        const el = this;
        return {
          contains: key => el.className.split(/\s+/).includes(key),
          toggle(key, on) {
            const list = el.className.split(/\s+/).filter(Boolean);
            on = on ?? !list.includes(key);
            el.className = (on ? [...new Set([...list, key])] : list.filter(v => v !== key)).join(' ');
          }
        };
      }
      appendChild(el) { el.parentElement = this; this.children.push(el); return el; }
      removeChild(el) { this.children = this.children.filter(child => child !== el); el.parentElement = null; }
      contains(el) { return el === this || this.children.some(child => child.contains(el)); }
      querySelectorAll(selector) {
        return this.children.flatMap(child => [...(matches(child, selector) ? [child] : []), ...child.querySelectorAll(selector)]);
      }
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
      addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
      dispatch(type, extra = {}) {
        const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
        for (const listener of this.listeners[type] || []) listener(event);
        return event;
      }
      click() { if (!this.disabled) this.dispatch('click'); }
      focus() { document.activeElement = this; }
      select() {}
    }
    const body = new Element('body'), widget = new Element();
    widget.className = 'tool-widget'; body.appendChild(widget);
    let markup = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'));
    markup = markup.replace(/\{resultBases\.map\(\(b\) => \(([\s\S]*?)\)\)\}/, (_, template) => resultBases.map(b =>
      template.replace(/\{`([^`]+)`\}/g, (_, value) => '"' + value.replace(/\$\{b\}/g, String(b)) + '"')
        .replace(/data-base=\{b\}/g, 'data-base="' + b + '"')).join(''));
    const stack = [widget], voids = new Set(['input', 'br', 'hr', 'img']);
    for (const match of markup.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>/g)) {
      const tag = match[1];
      if (match[0].startsWith('</')) {
        if (stack.at(-1)?.tagName === tag.toUpperCase()) stack.pop();
        continue;
      }
      const el = new Element(tag);
      for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) el.setAttribute(attr[1], attr[2]);
      for (const flag of ['hidden', 'disabled', 'open']) el[flag] = new RegExp('\\b' + flag + '(?=\\s|/|$)').test(match[2]);
      if (el.getAttribute('data-copy')) el.textContent = strings.en.copy;
      stack.at(-1).appendChild(el);
      if (el.id) ids.set(el.id, el);
      if (!voids.has(tag) && !match[2].endsWith('/')) stack.push(el);
    }
    const get = id => {
      if (!ids.has(id)) throw new Error('Missing source ID ' + id);
      return ids.get(id);
    };
    // Read the selected numeric expressions or first literal option from markup.
    for (const match of markup.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
      const selected = /selected=\{\w+ === (\d+)\}/.exec(match[2]);
      get(match[1]).value = selected ? selected[1] : /<option value="([^"]+)"/.exec(match[2])[1];
    }
    Object.assign(document, {
      body, activeElement: body, getElementById: get, createElement: tag => new Element(tag), execCommand: () => false,
      querySelector: selector => body.querySelector(selector), querySelectorAll: selector => body.querySelectorAll(selector),
      addEventListener(type, listener) { (documentEvents[type] ??= []).push(listener); },
      dispatch(type, extra = {}) {
        const event = { type, target: this.activeElement, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
        for (const listener of documentEvents[type] || []) listener(event);
        return event;
      }
    });
    const context = {
      document, t: strings.en, isSecureContext: true,
      navigator: { clipboard: { writeText(value) {
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        copies.push({ value, resolve, reject }); return promise;
      } } },
      setTimeout(fn, delay = 0) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
      clearTimeout: id => timers.delete(id),
      ztPersist: { load: () => ({}), save() {}, clear: slug => clears.push(slug) }, _slug: 'number-base'
    };
    context.window = context;
    vm.createContext(context);
    if (shellFirst) vm.runInContext(shortcut, context);
    vm.runInContext(script, context, { filename: 'NumberBaseTool.astro' });
    if (!shellFirst) vm.runInContext(shortcut, context);
    function tick(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next; timers.delete(id); now = timer.at; timer.fn();
      }
      now = end;
    }
    const button = (base = 10) => body.querySelector('[data-copy="nb-out-' + base + '"]');
    function input(value) { get('nb-input').value = value; get('nb-input').dispatch('input'); }
    function copy(base = 10) { button(base).click(); return copies.at(-1); }
    function snapshot() {
      return { input: get('nb-input').value, status: get('nb-status').textContent, className: get('nb-status').className,
        outputs: [10, 2, 16, 8, 'other', 'twos-bin', 'twos-hex'].map(base => get('nb-out-' + base).textContent),
        copyLabel: button().textContent };
    }
    function ctrlL(focusInside = true) {
      (focusInside ? get('nb-input') : body).focus();
      return document.dispatch('keydown', { ctrlKey: true, key: 'l' });
    }
    return { get, input, copy, button, snapshot, ctrlL, tick, clears };
  }

  for (const outcome of ['resolve', 'reject']) {
    const p = page(); p.input('255');
    eq('page converts 255 into the four standard bases', p.snapshot().outputs.slice(0, 4), ['255', '11111111', 'FF', '377']);
    const copy = p.copy();
    eq('current copy reads displayed decimal ' + outcome, copy.value, '255');
    copy[outcome](new Error('controlled clipboard rejection')); await settle();
    if (outcome === 'resolve') {
      eq('current successful copy gives button feedback', p.button().textContent, strings.en.copied);
      p.tick(1500);
      eq('successful copy feedback resets after 1500 ms', p.button().textContent, strings.en.copy);
    } else {
      eq('current clipboard rejection reports failure', p.snapshot().status, strings.en.copyFail);
      check('current clipboard rejection is an error', p.snapshot().className.endsWith(' error'));
      p.input('256');
      check('valid input recovers from copy failure', p.snapshot().className.endsWith(' success'));
      const next = p.copy(); next.resolve(); await settle();
      eq('copy succeeds after recovery', p.button().textContent, strings.en.copied);
    }
  }

  for (const action of ['Clear', 'CtrlL', 'valid input', 'invalid input', 'Clear then same input']) {
    for (const shellFirst of action === 'CtrlL' ? [false, true] : [false]) {
      for (const outcome of ['reject', 'resolve']) {
        const name = action + ', shellFirst=' + shellFirst + ', ' + outcome;
        const p = page(shellFirst); p.input('255'); const pending = p.copy();
        if (action.startsWith('Clear')) {
          p.get('nb-clear').click();
          if (action === 'Clear then same input') p.input('255');
        } else if (action === 'CtrlL') {
          check('shortcut prevents browser navigation: ' + name, p.ctrlL().defaultPrevented);
          eq('shortcut clears persisted state: ' + name, p.clears, ['number-base']);
          p.tick(0);
        } else p.input(action === 'valid input' ? '256' : '12Z');
        const before = p.snapshot();
        if (action === 'Clear' || action === 'CtrlL') {
          eq('clear empties input, status and outputs: ' + name, [before.input, before.status, ...before.outputs], Array(9).fill(''));
        } else if (action === 'invalid input') {
          check('invalid input has its own diagnosis: ' + name, before.className.endsWith(' error') && before.status.includes('Z'));
          eq('invalid input removes old output: ' + name, before.outputs, Array(7).fill(''));
        } else eq('valid replacement has current output: ' + name, before.outputs[0], action === 'valid input' ? '256' : '255');
        pending[outcome](new Error('controlled late clipboard rejection')); await settle();
        eq('late copy leaves current page untouched: ' + name, p.snapshot(), before);
        p.input('1024'); const next = p.copy();
        eq('recovery copies fresh value: ' + name, next.value, '1024');
        next.resolve(); await settle();
        eq('recovery keeps success feedback: ' + name, p.button().textContent, strings.en.copied);
        p.tick(1500);
        eq('recovery feedback expires: ' + name, p.button().textContent, strings.en.copy);
      }
    }
  }

  // Promise callbacks run before the component's deferred CtrlL refresh.
  for (const shellFirst of [false, true]) for (const outcome of ['reject', 'resolve']) {
    const p = page(shellFirst); p.input('255'); const pending = p.copy();
    p.ctrlL(); const before = p.snapshot();
    pending[outcome](new Error('rejected before timer')); await settle();
    eq('CtrlL suppresses clipboard feedback before its timer: ' + shellFirst + '/' + outcome, p.snapshot(), before);
    p.tick(0);
    eq('CtrlL eventually clears current status', p.snapshot().status, '');
  }
  {
    const p = page(); p.input('255'); const pending = p.copy();
    check('CtrlL outside the tool remains a browser shortcut', !p.ctrlL(false).defaultPrevented);
    p.tick(0); pending.resolve(); await settle();
    eq('outside shortcut keeps active copy feedback', p.button().textContent, strings.en.copied);
  }
  {
    const p = page(); p.input('255'); const old = p.copy(), current = p.copy();
    current.resolve(); await settle(); const before = p.snapshot();
    old.reject(new Error('older copy rejected')); await settle();
    eq('older request on the same button cannot replace newer success', p.snapshot(), before);
  }
  {
    const p = page(); p.input('255'); p.copy().resolve(); await settle(); p.tick(500);
    p.copy().resolve(); await settle(); p.tick(1000);
    eq('older feedback timer cannot shorten a newer success', p.button().textContent, strings.en.copied);
    p.tick(500);
    eq('latest feedback timer restores Copy', p.button().textContent, strings.en.copy);
    p.copy().resolve(); await settle(); p.get('nb-clear').click();
    eq('Clear removes feedback for the cleared value', p.button().textContent, strings.en.copy);
  }
  console.log('Page clipboard lifecycle: ' + (passes - beforePasses) + ' passed, ' + (failures - beforeFailures) + ' failed');
}

console.log(`\n${passes} passed, ${failures} failed${skips ? ', ' + skips + ' skipped' : ''}`);
process.exit(failures ? 1 : 0);
