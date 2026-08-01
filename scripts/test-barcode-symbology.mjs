// Barcode Symbology — spec-driven regression test
//
// Read:  src/components/tools/BarcodeGeneratorTool.astro (extracts the real
//        encoder block, so this test cannot drift from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// SPEC ANCHORS (accessed 2026-08-01):
//   ISO/IEC 15420  EAN/UPC   — L is odd parity, R = ~L, G = reverse(R)
//   ISO/IEC 15417  Code 128  — 107 symbols, 11 modules each (Stop 13), mod-103
//   ISO/IEC 16388  Code 39   — 9 elements per character, 3 wide + 6 narrow
//   ISO/IEC 16390  ITF       — 5 elements per digit, 2 wide + 3 narrow
//   EN 798         Codabar   — 7 elements per character
//   GS1 GenSpecs   check digit — weights 3,1,3,1... from the rightmost data digit
//
// Design: three layers.
//   1. Structural invariants over the tables themselves (parity, module counts,
//      uniqueness) — catches a mistyped table entry without any reference data.
//   2. Published check-digit vectors — catches a broken weighting direction.
//   3. Independent decoders that reverse the module stream back to the original
//      payload — catches parity-pattern misuse, L/G/R mix-ups, wrong subset
//      switching, and interleaving errors that a forward-only test would miss.
//
// Run: node scripts/test-barcode-symbology.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const componentPath = join(root, 'src/components/tools/BarcodeGeneratorTool.astro');
const source = readFileSync(componentPath, 'utf8');

// ---------- extract the shipped encoder block ----------
const START_MARK = 'var EAN_L = [';
const END_MARK = '/* ── Validation + build';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the encoder block in BarcodeGeneratorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);

const exported = [
  'EAN_L', 'EAN_G', 'EAN_R', 'EAN13_PARITY', 'CODE128', 'CODE39', 'CODE39_CHARS',
  'ITF', 'CODABAR', 'SPECS',
  'gs1CheckDigit', 'widthsToModules', 'encodeEanUpc', 'encodeCode128',
  'code128Values', 'encodeCode39', 'code39CheckChar', 'encodeItf', 'encodeCodabar'
];
// `wrap` is referenced only inside DOM helpers that this test never calls.
const factory = new Function('wrap', block + '\nreturn {' + exported.join(',') + '};');
const M = factory(null);

// ---------- harness ----------
let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + detail));
}
function equal(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}

// ---------- layer 1: structural invariants ----------
const ones = (s) => s.split('').filter((c) => c === '1').length;

for (let d = 0; d < 10; d++) {
  const complement = M.EAN_L[d].split('').map((c) => (c === '0' ? '1' : '0')).join('');
  check('EAN R = ~L (digit ' + d + ')', complement === M.EAN_R[d], complement + ' vs ' + M.EAN_R[d]);
  const reversed = M.EAN_R[d].split('').reverse().join('');
  check('EAN G = reverse(R) (digit ' + d + ')', reversed === M.EAN_G[d], reversed + ' vs ' + M.EAN_G[d]);
  check('EAN L odd parity (digit ' + d + ')', ones(M.EAN_L[d]) % 2 === 1);
  check('EAN G even parity (digit ' + d + ')', ones(M.EAN_G[d]) % 2 === 0);
  check('EAN L is 7 modules (digit ' + d + ')', M.EAN_L[d].length === 7);
}
equal('EAN-13 parity table size', M.EAN13_PARITY.length, 10);
check('EAN-13 parity row 0 is all L', M.EAN13_PARITY[0] === 'LLLLLL');
check('EAN-13 parity rows are 6 chars of L/G', M.EAN13_PARITY.every((p) => /^[LG]{6}$/.test(p)));

equal('Code 128 table size', M.CODE128.length, 107);
M.CODE128.forEach((widths, value) => {
  const modules = widths.split('').reduce((a, c) => a + Number(c), 0);
  if (value < 106) {
    check('Code 128 value ' + value + ' has 6 elements', widths.length === 6, widths);
    check('Code 128 value ' + value + ' spans 11 modules', modules === 11, widths + ' = ' + modules);
  } else {
    check('Code 128 stop has 7 elements', widths.length === 7, widths);
    check('Code 128 stop spans 13 modules', modules === 13, String(modules));
  }
});
equal('Code 128 patterns are unique', new Set(M.CODE128).size, 107);

equal('Code 39 charset length', M.CODE39_CHARS.length, 43);
check('Code 39 charset is covered by the table', M.CODE39_CHARS.split('').every((c) => M.CODE39[c]));
Object.keys(M.CODE39).forEach((ch) => {
  const widths = M.CODE39[ch];
  check('Code 39 "' + ch + '" has 9 elements', widths.length === 9, widths);
  check('Code 39 "' + ch + '" has 3 wide', widths.split('').filter((c) => c === '3').length === 3, widths);
  check('Code 39 "' + ch + '" has 6 narrow', widths.split('').filter((c) => c === '1').length === 6, widths);
});
equal('Code 39 patterns are unique', new Set(Object.values(M.CODE39)).size, 44);

M.ITF.forEach((widths, d) => {
  check('ITF digit ' + d + ' has 5 elements', widths.length === 5, widths);
  check('ITF digit ' + d + ' has 2 wide', widths.split('').filter((c) => c === '3').length === 2, widths);
});
equal('ITF patterns are unique', new Set(M.ITF).size, 10);

const codabarKeys = Object.keys(M.CODABAR);
equal('Codabar table size', codabarKeys.length, 20);
codabarKeys.forEach((ch) => check('Codabar "' + ch + '" has 7 elements', M.CODABAR[ch].length === 7, M.CODABAR[ch]));
equal('Codabar patterns are unique', new Set(Object.values(M.CODABAR)).size, 20);

// ---------- layer 2: published check-digit vectors ----------
equal('GS1 check EAN-13 590123412345', M.gs1CheckDigit('590123412345'), 7);
equal('GS1 check EAN-13 400638133393', M.gs1CheckDigit('400638133393'), 1);
equal('GS1 check UPC-A 03600029145', M.gs1CheckDigit('03600029145'), 2);
equal('GS1 check EAN-8 9638507', M.gs1CheckDigit('9638507'), 4);
equal('GS1 check EAN-8 7351353', M.gs1CheckDigit('7351353'), 7);

// Odd-length discriminators. EAN-13 is the only symbology here with an
// even-length payload, so the widely quoted positional rule ("from the left,
// odd positions weigh 1") happens to be right for it and wrong for the rest.
// The textbook vectors above cannot tell the two apart — these can, and they
// are the reason this file anchors on the rightmost digit instead.
{
  const positional = (d) => {
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
    return (10 - (sum % 10)) % 10;
  };
  [
    ['1234567', 0, 8],          // EAN-8
    ['04963406000', 4, 8],      // UPC-A
    ['1540141253226', 4, 2],    // ITF-14
  ].forEach(([data, correct, wrong]) => {
    equal('GS1 check ' + data + ' (odd-length)', M.gs1CheckDigit(data), correct);
    check('positional rule really differs on ' + data, positional(data) === wrong,
      'expected the buggy variant to yield ' + wrong + ', got ' + positional(data));
  });
}

// Code 128 "PJJ123C" under Start B carries check symbol 55 (Wikipedia worked example).
{
  const values = M.code128Values('PJJ123C');
  equal('Code 128 PJJ123C starts in subset B', values[0], 104);
  equal('Code 128 PJJ123C check symbol', values[values.length - 2], 55);
  equal('Code 128 PJJ123C ends with Stop', values[values.length - 1], 106);
}

// Code 39 mod-43 over the documented charset ordering.
equal('Code 39 mod-43 of "CODE39"', M.code39CheckChar('CODE39'), M.CODE39_CHARS[(12 + 24 + 13 + 14 + 3 + 9) % 43]);

// ---------- layer 3: independent decoders (round-trip) ----------

// Split a module stream into element widths, e.g. '110100' -> [2,1,1,2].
function runLengths(modules) {
  const runs = [];
  let i = 0;
  while (i < modules.length) {
    let n = 1;
    while (i + n < modules.length && modules[i + n] === modules[i]) n++;
    runs.push(n);
    i += n;
  }
  return runs;
}

function decodeEanUpc(modules, kind) {
  const halfDigits = kind === 'ean8' ? 4 : 6;
  const guardSide = '101';
  const guardMid = '01010';
  const expectedLength = kind === 'ean8' ? 67 : 95;
  if (modules.length !== expectedLength) throw new Error('length ' + modules.length);
  if (modules.slice(0, 3) !== guardSide) throw new Error('left guard');
  if (modules.slice(-3) !== guardSide) throw new Error('right guard');
  const midStart = 3 + halfDigits * 7;
  if (modules.slice(midStart, midStart + 5) !== guardMid) throw new Error('center guard');

  const parity = [];
  const left = [];
  for (let i = 0; i < halfDigits; i++) {
    const chunk = modules.substr(3 + i * 7, 7);
    const asL = M.EAN_L.indexOf(chunk);
    const asG = M.EAN_G.indexOf(chunk);
    if (asL >= 0) { left.push(asL); parity.push('L'); }
    else if (asG >= 0) { left.push(asG); parity.push('G'); }
    else throw new Error('left digit ' + i + ' not in L/G');
  }
  const right = [];
  for (let i = 0; i < halfDigits; i++) {
    const chunk = modules.substr(midStart + 5 + i * 7, 7);
    const asR = M.EAN_R.indexOf(chunk);
    if (asR < 0) throw new Error('right digit ' + i + ' not in R');
    right.push(asR);
  }

  if (kind === 'ean8') return left.join('') + right.join('');
  const lead = M.EAN13_PARITY.indexOf(parity.join(''));
  if (lead < 0) throw new Error('parity pattern ' + parity.join('') + ' unknown');
  return String(lead) + left.join('') + right.join('');
}

function decodeCode128(modules) {
  const runs = runLengths(modules);
  if ((runs.length - 7) % 6 !== 0) throw new Error('element count ' + runs.length);
  const values = [];
  for (let i = 0; i + 6 <= runs.length; i += 6) {
    const size = i + 7 === runs.length ? 7 : 6;
    const widths = runs.slice(i, i + size).join('');
    const value = M.CODE128.indexOf(widths);
    if (value < 0) throw new Error('unknown symbol ' + widths);
    values.push(value);
    if (size === 7) break;
  }
  if (values[values.length - 1] !== 106) throw new Error('missing stop');
  const payload = values.slice(0, -2);
  let sum = payload[0];
  for (let i = 1; i < payload.length; i++) sum += payload[i] * i;
  if (sum % 103 !== values[values.length - 2]) throw new Error('checksum mismatch');

  let mode = payload[0] === 103 ? 'A' : payload[0] === 104 ? 'B' : 'C';
  let out = '';
  for (let i = 1; i < payload.length; i++) {
    const v = payload[i];
    if (v === 99) { mode = 'C'; continue; }
    if (v === 100) { mode = 'B'; continue; }
    if (v === 101) { mode = 'A'; continue; }
    if (mode === 'C') { out += String(v).padStart(2, '0'); continue; }
    if (mode === 'A') { out += String.fromCharCode(v >= 64 ? v - 64 : v + 32); continue; }
    out += String.fromCharCode(v + 32);
  }
  return out;
}

function decodeCode39(modules) {
  const runs = runLengths(modules);
  // 9 elements per character, separated by one narrow gap element.
  if ((runs.length + 1) % 10 !== 0) throw new Error('element count ' + runs.length);
  const count = (runs.length + 1) / 10;
  let out = '';
  for (let i = 0; i < count; i++) {
    const widths = runs.slice(i * 10, i * 10 + 9).join('');
    const ch = Object.keys(M.CODE39).find((k) => M.CODE39[k] === widths);
    if (!ch) throw new Error('unknown character ' + widths);
    out += ch;
  }
  if (out[0] !== '*' || out[out.length - 1] !== '*') throw new Error('missing delimiters');
  return out.slice(1, -1);
}

function decodeItf(modules) {
  const runs = runLengths(modules);
  if (runs.slice(0, 4).join('') !== '1111') throw new Error('start pattern');
  if (runs.slice(-3).join('') !== '311') throw new Error('stop pattern');
  const body = runs.slice(4, runs.length - 3);
  if (body.length % 10 !== 0) throw new Error('body element count ' + body.length);
  let out = '';
  for (let i = 0; i < body.length; i += 10) {
    const bars = [], spaces = [];
    for (let e = 0; e < 5; e++) { bars.push(body[i + e * 2]); spaces.push(body[i + e * 2 + 1]); }
    const barDigit = M.ITF.indexOf(bars.join(''));
    const spaceDigit = M.ITF.indexOf(spaces.join(''));
    if (barDigit < 0 || spaceDigit < 0) throw new Error('unknown pair at ' + i);
    out += String(barDigit) + String(spaceDigit);
  }
  return out;
}

function decodeCodabar(modules) {
  const runs = runLengths(modules);
  if ((runs.length + 1) % 8 !== 0) throw new Error('element count ' + runs.length);
  const count = (runs.length + 1) / 8;
  let out = '';
  for (let i = 0; i < count; i++) {
    const widths = runs.slice(i * 8, i * 8 + 7).join('');
    const ch = Object.keys(M.CODABAR).find((k) => M.CODABAR[k] === widths);
    if (!ch) throw new Error('unknown character ' + widths);
    out += ch;
  }
  return out;
}

function roundTrip(name, encode, decode, payload, expected) {
  try {
    const decoded = decode(encode(payload));
    check(name, decoded === expected, 'decoded ' + JSON.stringify(decoded) + ', expected ' + JSON.stringify(expected));
  } catch (error) {
    check(name, false, error.message);
  }
}

// EAN-13: every leading digit exercises a different parity pattern.
for (let lead = 0; lead < 10; lead++) {
  const data = String(lead) + '01234512345';
  const full = data + M.gs1CheckDigit(data);
  roundTrip('EAN-13 round-trip (lead ' + lead + ')',
    (p) => M.encodeEanUpc('ean13', p), (m) => decodeEanUpc(m, 'ean13'), full, full);
}
{
  const full = '9638507' + M.gs1CheckDigit('9638507');
  roundTrip('EAN-8 round-trip', (p) => M.encodeEanUpc('ean8', p), (m) => decodeEanUpc(m, 'ean8'), full, full);
}
{
  // UPC-A is EAN-13 with a leading zero; decoding must return the padded form.
  const upc = '03600029145' + M.gs1CheckDigit('03600029145');
  roundTrip('UPC-A round-trip', (p) => M.encodeEanUpc('ean13', '0' + p), (m) => decodeEanUpc(m, 'ean13'), upc, '0' + upc);
}

equal('EAN-13 module count', M.encodeEanUpc('ean13', '5901234123457').length, 95);
equal('EAN-8 module count', M.encodeEanUpc('ean8', '96385074').length, 67);

// Code 128 exercises every subset path: pure text, digit runs, subset C entry,
// odd-length digit runs, and control characters that force subset A.
[
  'PJJ123C',
  'ZeroTool-128',
  '1234567890',
  'AB123456789012CD',
  'X1234567Y',
  'A\tB',
  '~!@#$%^&*()_+',
].forEach((payload) => {
  roundTrip('Code 128 round-trip ' + JSON.stringify(payload), M.encodeCode128, decodeCode128, payload, payload);
});

['ZEROTOOL 39', 'ABC-123', '$1.50/A+B%C', '0123456789'].forEach((payload) => {
  roundTrip('Code 39 round-trip ' + JSON.stringify(payload), M.encodeCode39, decodeCode39, payload, payload);
});

{
  const full = '1540141253226' + M.gs1CheckDigit('1540141253226');
  roundTrip('ITF-14 round-trip', M.encodeItf, decodeItf, full, full);
  equal('ITF-14 module count', M.encodeItf(full).length, 135);
}

['A1234567890B', 'C123-456$789D', 'A0123456789-$:/.+B'].forEach((payload) => {
  roundTrip('Codabar round-trip ' + JSON.stringify(payload), M.encodeCodabar, decodeCodabar, payload, payload);
});

// Every shipped sample must encode cleanly — the UI falls back to these.
Object.keys(M.SPECS).forEach((kind) => {
  const spec = M.SPECS[kind];
  try {
    if (kind === 'ean13' || kind === 'ean8' || kind === 'upca' || kind === 'itf14') {
      const full = spec.sample + M.gs1CheckDigit(spec.sample);
      equal('sample digit count for ' + kind, spec.sample.length, spec.digits);
      const modules = kind === 'itf14' ? M.encodeItf(full)
        : M.encodeEanUpc(kind === 'ean8' ? 'ean8' : 'ean13', kind === 'upca' ? '0' + full : full);
      check('sample encodes for ' + kind, /^[01]+$/.test(modules) && modules.length > 0);
    } else if (kind === 'code128') {
      check('sample encodes for ' + kind, decodeCode128(M.encodeCode128(spec.sample)) === spec.sample);
    } else if (kind === 'code39') {
      check('sample encodes for ' + kind, decodeCode39(M.encodeCode39(spec.sample)) === spec.sample);
    } else {
      check('sample encodes for ' + kind, decodeCodabar(M.encodeCodabar(spec.sample)) === spec.sample);
    }
  } catch (error) {
    check('sample encodes for ' + kind, false, error.message);
  }
});

console.log(failures === 0
  ? 'PASS: ' + passes + ' checks, 0 failures'
  : 'FAIL: ' + failures + ' of ' + (passes + failures) + ' checks failed');
process.exit(failures === 0 ? 0 : 1);
