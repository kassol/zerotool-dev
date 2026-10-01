// IBAN Validator & Parser — BBAN field layout matches the SWIFT IBAN registry
//
// Read:  src/components/tools/IbanValidatorParserTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers: the country table and splitBban)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: every country's BBAN fields add up to its IBAN length minus 4 (before the fix
// Guatemala and Nicaragua added up to 32 for a 28-character IBAN, so the account field was
// cut short without an error); the SWIFT IBAN registry examples for Mauritius, Guatemala and
// Nicaragua pass ISO 7064 MOD 97-10 (checked here independently) and split into the
// registry's fields. Mauritius before the fix: bank 4 letters, branch 4, account 15,
// "reserved" MUR; the registry structure is 4!a2!n2!n12!n3!n3!a (bank BOMM01, branch 01,
// account 12 digits, 000, currency MUR).
//
// Run: node scripts/test-iban-validator-parser.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/IbanValidatorParserTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in IbanValidatorParserTool.astro');
  process.exit(1);
}
const E = new Function('t', source.slice(startIndex, endIndex) + '\nreturn { REG, splitBban };')({});

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
function mod97ok(iban) {
  const r = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of r) for (const d of String(parseInt(ch, 36))) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}

for (const [cc, r] of Object.entries(E.REG)) {
  const sum = r.fields.reduce((a, f) => a + f[1], 0) + 4;
  check(cc + ': fields add up to the IBAN length', sum === r.len, sum + ' vs ' + r.len);
}

const CASES = [
  ['MU17BOMM0101101030300200000MUR', [['bank', 'BOMM01'], ['branch', '01'], ['account', '101030300200'], ['reserved', '000'], ['currency', 'MUR']]],
  ['GT82TRAJ01020000001210029690', [['bank', 'TRAJ'], ['currency', '01'], ['type', '02'], ['account', '0000001210029690']]],
  ['NI45BAPR00000013000003558124', [['bank', 'BAPR'], ['account', '00000013000003558124']]],
];
for (const [iban, fields] of CASES) {
  const cc = iban.slice(0, 2);
  check(cc + ' registry example passes MOD 97-10', mod97ok(iban));
  eq(cc + ' length', iban.length, E.REG[cc].len);
  const split = E.splitBban(iban.slice(4), E.REG[cc].fields);
  check(cc + ' splits without a type error', !split.error, JSON.stringify(split.error));
  eq(cc + ' fields', (split.parts || []).map((p) => [p.role, p.value]), fields);
}
// a letter where Mauritius has digits is reported
check('MU: letter in the account is a type error', !!E.splitBban('BOMM0101X01030300200000MUR', E.REG.MU.fields).error);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
