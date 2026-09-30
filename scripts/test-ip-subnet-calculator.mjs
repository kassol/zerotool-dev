// IP Subnet Calculator — strict dotted-decimal IPv4 and a 0–32 integer prefix
//
// Read:  src/components/tools/IpSubnetCalculatorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Rule: the inet_pton dotted-decimal form (glibc resolv/inet_pton.c inet_pton4): exactly four
// decimal parts 0–255, digits only, no leading zeros; Python's ipaddress and Node's
// net.isIPv4 apply the same rule, and the test compares against net.isIPv4. WHATWG URL's
// IPv4 parser is not used: it reads 010 as octal and 0x0a as hex, which a subnet calculator
// should not guess at. Prefix: an integer 0–32 in decimal, no sign, no leading zero.
// Covers: the reported inputs (10.0.0.1x, 10.0.0.01, /24x were accepted by parseInt), signs,
// spaces, hex / octal / shorthand forms, empty parts, 256, prefix 33 / -1 / 1.5 / 024 / empty /
// a second slash, whitespace around the slash, the dropdown prefix when there is no slash,
// 20,000 random strings against net.isIPv4, and calculate() on /24, /31, /32, /0.
//
// Run: node scripts/test-ip-subnet-calculator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isIPv4 } from 'node:net';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/IpSubnetCalculatorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in IpSubnetCalculatorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { ipToInt, parseInput, calculate };')();

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

// ---------- the reported defect ----------
eq('10.0.0.1x rejected', E.parseInput('10.0.0.1x', 24), { error: 'ip' });
eq('10.0.0.01 rejected (leading zero)', E.parseInput('10.0.0.01', 24), { error: 'ip' });
eq('/24x rejected', E.parseInput('10.0.0.0/24x', 24), { error: 'cidr' });

// ---------- addresses ----------
for (const bad of [
  '010.0.0.1', '10.0.0.00', '1.2.3', '1.2.3.4.5', '1..3.4', '.1.2.3', '1.2.3.4.', '256.0.0.1',
  '1.2.3.-4', '+1.2.3.4', '1.2.3.4 ', ' 1.2.3.4', '1.2 .3.4', '0x0a.0.0.1', '1.2.3.0x4', '10',
  '10.1', '167772161', '1.2.3.1e2', '1.2.3.４', '１.2.3.4', '1.2.3.4\n', 'a.b.c.d', '', '1.2.3.9999',
]) {
  eq('invalid address ' + JSON.stringify(bad), E.ipToInt(bad), null);
}
eq('0.0.0.0', E.ipToInt('0.0.0.0'), 0);
eq('255.255.255.255', E.ipToInt('255.255.255.255'), 4294967295);
eq('10.0.0.1', E.ipToInt('10.0.0.1'), 167772161);
eq('192.168.100.200', E.ipToInt('192.168.100.200'), 3232261320);

// Random strings over a small alphabet, compared with Node's net.isIPv4 (same rule).
let seed = 12345;
const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const ALPHABET = '0123456789.0125x -';
let mismatches = 0;
let firstMismatch = '';
let validCount = 0;
for (let k = 0; k < 20000; k++) {
  let s = '';
  const len = 7 + rand(10);
  for (let i = 0; i < len; i++) s += ALPHABET[rand(ALPHABET.length)];
  if (rand(3) === 0) s = [0, 1, 2, 3].map(() => String(rand(300))).join('.');
  const ours = E.ipToInt(s) !== null;
  if (ours) validCount++;
  if (ours !== isIPv4(s)) { mismatches++; if (!firstMismatch) firstMismatch = s; }
}
eq('20,000 random strings agree with net.isIPv4', mismatches, 0);
check('random sample includes valid addresses', validCount > 1000, String(validCount));
if (firstMismatch) console.log('  first mismatch: ' + JSON.stringify(firstMismatch));

// ---------- prefix ----------
eq('CIDR input', E.parseInput('192.168.1.0/24', 8), { ip: '192.168.1.0', prefix: 24 });
eq('/0', E.parseInput('0.0.0.0/0', 24), { ip: '0.0.0.0', prefix: 0 });
eq('/32', E.parseInput('10.0.0.1/32', 24), { ip: '10.0.0.1', prefix: 32 });
eq('spaces around the slash', E.parseInput('10.0.0.0 / 8', 24), { ip: '10.0.0.0', prefix: 8 });
for (const bad of ['33', '-1', '+8', '1.5', '024', '00', '', ' ', '8/8', '0x8', '８', '99999999999']) {
  eq('invalid prefix ' + JSON.stringify(bad), E.parseInput('10.0.0.0/' + bad, 24), { error: 'cidr' });
}
eq('bad address with a good prefix', E.parseInput('10.0.0.01/8', 24), { error: 'ip' });
eq('no slash: dropdown prefix', E.parseInput('172.16.5.4', 20), { ip: '172.16.5.4', prefix: 20 });
eq('no slash: bad address', E.parseInput('172.16.5', 20), { error: 'ip' });

// ---------- calculate ----------
eq('/24', E.calculate('192.168.1.130', 24), {
  network: '192.168.1.0', broadcast: '192.168.1.255', mask: '255.255.255.0', wildcard: '0.0.0.255',
  first: '192.168.1.1', last: '192.168.1.254', usable: (254).toLocaleString(), cidr: '192.168.1.0/24',
});
eq('/31 has 2 usable (RFC 3021)', [E.calculate('10.0.0.1', 31).first, E.calculate('10.0.0.1', 31).last, E.calculate('10.0.0.1', 31).usable],
  ['10.0.0.0', '10.0.0.1', '2']);
eq('/32', E.calculate('10.0.0.1', 32).cidr, '10.0.0.1/32');
eq('/0', [E.calculate('8.8.8.8', 0).network, E.calculate('8.8.8.8', 0).broadcast], ['0.0.0.0', '255.255.255.255']);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
