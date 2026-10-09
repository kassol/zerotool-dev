// Color Contrast Checker — the suggested colour passes AA after it is rounded to a hex value
//
// Read:  src/components/tools/ColorContrastCheckerTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the suggestion for a failing pair is an 8-bit colour whose contrast with the
// background is at least 4.5:1 when measured on the rounded hex value (before the fix the
// search accepted unrounded floats and `target * 0.99`, so about half of the suggestions
// were just below 4.5:1, e.g. #D97706 on #FFF7ED → #b75800 at 4.4857:1); 20,000 seeded
// random pairs plus grey / pure-hue / near-black / near-white edges; the displayed ratio
// is truncated, not rounded (WCAG Understanding 1.4.3: 4.499:1 does not meet 4.5:1).
// The reference contrast is computed here independently from the WCAG 2.2 definition of
// relative luminance (threshold 0.04045; no 8-bit value lies between 0.03928 and 0.04045).
//
// Run: node scripts/test-color-contrast-checker.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = process.env.ZEROTOOL_QA_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const componentPath = process.env.ZEROTOOL_QA_COMPONENT || join(root, 'src/components/tools/ColorContrastCheckerTool.astro');
const source = readFileSync(componentPath, 'utf8');
const SLUG = 'color-contrast-checker';

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in ColorContrastCheckerTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { suggestFix, rgbToHex, hexToRgb, contrast, formatRatio: typeof formatRatio === "function" ? formatRatio : null };')();

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

// Independent WCAG 2.2 reference
function lin(v) { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
function refRatio(a, b) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
function suggestHex(fg, bg) {
  const s = E.suggestFix(E.hexToRgb(fg), E.hexToRgb(bg), 4.5);
  return { hex: E.rgbToHex(s.rgb.r, s.rgb.g, s.rgb.b), ratio: s.ratio };
}

// ---------- the reported case ----------
{
  const s = suggestHex('#d97706', '#fff7ed');
  check('#D97706 on #FFF7ED: suggestion passes on its hex value', refRatio(s.hex, '#fff7ed') >= 4.5,
    s.hex + ' → ' + refRatio(s.hex, '#fff7ed'));
  check('#D97706 on #FFF7ED: reported ratio is the hex value\'s ratio',
    Math.abs(s.ratio - refRatio(s.hex, '#fff7ed')) < 1e-9, s.ratio + ' vs ' + refRatio(s.hex, '#fff7ed'));
  check('#D97706 on #FFF7ED: suggestion stays orange (R > G > B)', (() => {
    const c = E.hexToRgb(s.hex); return c.r > c.g && c.g >= c.b;
  })(), s.hex);
}

// ---------- seeded random pairs ----------
let seed = 0x2f6e2b1;
function rnd() { seed = (seed * 1103515245 + 12345) >>> 0; return seed >>> 8; }
let tried = 0, failed = 0, firstBad = null, ratioMismatch = 0, changedNothing = 0;
while (tried < 20000) {
  const fg = hex(rnd() & 255, rnd() & 255, rnd() & 255);
  const bg = hex(rnd() & 255, rnd() & 255, rnd() & 255);
  if (refRatio(fg, bg) >= 4.5) continue;
  tried++;
  const s = suggestHex(fg, bg);
  const r = refRatio(s.hex, bg);
  if (!(r >= 4.5)) { failed++; if (!firstBad) firstBad = fg + ' on ' + bg + ' → ' + s.hex + ' ' + r.toFixed(4); }
  if (Math.abs(s.ratio - r) > 1e-9) ratioMismatch++;
  if (s.hex === fg) changedNothing++;
}
check('20,000 random failing pairs: every suggestion ≥ 4.5:1 on its hex value', failed === 0,
  failed + ' below 4.5; first: ' + firstBad);
check('20,000 random failing pairs: displayed ratio equals the hex value\'s ratio', ratioMismatch === 0, ratioMismatch);
check('20,000 random failing pairs: suggestion differs from the input', changedNothing === 0, changedNothing);

// ---------- edges: greys, pure hues, near-black / near-white backgrounds ----------
{
  const fgs = [];
  for (let v = 0; v <= 255; v += 15) fgs.push(hex(v, v, v));
  fgs.push('#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#7f00ff', '#1a73e8');
  const bgs = ['#000000', '#0a0a0a', '#333333', '#777777', '#767676', '#808080', '#959595', '#cccccc', '#f5f5f5', '#ffffff',
    '#ff0000', '#00ff00', '#0000ff', '#ffff00'];
  let n = 0, bad = [];
  for (const fg of fgs) for (const bg of bgs) {
    if (refRatio(fg, bg) >= 4.5) continue;
    n++;
    const s = suggestHex(fg, bg);
    if (!(refRatio(s.hex, bg) >= 4.5)) bad.push(fg + '/' + bg + '→' + s.hex);
  }
  check('edge pairs (' + n + '): every suggestion ≥ 4.5:1', bad.length === 0, bad.slice(0, 5).join(', '));
}

// ---------- displayed ratio is truncated ----------
check('formatRatio exists in the engine', typeof E.formatRatio === 'function');
if (E.formatRatio) {
  eq('4.4999 shows 4.49', E.formatRatio(4.4999), '4.49');
  eq('4.5 shows 4.50', E.formatRatio(4.5), '4.50');
  eq('21 shows 21.00', E.formatRatio(21), '21.00');
  eq('1 shows 1.00', E.formatRatio(1), '1.00');
  eq('#777777 on white (4.4784) shows 4.47', E.formatRatio(E.contrast(E.hexToRgb('#777777'), E.hexToRgb('#ffffff'))), '4.47');
  eq('#767676 on white (4.5422) shows 4.54', E.formatRatio(E.contrast(E.hexToRgb('#767676'), E.hexToRgb('#ffffff'))), '4.54');
  // floating error must not push an exact value down a step: 3 / 1 etc.
  eq('2.9999999999999996 shows 3.00 (float noise)', E.formatRatio(2.9999999999999996), '3.00');
}


import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { relative } from 'node:path';
const { loadPage } = await import(pathToFileURL(join(root, 'scripts/astro-page-harness.mjs')));
const domino = createRequire(join(root, 'package.json'))('@mixmark-io/domino');
const langKeys = ['en', 'zh', 'ja', 'ko'];
function localized(src) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(src)[1];
  const region = /\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/.exec(fm);
  if (region) return vm.runInNewContext(region[1] + '\n;STRINGS');
  const start = fm.indexOf('const labels =');
  return vm.runInNewContext(fm.slice(start, fm.indexOf('const L =', start)) + '\n;labels');
}
const labels = localized(source);
const sharedSource = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = sharedSource.slice(sharedSource.indexOf("      document.addEventListener('keydown',", sharedSource.indexOf('// ── Keyboard shortcuts:')), sharedSource.indexOf('      // ── Copy button visual feedback'));
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const asyncErrors = [];
process.on('unhandledRejection', error => asyncErrors.push(String(error)));
function open(lang = 'en', order = 'after', saved = null) {
  const L = labels[lang], esc = v => String(v).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  let html = source.replace(/^---\n[\s\S]*?\n---/, '').replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/g,'').replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style>/g,'').replace(/<Toggletip\s[^>]*>[\s\S]*?<\/Toggletip>/g,'').replace(/<Toggletip\s[^>]*\/>/g,'');
  html = html.replace(/=\{L\.([\w]+)\}/g,(_,key)=>'="'+esc(L[key])+'"').replace(/\{L\.([\w]+)\}/g,(_,key)=>esc(L[key]));
  const win = domino.createWindow('<html lang="'+lang+'"><body><div class="tool-widget">'+html+'</div><input id="outside" type="text"></body></html>');
  const doc = win.document;
  let active = doc.body;
  Object.defineProperty(doc,'activeElement',{configurable:true,get:()=>active});
  function dispatch(el,type,init={}) { const ev=doc.createEvent('Event');ev.initEvent(type,true,true);for(const[k,v]of Object.entries(init))Object.defineProperty(ev,k,{value:v});el.dispatchEvent(ev);return ev; }
  for (const el of doc.querySelectorAll('*')) {
    if (!('dataset' in el)) Object.defineProperty(el,'dataset',{value:new Proxy({}, {get:(_,key)=>el.getAttribute('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase()))??undefined,set:(_,key,v)=>{el.setAttribute('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),v);return true;}})});
    if (!('hidden' in el)) Object.defineProperty(el,'hidden',{get:()=>el.hasAttribute('hidden'),set:v=>v?el.setAttribute('hidden',''):el.removeAttribute('hidden')});
    Object.defineProperty(el,'focus',{value:()=>{active=el;}});
    if(el.tagName==='BUTTON')Object.defineProperty(el,'click',{value:()=>{if(!el.disabled)dispatch(el,'click');}});
  }
  const jobs=[],timers=new Map(),allTimers=[];let timerID=0;
  const persist={saved,saveCalls:[],clearCalls:[],load:()=>persist.saved,save:(slug,value)=>{persist.saved=JSON.parse(JSON.stringify(value));persist.saveCalls.push([slug,value]);},clear:slug=>{persist.saved=null;persist.clearCalls.push(slug);}};
  const storage=[],tracks=[],assertions=[],fallback=[];
  let mode='pending',fallbackOK=false;
  const native={writeText:value=>{if(mode==='throw')throw Error('sync denial');return new Promise((resolve,reject)=>jobs.push({value,resolve,reject}));}};
  const navigator=Object.create({clipboard:{writeText(){throw Error('prototype clipboard must never run');}}});
  Object.defineProperty(navigator,'clipboard',{configurable:true,writable:true,value:native});
  const create=doc.createElement.bind(doc);doc.createElement=tag=>{const el=create(tag);Object.defineProperty(el,'select',{value:()=>fallback.push(el.value)});return el;};
  doc.execCommand=command=>command==='copy'&&fallbackOK;
  const globals={document:doc,navigator,isSecureContext:true,ztPersist:persist,trackTool:(...args)=>tracks.push(args),addEventListener:(type,fn)=>{if(type==='storage')storage.push(fn);},setTimeout:(fn,ms)=>{const t={id:++timerID,fn,ms};timers.set(t.id,t);allTimers.push(t);return t.id;},clearTimeout:id=>timers.delete(id),console:{assert:(ok,msg)=>assertions.push({ok,msg}),log(){},warn(){},error(){}}};
  if(order==='before')vm.runInNewContext('var _slug='+JSON.stringify(SLUG)+';'+shortcut,{document:doc,window:globals});
  const page=loadPage(relative(root,componentPath),{lang,globals});
  if(order==='after')page.run('var _slug='+JSON.stringify(SLUG)+';'+shortcut);
  const el=id=>{const e=doc.getElementById(id);if(!e)throw Error('Missing actual markup ID '+id);return e;};
  return {page,doc,el,jobs,timers,allTimers,persist,storage,tracks,assertions,fallback,
    text:id=>doc.getElementById(id)?.textContent??'',
    input(id,value,type='input'){const e=el(id);e.value=String(value);dispatch(e,type);},
    click:id=>{try{el(id).click();}catch(error){check(id+' click does not throw',false,String(error));}},
    key(id,key='l',meta=false){el(id).focus();return dispatch(doc,'keydown',{key,ctrlKey:!meta,metaKey:meta});},
    mode(value){mode=value;Object.defineProperty(navigator,'clipboard',{configurable:true,writable:true,value:value==='missing'?undefined:native});},
    fallbackOK(v){fallbackOK=v;},
    expire(){for(const t of [...timers.values()]){timers.delete(t.id);t.fn();}},
  };
}

const statusIDs=['ccc-body-aa','ccc-body-aaa','ccc-large-aa','ccc-large-aaa','ccc-ui-aa'];
function failing(p){p.input('ccc-fg-hex','#777777');p.input('ccc-bg-hex','#ffffff');}
for(const lang of langKeys){
  const p=open(lang),L=labels[lang];
  check(lang+' initial ratio valid',p.text('ccc-ratio-value').endsWith(' : 1'));check(lang+' initial suggestion hidden',p.el('ccc-suggestion').hidden);
  p.input('ccc-fg-hex','#000');p.input('ccc-bg-hex','fff');eq(lang+' native color sync',p.el('ccc-fg-picker').value,'#000000');eq(lang+' exact 21 ratio',p.text('ccc-ratio-value'),'21.00 : 1');
  eq(lang+' 5 badge thresholds',statusIDs.map(id=>p.text(id)),Array(5).fill(L.pass));
  p.input('ccc-fg-hex','#777777');eq(lang+' truncation boundary',p.text('ccc-ratio-value'),'4.47 : 1');
  eq(lang+' body AA fail',p.text('ccc-body-aa'),L.fail);eq(lang+' body AAA fail',p.text('ccc-body-aaa'),L.fail);eq(lang+' large AA pass',p.text('ccc-large-aa'),L.pass);eq(lang+' large AAA fail',p.text('ccc-large-aaa'),L.fail);eq(lang+' UI AA pass',p.text('ccc-ui-aa'),L.pass);
  check(lang+' failing suggestion visible',!p.el('ccc-suggestion').hidden);const proposed=p.el('ccc-apply-btn').dataset.hex;
  p.click('ccc-apply-btn');eq(lang+' Apply uses rounded HEX',p.el('ccc-fg-hex').value,proposed.toUpperCase());check(lang+' Apply hides passing suggestion',p.el('ccc-suggestion').hidden);
  const stable=p.el('ccc-fg-hex').value;p.key('ccc-fg-hex','Enter');eq(lang+' hidden suggestion CtrlEnter inert',p.el('ccc-fg-hex').value,stable);eq(lang+' hidden suggestion cache removed',p.el('ccc-apply-btn').dataset.hex,'');
  failing(p);const ratio=p.text('ccc-ratio-value');p.input('ccc-fg-hex','#x');eq(lang+' partial input keeps ratio',p.text('ccc-ratio-value'),ratio);eq(lang+' partial no error',p.text('ccc-fg-error'),'');
  p.click('ccc-apply-btn');eq(lang+' invalid input cannot apply',p.el('ccc-fg-hex').value,'#x');p.click('ccc-copy-fixed');eq(lang+' invalid input cannot copy',p.jobs.length,0);
  p.input('ccc-fg-hex','#xyz');eq(lang+' invalid error',p.text('ccc-fg-error'),L.invalidHex);eq(lang+' invalid keeps ratio',p.text('ccc-ratio-value'),ratio);
  p.click('ccc-swap');eq(lang+' ordinary swap clears invalid',p.text('ccc-fg-error'),'');eq(lang+' ordinary swap cached background',p.el('ccc-fg-hex').value,'#FFFFFF');
  failing(p);p.click('ccc-copy-fixed');eq(lang+' whole suggested HEX copied',p.jobs.at(-1).value,p.el('ccc-copy-fixed').dataset.hex.toUpperCase());p.jobs.at(-1).reject(Error('denial'));await settle();eq(lang+' visible rejection',p.text('ccc-copy-status'),L.copyFailed);
  p.click('ccc-copy-fixed');p.jobs.at(-1).resolve();await settle();eq(lang+' same-result retry',p.text('ccc-copy-fixed'),L.copied);eq(lang+' retry clears rejection',p.text('ccc-copy-status'),'');p.expire();eq(lang+' stable copy label',p.text('ccc-copy-fixed'),L.copyFixed);
  for(const mode of ['throw','missing']){p.mode(mode);p.click('ccc-copy-fixed');await settle();eq(lang+mode+' visible failure',p.text('ccc-copy-status'),L.copyFailed);p.mode('pending');p.click('ccc-copy-fixed');p.jobs.at(-1).resolve();await settle();p.expire();eq(lang+mode+' retry original label',p.text('ccc-copy-fixed'),L.copyFixed);}
  for(const order of ['before','after'])for(const meta of [false,true]){
    const q=open(lang,order);failing(q);const pickerValues=['ccc-fg-picker','ccc-bg-picker'].map(id=>q.el(id).value);q.key('ccc-fg-hex',meta?'L':'l',meta);
    eq(lang+order+meta+' text clears',[q.el('ccc-fg-hex').value,q.el('ccc-bg-hex').value],['','']);
    eq(lang+order+meta+' native controls retained',['ccc-fg-picker','ccc-bg-picker'].map(id=>q.el(id).value),pickerValues);
    check(lang+order+meta+' preview hidden',q.el('ccc-preview').hidden);eq(lang+order+meta+' preview colors clear',[q.el('ccc-preview').style.backgroundColor,q.el('ccc-preview').style.color],['','']);
    eq(lang+order+meta+' ratio/badges clear',['ccc-ratio-value','ccc-ratio-headline',...statusIDs].map(id=>q.text(id)),Array(7).fill(''));
    check(lang+order+meta+' suggestion hidden',q.el('ccc-suggestion').hidden);eq(lang+order+meta+' datasets clear',[q.el('ccc-apply-btn').dataset.hex,q.el('ccc-copy-fixed').dataset.hex],['','']);eq(lang+order+meta+' suggestion display clear',['ccc-suggestion-hex','ccc-suggestion-ratio'].map(id=>q.text(id)),['','']);
    eq(lang+order+meta+' persistence once',q.persist.clearCalls.length,1);q.key('ccc-bg-hex','Enter',meta);q.click('ccc-swap');eq(lang+order+meta+' hidden actions leave clear',[q.el('ccc-fg-hex').value,q.el('ccc-bg-hex').value],['','']);
    q.input('ccc-fg-hex','#000000');eq(lang+order+meta+' one new color does not use cached background',q.text('ccc-ratio-value'),'');q.input('ccc-bg-hex','#ffffff');eq(lang+order+meta+' new inputs resume',q.text('ccc-ratio-value'),'21.00 : 1');check(lang+order+meta+' preview resumes',!q.el('ccc-preview').hidden);q.key('outside');eq(lang+order+meta+' outside scope preserved',q.el('ccc-bg-hex').value,'#ffffff');eq(lang+order+meta+' outside no clear',q.persist.clearCalls.length,1);
  }
}
for(const mutation of ['input','picker','swap','apply','shortcut'])for(const late of ['resolve','reject']){
 const p=open();failing(p);p.click('ccc-copy-fixed');const old=p.jobs.at(-1);
 if(mutation==='input')p.input('ccc-fg-hex','#888888');if(mutation==='picker')p.input('ccc-fg-picker','#888888');if(mutation==='swap')p.click('ccc-swap');if(mutation==='apply')p.click('ccc-apply-btn');if(mutation==='shortcut')p.key('ccc-fg-hex');
 const state=[p.text('ccc-copy-fixed'),p.text('ccc-copy-status')];old[late](Error('late'));await settle();eq(mutation+late+' stale completion inert',[p.text('ccc-copy-fixed'),p.text('ccc-copy-status')],state);eq(mutation+late+' no fallback',p.fallback.length,0);
}
for(const a of ['resolve','reject'])for(const b of ['resolve','reject']){
 const p=open();failing(p);p.click('ccc-copy-fixed');const old=p.jobs.at(-1);p.click('ccc-copy-fixed');const current=p.jobs.at(-1);current[b](Error('current'));await settle();const state=[p.text('ccc-copy-fixed'),p.text('ccc-copy-status')];old[a](Error('old'));await settle();eq(a+b+' latest same button state',[p.text('ccc-copy-fixed'),p.text('ccc-copy-status')],state);p.expire();eq(a+b+' stable label after timer',p.text('ccc-copy-fixed'),labels.en.copyFixed);
}
{
 const p=open();failing(p);p.click('ccc-copy-fixed');p.jobs.at(-1).resolve();await settle();const old=p.allTimers.at(-1);p.input('ccc-fg-hex','#888888');p.click('ccc-copy-fixed');p.jobs.at(-1).resolve();await settle();old.fn();eq('old timer cannot restore new success',p.text('ccc-copy-fixed'),labels.en.copied);p.expire();eq('latest timer restores original',p.text('ccc-copy-fixed'),labels.en.copyFixed);
}
{
 const p=open();failing(p);p.el('ccc-copy-fixed').dataset.hex='invalid';p.el('ccc-apply-btn').dataset.hex='invalid';p.click('ccc-copy-fixed');p.click('ccc-apply-btn');eq('invalid dataset cannot copy',p.jobs.length,0);eq('invalid dataset cannot apply',p.el('ccc-fg-hex').value,'#777777');
}
check('no unhandled promises',asyncErrors.length===0,asyncErrors.join(';'));

// v2 layout and SSR text: the runtime checks above still drive the actual candidate.
const tipKeys=["fg", "bg", "swap", "ratio", "apply", "copy"];

const { parse } = createRequire(createRequire(join(root,'package.json')).resolve('astro/package.json'))('@astrojs/compiler');
try { const ast=await parse(source);check('Astro candidate syntax',Boolean(ast.ast)); } catch(error){check('Astro candidate syntax',false,String(error));}
check('SSR strings region',source.includes('// strings:start\nconst STRINGS =')&&source.includes('// strings:end'));
check('no stale labels identifier',! /\blabels\b/.test(source.split('\n---')[0]));
const actualFrontmatter=/^---\n([\s\S]*?)\n---/.exec(source)[1];
const actualStrings=/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/.exec(actualFrontmatter)[1];
const actualFallback=/const L = [^\n]+/.exec(actualFrontmatter)[0];
const fallback=vm.runInNewContext(actualStrings+'\nconst lang="unrecognized";'+actualFallback+'\n;L');
eq('actual frontmatter fallback resolves English',fallback,labels.en);
check('Toggletip import',source.includes("import Toggletip from '../Toggletip.astro'"));
const bindings=[...source.matchAll(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{L\.\w+\}>\{L\.tips\.(\w+)\}<\/Toggletip>/g)];
eq('one real binding per tip',bindings.map(m=>m[2]).sort(),tipKeys.slice().sort());check('unique tip IDs',new Set(bindings.map(m=>m[1])).size===bindings.length);
for(const lang of langKeys){
  const L=labels[lang];for(const key of tipKeys)check(lang+' SSR tip '+key,typeof L.tips[key]==='string'&&L.tips[key].trim().length>0);
  check(lang+' empty explanation',typeof L.empty==='string'&&L.empty.trim().length>0);
  const dir=process.env.ZEROTOOL_QA_MDX_DIR;
  const mdxPath=dir?join(dir,`b12-${SLUG}-feature-${lang}.mdx`):join(root,'src/content/tools',SLUG,lang+'.mdx');
  const mdx=readFileSync(mdxPath,'utf8'),fm=/^---\n([\s\S]*?)\n---/.exec(mdx)[1];
  const region=/^steps:\n((?:  - .+\n)*)/m.exec(fm);
  const steps=region?[...region[1].matchAll(/^  - (.+)$/gm)].map(m=>JSON.parse(m[1])):[];
  check(lang+' suggestion step names the actual Apply button',steps.some(step=>step.includes(L.apply)));
  check(lang+' steps present and <=8',steps.length>0&&steps.length<=8);check(lang+' each step <=280',steps.every(step=>step.length<=280));check(lang+' total steps <=1200',steps.join('').length<=1200);check(lang+' plain steps',steps.every(step=>!/<[^>]+>|\*\*|`/.test(step)));check(lang+' steps before FAQ',fm.indexOf('steps:')>=0&&fm.indexOf('steps:')<fm.indexOf('faqItems:'));
}
const client=source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];check('tips stay out of client data',!client.includes('tips')&&!/data-[\w-]*tip/.test(source.split('<script')[0]));
check('270-320px desktop rail',/grid-template-columns:\s*clamp\(270px,\s*24vw,\s*320px\)\s*minmax\(0,\s*1fr\)/.test(source));
check('860px stack breakpoint',/@media \(max-width: 860px\)/.test(source));check('640px phone breakpoint',/@media \(max-width: 640px\)/.test(source));
check('root flex column and min-height0',/ccc-wrap[^{]*\{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;/.test(source)&&source.includes('.ccc-wrap { flex: 1; min-height: 0; }'));
check('result bounded desktop',source.includes('.ccc-result { min-width: 0; min-height: 0; overflow: auto; }'));
check('empty hidden on mobile',source.includes('.ccc-result[data-empty="true"] { display: none; }'));
check('rail uses shared zt-rail',source.includes('class="ccc-rail zt-rail"'));

check('main HEX44 phone',source.includes('.ccc-hex-input { min-height: 44px;'));check('main buttons44 phone',source.includes('.ccc-swap-btn, .ccc-action button { min-height: 44px; }'));check('native colors44 phone',source.includes('.ccc-picker { width: 44px; height: 44px;'));check('status reserved',source.includes('#ccc-copy-status { min-height: 2.8em;'));
check('sample internally scrolls at fixed height',source.includes('.ccc-preview { height: 160px; min-height: 0; overflow: auto;'));check('summary internally scrolls',source.includes('.ccc-summary { max-height: 24rem; overflow: auto; }'));
const p=open();eq('three independent buttons retained',p.doc.querySelectorAll('#ccc-swap,#ccc-apply-btn,#ccc-copy-fixed').length,3);p.key('ccc-fg-hex');eq('clear empty signal',p.el('ccc-result').dataset.empty,'true');check('clear explanation visible',!p.el('ccc-empty').hidden);p.input('ccc-fg-hex','#000000');p.input('ccc-bg-hex','#ffffff');eq('new input restores preview',p.el('ccc-result').dataset.empty,'false');check('real result content restored',!p.el('ccc-result-content').hidden);
check('registered generate layout',readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8').includes("  'color-contrast-checker': 'generate',"));

// ---------- S2-9 fixes outside the engine ----------
// Analytics: one `check` event per committed change (as in css-triangle-generator / box-shadow-generator),
// not on page load and not on every input event or colour-picker drag step.
for (const lang of langKeys) {
  const p = open(lang), checks = () => p.tracks.filter(t => t[1] === 'check').length;
  eq(lang + ' GA: page load sends no check', checks(), 0);
  p.input('ccc-fg-hex', '#7'); p.input('ccc-fg-hex', '#77'); p.input('ccc-fg-hex', '#777'); p.input('ccc-fg-hex', '#777777');
  eq(lang + ' GA: input events send no check', checks(), 0);
  p.input('ccc-fg-hex', '#777777', 'change');
  eq(lang + ' GA: committed hex change sends one check', checks(), 1);
  p.input('ccc-fg-hex', '#77', 'change');
  eq(lang + ' GA: committed invalid hex sends nothing', checks(), 1);
  for (const v of ['#101010', '#202020', '#303030']) p.input('ccc-bg-picker', v);
  eq(lang + ' GA: picker drag sends nothing', checks(), 1);
  p.input('ccc-bg-picker', '#303030', 'change');
  eq(lang + ' GA: picker commit sends one check', checks(), 2);
  p.key('ccc-fg-hex'); p.input('ccc-fg-hex', '#000000'); p.input('ccc-fg-hex', '#000000', 'change');
  eq(lang + ' GA: after Ctrl+L one colour alone sends nothing', checks(), 2);
}
// Full-width input from an IME is read through NFKC; maxlength no longer truncates pasted text.
for (const lang of langKeys) {
  const p = open(lang), L = labels[lang];
  p.input('ccc-bg-hex', '#ffffff');
  p.input('ccc-fg-hex', '＃７６７６７６');
  eq(lang + ' full-width hex is read', p.el('ccc-fg-picker').value, '#767676');
  eq(lang + ' full-width hex gives the ratio', p.text('ccc-ratio-value'), '4.54 : 1');
  eq(lang + ' full-width hex shows no error', p.text('ccc-fg-error'), '');
  p.input('ccc-fg-hex', '＃９４９４９４');
  check(lang + ' full-width failing colour keeps Apply and Copy usable', !p.el('ccc-apply-btn').disabled && !p.el('ccc-copy-fixed').disabled);
  p.input('ccc-fg-hex', '  #1F2937  ');
  eq(lang + ' pasted hex with spaces is read', p.text('ccc-ratio-value'), '14.67 : 1');
  const ratio = p.text('ccc-ratio-value');
  for (const alpha of ['#1f2937cc', '1f2937cc', '#000a']) {
    p.input('ccc-fg-hex', alpha);
    eq(lang + ' ' + alpha + ' gives the transparency message', p.text('ccc-fg-error'), L.noAlpha);
    eq(lang + ' ' + alpha + ' keeps the last ratio', p.text('ccc-ratio-value'), ratio);
  }
  check(lang + ' noAlpha string', typeof L.noAlpha === 'string' && L.noAlpha.trim().length > 0 && L.noAlpha !== L.invalidHex);
  // Large text is 18pt (24px) or 14pt bold (18.66px) (WCAG 2.2 "large scale"); body text is the rest.
  check(lang + ' body-text hint is the complement of large text', L.bodyHint.includes('24px') && L.bodyHint.includes('18.66px'), L.bodyHint);
}
check('hex inputs do not truncate pasted text at 7 characters', !/maxlength="7"/.test(source));
console.log(`\n${passes} passed, ${failures} failed`);process.exit(failures?1:0);
