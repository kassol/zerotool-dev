// MIME Type Lookup — lookup table, magic-bytes signatures and the facts the mime type guide quotes
//
// Read:  src/components/tools/MimeTypeLookupTool.astro (evaluates the DB, EXT_INDEX and SIGNATURES
//        declarations between `var DB = [` and the `// ── Search panel ──` comment),
//        scripts/test-mime-type-lookup.fixtures.json (IANA registry rows for the DB entries, see its
//        `source` field), src/content/blog/mime-type-lookup-guide/{en,zh,ja,ko}.mdx,
//        src/content/tools/mime-type-lookup/{en,zh,ja,ko}.mdx
// Write: a temporary directory for the `mime-run` module (removed afterwards); stdout
// Exit:  0 if all PASS, 1 if any FAIL
//
// The guide's sniff table (`mime-sniff`) is rebuilt from its "First bytes" column: each row's bytes
// go through the tool's first-match loop and the result must equal the "Tool result" column (the
// File.type fallback uses the Chrome column, as the tool does). Counts and the registered /
// unregistered examples are checked against the fixture. The `mime-run` module is executed on
// generated files.
//
// Run: node scripts/test-mime-type-lookup.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';
import { parseFragment, defaultTreeAdapter } from 'parse5';
import { loadPage } from './astro-page-harness.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'src/components/tools/MimeTypeLookupTool.astro'), 'utf8');
const a = src.indexOf('var DB = [');
const b = src.indexOf('// ── Search panel ──');
if (a < 0 || b <= a) { console.error('FAIL: DB / SIGNATURES block not found'); process.exit(1); }
const { DB, EXT_INDEX, SIGNATURES, GROUPS } = new Function(src.slice(a, b) + '\nreturn { DB, EXT_INDEX, SIGNATURES, GROUPS };')();
const fx = JSON.parse(readFileSync(join(root, 'scripts/test-mime-type-lookup.fixtures.json'), 'utf8'));

let passes = 0, failures = 0;
function check(name, ok, detail) { if (ok) passes++; else { failures++; console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : '')); } }

// the tool's sniff(): first matching signature, else File.type, else application/octet-stream
function sniff(bytes, fileType) {
  const m = SIGNATURES.find((s) => { try { return s.match(bytes); } catch { return false; } });
  return { mime: m ? m.mime : (fileType || 'application/octet-stream'), matched: !!m, container: !!(m && m.container) };
}

// ── 1. table and signatures ──
check('DB has 155 entries', DB.length === 155, DB.length);
check('37 signatures', SIGNATURES.length === 37, SIGNATURES.length);
check('every DB group is a chip group', DB.every((r) => GROUPS.includes(r[2])));
check('every signature MIME is in the DB', SIGNATURES.every((s) => DB.some((r) => r[0] === s.mime)));
check('fixture covers exactly the DB', Object.keys(fx.entries).length === DB.length && DB.every((r) => r[0] in fx.entries));
const registered = DB.filter((r) => fx.entries[r[0]] !== null).length;
const unregistered = DB.length - registered;
check('106 registered / 49 not', registered === 106 && unregistered === 49, registered + '/' + unregistered);
const obsolete = DB.filter((r) => /OBSOLETED in favor of text\/javascript/.test(fx.entries[r[0]] || '')).map((r) => r[0]).sort();
check('application/javascript and application/ecmascript are obsoleted', JSON.stringify(obsolete) === '["application/ecmascript","application/javascript"]', obsolete.join(','));
const extOf = (e) => (EXT_INDEX[e] || []).map((r) => r[0]).join(', ');
check('.js maps to both types', extOf('js') === 'application/javascript, text/javascript', extOf('js'));
check('.ts maps to video/mp2t and TypeScript', extOf('ts') === 'video/mp2t, text/x-typescript', extOf('ts'));
check('.xml maps to two types', extOf('xml') === 'application/xml, text/xml', extOf('xml'));
check('.ico maps to two types', extOf('ico') === 'image/x-icon, image/vnd.microsoft.icon', extOf('ico'));

// ── 2. the en guide ──
const guide = readFileSync(join(root, 'src/content/blog/mime-type-lookup-guide/en.mdx'), 'utf8');
{
  const fm = guide.match(/^---\n([\s\S]*?)\n---/)[1];
  check('en guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
  const tpl = [/^## What (is|are) /m, /^## .*Online/m, /^## .* in Code/m, /^## (Summary|Conclusion)/m].filter((re) => re.test(guide));
  check('en guide has no template headings', tpl.length === 0, tpl.map(String).join(' '));
  check('en guide quotes 155 entries and 37 signatures', guide.includes('155 entries') && guide.includes('37 signatures'));
  check('en guide quotes the registered split', guide.includes(`${registered} of them are registered and ${unregistered} are not`));
  // registry counts table
  for (const [type, n] of Object.entries(fx.counts)) {
    const row = guide.match(new RegExp('^\\| `' + type + '` \\| ([0-9,]+) \\|', 'm'));
    check('registry row ' + type, row && Number(row[1].replace(/,/g, '')) === n, row && row[1]);
  }
  check('eleven top-level types', Object.keys(fx.counts).length === 11 && guide.includes('eleven top-level types'));
  // every type the guide lists as unregistered is unregistered, and the registered alternatives are registered
  for (const m of ['video/webm', 'audio/webm', 'audio/wav', 'audio/x-wav', 'image/x-icon', 'text/yaml', 'application/x-7z-compressed', 'video/x-matroska']) {
    check(m + ' is unregistered', fx.entries[m] === null, fx.entries[m]);
  }
  for (const m of ['image/vnd.microsoft.icon', 'application/yaml']) check(m + ' is registered', !!fx.entries[m]);

  // sniff table
  const start = guide.indexOf('{/* mime-sniff */}');
  check('en guide has mime-sniff', start >= 0);
  const rows = guide.slice(start).split('\n').filter((l) => l.startsWith('| `')).slice(0, 11);
  check('sniff table has 11 rows', rows.length === 11, rows.length);
  for (const row of rows) {
    const cells = row.split('|').slice(1, -1).map((c) => c.trim());
    const name = cells[0].match(/`([^`]+)`/)[1];
    const hex = cells[1].match(/`([0-9A-F ]+)`/)[1].trim().split(/\s+/).map((h) => parseInt(h, 16));
    const bytes = new Uint8Array(64); bytes.set(hex);
    // the remaining bytes of these short headers do not change the match; trailing zeros stand in for them
    const tool = cells[2].match(/`([^`]+)`/)[1];
    const chromeType = (cells[3].match(/^`([^`]+)`$/) || [])[1] || '';
    const r = sniff(bytes.subarray(0, Math.max(hex.length, 16)), chromeType);
    check('sniff ' + name + ' → ' + tool, r.mime === tool, r.mime);
    check('sniff ' + name + ' container note', r.container === /ZIP container note/.test(cells[2]));
    check('sniff ' + name + ' no-signature note', !r.matched === /no signature/.test(cells[2]));
  }
  // the PNG renamed .jpg uses the full 8-byte PNG signature; a real JPEG header is not mistaken for it
  check('JPEG bytes are image/jpeg', sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])).mime === 'image/jpeg');
  check('tar magic at 257 is outside 64 bytes', !SIGNATURES.some((s) => s.mime === 'application/x-tar'));
}

// ── 3. the mime-run module ──
{
  const run = guide.match(/\{\/\* mime-run \*\/\}\s*```js\n([\s\S]*?)```/);
  check('en guide has mime-run', !!run);
  if (run) {
    const dir = mkdtempSync(join(tmpdir(), 'mime-guide-'));
    try {
      writeFileSync(join(dir, 'check-upload.mjs'), run[1]);
      const { checkUpload } = await import(join(dir, 'check-upload.mjs'));
      const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(100)]);
      const jpg = Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), Buffer.alloc(100)]);
      const pdf = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1');
      const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(40)]);
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      const tiny = Buffer.from([0xff, 0xd8]);
      const files = { png, jpg, pdf, webp, svg, tiny };
      for (const [k, v] of Object.entries(files)) writeFileSync(join(dir, k), v);
      const cases = [
        ['png', 'cat.png', { ok: true, mime: 'image/png' }],
        ['png', 'photo.jpg', { ok: false, reason: 'content is image/png but the name ends in ".jpg"' }],
        ['jpg', 'IMG_0001.JPEG', { ok: true, mime: 'image/jpeg' }],
        ['pdf', 'invoice.pdf', { ok: true, mime: 'application/pdf' }],
        ['webp', 'hero.webp', { ok: true, mime: 'image/webp' }],
        ['webp', 'hero', { ok: false, reason: 'content is image/webp but the name ends in ""' }],
        ['svg', 'logo.svg', { ok: false, reason: 'file type not allowed' }],
        ['tiny', 'cut.jpg', { ok: false, reason: 'file type not allowed' }],
      ];
      for (const [f, name, want] of cases) {
        const got = await checkUpload(join(dir, f), name);
        check('checkUpload(' + f + ', ' + name + ')', JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
}

// ── 4. other language guides and tool pages keep the right counts ──
for (const lang of ['zh', 'ja', 'ko']) {
  const g = readFileSync(join(root, 'src/content/blog/mime-type-lookup-guide', lang + '.mdx'), 'utf8');
  check(lang + ' guide quotes 155 and 37', g.includes('155') && g.includes('37'));
  check(lang + ' guide does not say ~240 / ~30', !/240|約\s*30|约\s*30|약\s*30/.test(g));
  check(lang + ' guide does not say file-type reads like the browser tool', !/浏览器端工具一致|ツールと同じ要領|도구와 동일한 방식/.test(g));
}
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const p = readFileSync(join(root, 'src/content/tools/mime-type-lookup', lang + '.mdx'), 'utf8');
  check(lang + ' tool page does not say ~240 entries', !/240/.test(p));
  check(lang + ' tool page FAQ gives the registered split', p.includes(String(registered)) && p.includes(String(unregistered)) && !/snapshot of the IANA|精选快照|選定スナップショット|큐레이션 스냅샷/.test(p));
}

const frontmatter=src.match(/^---\n([\s\S]*?)\n---/)[1];
const LOCALES=vm.runInNewContext(frontmatter.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/)[1]+';STRINGS');
const markupTemplate=src.replace(/^---[\s\S]*?---\s*/,'').split('<script')[0];
const tipBindings=[...markupTemplate.matchAll(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g)];
const escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function renderMarkup(lang){
  const T=LOCALES[lang],about=JSON.parse(readFileSync(join(root,'src/i18n/'+lang+'.json'),'utf8'))['tool.tipAbout'];
  return markupTemplate.replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g,(_,id,key,tip)=>'<span class="zt-tip"><button type="button" data-zt-tip="'+id+'" aria-label="'+escape(about.replace('{name}',T[key]))+'">?</button><span id="'+id+'" popover="auto">'+escape(T.tips[tip])+'</span></span>')
    .replace(/=\{T\.(\w+)\}/g,(_,key)=>'="'+escape(T[key])+'"').replace(/\{T\.(\w+)\}/g,(_,key)=>escape(T[key]));
}

// Complete page lifecycle: actual IIFE, real shared shortcut, real File/Blob bytes.
// parse5 models generated DOM. Clipboard promises, FileReader delivery and timers are controlled;
// this does not claim browser layout, native picker or MutationObserver coverage.
const layout=readFileSync(join(root,'src/layouts/ToolLayout.astro'),'utf8');
const shortcut=layout.slice(layout.indexOf('// ── Keyboard shortcuts:'),layout.indexOf('// ── Copy button visual feedback'));
if(!shortcut.includes("widget.querySelectorAll('textarea"))throw Error('Shared shortcut missing');
const must=(value,message)=>{if(!value)throw Error(message);};
function eq(name,actual,expected){check(name,JSON.stringify(actual)===JSON.stringify(expected),'got '+JSON.stringify(actual)+', expected '+JSON.stringify(expected));}
const settle=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const unhandled=[];process.on('unhandledRejection',error=>unhandled.push(String(error)));
function page(lang='en',order='shared-after',clipboardMode='normal',savedMode=null){
  const key='mime',slugs={mime:'mime-type-lookup'},paths={mime:'src/components/tools/MimeTypeLookupTool.astro'};
  const clipboard=[],timers=new Map(),readers=[],persistCalls=[],execCalls=[];
  let timerId=0,clock=0,doc;
  const descendants = el => el.children.flatMap(child => [child, ...descendants(child)]);
  const matchOne = (el, selector) => {
    if (el.tagName.startsWith('#')) return false;
    const parts = selector.trim().split(/\s+(?![^\[]*\])/);
    if (parts.length > 1) {
      if (!matchOne(el, parts.pop())) return false;
      for (let parent = el.parentNode; parent; parent = parent.parentNode) if (matchOne(parent, parts.join(' '))) return true;
      return false;
    }
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    const plain = selector.replace(/\[[^\]]+\]/g, '');
    const tag = /^[a-z][\w-]*/i.exec(plain)?.[0], id = /#([\w-]+)/.exec(plain)?.[1];
    return (!tag || el.tagName === tag.toUpperCase()) && (!id || el.id === id)
      && [...plain.matchAll(/\.([\w-]+)/g)].every(m => el.classList.contains(m[1]))
      && attrs.every(m => m[2] === undefined ? el.getAttribute(m[1]) !== null : el.getAttribute(m[1]) === m[2]);
  };
  const matches = (el, selector) => selector.split(',').some(part => matchOne(el, part.trim()));
  class EventStub {
    constructor(type, extra = {}) { Object.assign(this, { type, bubbles: false, defaultPrevented: false }, extra); }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.stopped = true; }
  }
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, listeners: {}, id: '', className: '', type: tag === 'input' ? 'text' : '', style: {}, text: '', _value: '', dirtyValue: false, disabled: false, hidden: false }); }
    get value() {
      if (!this.dirtyValue && this.tagName === 'TEXTAREA') return this.textContent;
      if (!this.dirtyValue && this.tagName === 'SELECT') return this.querySelector('option')?.value ?? '';
      return this._value;
    }
    set value(v) { this._value = String(v); this.dirtyValue = true;if(this.type==='file'&&this._value==='')this.files=[]; }
    get firstChild() { return this.children[0]??null; }
    get dataset() { const el=this;return new Proxy({}, {get(_,key){return el.getAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()));},set(_,key,value){el.setAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()),value);return true;}}); }
    get parentElement() { return this.parentNode; }
    get isConnected() { return doc.contains(this); }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) el.className = (el.className + ' ' + c).trim(); }, remove(c) { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); }, toggle(c,force) { const yes=force??!this.contains(c);yes?this.add(c):this.remove(c);return yes; } }; }
    setAttribute(k, v) { this.attributes[k] = String(v); if (['id', 'class', 'type', 'value'].includes(k)) this[k === 'class' ? 'className' : k] = String(v); if (['hidden', 'disabled', 'checked'].includes(k)) this[k] = true; }
    getAttribute(k) { if (['id', 'class', 'type'].includes(k)) return this[k === 'class' ? 'className' : k] || null; return this.attributes[k] ?? null; }
    removeAttribute(k) { delete this.attributes[k]; if (['hidden','disabled','checked'].includes(k)) this[k]=false; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(v) { if(doc?.activeElement&&doc.activeElement!==this&&this.contains(doc.activeElement))doc.activeElement=doc.body; for (const child of this.children) child.parentNode = null; this.children = []; this.text = String(v); }
    set innerHTML(v) {
      this.textContent = '';
      // parse5 supplies the real HTML tokenizer/entity table in the actual element context.
      // In particular, textarea uses RCDATA. No homemade entity decoder is used.
      const context = defaultTreeAdapter.createElement(this.tagName.toLowerCase(), 'http://www.w3.org/1999/xhtml', []);
      for (const node of parseFragment(context, String(v)).childNodes) this.appendChild(fromParse5(node));
    }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    removeChild(child) { const i=this.children.indexOf(child);if(i>=0)this.children.splice(i,1);child.parentNode=null;return child; }
    querySelectorAll(selector) { return descendants(this).filter(el => matches(el, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    contains(el) { return el === this || descendants(this).includes(el); }
    closest(selector) { for (let el = this; el; el = el.parentNode) if (matches(el, selector)) return el; return null; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    dispatchEvent(event) {
      event.target = this;
      for (let el = this; el; el = el.parentNode) {
        event.currentTarget = el;
        for (const fn of el.listeners[event.type] || []) fn.call(el, event);
        if (!event.bubbles || event.stopped) break;
      }
      return !event.defaultPrevented;
    }
    dispatch(type, extra = {}) { return this.dispatchEvent(new EventStub(type, { bubbles: true, ...extra })); }
    click() { if(!this.disabled)this.dispatch('click'); }
    select() { doc.selectedElement=this; }
    focus() { doc.activeElement = this; }
    setSelectionRange(start,end) { this.selectionStart=start;this.selectionEnd=end; }
  }
  function fromParse5(node) {
    const el = new Element(node.tagName || node.nodeName);
    if (node.nodeName === '#text') el.text = node.value;
    for (const attr of node.attrs || []) el.setAttribute(attr.name, attr.value);
    for (const child of node.childNodes || []) if (child.nodeName !== '#comment') el.appendChild(fromParse5(child));
    return el;
  }

  doc=new Element('#document');doc.documentElement=new Element('html');doc.documentElement.lang=lang;doc.appendChild(doc.documentElement);
  doc.body=new Element('body');doc.documentElement.appendChild(doc.body);
  const widget=new Element('section');widget.className='tool-widget';doc.body.appendChild(widget);
  widget.innerHTML=renderMarkup(lang);
  doc.getElementById=id=>descendants(doc).find(el=>el.id===id)??null;
  doc.createElement=tag=>new Element(tag);doc.activeElement=doc.body;
  doc.execCommand=command=>{execCalls.push(command);throw Error('Native clipboard prohibited');};
  const persist={clear(slug){persistCalls.push(['clear',slug]);},save(...args){persistCalls.push(['save',...args]);},load(){return savedMode?{mode:savedMode}:null;}};
  class Reader {
    constructor(){this.result=null;this.error=null;readers.push(this);}
    readAsArrayBuffer(blob){this.blob=blob;}
    async finish(){this.result=await this.blob.arrayBuffer();if(this.onload)this.onload({target:this});}
    fail(message='controlled read failure'){this.error=new Error(message);if(this.onerror)this.onerror({target:this});}
    abort(){this.aborted=true;}
  }
  const globals={document:doc,File,FileReader:Reader,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,Blob,
    _slug:slugs[key],ztPersist:persist,trackTool(){},t:Object.fromEntries(Object.entries(LOCALES[lang]).filter(([key])=>key!=='tips')),
    navigator:clipboardMode==='absent'?{}:{clipboard:{writeText(value){if(clipboardMode==='throw')throw Error('Controlled clipboard throw');const d=deferred();clipboard.push({...d,value:String(value)});return d.promise;},write(){throw Error('Unexpected clipboard.write');}}},
    setTimeout(fn,ms){timers.set(++timerId,{fn,ms,due:clock+ms});return timerId;},clearTimeout(id){timers.delete(id);},
  };
  if(order==='shared-before')vm.runInNewContext(shortcut,{document:doc,window:{ztPersist:persist},_slug:slugs[key]},{filename:'ToolLayout.astro:actual-shortcut'});
  const actual=loadPage(paths[key],{lang,globals});
  if(order==='shared-after')actual.run(shortcut);
  const get=id=>{const el=doc.getElementById(id);must(el,key+' ID '+id);return el;};
  return{doc,get,widget,clipboard,readers,timers,persistCalls,execCalls,
    input(id,value){get(id).value=value;get(id).dispatch('input');},
    ctrlL(el=get('mtl-search'),key='l',mod='ctrlKey'){el.focus();const e=new EventStub('keydown',{bubbles:true,key,[mod]:true});el.dispatchEvent(e);return e;},
    choose(files){get('mtl-file').value=files.length?'fakepath/'+files[0].name:'';get('mtl-file').files=files;get('mtl-file').dispatch('change');},
    drop(files){get('mtl-drop').dispatch('drop',{dataTransfer:{files}});},
    tick(ms){clock+=ms;for(;;){const ready=[...timers].filter(([,t])=>t.due<=clock).sort((a,b)=>a[1].due-b[1].due)[0];if(!ready)break;timers.delete(ready[0]);ready[1].fn();}},
  };
}
const PNG=new File([Uint8Array.from([137,80,78,71,13,10,26,10]),new Uint8Array(72)],'old.png',{type:'image/png'});
const JPEG=new File([Uint8Array.from([255,216,255,224]),new Uint8Array(72)],'new.jpg',{type:'image/jpeg'});
const INVALID=new File([],'empty',{type:''});
const COPY={en:'Copy',zh:'复制',ja:'コピー',ko:'복사'},COPIED={en:'Copied',zh:'已复制',ja:'コピー済み',ko:'복사됨'};
const FAILED={en:'Copy failed. Please try again.',zh:'复制失败，请重试。',ja:'コピーに失敗しました。再試行してください。',ko:'복사에 실패했습니다. 다시 시도해 주세요.'};
const snap=p=>({search:p.get('mtl-search').value,catalog:p.get('mtl-results').textContent,status:p.get('mtl-sniff-status').textContent,statusClass:p.get('mtl-sniff-status').className,file:p.get('mtl-file').value,hidden:p.get('mtl-sniff-result').hidden,fields:['mime','ext','bytes','browser','note'].map(k=>p.get('mtl-sniff-'+k).textContent),noteHidden:p.get('mtl-sniff-note-row').hidden,copies:p.get('mtl-sniff-result').querySelectorAll('.mtl-copy').map(b=>b.textContent)});
const sniffButton=p=>p.doc.querySelector('.mtl-copy[data-target="mtl-sniff-mime"]');
async function prepared(lang,order,mode='sniff',api='normal'){
  const p=page(lang,order,api);if(mode==='search')p.input('mtl-search','.png');else{p.get('mtl-tab-sniff').click();p.choose([PNG]);await p.readers.at(-1).finish();}return p;
}
const button=(p,mode)=>mode==='search'?p.get('mtl-results').querySelector('.mtl-copy'):sniffButton(p);
const pagePass=passes,pageFail=failures;
for(const lang of ['en','zh','ja','ko'])for(const order of ['shared-before','shared-after']){
  const name=lang+'/'+order;let p=page(lang,order);
  eq(name+' initial complete catalog',p.get('mtl-results').querySelectorAll('.mtl-card').length,155);
  eq(name+' no invented Clear button',p.doc.querySelectorAll('#mtl-clear').length,0);
  p.input('mtl-search','.png');eq(name+' extension search',p.get('mtl-results').querySelector('.mtl-mime').textContent,'image/png');
  p.doc.querySelector('.mtl-chip[data-group="text"]').click();eq(name+' group narrows current search',p.get('mtl-results').querySelectorAll('.mtl-card').length,0);
  p.input('mtl-search','');check(name+' group remains when search emptied',p.get('mtl-results').querySelectorAll('.mtl-mime').every(el=>el.textContent.startsWith('text/')));
  p=await prepared(lang,order);eq(name+' real File.slice reads64bytes',p.readers[0].blob.size,64);
  eq(name+' real PNG sniff and16hex',[p.get('mtl-sniff-mime').textContent,p.get('mtl-sniff-ext').textContent,p.get('mtl-sniff-bytes').textContent],['image/png','.png','89 50 4E 47 0D 0A 1A 0A 00 00 00 00 00 00 00 00']);
  for(const b of p.get('mtl-sniff-result').querySelectorAll('.mtl-copy')){
    b.click();eq(name+' sniff full copy '+b.getAttribute('data-target'),p.clipboard.at(-1).value,p.get(b.getAttribute('data-target')).textContent);p.clipboard.at(-1).resolve();await settle();p.tick(1100);eq(name+' sniff normal label restored',b.textContent,COPY[lang]);
  }
  for(const [key,mod,focus] of [['l','ctrlKey','search'],['L','metaKey','copy']]){
    p=await prepared(lang,order);p.input('mtl-search','.png');const savedCalls=p.persistCalls.filter(x=>x[0]==='save').length;
    const e=p.ctrlL(focus==='copy'?sniffButton(p):p.get('mtl-search'),key,mod);
    eq(name+' shortcut clears all sniff fields',[p.get('mtl-search').value,p.get('mtl-file').value,p.get('mtl-file').files?.length,p.get('mtl-sniff-status').textContent,p.get('mtl-sniff-result').hidden,...snap(p).fields],['','',0,'',true,'','','','','']);
    eq(name+' shortcut recomputes empty search catalog',p.get('mtl-results').querySelectorAll('.mtl-card').length,155);
    check(name+' shortcut default prevented',e.defaultPrevented);eq(name+' actual shared clear called',p.persistCalls.filter(x=>x[0]==='clear'),[['clear','mime-type-lookup']]);
    eq(name+' shortcut preserves active mode',p.get('mtl-panel-search').hidden,true);eq(name+' shortcut does not write new preference',p.persistCalls.filter(x=>x[0]==='save').length,savedCalls);
  }
  p=await prepared(lang,order);const untouched=snap(p);const out=p.ctrlL(p.doc.body);eq(name+' outside shortcut no effect',snap(p),untouched);check(name+' outside default remains',!out.defaultPrevented);
  p=page(lang,order,'normal','sniff');eq(name+' restores actual mode preference',[p.get('mtl-panel-search').hidden,p.get('mtl-panel-sniff').hidden],[true,false]);
  for(const kind of ['new-valid','multiple','empty-file','no-selection','read-error','shortcut'])for(const late of ['load','error']){
    p=page(lang,order);p.get('mtl-tab-sniff').click();p.choose([PNG]);const old=p.readers[0];
    if(kind==='new-valid'||kind==='read-error'){p.choose([JPEG]);if(kind==='new-valid')await p.readers[1].finish();else p.readers[1].fail();}
    else if(kind==='multiple')p.drop([PNG,JPEG]);else if(kind==='empty-file')p.choose([INVALID]);else if(kind==='no-selection')p.choose([]);else p.ctrlL(p.get('mtl-file'));
    const current=snap(p);if(late==='load')await old.finish();else old.fail('late read error');eq(name+' old file '+late+' after '+kind,snap(p),current);
    if(kind==='new-valid')eq(name+' newest JPEG retained',p.get('mtl-sniff-mime').textContent,'image/jpeg');else check(name+' '+kind+' has no old sniff result',p.get('mtl-sniff-result').hidden);
  }
  p=await prepared(lang,order);p.choose([JPEG]);check(name+' new pending file immediately hides old result',p.get('mtl-sniff-result').hidden);p.readers.at(-1).fail();eq(name+' current error clears old fields',snap(p).fields,['','','','','']);check(name+' current read error visible',p.get('mtl-sniff-status').className.includes('error'));p.choose([PNG]);await p.readers.at(-1).finish();eq(name+' new read recovers',p.get('mtl-sniff-mime').textContent,'image/png');
  for(const mode of ['search','sniff']){
    for(const api of ['normal','absent','throw']){
      p=await prepared(lang,order,mode,api);const b=button(p,mode);let error=null;try{b.click();if(api==='normal')p.clipboard.at(-1).reject(Error('denied'));}catch(e){error=e.message;}await settle();eq(name+'/'+mode+'/'+api+' handled current failure',error,null);eq(name+'/'+mode+'/'+api+' visible error',b.textContent,FAILED[lang]);
      if(api==='normal'){b.click();p.clipboard.at(-1).resolve();await settle();eq(name+'/'+mode+' retry succeeds',b.textContent,COPIED[lang]);p.tick(1100);eq(name+'/'+mode+' retry returns Copy',b.textContent,COPY[lang]);}
    }
    for(const outcome of ['resolve','reject'])for(const action of ['shortcut',mode==='search'?'new-search':'new-file']){
      p=await prepared(lang,order,mode);button(p,mode).click();const job=p.clipboard.at(-1);
      if(action==='shortcut')p.ctrlL(button(p,mode));else if(action==='new-search')p.input('mtl-search','.pdf');else{p.choose([JPEG]);await p.readers.at(-1).finish();}
      const current=snap(p);job[outcome](outcome==='reject'?Error('late'):undefined);await settle();p.tick(2000);eq(name+'/'+mode+' late '+outcome+' after '+action,snap(p),current);
    }
    for(const outcome of ['resolve','reject']){
      p=await prepared(lang,order,mode);const b=button(p,mode);b.click();const old=p.clipboard.at(-1);b.click();p.clipboard.at(-1).resolve();await settle();const current=snap(p);old[outcome](outcome==='reject'?Error('late same'):undefined);await settle();eq(name+'/'+mode+' same-value old '+outcome,snap(p),current);p.tick(1100);eq(name+'/'+mode+' same-value settles fixed label',b.textContent,COPY[lang]);
    }
    p=await prepared(lang,order,mode);const b=button(p,mode);b.click();p.clipboard.at(-1).resolve();await settle();const oldTimers=[...p.timers.values()].filter(x=>x.ms===1100);check(name+'/'+mode+' captures real feedback timer',oldTimers.length>0);p.tick(100);b.click();p.clipboard.at(-1).resolve();await settle();const current=snap(p);p.tick(1000);oldTimers.forEach(x=>x.fn());eq(name+'/'+mode+' old timer preserves new success',snap(p),current);p.tick(100);eq(name+'/'+mode+' new timer restores original',b.textContent,COPY[lang]);
    check(name+'/'+mode+' never native clipboard',p.execCalls.length===0);
  }
}
await settle();eq('no unhandled clipboard rejection',unhandled,[]);
console.log(`page lifecycle: ${passes-pagePass} passed, ${failures-pageFail} failed`);
// The database/signatures and unmarked search/sniff algorithms are immutable.
for(const [name,begin,end,expected] of [
  ['database/signatures','      var DB = [','      // ── Search panel','7658506ed21f0eb823a8d410e85ce87e9100bcd0ced0f7ad66c7a4ca88a5b36b'],
  ['hex/extension helpers','      function bytesToHex','      function sniff(file)','562f88108dd27e810e00baf0460ffcfdbb0162e86a3af6a6dad31fd7bcf93b69'],
  ['real sniff detection/body','          var bytes = new Uint8Array(reader.result);','        reader.onerror =','fe6209537a8c72b3007de0f2bc68ad4953805962bf3f9249d9225f9e7d204992'],
  ['real search filter/render','        var q = (searchInput.value','      searchInput.addEventListener','e40c6c46d800264939dc2fef2e4c4cee2df02a35c2e1fdeeaba474bd5f58b1d8'],
])eq(name+' byte protection',createHash('sha256').update(src.slice(src.indexOf(begin),src.indexOf(end))).digest('hex'),expected);

// v2 page layout — compiled CSS, real SSR text and page controls; browser geometry is separate.
const v2Pass=passes,v2Fail=failures;
const frozen={
  "contentHashes": {
    "en": "9a0a06ee58a556a8fb61f9b78b13ba79105d2d3d221894eeb59f5f2ba8f55cea",
    "zh": "1480858fbb95e362639978fe04beae693a58e4268b7e7e7112fd85923677afe4",
    "ja": "f7efb11a423a250867aec6e95db057ab42bd1c235c2f14c7030a887f92e93da7",
    "ko": "cafea9ac7aa244a2f02b03971ee1fc4ace070a0d4e5d4876193cbdfabe328574"
  },
  "scriptHash": "e41610c910b4d235cbb3b5bd343c3d665f8906860fd889d2531c40a0d9dfb97a",
  "oldKeys": [
    "tabSearch",
    "tabSniff",
    "searchPh",
    "empty",
    "all",
    "application",
    "image",
    "audio",
    "video",
    "text",
    "font",
    "multipart",
    "message",
    "model",
    "extensions",
    "group",
    "copy",
    "copied",
    "copyFailed",
    "dropTitle",
    "dropHint",
    "detectedMime",
    "likelyExt",
    "magicBytes",
    "browserType",
    "note",
    "noMatchSig",
    "containerNote",
    "folderError",
    "unsupported",
    "none"
  ],
  "oldStringHashes": {
    "en": "bdf05f256f3b4b037cb264ed5f808ea19ac90f7c8d5216ffb98e25187957151c",
    "zh": "35afae64d25ddf4e19b0e0682a5eea90273e0d8a6412c56d6477a8f53335dd77",
    "ja": "4af7ff135a6385b9cfc7cc2b95c7c4a776250b8a6a111d14ec51996a2f0450db",
    "ko": "980122e0e8328ed4440990f3c3047a0d76a0b4f75104dc118d73698f6f03230f"
  }
};
const hash=value=>createHash('sha256').update(value).digest('hex');
const require=createRequire(join(root,'package.json'));
const astroRequire=createRequire(require.resolve('astro/package.json'));
const compiled=await astroRequire('@astrojs/compiler').transform(src,{filename:join(root,'src/components/tools/MimeTypeLookupTool.astro')});
check('v2 Astro compiles',!compiled.diagnostics.some(d=>d.severity===1));
let compileError='';try{await require('esbuild').transform(compiled.code,{loader:'ts',format:'esm'});}catch(e){compileError=String(e);}
eq('v2 compiled module parses',compileError,'');
const css=compiled.css.join('\n'),pageScript=src.match(/<script is:inline[^>]*>([\s\S]*?)<\/script>/)[1];
const {compile:compileMdx}=await import('@mdx-js/mdx');
check('v2 direct flex root bounded panels',/^<div class="mtl-wrap">/.test(markupTemplate)&&/\.mtl-wrap\s*\{[^}]*display:\s*flex[^}]*min-height:\s*0/.test(css)&&/\.mtl-panel\s*\{[^}]*flex:\s*1 1 0[^}]*min-height:\s*0/.test(css));
check('v2 no runtime i18n',!/data-i18n|document\.documentElement\.lang/.test(src));
check('v2 tips excluded client',/define:vars=\{\{ t: CLIENT_T \}\}/.test(src)&&!/STRINGS|TIPS|tips/.test(pageScript));
check('v2 shared segmented and empty drop',markupTemplate.includes('mtl-tabs zt-segmented')&&markupTemplate.includes('mtl-drop zt-empty-drop'));
check('v2 status fixed not content sized',/\.mtl-search-status,\s*#mtl-sniff-status\s*\{[^}]*flex:\s*none[^}]*height:\s*2.8em[^}]*overflow:\s*auto/.test(css));
check('v2 search and sniff results internally scroll',/\.mtl-results\s*\{[^}]*flex:\s*1 1 0[^}]*min-height:\s*0[^}]*overflow:\s*auto/.test(css)&&/\.mtl-sniff-result\s*\{[^}]*flex:\s*1 1 0[^}]*min-height:\s*0[^}]*overflow:\s*auto/.test(css));
check('v2 desktop empty drop fills available height',/#mtl-panel-sniff:has\(#mtl-sniff-result\[hidden\]\) \.mtl-drop\s*\{\s*flex:\s*1 1 0/.test(css));
check('v2 hidden panels and empty sniff stay hidden',/\.mtl-panel\[hidden\]\s*\{\s*display:\s*none/.test(css)&&/\.mtl-sniff-result\[hidden\],\s*\.mtl-note-row\[hidden\]\s*\{\s*display:\s*none/.test(css));
check('v2 stacked breakpoint bounds results',/@media\s*\(max-width:\s*860px\)/.test(css)&&/\.mtl-results,\s*\.mtl-sniff-result\s*\{\s*flex:\s*none;\s*height:\s*27rem/.test(css));
check('v2 mobile no-match result and heading hidden',/#mtl-results:empty,\s*#mtl-panel-search:has\(#mtl-results:empty\) \.mtl-output-head\s*\{\s*display:\s*none/.test(css));
check('v2 phone result size and chip rail',/@media\s*\(max-width:\s*640px\)/.test(css)&&/\.mtl-results,\s*\.mtl-sniff-result\s*\{\s*height:\s*24rem/.test(css)&&/\.mtl-chips\s*\{\s*overflow-x:\s*auto;\s*flex-wrap:\s*nowrap/.test(css));
check('v2 buttons44 and copy failures bounded',/\.mtl-tab,\s*\.mtl-chip\s*\{\s*min-height:\s*44px/.test(css)&&/\.mtl-copy\s*\{[^}]*max-width:\s*42%[^}]*min-height:\s*44px[^}]*white-space:\s*normal/.test(css));
check('v2 both segmented active states contrast in themes',/\.mtl-tab\.is-active\s*\{[^}]*background:\s*var\(--color-text\)[^}]*color:\s*var\(--color-bg\)/.test(css)&&/\.mtl-chip\.is-active\s*\{[^}]*background:\s*var\(--color-text\)[^}]*color:\s*var\(--color-bg\)/.test(css));
eq('v2 seven actual tips',tipBindings.map(m=>m[1]),['mtl-tip-search','mtl-tip-group','mtl-tip-copy','mtl-tip-file','mtl-tip-detected','mtl-tip-bytes','mtl-tip-browser']);
const placeholders=value=>(String(value).match(/\{\w+\}/g)||[]).sort();
for(const lang of ['en','zh','ja','ko']){
  const T=LOCALES[lang],{tips,...client}=T,p=page(lang),about=JSON.parse(readFileSync(join(root,'src/i18n/'+lang+'.json'),'utf8'))['tool.tipAbout'];
  eq('v2 '+lang+' same locale keys',Object.keys(T).sort(),Object.keys(LOCALES.en).sort());
  eq('v2 '+lang+' prior strings exact',hash(JSON.stringify(Object.fromEntries(frozen.oldKeys.map(k=>[k,T[k]])))),frozen.oldStringHashes[lang]);
  eq('v2 '+lang+' same tip keys',Object.keys(tips),Object.keys(LOCALES.en.tips));
  for(const key of Object.keys(tips)){
    check('v2 '+lang+' plain nonempty tip '+key,typeof tips[key]==='string'&&tips[key].trim()&&!/[<>\n]|https?:/.test(tips[key]));
    eq('v2 '+lang+' tip placeholder '+key,placeholders(tips[key]),placeholders(LOCALES.en.tips[key]));
  }
  check('v2 '+lang+' no serialized tips',!('tips' in client)&&Object.values(tips).every(text=>!JSON.stringify(client).includes(text)));
  eq('v2 '+lang+' SSR tab labels',[p.get('mtl-tab-search').textContent,p.get('mtl-tab-sniff').textContent],[T.tabSearch,T.tabSniff]);
  eq('v2 '+lang+' SSR search label/placeholder',[p.doc.querySelector('label[for="mtl-search"]').textContent,p.get('mtl-search').getAttribute('placeholder')],[T.searchLabel,T.searchPh]);
  eq('v2 '+lang+' visible local64bytes privacy',p.doc.querySelector('.mtl-drop-body span').textContent,T.dropHint);
  for(const [,id,aboutKey,key] of tipBindings){eq('v2 '+lang+' tip body '+key,p.get(id).textContent,tips[key]);eq('v2 '+lang+' tip about '+key,p.doc.querySelector('[data-zt-tip="'+id+'"]').getAttribute('aria-label'),about.replace('{name}',T[aboutKey]));}
  for(const [id,label] of [['mtl-results',T.resultsLabel],['mtl-sniff-result',T.tabSniff]])eq('v2 '+lang+' keyboard result '+id,[p.get(id).getAttribute('tabindex'),p.get(id).getAttribute('role'),p.get(id).getAttribute('aria-label')],['0','region',label]);
  p.input('mtl-search','no-match-xyz');
  eq('v2 '+lang+' real no-match empty DOM and visible notice',[p.get('mtl-results').children.length,p.get('mtl-results').textContent,p.get('mtl-empty').style.display,p.get('mtl-empty').textContent],[0,'','',T.empty]);
  eq('v2 '+lang+' all10 real group controls',p.get('mtl-chips').querySelectorAll('.mtl-chip').length,10);
  eq('v2 '+lang+' three sniff copy controls',p.get('mtl-sniff-result').querySelectorAll('.mtl-copy').map(x=>x.getAttribute('data-target')),['mtl-sniff-mime','mtl-sniff-ext','mtl-sniff-bytes']);
  for(const order of ['shared-before','shared-after']){
    const q=await prepared(lang,order);const e=q.ctrlL(q.doc.querySelector('[data-zt-tip="mtl-tip-detected"]'));
    eq('v2 '+lang+'/'+order+' result tip CtrlL focus/results',[q.doc.activeElement.id,q.get('mtl-sniff-result').hidden,q.get('mtl-sniff-status').textContent],['mtl-tab-sniff',true,'']);
    check('v2 '+lang+'/'+order+' result tip CtrlL prevents',e.defaultPrevented);
    eq('v2 '+lang+'/'+order+' real shared clear',q.persistCalls.filter(x=>x[0]==='clear'),[['clear','mime-type-lookup']]);
  }
  const content=readFileSync(join(root,'src/content/tools/mime-type-lookup/'+lang+'.mdx'),'utf8'),meta=yaml.load(content.match(/^---\n([\s\S]*?)\n---/)[1]);
  eq('v2 '+lang+' four original Usage steps',meta.steps.length,4);
  check('v2 '+lang+' bounded plain steps',meta.steps.every(x=>typeof x==='string'&&x.length<=280&&!/[<>\n]/.test(x))&&meta.steps.join('').length<=1200);
  check('v2 '+lang+' steps before FAQ',content.indexOf('steps:')<content.indexOf('faqItems:'));
  eq('v2 '+lang+' every nonUsage byte retained',hash(content.replace(/^steps:\n(?:  - .*\n)+/m,'')),frozen.contentHashes[lang]);
  let error='';try{await compileMdx(content.replace(/^---[\s\S]*?---\s*/,''));}catch(e){error=String(e);}eq('v2 '+lang+' MDX compiles',error,'');
}
eq('v2 entire client script after old i18n exact',hash(src.slice(src.indexOf('      // Curated MIME database'),src.indexOf('<style is:global>'))),frozen.scriptHash);
check('v2 registry analyze',/'mime-type-lookup':\s*'analyze'/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')));
console.log(`v2 page layout: ${passes-v2Pass} passed, ${failures-v2Fail} failed`);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
