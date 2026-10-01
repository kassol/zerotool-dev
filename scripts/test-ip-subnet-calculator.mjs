// IP Subnet Calculator — strict dotted-decimal IPv4 and a 0–32 integer prefix
//
// Read:  src/components/tools/IpSubnetCalculatorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers); src/content/tools/ip-subnet-calculator/en.mdx;
//        src/content/blog/ip-subnet-calculator-guide/{en,ja,ko}.mdx (`isc-check` / `isc-bin` /
//        `isc-run` annotations; the en Python block runs when python3 is installed)
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
// 20,000 random strings against net.isIPv4, and calculate() on /24, /31, /32, /0; the page
// script (stand-in DOM): a dropdown change rewrites a typed /prefix; the English page examples.
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

// ---------- page script: the dropdown rewrites a typed prefix ----------
// render() takes the prefix after the slash over the dropdown, so the dropdown used to do
// nothing while the input had a slash (including the 192.168.1.0/24 shown on load).
{
  const scriptMatch = /<script is:inline>([\s\S]*?)<\/script>/.exec(source);
  const els = {};
  const el = (id) => {
    if (!els[id]) {
      const handlers = {};
      els[id] = {
        id, value: '', textContent: '', hidden: false,
        appendChild() {},
        addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
        fire(type) { (handlers[type] || []).forEach((fn) => fn.call(els[id], {})); },
      };
    }
    return els[id];
  };
  const document = {
    documentElement: { lang: 'en' },
    getElementById: el,
    querySelectorAll() { return []; },
    createElement() { return {}; },
  };
  new Function('document', 'window', 'navigator', 'setTimeout', 'clearTimeout', scriptMatch[1])(
    document, {}, {}, (fn) => fn(), () => {});
  eq('on load', [el('isc-input').value, el('isc-prefix').value, el('isc-hosts').textContent], ['192.168.1.0/24', '24', '254']);
  el('isc-prefix').value = '26';
  el('isc-prefix').fire('change');
  eq('dropdown /26 rewrites the input', [el('isc-input').value, el('isc-cidr').textContent, el('isc-hosts').textContent], ['192.168.1.0/26', '192.168.1.0/26', '62']);
  el('isc-input').value = '10.1.2.3';
  el('isc-input').fire('input');
  eq('no slash: dropdown prefix used', el('isc-cidr').textContent, '10.1.2.0/26');
  el('isc-prefix').value = '30';
  el('isc-prefix').fire('change');
  eq('no slash: dropdown change keeps the input', [el('isc-input').value, el('isc-cidr').textContent], ['10.1.2.3', '10.1.2.0/30']);
  el('isc-input').value = '198.51.100.7/24x';
  el('isc-input').fire('input');
  eq('bad prefix error text', [el('isc-error').hidden, el('isc-error').textContent], [false, 'The CIDR prefix must be a whole number from 0 to 32 (e.g. /24).']);
}

// ---------- examples on the English tool page ----------
{
  const page = readFileSync(join(root, 'src/content/tools/ip-subnet-calculator/en.mdx'), 'utf8');
  for (const [input, dd] of [['192.168.1.77/26', 24], ['172.31.100.5/20', 24], ['203.0.113.9/31', 24], ['198.51.100.7', 32]]) {
    const p = E.parseInput(input, dd);
    const r = E.calculate(p.ip, p.prefix);
    const row = `<td>${r.network} / ${r.broadcast}</td><td>${r.mask} / ${r.wildcard}</td><td>${r.first} – ${r.last}</td><td>${r.usable}</td>`;
    check('page row for ' + input, page.includes(row), row);
  }
  for (const bad of ['10.0.0.01', '0x0a.0.0.1', '10.1']) eq('page invalid ' + bad, E.parseInput(bad, 24).error, 'ip');
  for (const bad of ['10.0.0.0/33', '10.0.0.0/24x', '10.0.0.0/024', '10.0.0.0/255.255.255.0']) eq('page invalid ' + bad, E.parseInput(bad, 24).error, 'cidr');
}

// ---------- guide: ip-subnet-calculator-guide en / ja / ko ----------
// `isc-check` annotations: the calculator's output for the input matches every listed field,
// and each listed value appears in the guide. `isc-bin` blocks: each binary row equals the
// dotted-decimal value on the same row, and the network / broadcast rows are the AND / OR of
// the address and the mask. The en guide's Python block (marked `isc-run`) prints the value
// in each `# -> ` comment (run when python3 is installed). The three versions are indexable,
// have no template headings, and the cloud reserved-address tables add up.
{
  const { spawnSync } = await import('node:child_process');
  const python = (() => { const r = spawnSync('python3', ['--version'], { encoding: 'utf8' }); return !r.error && r.status === 0; })();
  for (const lang of ['en', 'ja', 'ko']) {
    const file = `src/content/blog/ip-subnet-calculator-guide/${lang}.mdx`;
    const guide = readFileSync(join(root, file), 'utf8');
    const fm = guide.match(/^---\n([\s\S]*?)\n---/)[1];
    check(lang + ' guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
    const tpl = [/^## What (is|are) /m, /^## .*Online/m, /^## .* in Code/m, /^## (Summary|Conclusion)/m].filter((re) => re.test(guide));
    check(lang + ' guide has no template headings', tpl.length === 0, tpl.map(String));

    const checks = [...guide.matchAll(/\{\/\* isc-check: (\{.*?\}) \*\/\}/g)].map((m) => JSON.parse(m[1]));
    check(lang + ' guide has isc-check annotations', checks.length >= 8, checks.length);
    const body = guide.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    for (const c of checks) {
      const p = E.parseInput(c.in, c.prefix ?? 24);
      if (p.error) { check(`${lang} ${c.in} parses`, false, p.error); continue; }
      const r = E.calculate(p.ip, p.prefix);
      for (const k of Object.keys(c)) {
        if (k === 'in' || k === 'prefix') continue;
        eq(`${lang} ${c.in} ${k}`, r[k], c[k]);
        check(`${lang} ${c.in} ${k} value is in the text`, body.includes(c[k]), c[k]);
      }
    }

    const binBlocks = [...guide.matchAll(/\{\/\* isc-bin \*\/\}[\s\S]*?```text\n([\s\S]*?)```/g)].map((m) => m[1]);
    check(lang + ' guide has a binary block', binBlocks.length === 1, binBlocks.length);
    for (const blk of binBlocks) {
      const rows = blk.trim().split('\n').map((line) => {
        const m = line.match(/([01][01.|]{34,35})\s+(\d+\.\d+\.\d+\.\d+)/);
        return m && { bits: m[1].replace(/\|/g, ''), ip: m[2] };
      });
      check(lang + ' binary block rows parse', rows.length === 4 && rows.every(Boolean), blk);
      if (rows.length !== 4 || !rows.every(Boolean)) continue;
      for (const row of rows) {
        const n = parseInt(row.bits.replace(/\./g, ''), 2) >>> 0;
        eq(`${lang} binary ${row.ip}`, n, E.ipToInt(row.ip));
      }
      const [addr, mask, net, bc] = rows.map((x) => E.ipToInt(x.ip));
      eq(lang + ' binary network = address AND mask', net, (addr & mask) >>> 0);
      eq(lang + ' binary broadcast = network OR ~mask', bc, (net | (~mask >>> 0)) >>> 0);
      // Display columns: CJK, kana and Hangul take two columns in a monospace font.
      const cols = (s) => [...s].reduce((w, ch) => w + (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]/u.test(ch) ? 2 : 1), 0);
      const barCol = blk.split('\n').filter((l) => l.includes('|')).map((l) => cols(l.slice(0, l.indexOf('|'))));
      check(lang + ' binary bar aligned', new Set(barCol).size === 1, barCol);
      const prefix = rows[1].bits.replace(/\./g, '').indexOf('0');
      const pre = blk.split('\n')[0];
      const bitsBeforeBar = pre.slice(0, pre.indexOf('|')).replace(/[^01]/g, '').length;
      eq(lang + ' binary bar sits at the prefix', bitsBeforeBar, prefix);
    }
  }

  // en / ja / ko cloud tables, row by row (provider → reserved, then usable counts per prefix)
  const cloud = {
    en: { cols: [24, 28], rows: [['Classic subnet', 2], ['AWS VPC', 5], ['Azure Virtual Network', 5], ['Google Cloud VPC', 4]] },
    ja: { cols: [24, 28], rows: [['一般的な LAN', 2], ['AWS VPC', 5], ['Azure Virtual Network', 5], ['Google Cloud VPC', 4]] },
    ko: { cols: [24, 26], rows: [['일반 LAN', 2], ['AWS VPC', 5], ['Azure Virtual Network', 5], ['Google Cloud VPC', 4], ['네이버 클라우드 플랫폼 VPC', 7]] },
  };
  for (const [lang, t] of Object.entries(cloud)) {
    const guide = readFileSync(join(root, `src/content/blog/ip-subnet-calculator-guide/${lang}.mdx`), 'utf8');
    for (const [name, reserved] of t.rows) {
      const line = guide.split('\n').find((l) => l.startsWith('|') && l.includes(name));
      if (!line) { check(`${lang} cloud row ${name}`, false, 'missing'); continue; }
      const cells = line.split('|').map((s) => s.trim());
      const nums = cells.filter((s) => /^\d+$/.test(s)).map(Number);
      eq(`${lang} cloud row ${name} usable`, nums.slice(0, 2), t.cols.map((p) => 2 ** (32 - p) - reserved));
    }
  }
  // ko: the NCP quote (/24 249, /25 121, /26 57) is 7 fewer than the block size.
  {
    const ko = readFileSync(join(root, 'src/content/blog/ip-subnet-calculator-guide/ko.mdx'), 'utf8');
    for (const [p, n] of [[24, 249], [25, 121], [26, 57]]) {
      check(`ko NCP /${p} ${n}`, ko.includes(`/${p}인 경우 ${n}개`) && 2 ** (32 - p) - 7 === n);
    }
  }
  // en: the "How many subnets" table and the Gaussian / mask tables are arithmetic.
  {
    const en = readFileSync(join(root, 'src/content/blog/ip-subnet-calculator-guide/en.mdx'), 'utf8');
    for (let p = 25; p <= 30; p++) {
      const row = `| /${p} | ${p - 24} | ${2 ** (p - 24)} | ${2 ** (32 - p)} | ${2 ** (32 - p) - 2} |`;
      check('en subnet table row /' + p, en.includes(row), row);
    }
    for (const [lang, file] of [['en', 'en'], ['ja', 'ja'], ['ko', 'ko']]) {
      const g = readFileSync(join(root, `src/content/blog/ip-subnet-calculator-guide/${file}.mdx`), 'utf8');
      for (let k = 0; k <= 8; k++) {
        const v = (0xff << (8 - k)) & 0xff;
        const row = `| ${k} | \`${v.toString(2).padStart(8, '0')}\` | ${v} | ${256 - v} |`;
        check(`${lang} octet table row ${k}`, g.includes(row), row);
      }
    }
    if (python) {
      const block = en.match(/\{\/\* isc-run \*\/\}\s*```python\n([\s\S]*?)```/)[1];
      const expected = [...block.matchAll(/# -> (.*)$/gm)].map((m) => m[1]);
      const r = spawnSync('python3', ['-c', block], { encoding: 'utf8' });
      check('en guide Python block runs', r.status === 0, r.stderr);
      eq('en guide Python block output', r.stdout.trim().split('\n'), expected);
    } else console.log('SKIP: en guide Python block — python3 not installed');
  }
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
