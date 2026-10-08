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
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import domino from '@mixmark-io/domino';
import { loadPage, frontmatterStrings } from './astro-page-harness.mjs';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/IpSubnetCalculatorTool.astro'), 'utf8');
const frontmatter=source.split('---')[1];
const pageStrings=frontmatterStrings(frontmatter);
const locale=new Function('lang',frontmatter.slice(frontmatter.indexOf('const STRINGS'))+'\nreturn {T,TIPS,CLIENT_T};');

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
// RFC 3021 §2: the two addresses of a /31 are host addresses, so it has no broadcast address;
// a /32 is one address (RFC 4632 §3.1 host route). The engine reports none instead of the
// last address of the block, and /30 still has one.
eq('/31 has no broadcast address', E.calculate('203.0.113.9', 31).broadcast, null);
eq('/32 has no broadcast address', E.calculate('198.51.100.7', 32).broadcast, null);
eq('/30 keeps its broadcast address', E.calculate('203.0.113.9', 30).broadcast, '203.0.113.11');
eq('/0', [E.calculate('8.8.8.8', 0).network, E.calculate('8.8.8.8', 0).broadcast], ['0.0.0.0', '255.255.255.255']);

// ---------- page script: the dropdown rewrites a typed prefix ----------
// render() takes the prefix after the slash over the dropdown, so the dropdown used to do
// nothing while the input had a slash (including the 192.168.1.0/24 shown on load).
{
  const scriptMatch = /<script\b[^>]*>([\s\S]*?)<\/script>/.exec(source);
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
    addEventListener() {},
    createElement() { return {}; },
  };
  new Function('document', 'window', 'navigator', 'setTimeout', 'clearTimeout', 't', scriptMatch[1])(
    document, {}, {}, (fn) => fn(), () => {}, locale('en').CLIENT_T);
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
  el('isc-input').value = '203.0.113.9/31';
  el('isc-input').fire('input');
  eq('/31 broadcast cell says none', el('isc-broadcast').textContent, 'None (/31 point-to-point link, RFC 3021)');
  el('isc-input').value = '198.51.100.7/32';
  el('isc-input').fire('input');
  eq('/32 broadcast cell says none', el('isc-broadcast').textContent, 'None (/32 is a single address)');
  el('isc-input').value = '203.0.113.9/30';
  el('isc-input').fire('input');
  eq('/30 broadcast cell is an address', el('isc-broadcast').textContent, '203.0.113.11');
  for (const lang of ['zh', 'ja', 'ko']) {
    check(lang + ' has the no-broadcast strings', !!pageStrings[lang].noBroadcast31 && !!pageStrings[lang].noBroadcast32);
  }
}

// ---------- examples on the English tool page ----------
{
  const page = readFileSync(join(root, 'src/content/tools/ip-subnet-calculator/en.mdx'), 'utf8');
  for (const [input, dd] of [['192.168.1.77/26', 24], ['172.31.100.5/20', 24], ['203.0.113.9/31', 24], ['198.51.100.7', 32]]) {
    const p = E.parseInput(input, dd);
    const r = E.calculate(p.ip, p.prefix);
    const row = `<td>${r.network} / ${r.broadcast ?? 'none'}</td><td>${r.mask} / ${r.wildcard}</td><td>${r.first} – ${r.last}</td><td>${r.usable}</td>`;
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

// ---------- complete page lifecycle and real shared shortcuts ----------
// Execute the original renderer/listeners; control only the DOM, clipboard delivery and clock.
const markupTemplate=source.replace(/^---\n[\s\S]*?\n---\s*/,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').split('<style')[0];
const escapeMarkup=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function renderMarkup(lang){
 const T=pageStrings[lang],about=JSON.parse(readFileSync(join(root,'src/i18n',lang+'.json'),'utf8'))['tool.tipAbout'];
 return markupTemplate.replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g,(_all,id,label,key)=>'<span class="zt-tip"><button type="button" data-zt-tip="'+id+'" aria-label="'+escapeMarkup(about.replace('{name}',T[label]))+'"></button><span id="'+id+'" class="zt-tip-pop" hidden>'+escapeMarkup(T.tips[key])+'</span></span>')
  .replace(/=\{T\.(\w+)\}/g,(_all,key)=>'="'+escapeMarkup(T[key])+'"').replace(/\{T\.(\w+)\}/g,(_all,key)=>escapeMarkup(T[key]));
}
const layout=readFileSync(join(root,'src/layouts/ToolLayout.astro'),'utf8');
const shortcut=layout.slice(layout.indexOf('// ── Keyboard shortcuts:'),layout.indexOf('// ── Copy button visual feedback'));
const unhandled=[];
const onUnhandled=error=>unhandled.push(String(error));
process.on('unhandledRejection',onUnhandled);
const settle=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
function page(lang,order){
 const document=domino.createDocument('<html lang="'+lang+'"><body><main class="tool-widget">'+renderMarkup(lang)+'</main><input id="outside" type="text"></body></html>');
 Object.defineProperty(document,'activeElement',{value:document.body,writable:true,configurable:true});
 const timers=new Map(),clipboard=[],clears=[],tracks=[],errors=[],effects=[];
 let clock=0,seq=0;
 const input=document.getElementById('isc-input'),prefix=document.getElementById('isc-prefix'),result=document.getElementById('isc-results'),error=document.getElementById('isc-error'),btn=document.getElementById('isc-copy');
 // Domino has no select.value implementation; preserve native option nodes and selected flags.
 Object.defineProperty(prefix,'value',{get(){return Array.from(prefix.options).find(o=>o.selected)?.value??'';},set(value){for(const option of Array.from(prefix.options))option.selected=option.value===String(value);}});
 function focus(el){if(!Object.hasOwn(el,'focus'))Object.defineProperty(el,'focus',{value:()=>{document.activeElement=el;}});el.focus();}
 focus(input);
 const navigator={clipboard:{writeText(value){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});clipboard.push({value,promise,resolve,reject});return promise;}}};
 const globals={document,navigator,t:locale(lang).CLIENT_T,_slug:'ip-subnet-calculator',ztPersist:{clear:slug=>clears.push(slug)},trackTool:(...args)=>tracks.push(args),fetch(){effects.push('network');throw Error('Unexpected network');},setTimeout(fn,ms){timers.set(++seq,{fn,ms,due:clock+ms});return seq;},clearTimeout(id){timers.delete(id);}};
 document.execCommand=()=>{effects.push('fallback');throw Error('Unexpected fallback');};
 if(order==='shared-before'){const ctx=vm.createContext(globals);ctx.window=ctx;vm.runInContext(shortcut,ctx);}
 const real=loadPage('src/components/tools/IpSubnetCalculatorTool.astro',{lang,globals});
 if(order==='shared-after')real.run(shortcut);
 function event(el,type,values={}){const e=document.createEvent('Event');e.initEvent(type,true,true);Object.assign(e,values);try{el.dispatchEvent(e);}catch(error){errors.push(String(error));}return e;}
 return{document,input,prefix,result,error,btn,clipboard,clears,tracks,errors,effects,timers,navigator,
  type(value){input.value=value;event(input,'input');},
  select(value){prefix.value=String(value);event(prefix,'change');},
  tick(ms){clock+=ms;for(;;){const ready=[...timers].filter(([,t])=>t.due<=clock).sort((a,b)=>a[1].due-b[1].due)[0];if(!ready)break;timers.delete(ready[0]);ready[1].fn();}},
  key(el,values){focus(el);return event(el,'keydown',{ctrlKey:false,metaKey:false,...values});},
  click(){focus(btn);event(btn,'click');},
  cells(){return Array.from(result.querySelectorAll('td')).map(e=>e.textContent);},
  snapshot(){return[input.value,prefix.value,error.hidden,error.textContent,result.hidden,result.innerHTML];},
 };
}
const copyFailed={en:'Copy failed',zh:'复制失败',ja:'コピー失敗',ko:'복사 실패'};
const defaultValues=['192.168.1.0','192.168.1.255','255.255.255.0','0.0.0.255','192.168.1.1','192.168.1.254','254','192.168.1.0/24'];
const rowKeys=['networkAddress','broadcastAddress','subnetMask','wildcardMask','firstHost','lastHost','usableHosts','cidr'];
check('actual shared keyboard handler loaded',shortcut.includes('window.ztPersist.clear(_slug)'));
for(const lang of ['en','zh','ja','ko'])for(const order of ['shared-before','shared-after']){
 const t=pageStrings[lang],tag=lang+'/'+order;
 {
  const p=page(lang,order);
  eq(tag+' actual default eight rows',p.cells(),defaultValues);eq(tag+' default CIDR/prefix/result',[p.input.value,p.prefix.value,p.result.hidden],['192.168.1.0/24','24',false]);eq(tag+' all 33 prefix choices',Array.from(p.prefix.options).map(o=>o.value),Array.from({length:33},(_,i)=>String(i)));
  p.type('203.0.113.9/31');p.tick(249);eq(tag+' 250ms boundary preserved',p.cells(),defaultValues);p.tick(1);eq(tag+' actual /31 output',[p.cells()[0],p.cells()[1],p.cells()[6],p.prefix.value],['203.0.113.8',t.noBroadcast31,'2','31']);
  p.select(32);eq(tag+' prefix rewrites CIDR immediately',[p.input.value,p.cells()[1],p.cells()[7]],['203.0.113.9/32',t.noBroadcast32,'203.0.113.9/32']);
  p.type('10.1.2.3');p.tick(250);p.select(30);eq(tag+' prefix preserves address without slash',[p.input.value,p.cells()[7]],['10.1.2.3','10.1.2.0/30']);
  p.type('10.0.0.01');p.tick(250);eq(tag+' real invalid error hides prior result',[p.error.hidden,p.error.textContent,p.result.hidden],[false,t.errInvalidIp,true]);
  p.type('');p.tick(250);eq(tag+' empty input hides result and clears error',[p.error.hidden,p.error.textContent,p.result.hidden],[true,'',true]);
  p.type('10.0.0.0/24');p.input.value='198.51.100.7/32';p.tick(250);eq(tag+' queued callback reads current input rather than captured address',p.cells()[7],'198.51.100.7/32');
 }
 for(const state of ['valid','invalid','pending'])for(const mod of ['ctrlKey','metaKey']){
  const p=page(lang,order);p.select(26);if(state==='invalid'){p.type('1.2.3.999');p.tick(250);}if(state==='pending')p.type('203.0.113.9/31');
  const ev=p.key(state==='valid'?p.btn:p.input,{key:mod==='ctrlKey'?'l':'L',[mod]:true});
  eq(tag+'/'+state+'/'+mod+' clears results and error',[p.input.value,p.result.hidden,p.error.hidden,p.error.textContent,p.btn.textContent],['',true,true,'',t.copy]);
  eq(tag+'/'+state+'/'+mod+' preserves menu prefix',p.prefix.value,'26');eq(tag+'/'+state+'/'+mod+' focuses input',p.document.activeElement.id,'isc-input');eq(tag+'/'+state+'/'+mod+' shared persistence exactly once',p.clears,['ip-subnet-calculator']);check(tag+'/'+state+'/'+mod+' default suppressed',ev.defaultPrevented);
  eq(tag+'/'+state+'/'+mod+' no queued timer',p.timers.size,0);p.tick(1000);eq(tag+'/'+state+'/'+mod+' stays clear',[p.input.value,p.result.hidden,p.error.hidden],['',true,true]);
  p.type('198.51.100.7/32');p.tick(250);eq(tag+'/'+state+'/'+mod+' recovers normally',[p.cells()[7],p.result.hidden],['198.51.100.7/32',false]);
 }
 {
  const p=page(lang,order),before=p.snapshot(),tracks=p.tracks.length;
  for(const values of [{key:'l'},{key:'Enter',ctrlKey:true},{key:'Enter',metaKey:true}]){const ev=p.key(p.input,values);eq(tag+' ordinary/unbound key preserves page',p.snapshot(),before);check(tag+' ordinary/unbound key not suppressed',!ev.defaultPrevented);}
  eq(tag+' no primary action on modified Enter',p.tracks.length,tracks);p.key(p.document.getElementById('outside'),{key:'l',ctrlKey:true});eq(tag+' outside shortcut preserves tool',p.snapshot(),before);eq(tag+' outside shortcut preserves persistence',p.clears,[]);
 }
 {
  const p=page(lang,order),u=unhandled.length;p.click();
  eq(tag+' exact eight-line copy',p.clipboard[0].value,rowKeys.map((key,i)=>t[key]+': '+defaultValues[i]).join('\n'));p.clipboard[0].reject(Error('controlled denial'));await settle();
  eq(tag+' current rejection handled',unhandled.length,u);eq(tag+' current rejection visible',p.btn.textContent,copyFailed[lang]);
  p.click();eq(tag+' retry keeps original copied bytes',p.clipboard[1].value,p.clipboard[0].value);p.clipboard[1].resolve();await settle();eq(tag+' same output direct success retry',p.btn.textContent,t.copied);p.tick(1500);eq(tag+' current timer resets success',p.btn.textContent,t.copy);eq(tag+' no synchronous error',p.errors,[]);
 }
 for(const unavailable of ['absent','throw']){
  const p=page(lang,order),clipboard=p.navigator.clipboard;
  if(unavailable==='absent')delete p.navigator.clipboard;else p.navigator.clipboard={writeText(){throw Error('controlled synchronous failure');}};
  p.click();await settle();eq(tag+'/'+unavailable+' failure handled',p.errors,[]);eq(tag+'/'+unavailable+' failure visible',p.btn.textContent,copyFailed[lang]);eq(tag+'/'+unavailable+' no fallback invented',p.effects,[]);
  p.navigator.clipboard=clipboard;p.click();p.clipboard[0].resolve();await settle();eq(tag+'/'+unavailable+' API recovery on same output',p.btn.textContent,t.copied);
 }
 for(const transition of ['clear','new-valid','new-invalid','input-only','same-input','prefix','empty'])for(const completion of ['resolve','reject']){
  const p=page(lang,order),u=unhandled.length;p.click();
  if(transition==='clear')p.key(p.btn,{key:'l',ctrlKey:true});else if(transition==='prefix')p.select(31);else{p.type(transition==='new-invalid'?'bad':transition==='same-input'?'192.168.1.0/24':transition==='empty'?'':'203.0.113.9/31');if(transition.startsWith('new-')||transition==='empty')p.tick(250);}
  const before=p.snapshot();p.clipboard[0][completion](completion==='reject'?Error('controlled late denial'):undefined);await settle();
  eq(tag+'/'+transition+'/'+completion+' old callback leaves current state intact',p.snapshot(),before);eq(tag+'/'+transition+'/'+completion+' no unhandled rejection',unhandled.length,u);
 }
 for(const first of ['resolve','reject'])for(const second of ['resolve','reject']){
  const p=page(lang,order),u=unhandled.length;p.click();p.click();p.clipboard[1][second](second==='reject'?Error('new denial'):undefined);await settle();const text=p.btn.textContent;p.clipboard[0][first](first==='reject'?Error('old denial'):undefined);await settle();
  eq(tag+'/request-order/'+first+'/'+second+' newest result retained',p.btn.textContent,text);eq(tag+'/request-order/'+first+'/'+second+' newest visible result',text,second==='resolve'?t.copied:copyFailed[lang]);eq(tag+'/request-order/'+first+'/'+second+' handled',unhandled.length,u);
 }
 {
  const p=page(lang,order);p.click();p.clipboard[0].resolve();await settle();const oldTimer=[...p.timers.values()].find(x=>x.ms===1500);check(tag+' real success timer captured',!!oldTimer);
  p.tick(100);p.click();p.clipboard[1].resolve();await settle();p.tick(1400);eq(tag+' old deadline preserves second success',p.btn.textContent,t.copied);oldTimer.fn();eq(tag+' forced old timer delivery stays stale',p.btn.textContent,t.copied);p.tick(100);eq(tag+' new deadline restores label',p.btn.textContent,t.copy);
 }
 for(const transition of ['clear','input','prefix']){
  const p=page(lang,order);p.click();p.clipboard[0].resolve();await settle();const timer=[...p.timers.values()].find(x=>x.ms===1500);
  if(transition==='clear')p.key(p.btn,{key:'l',ctrlKey:true});else if(transition==='input')p.type('10.0.0.1');else p.select(31);
  eq(tag+'/'+transition+' synchronously clears copied feedback',p.btn.textContent,t.copy);const before=p.snapshot();timer.fn();eq(tag+'/'+transition+' old timer cannot change state',p.snapshot(),before);
 }
 {
  const p=page(lang,order);p.type('');p.tick(250);p.click();eq(tag+' hidden old result cannot be copied',p.clipboard.length,0);eq(tag+' no network or fallback effects',p.effects,[]);
 }
}
process.removeListener('unhandledRejection',onUnhandled);
const protectedEngine=source.match(/^      \/\* ── engine:start ── \*\/[\s\S]*?^      \/\* ── engine:end ── \*\//m)[0];
eq('engine exact original bytes including indentation',Buffer.byteLength(protectedEngine),2859);
eq('engine exact original SHA256',createHash('sha256').update(protectedEngine).digest('hex'),'9a6bf50d51da3dc435dfb60b187b15236bae2e9e68d855f18880081c655c11ee');

// ---------- v2 page layout ----------
const require=createRequire(join(root,'package.json'));
const astroRequire=createRequire(require.resolve('astro/package.json'));
const compiled=await astroRequire('@astrojs/compiler').transform(source,{filename:join(root,'src/components/tools/IpSubnetCalculatorTool.astro'),scopedStyleStrategy:'attribute'});
check('v2 Astro compilation diagnostics',!compiled.diagnostics.some(d=>d.severity===1));
let moduleError='';try{await require('esbuild').transform(compiled.code,{loader:'ts',format:'esm'});}catch(e){moduleError=String(e);}eq('v2 generated module parses',moduleError,'');
const css=compiled.css.join('\n'),hash=v=>createHash('sha256').update(v).digest('hex');
eq('v2 whole client core retained after build-time localization',hash(source.slice(source.indexOf('      var inputEl    ='),source.indexOf('  </script>'))),'2e5e3700cc84a92770e1a43c33f82b141010a1a799e6ad9d31d374f1fa487850');
check('v2 direct flex root',/^<div class="isc-wrap">/.test(markupTemplate)&&/\.isc-wrap[^{}]*\{[^}]*min-width:\s*0[^}]*min-height:\s*0/.test(css));
check('v2 controls then stable status then full-width result',markupTemplate.indexOf('isc-inputs')<markupTemplate.indexOf('isc-status')&&markupTemplate.indexOf('isc-status')<markupTemplate.indexOf('isc-result-section'));
check('v2 fixed status and long error scroll',/\.isc-status[^{}]*\{[^}]*height:\s*2\.8em[^}]*overflow:\s*auto/.test(css)&&/@media\s*\(max-width:\s*860px\)[\s\S]*?height:\s*4\.2em/.test(css));
for(const cls of ['isc-result-section','isc-results','isc-table-scroll'])check('v2 zero basis and minimum sizes '+cls,new RegExp('\\.'+cls+'[^{}]*\\{[^}]*flex:\\s*1 1 0[^}]*min-width:\\s*0[^}]*min-height:\\s*0').test(css));
check('v2 actual table scrollbar bounded',/\.isc-table-scroll[^{}]*\{[^}]*overflow:\s*auto/.test(css));
check('v2 hidden result wins flex',/\.isc-results[^{}]*\[hidden\][^{}]*\{\s*display:\s*none/.test(css));
check('v2 stable stacked result heights',/@media\s*\(max-width:\s*860px\)[\s\S]*?height:\s*26rem/.test(css)&&/@media\s*\(max-width:\s*640px\)[\s\S]*?height:\s*24rem/.test(css));
check('v2 phone input/select/copy 44px',/@media\s*\(max-width:\s*640px\)[\s\S]*?input[^{}]*select[^{}]*\.btn-copy[^{}]*\{\s*min-height:\s*44px/.test(css));
check('v2 table content wraps inside fixed columns',/\.isc-table[^{}]*\{[^}]*table-layout:\s*fixed/.test(css)&&/\.isc-table[^{}]*td[^{}]*\{[^}]*overflow-wrap:\s*anywhere/.test(css));
check('v2 empty result has a desktop sentence and hides on stacked screens',markupTemplate.includes('id="isc-empty"')&&/@media\s*\(max-width:\s*860px\)[\s\S]*?:has\(#isc-results[^)]*\[hidden\][^)]*\)[^{}]*\{\s*display:\s*none/.test(css));
check('v2 full result hides empty prompt',/:has\(#isc-results[^)]*:not\(\[hidden\]\)[^)]*\)[^{}]*\.isc-empty[^{}]*\{\s*display:\s*none/.test(css));
check('v2 compiled styles contain no unresolved global',!css.includes(':global('));
check('v2 automatic dark ancestor is global',/:root:not\(\[data-theme="light"\]\)\s+\.isc-error\[data-astro-cid-/.test(css));
check('v2 selected dark ancestor is global',/\[data-theme="dark"\]\s+\.isc-error\[data-astro-cid-/.test(css));
check('v2 no runtime localization or duplicate source tables',!/data-i18n|document\.documentElement\.lang|var STRINGS/.test(source));
const pageScript=source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
check('v2 tips excluded from script',/define:vars=\{\{ t: CLIENT_T \}\}/.test(source)&&!/TIPS|tips|STRINGS/.test(pageScript));
const bindings=[...markupTemplate.matchAll(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g)];
eq('v2 tip IDs',bindings.map(m=>m[1]),['isc-tip-input','isc-tip-prefix','isc-tip-results','isc-tip-copy']);
check('v2 tips outside labels and buttons',!/<(?:label|button)\b[^>]*>(?:(?!<\/(?:label|button)>)[\s\S])*?<Toggletip/.test(markupTemplate));
const originalStringsHashes={
  "en": "4d5f514b6aa8b815cfeaba10cd92b17a8772ea75d0045e532f7e2b9c673b3e61",
  "zh": "9785685de1b68fcf399d9f8059efe5b8d31ff5fd77a6bf561426d7c924884264",
  "ja": "28e61f24280471f287d5c4286e0c1a30d9d9c78862014629845160761409152f",
  "ko": "661bd1b195106a5dbe7527b7cf1b4cd7bf8b2fc8c41248be1c63f4d8dbdc69c3"
};
const {compile}=await import('@mdx-js/mdx');
for(const lang of ['en','zh','ja','ko']){
 const {T,TIPS,CLIENT_T}=locale(lang),p=page(lang,'shared-after');
 eq('v2 '+lang+' four tip keys',Object.keys(TIPS),['input','prefix','results','copy']);
 check('v2 '+lang+' plain short tips',Object.values(TIPS).every(t=>typeof t==='string'&&t.length>0&&t.length<=280&&!/[<>\n]|https?:/.test(t)));
 eq('v2 '+lang+' fifteen runtime keys',Object.keys(CLIENT_T),['copy','copied','copyFailed','networkAddress','broadcastAddress','noBroadcast31','noBroadcast32','subnetMask','wildcardMask','firstHost','lastHost','usableHosts','cidr','errInvalidIp','errInvalidCidr']);
 check('v2 '+lang+' serialized strings omit tips',Object.values(TIPS).every(text=>!JSON.stringify(CLIENT_T).includes(text)));
 eq('v2 '+lang+' existing localized strings unchanged',hash(JSON.stringify(Object.fromEntries(Object.entries(T).filter(([k])=>!['tips','empty'].includes(k))))),originalStringsHashes[lang]);
 eq('v2 '+lang+' SSR input label',p.document.querySelector('label[for="isc-input"]').textContent,T.inputLabel);eq('v2 '+lang+' SSR prefix label',p.document.querySelector('label[for="isc-prefix"]').textContent,T.prefixLabel);
 eq('v2 '+lang+' SSR placeholder',p.input.placeholder,T.placeholder);eq('v2 '+lang+' SSR eight labels',Array.from(p.result.querySelectorAll('th')).map(e=>e.textContent),rowKeys.map(k=>T[k]));
 eq('v2 '+lang+' initial default retained',p.cells(),defaultValues);eq('v2 '+lang+' single real Copy button',Array.from(p.document.querySelectorAll('button:not([data-zt-tip])')).map(e=>e.id),['isc-copy']);
 const scroll=p.document.querySelector('.isc-table-scroll');eq('v2 '+lang+' keyboard-readable result region',[scroll.getAttribute('tabindex'),scroll.getAttribute('role'),scroll.getAttribute('aria-label')],['0','region',T.resultsLabel]);
 eq('v2 '+lang+' localized empty sentence',p.document.getElementById('isc-empty').textContent,T.empty);
 for(const [,id,label,key]of bindings){eq('v2 '+lang+' real tip '+id,p.document.getElementById(id).textContent,TIPS[key]);check('v2 '+lang+' localized tip aria '+id,p.document.querySelector('[data-zt-tip="'+id+'"]').getAttribute('aria-label').includes(T[label]));}
 const content=readFileSync(join(root,'src/content/tools/ip-subnet-calculator',lang+'.mdx'),'utf8'),data=require('js-yaml').load(content.match(/^---\n([\s\S]*?)\n---/)[1]);
 eq('v2 '+lang+' five steps',data.steps.length,5);check('v2 '+lang+' plain bounded steps',data.steps.every(t=>t.length<=280&&!/[<>\n]/.test(t))&&data.steps.join('').length<=1200);check('v2 '+lang+' steps before FAQ',content.indexOf('steps:')<content.indexOf('faqItems:'));
 eq('v2 '+lang+' MDX content contract', contractProblems('ip-subnet-calculator', lang), '');
 let error='';try{await compile(content.replace(/^---\n[\s\S]*?\n---/,''));}catch(e){error=String(e);}eq('v2 '+lang+' MDX compiles',error,'');
 for(const order of ['shared-before','shared-after'])for(const selector of ['[data-zt-tip="isc-tip-results"]','[data-zt-tip="isc-tip-copy"]','.isc-table-scroll']){
  const q=page(lang,order);q.key(q.document.querySelector(selector),{key:'l',ctrlKey:true});
  eq('v2 '+lang+'/'+order+'/'+selector+' clear focuses before hiding result',[q.input.value,q.result.hidden,q.error.hidden,q.document.activeElement.id,q.clears],['',true,true,'isc-input',['ip-subnet-calculator']]);
 }
}
{
 const p=page('en','shared-after');p.type('8.8.8.8/0');p.tick(250);eq('v2 largest subnet keeps eight complete values',p.cells(),['0.0.0.0','255.255.255.255','0.0.0.0','255.255.255.255','0.0.0.1','255.255.255.254',(4294967294).toLocaleString(),'0.0.0.0/0']);
 p.click();eq('v2 largest subnet copy remains complete',p.clipboard[0].value,rowKeys.map((k,i)=>pageStrings.en[k]+': '+p.cells()[i]).join('\n'));p.clipboard[0].resolve();await settle();
 p.type('1'.repeat(100000));p.tick(250);eq('v2 long invalid input bounded to original localized error',[p.result.hidden,p.error.textContent],[true,pageStrings.en.errInvalidIp]);
}
check('v2 registered as analyze',/'ip-subnet-calculator':\s*'analyze'/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')));

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
