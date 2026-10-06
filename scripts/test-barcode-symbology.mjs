// Barcode Symbology — spec-driven regression test
//
// Read:  src/components/tools/BarcodeGeneratorTool.astro (extracts the real
//        encoder block, so this test cannot drift from the shipped source)
// Write: stdout; optional ZT_B13_REPORT JSON.
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

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const root = process.env.ZT_B13_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const componentPath = process.env.ZT_B13_SOURCE || join(root, 'src/components/tools/BarcodeGeneratorTool.astro');
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


// ---------- Whole-page interaction and asynchronous lifetime regression ----------
// Read: the complete component IIFE, actual markup, shared ToolLayout shortcut and parse5.
// Write: stdout; optional ZT_B13_REPORT JSON chosen by the caller. No network or system clipboard.
// Canvas rasterization / image decoding are controlled async boundaries; canvas blobs
// contain JSON operation receipts, NOT PNG pixels. The real SVG encoder and render run.
const ROOT=root;
const {loadPage}=await import(pathToFileURL(ROOT+'/scripts/astro-page-harness.mjs')); 
const req=createRequire(ROOT+'/package.json'),{parseFragment}=req('parse5');
const read=p=>readFileSync(ROOT+'/'+p,'utf8'),sha=s=>createHash('sha256').update(s).digest('hex');
const specs=[{slug:'barcode-generator',file:'src/components/tools/BarcodeGeneratorTool.astro'}];
for(const s of specs){if(process.env.ZT_B13_SOURCE)s.file=relative(ROOT,process.env.ZT_B13_SOURCE);s.source=read(s.file);}
const layout=read('src/layouts/ToolLayout.astro'),start=layout.indexOf("      document.addEventListener('keydown'",layout.indexOf('// ── Keyboard shortcuts'));
const shortcut=layout.slice(start,layout.indexOf('      // ── Copy button visual feedback',start));
if(!shortcut.includes('window.ztPersist.clear(_slug)'))throw Error('shortcut drift');
const rows=[],unhandled=[];const onUnhandled=e=>unhandled.push(String(e?.message||e));process.on('unhandledRejection',onUnhandled);
const flush=async()=>{await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));};
function checkPage(s,name,actual,expected){const same=JSON.stringify(actual)===JSON.stringify(expected);rows.push({slug:s.slug,name,result:same?'PASS':'FAIL',actual,expected});}
function page(s,lang='en',order='before'){
 const docHandlers={},copies=[],exec=[],saved=[],cleared=[],tracks=[],images=[],blobs=[],downloads=[],revoked=[],urls=new Map(),winHandlers={};let document,now=0,seq=0,urlSeq=0,selection=null;const timers=new Map();
 const walk=n=>n.children.flatMap(c=>[c,...walk(c)]);
 function simple(e,selector){let rest=selector;const tag=rest.match(/^[a-z][a-z0-9-]*/i);if(tag){if(e.tagName!==tag[0].toUpperCase())return false;rest=rest.slice(tag[0].length);}for(const m of rest.matchAll(/([.#])([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g)){if(m[1]==='#'&&e.id!==m[2]||m[1]==='.'&&!e.classList.contains(m[2]))return false;if(m[3]&&(e.getAttribute(m[3])===null||m[4]!==undefined&&e.getAttribute(m[3])!==m[4]))return false;}return true;}
 function matches(e,selector){if(selector.includes(','))return selector.split(/,\s*/).some(x=>matches(e,x));const parts=selector.split(/\s+(?![^\[]*\])/);if(!simple(e,parts.pop()))return false;for(const part of parts.reverse()){let p=e.parentNode;while(p&&!simple(p,part))p=p.parentNode;if(!p)return false;e=p;}return true;}
 function element(tag,attrs={}){
  const listeners={};const el={tagName:tag.toUpperCase(),attributes:{...attrs},parentNode:null,childNodes:[],dataset:Object.fromEntries(Object.entries(attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v])),style:{},hidden:'hidden'in attrs,disabled:'disabled'in attrs,checked:'checked'in attrs,_value:attrs.value,
   get children(){return this.childNodes.filter(n=>n.tagName);},get id(){return this.attributes.id||'';},set id(v){this.attributes.id=v;},get type(){return this.attributes.type||(this.tagName==='INPUT'?'text':'');},set type(v){this.attributes.type=v;},get className(){return this.attributes.class||'';},set className(v){this.attributes.class=String(v);},
   get options(){return walk(this).filter(e=>e.tagName==='OPTION');},get value(){if(this._value!==undefined)return this._value;if(this.tagName==='SELECT'){const x=this.options.find(e=>e.attributes.selected!==undefined)||this.options[0];return x?x.value:'';}return '';},set value(v){this._value=String(v);},
   get textContent(){return this.childNodes.map(n=>n.tagName?n.textContent:n.value).join('');},set textContent(v){this.childNodes=[{value:String(v),parentNode:this}];},
   get innerHTML(){return this._html||'';},set innerHTML(v){this._html=String(v);this.childNodes=parseFragment(this._html).childNodes.map(n=>wrap(n,this));},
   getAttribute(k){return Object.hasOwn(this.attributes,k)?this.attributes[k]:null;},setAttribute(k,v){this.attributes[k]=String(v);if(k==='disabled')this.disabled=true;if(k==='hidden')this.hidden=true;},removeAttribute(k){delete this.attributes[k];if(k==='disabled')this.disabled=false;if(k==='hidden')this.hidden=false;},
   appendChild(n){n.parentNode=this;this.childNodes.push(n);return n;},removeChild(n){this.childNodes=this.childNodes.filter(x=>x!==n);n.parentNode=null;},remove(){this.parentNode?.removeChild(this);},contains(n){for(;n;n=n.parentNode)if(n===this)return true;return false;},
   querySelectorAll(q){return walk(this).filter(e=>matches(e,q));},querySelector(q){return this.querySelectorAll(q)[0]||null;},
   addEventListener(k,f){(listeners[k]||=[]).push(f);},focus(){document.activeElement=this;},select(){selection=this;},dispatch(k,init={}){const e={type:k,target:this,currentTarget:this,defaultPrevented:false,cancelBubble:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.cancelBubble=true;},...init};for(const f of listeners[k]||[])f.call(this,e);if(!e.cancelBubble)for(const f of docHandlers[k]||[])f.call(document,e);return e;},click(){if(this.tagName==='A'){downloads.push({name:this.download,url:this.href,blob:urls.get(this.href)});return;}if(!this.disabled)this.dispatch('click');},
  };el.classList={contains:c=>el.className.split(/\s+/).includes(c),add(...c){el.className=[...new Set([...el.className.split(/\s+/).filter(Boolean),...c])].join(' ');},remove(...c){el.className=el.className.split(/\s+/).filter(x=>!c.includes(x)).join(' ');},toggle(c,on){const add=on===undefined?!this.contains(c):on;this[add?'add':'remove'](c);return add;}};if(tag.toLowerCase()==='canvas'){el.width=Number(attrs.width||300);el.height=Number(attrs.height||150);el.ops=[];const ctx={};for(const name of ['save','restore','beginPath','arc','moveTo','lineTo','quadraticCurveTo','closePath','rect','clip'])ctx[name]=(...args)=>el.ops.push({name,args});ctx.clearRect=()=>{el.ops=[];};ctx.fillText=(text,...args)=>el.ops.push({name:'fillText',text,args,font:ctx.font,color:ctx.fillStyle});ctx.fillRect=(...args)=>el.ops.push({name:'fillRect',args,color:ctx.fillStyle});ctx.drawImage=(image,...args)=>el.ops.push({name:'drawImage',image:image.src,args});el.getContext=()=>ctx;el.toBlob=(cb,type)=>{const snapshot={width:el.width,height:el.height,ops:structuredClone(el.ops)};const job={snapshot,type,done:false,deliver(blob){if(this.done)throw Error('duplicate blob delivery');this.done=true;cb(blob===undefined?new Blob([JSON.stringify(snapshot)],{type:type||'image/png'}):blob);}};blobs.push(job);};}return el;
 }
 function wrap(n,parent){if(!n.tagName)return{value:n.value||'',parentNode:parent};const e=element(n.tagName,Object.fromEntries((n.attrs||[]).map(a=>[a.name,a.value])));e.parentNode=parent;e.childNodes=(n.childNodes||[]).map(n=>wrap(n,e));if(e.tagName==='TEXTAREA')e.value=e.textContent;return e;}
 const body=element('body'),widget=element('section',{class:'tool-widget'});body.appendChild(widget);
 let markup=s.source.slice(s.source.indexOf('---',3)+3,s.source.indexOf('<script is:inline>')).replace(/\{\/\*[\s\S]*?\*\/\}/g,'');
 {const part=s.source.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/)[1];const STRINGS=vm.runInNewContext(part+';STRINGS');const L=STRINGS[lang];markup=markup.replace(/=\{L\.(\w+)\}/g,(_,key)=>'="'+L[key].replaceAll('&','&amp;').replaceAll('"','&quot;')+'"').replace(/\{L\.(\w+)\}/g,(_,key)=>L[key]);}
 widget.childNodes=parseFragment(markup).childNodes.map(n=>wrap(n,widget));
 document={body,documentElement:{lang},activeElement:body,createElement:tag=>element(tag),getElementById(id){const e=walk(body).find(e=>e.id===id);if(!e)throw Error('Missing real DOM '+id);return e;},querySelectorAll:q=>body.querySelectorAll(q),querySelector:q=>body.querySelector(q),addEventListener(k,f){(docHandlers[k]||=[]).push(f);},execCommand(command){exec.push({command,text:selection?.value});return false;}};
 class Img{constructor(){images.push(this);this.width=this.naturalWidth=32;this.height=this.naturalHeight=32;}deliver(){this.onload?.();}fail(){this.onerror?.(new Error('controlled image failure'));}}
 const globals={document,Blob,structuredClone,Image:Img,isSecureContext:true,URL:{createObjectURL(blob){const url='blob:probe/'+(++urlSeq);urls.set(url,blob);return url;},revokeObjectURL:url=>revoked.push(url)},navigator:{clipboard:{writeText:text=>new Promise((resolve,reject)=>copies.push({text,resolve,reject})),write(){throw Error('unexpected native clipboard');}}},setTimeout(fn,delay){const id=++seq;timers.set(id,{fn,due:now+delay,delay});return id;},clearTimeout:id=>timers.delete(id),ztPersist:{load(){return null;},save:(slug,v)=>saved.push({slug,value:JSON.parse(JSON.stringify(v))}),clear:slug=>cleared.push(slug)},trackTool:(...x)=>tracks.push(x),addEventListener(k,f){(winHandlers[k]||=[]).push(f);},fetch(){throw Error('network forbidden');}};
 let nativeClipboardReads=0;Object.setPrototypeOf(globals.navigator,{get clipboard(){nativeClipboardReads++;throw Error('native clipboard prototype exposed');}});
 const context={...globals,_slug:s.slug};context.window=context;if(order==='before')vm.runInNewContext(shortcut,context);const loaded=loadPage(s.file,{lang,globals});if(order==='after')loaded.run('var _slug='+JSON.stringify(s.slug)+';\n'+shortcut);
 const $=id=>document.getElementById(id);return{$,document,globals,get nativeClipboardReads(){return nativeClipboardReads;},copies,exec,saved,cleared,tracks,images,blobs,downloads,urls,revoked,timers,input(id,value,ev='input'){$(id).focus();$(id).value=value;$(id).dispatch(ev);},click(selector){const e=selector.startsWith('#')?$(selector.slice(1)):document.querySelector(selector);if(!e)throw Error('No real selector '+selector);e.click();},key(id,meta=false){$(id).focus();$(id).dispatch('keydown',{key:'l',ctrlKey:!meta,metaKey:meta});},advance(ms){const end=now+ms;for(let g=0;;g++){if(g>100)throw Error('timer runaway');const next=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;now=next[1].due;timers.delete(next[0]);next[1].fn();}now=end;}};
}
const barcode=specs[0];
const bCopy={en:'Copy SVG',zh:'复制 SVG',ja:'SVG をコピー',ko:'SVG 복사'},bCopied={en:'Copied!',zh:'已复制！',ja:'コピーしました！',ko:'복사됨!'};
const bFailure={en:'Copy failed. Download the SVG instead.',zh:'复制失败，请改用下载 SVG。',ja:'コピーできませんでした。SVG をダウンロードしてください。',ko:'복사하지 못했습니다. SVG를 다운로드하세요.'};
const svg=p=>p.$('bcode-canvas').innerHTML;
for(const lang of ['en','zh','ja','ko']){
 const p=page(barcode,lang);checkPage(barcode,lang+' initial real EAN output checked digits',p.$('bcode-canvas').querySelector('svg').getAttribute('aria-label'),'5901234123457');
 p.input('bcode-symbology','code128','change');p.input('bcode-data','PROBE-A');const out=svg(p);checkPage(barcode,lang+' real code128 current data',p.$('bcode-canvas').querySelector('svg').getAttribute('aria-label'),'PROBE-A');
 p.click('#bcode-copy');checkPage(barcode,lang+' copy full current SVG bytes',p.copies[0].text,out);p.copies[0].resolve();await flush();checkPage(barcode,lang+' normal copy feedback',p.$('bcode-copy').textContent,bCopied[lang]);p.advance(1400);checkPage(barcode,lang+' normal copy timer',p.$('bcode-copy').textContent,bCopy[lang]);
 p.click('#bcode-copy');p.copies[1].reject(Error('current refusal'));await flush();checkPage(barcode,lang+' current copy rejection visible',p.$('bcode-status').textContent,bFailure[lang]);
 p.click('#bcode-copy');p.copies[2].resolve();await flush();checkPage(barcode,lang+' same output direct retry copies full bytes',p.copies[2].text,out);checkPage(barcode,lang+' same output retry clears own failure',p.$('bcode-status').textContent,'');
}
for(const order of ['before','after'])for(const meta of [false,true]){
 const p=page(barcode,'en',order);p.key('bcode-data',meta);checkPage(barcode,order+'/'+meta+' shared clears input',p.$('bcode-data').value,'');checkPage(barcode,order+'/'+meta+' actual shared persist clear',p.cleared,['barcode-generator']);checkPage(barcode,order+'/'+meta+' CtrlL preserves appearance',[p.$('bcode-symbology').value,p.$('bcode-module').value,p.$('bcode-height').value,p.$('bcode-showtext').checked],['ean13','2','80',true]);checkPage(barcode,order+'/'+meta+' CtrlL clears derived SVG',svg(p),'');checkPage(barcode,order+'/'+meta+' CtrlL disables export/copy',[p.$('bcode-png').disabled,p.$('bcode-svg').disabled,p.$('bcode-copy').disabled],[true,true,true]);
}
{
 const p=page(barcode);p.input('bcode-data','');checkPage(barcode,'real empty input clears SVG immediately',svg(p),'');checkPage(barcode,'real empty input disables buttons',p.$('bcode-copy').disabled,true);p.click('#bcode-reset');checkPage(barcode,'Reset deliberately restores sample',p.$('bcode-data').value,'590123412345');checkPage(barcode,'Reset valid preview',p.$('bcode-copy').disabled,false);
 p.input('bcode-module','4');checkPage(barcode,'option input recomputes actual SVG width',p.$('bcode-canvas').querySelector('svg').getAttribute('width'),'452');
 p.click('#bcode-svg');checkPage(barcode,'SVG download captures full bytes immediately',await p.downloads[0].blob.text(),svg(p));checkPage(barcode,'SVG download filename',p.downloads[0].name,'ean13-590123412345.svg');
 Object.defineProperty(p.globals.navigator,'clipboard',{value:undefined,configurable:true});p.click('#bcode-copy');await flush();checkPage(barcode,'missing clipboard has visible failure',p.$('bcode-status').textContent,bFailure.en);
}
for(const boundary of ['input','option','reset','CtrlL'])for(const outcome of ['resolve','reject']){
 const p=page(barcode);p.click('#bcode-copy');if(boundary==='input')p.input('bcode-data','400638133393');if(boundary==='option')p.input('bcode-module','3');if(boundary==='reset')p.click('#bcode-reset');if(boundary==='CtrlL')p.key('bcode-data');const before=[p.$('bcode-copy').textContent,p.$('bcode-status').textContent];p.copies[0][outcome](Error('late refusal'));await flush();checkPage(barcode,boundary+'/'+outcome+' old copy preserves current feedback',[p.$('bcode-copy').textContent,p.$('bcode-status').textContent],before);
}
{
 const p=page(barcode);p.click('#bcode-copy');p.copies[0].resolve();await flush();p.advance(100);p.click('#bcode-copy');p.copies[1].resolve();await flush();p.advance(1300);checkPage(barcode,'old 1400ms timer preserves second Copied',p.$('bcode-copy').textContent,bCopied.en);p.advance(100);checkPage(barcode,'latest barcode timer restores actual label',p.$('bcode-copy').textContent,bCopy.en);
}
for(const boundary of ['input','reset','CtrlL']){
 const p=page(barcode);p.input('bcode-symbology','code128','change');p.input('bcode-data','PROBE-A');const original=svg(p);p.click('#bcode-png');const image=p.images[0],encoded=await p.urls.get(image.src).text();checkPage(barcode,boundary+' PNG input SVG snapshot is original',encoded,original);image.deliver();if(boundary==='input')p.input('bcode-data','PROBE-B');if(boundary==='reset')p.click('#bcode-reset');if(boundary==='CtrlL')p.key('bcode-data');p.blobs[0].deliver();checkPage(barcode,boundary+' PNG callback filename belongs to original content',p.downloads[0].name,'code128-PROBE-A.png');checkPage(barcode,boundary+' PNG canvas draw uses original image source',p.blobs[0].snapshot.ops.find(o=>o.name==='drawImage').image,image.src);
}

for(const outcome of ['resolve','reject']){const p=page(barcode);p.click('#bcode-copy');p.click('#bcode-copy');p.copies[1].resolve();await flush();const before=[p.$('bcode-copy').textContent,p.$('bcode-status').textContent];p.copies[0][outcome](Error('older request'));await flush();checkPage(barcode,'same-result older '+outcome+' cannot change newer success',[p.$('bcode-copy').textContent,p.$('bcode-status').textContent],before);}
{const p=page(barcode);p.globals.navigator.clipboard.writeText=()=>{throw Error('sync copy refusal');};let thrown='';try{p.click('#bcode-copy');}catch(e){thrown=e.message;}await flush();checkPage(barcode,'sync clipboard failure handled',thrown,'');checkPage(barcode,'sync failure visible',p.$('bcode-status').textContent,bFailure.en);}
{const p=page(barcode);Object.defineProperty(p.globals.navigator,'clipboard',{value:undefined,configurable:true});p.click('#bcode-copy');await flush();checkPage(barcode,'own undefined never reads native clipboard getter',p.nativeClipboardReads,0);}
{const p=page(barcode);p.click('#bcode-copy');p.copies[0].resolve();await flush();const timer=[...p.timers.values()].find(t=>t.delay===1400);p.input('bcode-data','400638133393');p.click('#bcode-copy');p.copies[1].resolve();await flush();timer.fn();checkPage(barcode,'forced cancelled timer cannot remove current feedback',[p.$('bcode-copy').textContent,p.$('bcode-copy').classList.contains('copied')],[bCopied.en,true]);}

// ---------- v2 page layout ----------
const ssr=vm.runInNewContext(source.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/)[1]+';STRINGS');
for(const lang of ['en','zh','ja','ko']){
 const L=ssr[lang],p=page(barcode,lang);
 checkPage(barcode,lang+' v2 initial preview is nonempty',p.document.querySelector('.bcode-wrap').dataset.empty,'false');
 p.input('bcode-data','');checkPage(barcode,lang+' v2 empty result marker',p.document.querySelector('.bcode-wrap').dataset.empty,'true');
 p.click('#bcode-reset');checkPage(barcode,lang+' v2 reset restores preview marker',p.document.querySelector('.bcode-wrap').dataset.empty,'false');
 checkPage(barcode,lang+' v2 eight SSR tip keys',Object.keys(L.tips).sort(),['check','data','export','height','module','reset','symbology','text']);
 checkPage(barcode,lang+' v2 localized empty sentence',typeof L.empty==='string'&&L.empty.length>0,true);
 const prefix=process.env.ZT_B13_MDX_PREFIX,mdx=readFileSync(prefix?prefix+'-'+lang+'.mdx':join(root,'src/content/tools/barcode-generator',lang+'.mdx'),'utf8');
 const y=req('js-yaml').load(mdx.split('---')[1]);checkPage(barcode,lang+' v2 valid steps before FAQ',Array.isArray(y.steps)&&y.steps.length<=8&&y.steps.every(x=>x.length<=280)&&y.steps.join('').length<=1200&&mdx.indexOf('steps:')<mdx.indexOf('faqItems:'),true);
 checkPage(barcode,lang+' v2 Usage removed',!/<h2>(?:How to generate a barcode|使用方法|使い方|사용 방법)<\/h2>/.test(mdx),true);
}
checkPage(barcode,'v2 shared rail and bounded columns',source.includes('bcode-rail zt-rail')&&source.includes('grid-template-columns: 300px minmax(0, 1fr)')&&source.includes('overflow: auto'),true);
checkPage(barcode,'v2 state before main input',source.indexOf('id="bcode-status"')<source.indexOf('id="bcode-data"'),true);
checkPage(barcode,'v2 eight static tip instances',[...source.matchAll(/<Toggletip id="bcode-tip-/g)].length,8);
checkPage(barcode,'v2 tips remain outside client',!source.slice(source.indexOf('<script is:inline>'),source.indexOf('</script>',source.indexOf('<script is:inline>'))).includes('tips'),true);
checkPage(barcode,'v2 keeps four business buttons', ['bcode-copy','bcode-png','bcode-svg','bcode-reset'].every(id=>source.includes('id="'+id+'"')),true);
checkPage(barcode,'v2 Appearance native disclosure is closed',/<details class="bcode-appearance">/.test(source),true);
checkPage(barcode,'v2 phone empty preview hides and targets 44/24',source.includes('@media (max-width: 860px)')&&source.includes('@media (max-width: 640px)')&&source.includes('min-height: 44px')&&source.includes('min-height: 24px')&&source.includes('.bcode-wrap[data-empty="true"] .bcode-preview-card { display: none; }'),true);
const phoneRules=source.match(/@media \(max-width: 640px\) \{([\s\S]*?)\n  \}/)?.[1]||'';
const phoneStatus=phoneRules.match(/#bcode-status \{([^}]+)\}/)?.[1]||'';
checkPage(barcode,'v2 reserved status stays 2.8em with complete phone wording internally scrollable',source.includes('min-height: 2.8em')&&/(?:^|;)\s*height:\s*2\.8em/.test(phoneStatus)&&/overflow:\s*auto/.test(phoneStatus),true);
const phoneCanvas=phoneRules.match(/\.bcode-canvas \{([^}]+)\}/)?.[1]||'',phoneSvg=phoneRules.match(/\.bcode-canvas svg \{([^}]+)\}/)?.[1]||'';
checkPage(barcode,'phone short and long SVG share one 120px preview and fit completely',/(?:^|;)\s*height:\s*120px/.test(phoneCanvas)&&/min-height:\s*120px/.test(phoneCanvas)&&/max-height:\s*100%/.test(phoneSvg)&&/flex-shrink:\s*0/.test(phoneSvg),true);
for(const lang of ['en','zh','ja','ko']){
 const p=page(barcode,lang),long='QA'.repeat(500);p.input('bcode-symbology','code128','change');p.input('bcode-data',long);
 checkPage(barcode,lang+' phone long notice remains complete',p.$('bcode-status').textContent,ssr[lang].tooLong.replace('{n}','1000').replace('{max}','48'));
 const full=svg(p);p.click('#bcode-copy');checkPage(barcode,lang+' phone long preview retains complete SVG and copies every byte',p.$('bcode-canvas').querySelector('svg').getAttribute('aria-label')===long&&p.copies[0].text===full,true);p.copies[0].resolve();await flush();
}
if(!/['"]barcode-generator['"]\s*:\s*['"]generate['"]/.test(read('src/data/tool-layouts.ts')))console.log('PENDING: root generate registration, compile and native layout acceptance');

await flush();
checkPage(specs[0],'all page async failures handled',unhandled,[]);
process.removeListener('unhandledRejection',onUnhandled);
const pageCounts={PASS:rows.filter(r=>r.result==='PASS').length,FAIL:rows.filter(r=>r.result==='FAIL').length};
const counts={PASS:passes+pageCounts.PASS,FAIL:failures+pageCounts.FAIL};
const report={node:process.version,tool:specs[0].slug,sourceSHA256:sha(specs[0].source),systemClipboard:false,rasterization:'canvas operation receipts; no browser pixels claimed',counts,legacyCounts:{PASS:passes,FAIL:failures},pageCounts,rows};
if(process.env.ZT_B13_REPORT)writeFileSync(process.env.ZT_B13_REPORT,JSON.stringify(report,null,2)+'\n');
for(const r of rows)if(r.result==='FAIL')console.log('FAIL '+r.name+' actual='+JSON.stringify(r.actual)+' expected='+JSON.stringify(r.expected));
console.log(JSON.stringify({slug:specs[0].slug,counts,legacyCounts:report.legacyCounts,pageCounts,sourceSHA256:report.sourceSHA256}));process.exitCode=counts.FAIL?1:0;
