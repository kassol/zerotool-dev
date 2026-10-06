// Favicon Generator — package layout and the examples in the favicon guide
//
// Read:  src/components/tools/FaviconGeneratorTool.astro (extracts the real icoPack(), zipPack(),
//        buildHtmlSnippet() and the manifest object, and the size lists);
//        src/content/blog/favicon-generator-guide/{en,ja}.mdx
// Write: stdout; optional ZT_B13_REPORT JSON. Favicon retains its self-cleaning unzip temp group.
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers:
// - the size lists (9 rendered sizes, 16/32/48 in the ICO) and the 11 file names in the ZIP;
// - icoPack(): header, one 16-byte entry per PNG, offsets, PNG payloads; zipPack(): a valid
//   STORED archive that `unzip -l` lists (skipped when unzip is missing);
// - `fav-ico` annotations: the ICO directory table in the guide (offsets and total size) equals
//   what icoPack() writes for PNGs of the quoted byte sizes;
// - `fav-files` annotations: the file order, and the "N files · X KB" line the tool shows for
//   the quoted byte sizes;
// - buildManifest(): with an app name, the manifest meets each manifest item of Chrome's install
//   criteria (web.dev "What does it take to be installable?": name or short_name, start_url,
//   display in fullscreen / standalone / minimal-ui / window-controls-overlay, a 192px and a
//   512px icon, no prefer_related_applications); every icon is "any" (the package has no
//   safe-zone image, so nothing is declared maskable); an empty name omits the keys instead of
//   writing "", and the page has the field labels and the missing-name warning in 4 languages;
// - the HTML snippet and the site.webmanifest quoted in the guides equal the tool's output with
//   default settings (theme color #ffffff, transparent background) and the name in the
//   `fav-manifest` annotation; the manifest row of the file table is its byte length;
// - the guides are indexable and have no template headings.
//
// Run: node scripts/test-favicon-generator.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const root = process.env.ZT_B13_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(process.env.ZT_B13_SOURCE || join(root, 'src/components/tools/FaviconGeneratorTool.astro'), 'utf8');

let failures = 0;
let passes = 0;
let skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}

// Returns the source of `function name(...) { ... }` by brace matching.
function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing function ' + name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unbalanced ' + name);
}

const TARGET_SIZES = JSON.parse(/var TARGET_SIZES = (\[[^\]]+\])/.exec(source)[1]);
const ICO_SIZES = JSON.parse(/var ICO_SIZES = (\[[^\]]+\])/.exec(source)[1]);
check('rendered sizes', JSON.stringify(TARGET_SIZES) === '[16,32,48,64,96,128,180,192,512]', JSON.stringify(TARGET_SIZES));
check('ICO sizes', JSON.stringify(ICO_SIZES) === '[16,32,48]', JSON.stringify(ICO_SIZES));

const icoPack = new Function(extractFunction('icoPack') + '\nreturn icoPack;')();
const crcBlock = source.slice(source.indexOf('var crcTable'), source.indexOf('function zipPack'));
const zipPack = new Function('TextEncoder', crcBlock + extractFunction('zipPack') + '\nreturn zipPack;')(TextEncoder);
const state = { themeColor: '#ffffff', bgMode: 'transparent', bgColor: '#0ea5e9', appName: '', shortName: '' };
const buildHtmlSnippet = new Function('state', extractFunction('buildHtmlSnippet') + '\nreturn buildHtmlSnippet;')(state);
const buildManifest = new Function(extractFunction('buildManifest') + '\nreturn buildManifest;')();
const manifest = buildManifest(state);

// Chrome's install criteria for the manifest itself (web.dev/articles/install-criteria, 2024-09-19).
function installProblems(m) {
  const out = [];
  if (!m.name && !m.short_name) out.push('name or short_name');
  if (typeof m.start_url !== 'string' || !m.start_url) out.push('start_url');
  if (!['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay'].includes(m.display)) out.push('display');
  const any = (m.icons || []).filter((i) => (i.purpose || 'any').split(/\s+/).includes('any'));
  for (const px of ['192x192', '512x512']) if (!any.some((i) => i.sizes.split(/\s+/).includes(px))) out.push('icon ' + px);
  if (m.prefer_related_applications === true) out.push('prefer_related_applications');
  return out;
}
{
  const named = JSON.parse(buildManifest({ ...state, appName: '  Example Site ', shortName: 'Example' }));
  check('named manifest meets the install criteria', installProblems(named).length === 0, installProblems(named).join(', '));
  check('name is trimmed', named.name === 'Example Site' && named.short_name === 'Example', JSON.stringify([named.name, named.short_name]));
  check('start_url is the site root', named.start_url === '/', named.start_url);
  check('no icon is declared maskable', named.icons.every((i) => i.purpose === 'any'), JSON.stringify(named.icons.map((i) => i.purpose)));
  check('icons point at files in the package', named.icons.every((i) => /^\/android-chrome-(192|512)\.png$/.test(i.src)));
  const nameOnly = JSON.parse(buildManifest({ ...state, appName: 'Example Site', shortName: '' }));
  check('empty short_name is omitted', !('short_name' in nameOnly) && installProblems(nameOnly).length === 0, JSON.stringify(nameOnly));
  const unnamed = JSON.parse(manifest);
  check('empty name: keys omitted, not ""', !('name' in unnamed) && !('short_name' in unnamed), JSON.stringify(unnamed));
  check('empty name: only the name criterion fails', installProblems(unnamed).join() === 'name or short_name', installProblems(unnamed).join());
  check('background color follows the color background', JSON.parse(buildManifest({ ...state, appName: 'x', bgMode: 'color' })).background_color === '#0ea5e9');
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const block = new RegExp('\\n        ' + lang + ': \\{([\\s\\S]*?)\\n        \\}').exec(source);
    for (const key of ['appName', 'shortName', 'nameHint', 'nameMissing', 'maskableNote']) {
      check(lang + ' STRINGS has ' + key, !!block && new RegExp('\\b' + key + ': \'').test(block[1]));
    }
  }
}

// File names in the order runGenerate() pushes them.
const genBody = extractFunction('runGenerate');
const names = [];
for (const m of genBody.matchAll(/files\.push\(\{ name: (.+?), data/g)) {
  if (/\+ sz \+/.test(m[1])) {
    const list = /(\[[\d, ]+\])\.forEach\(function \(sz\) \{\s*files\.push/.exec(genBody)[1];
    for (const sz of JSON.parse(list)) names.push(new Function('sz', 'return ' + m[1])(sz));
  } else names.push(JSON.parse(m[1].replace(/'/g, '"')));
}
check('11 files in the package', names.length === 11, names.join(','));

function fakePng(size, bytes) {
  const b = new Uint8Array(bytes);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b[16] = size; // stand-in IHDR width byte, only used to tell payloads apart
  return b.buffer;
}
function readIco(bytes) {
  const dv = new DataView(bytes.buffer);
  const n = dv.getUint16(4, true);
  const entries = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + 16 * i;
    entries.push({ w: bytes[o] || 256, h: bytes[o + 1] || 256, bpp: dv.getUint16(o + 6, true), size: dv.getUint32(o + 8, true), offset: dv.getUint32(o + 12, true) });
  }
  return { reserved: dv.getUint16(0, true), type: dv.getUint16(2, true), entries };
}
const sample = icoPack({ 48: fakePng(48, 714), 16: fakePng(16, 343), 32: fakePng(32, 539) });
const parsed = readIco(sample);
check('ICO header: reserved 0, type 1, 3 entries', parsed.reserved === 0 && parsed.type === 1 && parsed.entries.length === 3);
check('ICO entries sorted by size', parsed.entries.map((e) => e.w).join() === '16,32,48');
check('ICO payloads are the PNGs', parsed.entries.every((e) => sample[e.offset] === 0x89 && sample[e.offset + 16] === e.w));
check('ICO 256 is written as 0', icoPack({ 256: fakePng(0, 20) })[6] === 0);

// zipPack() output listed by unzip.
let unzipOk = true;
try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { unzipOk = false; }
if (unzipOk) {
  const dir = mkdtempSync(join(tmpdir(), 'fav-'));
  const zip = zipPack([{ name: 'favicon.ico', data: sample }, { name: 'site.webmanifest', data: new TextEncoder().encode(manifest) }]);
  writeFileSync(join(dir, 'p.zip'), zip);
  const listing = execFileSync('unzip', ['-l', join(dir, 'p.zip')]).toString();
  check('unzip lists both entries', /favicon\.ico/.test(listing) && /site\.webmanifest/.test(listing), listing);
  const test = execFileSync('unzip', ['-t', join(dir, 'p.zip')]).toString();
  check('unzip CRC check passes', /No errors detected/.test(test), test);
  rmSync(dir, { recursive: true, force: true });
} else skips += 2;

// Same formula as runGenerate(): files.length + ' files · ' + (bytes / 1024).toFixed(1) + ' KB'
const statsLine = (sizes) => sizes.length + ' files · ' + (sizes.reduce((a, b) => a + b, 0) / 1024).toFixed(1) + ' KB';

for (const lang of ['en', 'ja']) {
  const text = readFileSync(join(root, 'src/content/blog/favicon-generator-guide', lang + '.mdx'), 'utf8');
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)[1];
  check(lang + ': guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
  const h2 = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  check(lang + ': no template headings', !h2.some((h) => /^what (is|are)\b|online|\bin code\b|オンライン/i.test(h)), h2.join(' | '));
  check(lang + ': no summary heading at the end', !/summary|conclusion|まとめ/i.test(h2[h2.length - 1] || ''));

  const htmlBlocks = [...text.matchAll(/```html\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  check(lang + ': quotes the tool HTML snippet', htmlBlocks.includes(buildHtmlSnippet()));
  const fm2 = /\{\/\* fav-manifest: (.+?) \*\/\}\s*```json\n([\s\S]*?)\n```/.exec(text);
  check(lang + ': has a fav-manifest annotation before a json block', !!fm2);
  const guideManifest = fm2 ? buildManifest({ ...state, ...JSON.parse(fm2[1]) }) : '';
  if (fm2) check(lang + ': quotes the tool manifest', fm2[2] === guideManifest, fm2[2]);
  check(lang + ': no json block declares "any maskable"', ![...text.matchAll(/```json\n([\s\S]*?)\n```/g)].some((m) => /"purpose": "any maskable"/.test(m[1])));

  for (const m of text.matchAll(/\{\/\* fav-ico: (.+?) \*\/\}/g)) {
    const spec = JSON.parse(m[1]);
    const pngs = {};
    for (const [sz, bytes] of Object.entries(spec.sizes)) pngs[sz] = fakePng(Number(sz), bytes);
    const ico = icoPack(pngs);
    const dir = readIco(ico);
    check(lang + ': fav-ico total size', ico.length === spec.total, ico.length);
    // Each table row reads "| n | W × W | 32 | bytes | offset | PNG |".
    for (const e of dir.entries) {
      const row = new RegExp('\\| \\d \\| ' + e.w + ' × ' + e.h + ' \\| ' + e.bpp + ' \\| ' + e.size + ' \\| ' + e.offset + ' \\|');
      check(lang + ': ICO table row for ' + e.w, row.test(text), row);
    }
    check(lang + ': first image offset is 6 + 16 × entries', dir.entries[0].offset === 6 + 16 * dir.entries.length);
  }
  for (const m of text.matchAll(/\{\/\* fav-files: (.+?) \*\/\}/g)) {
    const spec = JSON.parse(m[1]);
    check(lang + ': fav-files names match the package order', JSON.stringify(spec.names) === JSON.stringify(names), spec.names.join());
    const mBytes = new TextEncoder().encode(guideManifest).length;
    const mi = spec.names.indexOf('site.webmanifest');
    check(lang + ': manifest bytes equal the quoted manifest', spec.letter[mi] === mBytes && spec.emoji[mi] === mBytes, mBytes);
    check(lang + ': letter stats line', statsLine(spec.letter) === spec.letterStats, statsLine(spec.letter));
    check(lang + ': emoji stats line', statsLine(spec.emoji) === spec.emojiStats, statsLine(spec.emoji));
    check(lang + ': stats lines are quoted', text.includes('「' + spec.emojiStats + '」') || text.includes('"' + spec.emojiStats + '"'));
    const fmt = (n) => n.toLocaleString('en-US') + ' B';
    spec.names.forEach((name, i) => {
      const row = '| `' + name + '` |';
      const line = text.split('\n').find((l) => l.startsWith(row));
      check(lang + ': table row for ' + name, line && line.includes(fmt(spec.emoji[i])) && line.includes(fmt(spec.letter[i])), line);
    });
  }
}


// ---------- Whole-page interaction and asynchronous lifetime regression ----------
// Read: the complete component IIFE, actual markup, shared ToolLayout shortcut and parse5.
// Write: stdout; optional ZT_B13_REPORT JSON chosen by the caller. No network or system clipboard.
// Canvas rasterization / image decoding are controlled async boundaries; canvas blobs
// contain JSON operation receipts, NOT PNG pixels. Real SVG, ICO/ZIP/manifest code runs.
const ROOT=root;
const {loadPage}=await import(pathToFileURL(ROOT+'/scripts/astro-page-harness.mjs')); 
const req=createRequire(ROOT+'/package.json'),{parseFragment}=req('parse5');
const read=p=>readFileSync(ROOT+'/'+p,'utf8'),sha=s=>createHash('sha256').update(s).digest('hex');
const specs=[{slug:'favicon-generator',file:'src/components/tools/FaviconGeneratorTool.astro'}];
for(const s of specs){if(process.env.ZT_B13_SOURCE)s.file=relative(ROOT,process.env.ZT_B13_SOURCE);s.source=read(s.file);}
const layout=read('src/layouts/ToolLayout.astro'),start=layout.indexOf("      document.addEventListener('keydown'",layout.indexOf('// ── Keyboard shortcuts'));
const shortcut=layout.slice(start,layout.indexOf('      // ── Copy button visual feedback',start));
if(!shortcut.includes('window.ztPersist.clear(_slug)'))throw Error('shortcut drift');
const rows=[],unhandled=[];const onUnhandled=e=>unhandled.push(String(e?.message||e));process.on('unhandledRejection',onUnhandled);
const flush=async()=>{await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));};
function checkPage(s,name,actual,expected){const same=JSON.stringify(actual)===JSON.stringify(expected);rows.push({slug:s.slug,name,result:same?'PASS':'FAIL',actual,expected});}
function page(s,lang='en',order='before'){
 const docHandlers={},copies=[],exec=[],saved=[],cleared=[],tracks=[],readers=[],images=[],blobs=[],downloads=[],revoked=[],urls=new Map(),winHandlers={};let document,now=0,seq=0,urlSeq=0,selection=null;const timers=new Map();
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
 const ssrStrings=Function(s.source.split('// strings:start')[1].split('// strings:end')[0]+';return STRINGS;')();
 const escapeText=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
 let markup=s.source.slice(s.source.indexOf('---',3)+3,s.source.indexOf('<script is:inline')).replace(/\{\/\*[\s\S]*?\*\/\}/g,'').replace(/\{L\.tips\.(\w+)\}/g,(_,k)=>escapeText(ssrStrings[lang].tips[k])).replace(/\{L\.(\w+)\}/g,(_,k)=>escapeText(ssrStrings[lang][k]));

 widget.childNodes=parseFragment(markup).childNodes.map(n=>wrap(n,widget));
 document={body,documentElement:{lang},activeElement:body,createElement:tag=>element(tag),getElementById(id){const e=walk(body).find(e=>e.id===id);if(!e)throw Error('Missing real DOM '+id);return e;},querySelectorAll:q=>body.querySelectorAll(q),querySelector:q=>body.querySelector(q),addEventListener(k,f){(docHandlers[k]||=[]).push(f);},execCommand(command){exec.push({command,text:selection?.value});return false;}};
 class Reader{constructor(){readers.push(this);}readAsText(file){this.file=file;this.mode='text';}readAsDataURL(file){this.file=file;this.mode='dataURL';}deliver(){this.result=this.mode==='text'?this.file.content:'data:image/png;base64,cHJvYmU=';this.onload?.({target:this});}fail(){this.onerror?.(new Error('controlled read failure'));}}
 class Img{constructor(){images.push(this);this.width=this.naturalWidth=32;this.height=this.naturalHeight=32;}deliver(){this.onload?.();}fail(){this.onerror?.(new Error('controlled image failure'));}}
 const clientKeys=JSON.parse(/const CLIENT_T = Object.fromEntries\((\[[^\]]+\])/.exec(s.source)[1]);
 const globals={CLIENT_T:Object.fromEntries(clientKeys.map(k=>[k,ssrStrings[lang][k]])),document,Blob,TextEncoder,Uint8Array,Uint32Array,DataView,ArrayBuffer,structuredClone,FileReader:Reader,Image:Img,isSecureContext:true,URL:{createObjectURL(blob){const url='blob:probe/'+(++urlSeq);urls.set(url,blob);return url;},revokeObjectURL:url=>revoked.push(url)},navigator:{clipboard:{writeText:text=>new Promise((resolve,reject)=>copies.push({text,resolve,reject})),write(){throw Error('unexpected native clipboard');}}},setTimeout(fn,delay){const id=++seq;timers.set(id,{fn,due:now+delay,delay});return id;},clearTimeout:id=>timers.delete(id),ztPersist:{load(){return null;},save:(slug,v)=>saved.push({slug,value:JSON.parse(JSON.stringify(v))}),clear:slug=>cleared.push(slug)},trackTool:(...x)=>tracks.push(x),addEventListener(k,f){(winHandlers[k]||=[]).push(f);},fetch(){throw Error('network forbidden');}};
 let nativeClipboardReads=0;Object.setPrototypeOf(globals.navigator,{get clipboard(){nativeClipboardReads++;throw Error('native clipboard prototype exposed');}});
 const context={...globals,_slug:s.slug};context.window=context;if(order==='before')vm.runInNewContext(shortcut,context);const loaded=loadPage(s.file,{lang,globals});if(order==='after')loaded.run('var _slug='+JSON.stringify(s.slug)+';\n'+shortcut);
 const $=id=>document.getElementById(id);return{$,document,globals,get nativeClipboardReads(){return nativeClipboardReads;},copies,exec,saved,cleared,tracks,readers,images,blobs,downloads,urls,revoked,timers,input(id,value,ev='input'){$(id).focus();$(id).value=value;$(id).dispatch(ev);},click(selector){const e=selector.startsWith('#')?$(selector.slice(1)):document.querySelector(selector);if(!e)throw Error('No real selector '+selector);e.click();},key(id,meta=false){$(id).focus();$(id).dispatch('keydown',{key:'l',ctrlKey:!meta,metaKey:meta});},file(file){$('fg-file').files=[file];$('fg-file').dispatch('change');},advance(ms){const end=now+ms;for(let g=0;;g++){if(g>100)throw Error('timer runaway');const next=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;now=next[1].due;timers.delete(next[0]);next[1].fn();}now=end;},async drain(){for(let i=0;i<50;i++){await flush();const pending=blobs.filter(b=>!b.done);if(!pending.length)return;pending.forEach(b=>b.deliver());}throw Error('blob queue did not settle');}};
}
const favicon=specs[0];
const fCopy={en:'Copy',zh:'复制',ja:'コピー',ko:'복사'},fCopied={en:'Copied',zh:'已复制',ja:'コピー済み',ko:'복사됨'};
// Independent reader for the actual STORED ZIP created by the production pipeline.
async function zipEntries(blob){const b=Buffer.from(await blob.arrayBuffer()),out={};let p=0;while(b.readUInt32LE(p)===0x04034b50){const size=b.readUInt32LE(p+18),n=b.readUInt16LE(p+26),x=b.readUInt16LE(p+28),name=b.subarray(p+30,p+30+n).toString(),start=p+30+n+x;out[name]=b.subarray(start,start+size);p=start+size;}if(b.readUInt32LE(p)!==0x02014b50)throw Error('missing real ZIP central directory');return out;}
const packageBlob=p=>[...p.urls.values()].findLast(b=>b.type==='application/zip');
async function generate(p){p.click('#fg-generate');await p.drain();}
const signature=p=>p.$('fg-prev-16').ops.map(o=>o.name==='fillText'?o.text:o.name==='drawImage'?o.image:null).filter(Boolean);
for(const lang of ['en','zh','ja','ko']){
 const p=page(favicon,lang);checkPage(favicon,lang+' initial emoji actual render call',signature(p),['🚀']);checkPage(favicon,lang+' main Generate enabled for default',p.$('fg-generate').disabled,false);await generate(p);checkPage(favicon,lang+' complete package visible',p.$('fg-result').hidden,false);
 const entries=await zipEntries(packageBlob(p));checkPage(favicon,lang+' actual package 11 entries',Object.keys(entries),['favicon.ico','favicon-16.png','favicon-32.png','favicon-48.png','favicon-64.png','favicon-96.png','favicon-128.png','apple-touch-icon.png','android-chrome-192.png','android-chrome-512.png','site.webmanifest']);
 checkPage(favicon,lang+' real manifest theme default',JSON.parse(entries['site.webmanifest']).theme_color,'#ffffff');
 p.click('#fg-download-zip');checkPage(favicon,lang+' actual download points at completed ZIP',p.downloads[0].blob===packageBlob(p),true);checkPage(favicon,lang+' actual ZIP download fixed name',p.downloads[0].name,'favicon-package.zip');
 const full=p.$('fg-snippet-code').textContent;p.click('#fg-copy-snippet');checkPage(favicon,lang+' full HTML copied',p.copies[0].text,full);p.copies[0].resolve();await flush();checkPage(favicon,lang+' successful copy label',p.$('fg-copy-snippet').textContent,fCopied[lang]);p.advance(1500);checkPage(favicon,lang+' normal timer restores',p.$('fg-copy-snippet').textContent,fCopy[lang]);
 const errors=unhandled.length;p.click('#fg-copy-snippet');p.copies[1].reject(Error('favicon-current-'+lang));await flush();checkPage(favicon,lang+' current copy refusal must be handled',unhandled.length-errors,0);checkPage(favicon,lang+' copy refusal must show failure',p.$('fg-status').className.includes('error')||p.$('fg-copy-snippet').textContent!==fCopy[lang],true);
 p.click('#fg-copy-snippet');p.copies[2].resolve();await flush();checkPage(favicon,lang+' direct same-result retry succeeds',p.$('fg-copy-snippet').textContent,fCopied[lang]);
}
for(const order of ['before','after'])for(const meta of [false,true]){
 const p=page(favicon,'en',order);await generate(p);p.key('fg-emoji-input',meta);checkPage(favicon,order+'/'+meta+' shared input clear happens',p.$('fg-emoji-input').value,'');checkPage(favicon,order+'/'+meta+' shared persist clear',p.cleared,['favicon-generator']);checkPage(favicon,order+'/'+meta+' CtrlL retains nontext settings',[p.$('fg-padding').value,p.$('fg-text-font').value,p.$('fg-theme-color').value],['8','system-ui','#ffffff']);checkPage(favicon,order+'/'+meta+' CtrlL hides stale package',p.$('fg-result').hidden,true);checkPage(favicon,order+'/'+meta+' CtrlL updates render source',signature(p),[]);p.click('#fg-download-zip');checkPage(favicon,order+'/'+meta+' CtrlL removes old download availability',p.downloads.length,0);
}
{
 const p=page(favicon);await generate(p);p.input('fg-theme-color','#123456');checkPage(favicon,'completed package invalidated by options',p.$('fg-result').hidden,true);p.click('#fg-download-zip');checkPage(favicon,'option invalidation removes previous ZIP target',p.downloads.length,0);await generate(p);checkPage(favicon,'regeneration updates real manifest',JSON.parse((await zipEntries(packageBlob(p)))['site.webmanifest']).theme_color,'#123456');p.input('fg-emoji-input','');checkPage(favicon,'ordinary empty source disables Generate',p.$('fg-generate').disabled,true);checkPage(favicon,'ordinary empty source hides package',p.$('fg-result').hidden,true);
}
{
 const p=page(favicon);p.click('#fg-tab-text');p.input('fg-text-input','A');p.input('fg-app-name','Name A');p.click('#fg-generate');await flush();checkPage(favicon,'first held size really rendered A',p.blobs[0].snapshot.ops.find(o=>o.name==='fillText').text,'A');p.input('fg-text-input','B');p.input('fg-app-name','Name B');await p.drain();checkPage(favicon,'changed source cancels old package publication',p.$('fg-result').hidden,true);checkPage(favicon,'cancelled generation has no completed ZIP',!!packageBlob(p),false);await generate(p);const entries=await zipEntries(packageBlob(p));for(const name of ['favicon-16.png','favicon-32.png','android-chrome-512.png'])checkPage(favicon,'fresh generation '+name+' uses B only',JSON.parse(entries[name]).ops.find(o=>o.name==='fillText').text,'B');checkPage(favicon,'fresh manifest uses Name B',JSON.parse(entries['site.webmanifest']).name,'Name B');
}
{
 const p=page(favicon);p.click('#fg-generate');await flush();p.key('fg-emoji-input');await p.drain();checkPage(favicon,'pending Generate cannot publish after CtrlL',p.$('fg-result').hidden,true);checkPage(favicon,'pending Generate cannot restore success after clear',p.$('fg-status').textContent,'');
}
function png(name){return{name,type:'image/png',size:128};}
{
 const p=page(favicon);p.click('#fg-tab-image');p.file(png('one.png'));checkPage(favicon,'actual file handler starts DataURL read',p.readers[0].mode,'dataURL');p.readers[0].deliver();p.images[0].deliver();checkPage(favicon,'real image completion enables Generate',p.$('fg-generate').disabled,false);checkPage(favicon,'image info current file',p.$('fg-image-info').textContent.startsWith('one.png · 32 × 32'),true);await generate(p);p.file({name:'bad.txt',type:'text/plain',size:1});checkPage(favicon,'invalid next file clears former package',p.$('fg-result').hidden,true);checkPage(favicon,'invalid next file stops stale image generation',p.$('fg-generate').disabled,true);
}
for(const stage of ['reader','image']){
 const p=page(favicon);p.click('#fg-tab-image');p.file(png('older.png'));if(stage==='image')p.readers[0].deliver();p.file(png('newer.png'));p.readers[1].deliver();const newer=p.images.at(-1);newer.deliver();checkPage(favicon,stage+' newer image positive control',p.$('fg-image-info').textContent.startsWith('newer.png'),true);if(stage==='reader')p.readers[0].deliver();const older=p.images.find(im=>im!==newer);older?.deliver();checkPage(favicon,stage+' late older completion must not replace new image',p.$('fg-image-info').textContent.startsWith('newer.png'),true);
}
{
 const p=page(favicon);p.click('#fg-tab-image');p.file(png('old.png'));p.key('fg-file');p.readers[0].deliver();p.images[0]?.deliver();checkPage(favicon,'pending file completion cannot revive after CtrlL',p.$('fg-image-info').hidden,true);checkPage(favicon,'pending image cannot enable Generate after clear',p.$('fg-generate').disabled,true);
}
for(const boundary of ['empty','CtrlL']){
 const p=page(favicon);p.click('#fg-tab-svg');p.input('fg-svg-input','<svg width="32" height="32"></svg>');p.advance(300);if(boundary==='empty'){p.input('fg-svg-input','');p.advance(300);}else p.key('fg-svg-input');p.images[0].deliver();checkPage(favicon,boundary+' old SVG load cannot restore empty source',p.$('fg-generate').disabled,true);
}
{
 const p=page(favicon);p.click('#fg-tab-svg');p.input('fg-svg-input','<svg width="32" height="32"></svg>');p.key('fg-svg-input');p.advance(300);checkPage(favicon,'CtrlL cancels queued SVG reader',p.images.length,0);
}
for(const boundary of ['input','option','CtrlL'])for(const outcome of ['resolve','reject']){
 const p=page(favicon);await generate(p);p.click('#fg-copy-snippet');if(boundary==='input')p.input('fg-emoji-input','A');if(boundary==='option')p.input('fg-theme-color','#123456');if(boundary==='CtrlL')p.key('fg-emoji-input');if(boundary!=='CtrlL')await generate(p);const before=p.$('fg-copy-snippet').textContent,errors=unhandled.length;p.copies[0][outcome](Error('favicon-late-'+boundary));await flush();if(outcome==='resolve')checkPage(favicon,boundary+' old copy cannot alter current label',p.$('fg-copy-snippet').textContent,before);else checkPage(favicon,boundary+' stale rejection is handled',unhandled.length-errors,0);
}
{
 const p=page(favicon);await generate(p);p.click('#fg-copy-snippet');p.copies[0].resolve();await flush();p.advance(100);p.click('#fg-copy-snippet');p.copies[1].resolve();await flush();p.advance(1400);checkPage(favicon,'old timer preserves newer Copied',p.$('fg-copy-snippet').textContent,fCopied.en);p.advance(100);checkPage(favicon,'latest timer restores Copy rather than captured Copied',p.$('fg-copy-snippet').textContent,fCopy.en);
 Object.defineProperty(p.globals.navigator,'clipboard',{value:undefined,configurable:true});let thrown='';try{p.click('#fg-copy-snippet');}catch(e){thrown=e.message;}checkPage(favicon,'missing clipboard API must not synchronously throw',thrown,'');
}

for(const outcome of ['resolve','reject']){const p=page(favicon);await generate(p);p.click('#fg-copy-snippet');p.click('#fg-copy-snippet');p.copies[1].resolve();await flush();const before=[p.$('fg-copy-snippet').textContent,p.$('fg-status').textContent];p.copies[0][outcome](Error('older request'));await flush();checkPage(favicon,'same-result older '+outcome+' preserves newer success',[p.$('fg-copy-snippet').textContent,p.$('fg-status').textContent],before);}
{const p=page(favicon);await generate(p);p.globals.navigator.clipboard.writeText=()=>{throw Error('sync copy refusal');};let thrown='';try{p.click('#fg-copy-snippet');}catch(e){thrown=e.message;}await flush();checkPage(favicon,'sync copy failure handled',thrown,'');checkPage(favicon,'sync copy refusal visible',p.$('fg-status').className.includes('error'),true);}
{const p=page(favicon);await generate(p);Object.defineProperty(p.globals.navigator,'clipboard',{value:undefined,configurable:true});let thrown='';try{p.click('#fg-copy-snippet');}catch(e){thrown=e.message;}await flush();checkPage(favicon,'own undefined clipboard handled',thrown,'');checkPage(favicon,'own undefined never reads native clipboard getter',p.nativeClipboardReads,0);}
{const p=page(favicon);await generate(p);p.click('#fg-copy-snippet');p.copies[0].resolve();await flush();const timer=[...p.timers.values()].find(t=>t.delay===1500);p.input('fg-emoji-input','B');await generate(p);p.click('#fg-copy-snippet');p.copies[1].resolve();await flush();timer.fn();checkPage(favicon,'forced cancelled timer preserves new feedback',[p.$('fg-copy-snippet').textContent,p.$('fg-copy-snippet').classList.contains('copied')],[fCopied.en,true]);}
for(const boundary of ['input','CtrlL']){const p=page(favicon);p.click('#fg-generate');await flush();if(boundary==='input')p.input('fg-emoji-input','B');else p.key('fg-emoji-input');p.blobs[0].deliver(null);await flush();checkPage(favicon,boundary+' cancelled generation rejection leaves current status',p.$('fg-status').textContent,'');checkPage(favicon,boundary+' cancelled rejection cannot publish package',p.$('fg-result').hidden,true);}
{const p=page(favicon);p.click('#fg-tab-image');p.file(png('old.png'));p.readers[0].deliver();p.key('fg-file');p.images[0].fail();checkPage(favicon,'stale raster error cannot restore status after clear',p.$('fg-status').textContent,'');}
{const p=page(favicon);p.click('#fg-tab-svg');p.input('fg-svg-input','<svg width="32" height="32"></svg>');p.advance(300);p.key('fg-svg-input');p.images[0].fail();checkPage(favicon,'stale SVG error cannot restore status after clear',p.$('fg-status').textContent,'');}

// A cached source may finish while another source owns generation/results.
for(const sourceType of ['image','svg'])for(const phase of ['pending','completed'])for(const outcome of ['deliver','fail']){
 const p=page(favicon);p.click('#fg-tab-'+sourceType);
 if(sourceType==='image'){p.file(png('cached.png'));p.readers[0].deliver();}
 else{p.input('fg-svg-input','<svg width="32" height="32"></svg>');p.advance(300);}
 const oldImage=p.images[0];p.click('#fg-tab-text');p.input('fg-text-input','T');p.click('#fg-generate');await flush();
 if(phase==='completed')await p.drain();
 const before={status:p.$('fg-status').textContent,hidden:p.$('fg-result').hidden,snippet:p.$('fg-snippet-code').textContent,url:packageBlob(p)};
 oldImage[outcome]();
 checkPage(favicon,sourceType+'/'+phase+'/'+outcome+' preserves active source feedback',p.$('fg-status').textContent,before.status);
 checkPage(favicon,sourceType+'/'+phase+'/'+outcome+' preserves active package/result',[p.$('fg-result').hidden,p.$('fg-snippet-code').textContent,packageBlob(p)===before.url],[before.hidden,before.snippet,true]);
 if(phase==='pending'){await p.drain();checkPage(favicon,sourceType+'/'+outcome+' cannot cancel other source generation',p.$('fg-result').hidden,false);const blob=packageBlob(p),entries=blob?await zipEntries(blob):null;checkPage(favicon,sourceType+'/'+outcome+' active generated image stays T',entries?JSON.parse(entries['favicon-16.png']).ops.find(o=>o.name==='fillText').text:null,'T');}
 if(outcome==='deliver'){p.click('#fg-tab-'+sourceType);checkPage(favicon,sourceType+' completed inactive source remains available as cache',p.$('fg-generate').disabled,false);checkPage(favicon,sourceType+' cache renders only after selecting that source',signature(p),[oldImage.src]);}
}

// v2 generate contract: all original legacy/package and lifecycle assertions remain above.
const SSR=Function(source.split('// strings:start')[1].split('// strings:end')[0]+';return STRINGS;')();
const markupV2=source.split('<script is:inline')[0],styleV2=source.split('<style')[1]||'';
check('v2 shared rail',/class="fg-rail zt-rail"/.test(markupV2));
check('v2 300px rail and bounded result',/grid-template-columns: 300px minmax\(0, 1fr\)/.test(styleV2));
check('v2 860 stack and 640 phone',/max-width: 860px/.test(styleV2)&&/max-width: 640px/.test(styleV2));
check('v2 actions and reserved status precede source/options',markupV2.indexOf('id="fg-generate"')<markupV2.indexOf('id="fg-copy-snippet"')&&markupV2.indexOf('id="fg-copy-snippet"')<markupV2.indexOf('class="fg-status-slot"')&&markupV2.indexOf('class="fg-status-slot"')<markupV2.indexOf('class="fg-tabs"')&&markupV2.indexOf('class="fg-status-slot"')<markupV2.indexOf('<details class="fg-options">'));
check('v2 reserved status',/\.fg-status-slot \{ min-height: 2\.8em/.test(styleV2));
check('v2 touch main44 and dense24',/min-height: 44px/.test(styleV2)&&/min-height: 24px/.test(styleV2));
check('v2 package scroll stays bounded',/\.fg-package-body \{[^}]*min-height: 0[^}]*overflow: auto/.test(styleV2));
check('v2 code uses internal scroll',/\.fg-snippet-code \{[^}]*max-height: 14rem[^}]*overflow: auto[^}]*white-space: pre/.test(styleV2));
check('v2 empty phone preview hidden',/\.fg-preview-section\[data-empty="true"\] \{ display: none/.test(styleV2));
check('v2 runtime translation loop removed',!source.includes("querySelectorAll('[data-i18n]')"));
check('v2 tips use SSR slots',(markupV2.match(/<Toggletip /g)||[]).length===13&&!/<Toggletip[^>]*text=/.test(markupV2));
check('v2 client excludes tips',!/const CLIENT_T[^\n]*tips/.test(source));
check('v2 Generate, ZIP and Copy each remain unique',['fg-generate','fg-download-zip','fg-copy-snippet'].every(id=>(markupV2.match(new RegExp('id="'+id+'"','g'))||[]).length===1));
check('v2 secondary emoji/options default closed',(markupV2.match(/<details class="fg-options">/g)||[]).length===2);
for(const lang of ['en','zh','ja','ko']){
 check(lang+' thirteen localized SSR tips',Object.keys(SSR[lang].tips).length===13&&Object.values(SSR[lang].tips).every(v=>typeof v==='string'&&v.length>0));
 const p=page(favicon,lang);checkPage(favicon,lang+' live preview distinct from package',[p.$('fg-live-preview').getAttribute('data-empty'),p.$('fg-result').hidden,p.$('fg-copy-snippet').disabled,p.$('fg-download-zip').disabled],['false',true,true,true]);
 await generate(p);checkPage(favicon,lang+' generated rail exports enabled',[p.$('fg-copy-snippet').disabled,p.$('fg-download-zip').disabled],[false,false]);
 p.input('fg-emoji-input','B');checkPage(favicon,lang+' edits invalidate exports but keep live preview',[p.$('fg-result').hidden,p.$('fg-copy-snippet').disabled,p.$('fg-download-zip').disabled,p.$('fg-live-preview').getAttribute('data-empty')],[true,true,true,'false']);
 for(const order of ['before','after']){const q=page(favicon,lang,order);await generate(q);q.key('fg-emoji-input');checkPage(favicon,lang+'/'+order+' clear empty preview/export state',[q.$('fg-live-preview').getAttribute('data-empty'),q.$('fg-preview-grid').hidden,q.$('fg-empty').hidden,q.$('fg-copy-snippet').disabled,q.$('fg-download-zip').disabled],['true',true,false,true,true]);}
 const md=read('src/content/tools/favicon-generator/'+lang+'.mdx');const block=/^steps:\n([\s\S]*?)(?=^faqItems:)/m.exec(md)?.[1]||'';
 const steps=block.split('\n').filter(v=>v.startsWith('  - ')).map(v=>JSON.parse(v.slice(4)));
 check(lang+' five steps before FAQ',steps.length===5);check(lang+' step limits',steps.every(v=>v.length<=280)&&steps.join('').length<=1200);
 check(lang+' old Usage removed',!/<h2>(How to use|使用方法|使い方|사용 방법)<\/h2>/.test(md));
 if(lang==='en')check('EN at least400 words',md.replace(/^---[\s\S]*?---/,'').replace(/<[^>]*>/g,' ').split(/\s+/).filter(Boolean).length>=400);
}

await flush();
checkPage(specs[0],'all page async failures handled',unhandled,[]);
process.removeListener('unhandledRejection',onUnhandled);
if(skips)console.log(`SKIP: ${skips} ZIP checks (unzip not found)`);
const pageCounts={PASS:rows.filter(r=>r.result==='PASS').length,FAIL:rows.filter(r=>r.result==='FAIL').length};
const counts={PASS:passes+pageCounts.PASS,FAIL:failures+pageCounts.FAIL};
const report={node:process.version,tool:specs[0].slug,sourceSHA256:sha(specs[0].source),systemClipboard:false,rasterization:'canvas operation receipts; no browser pixels claimed',counts,legacyCounts:{PASS:passes,FAIL:failures},pageCounts,rows};
if(process.env.ZT_B13_REPORT)writeFileSync(process.env.ZT_B13_REPORT,JSON.stringify(report,null,2)+'\n');
for(const r of rows)if(r.result==='FAIL')console.log('FAIL '+r.name+' actual='+JSON.stringify(r.actual)+' expected='+JSON.stringify(r.expected));
console.log(JSON.stringify({slug:specs[0].slug,counts,legacyCounts:report.legacyCounts,pageCounts,sourceSHA256:report.sourceSHA256}));process.exitCode=counts.FAIL?1:0;
