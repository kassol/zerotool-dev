// Pixelate Image — spec-driven regression test
//
// Read:  src/components/tools/PixelateImageTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: pixelate() block-average correctness including non-divisible edge blocks,
// pixelate() touching only the pixels it is given (mirroring how render() composites
// a region back into the full canvas), normalizeRect() reverse-drag normalization and
// out-of-bounds clipping, and toImageCoords() display-to-image scaling.
//
// Run: node scripts/test-pixelate-image.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = process.env.ZT_B14_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(process.env.ZT_B14_SOURCE || join(root, 'src/components/tools/PixelateImageTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in PixelateImageTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { pixelate, normalizeRect, toImageCoords };')();

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
function deepEqual(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}

// Build a flat RGBA buffer from a 2D array of [r,g,b,a] pixels (row-major).
function makeBuffer(pixels, w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixels[y][x];
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return data;
}
function readPixel(data, w, x, y) {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

// ---------- 1. pixelate(): block averaging ----------
{
  // 4x2 image, block=2 -> two 2x2 blocks, each averaged exactly.
  const w = 4, h = 2, block = 2;
  const pixels = [
    [[0, 0, 0, 255], [10, 0, 0, 255], [100, 100, 100, 200], [200, 100, 100, 200]],
    [[20, 0, 0, 255], [30, 0, 0, 255], [150, 100, 100, 100], [250, 100, 100, 100]],
  ];
  const data = makeBuffer(pixels, w, h);
  E.pixelate(data, w, h, block);
  // Block 1 (x:0-1,y:0-1): avg r = (0+10+20+30)/4 = 15, g=b=0, a=255
  deepEqual('pixelate block1 top-left pixel', readPixel(data, w, 0, 0), [15, 0, 0, 255]);
  deepEqual('pixelate block1 uniform fill', readPixel(data, w, 1, 1), [15, 0, 0, 255]);
  // Block 2 (x:2-3,y:0-1): color is alpha-weighted, r = (100*200+200*200+150*100+250*100)/600 ≈ 167,
  // g=b=100, a = (200+200+100+100)/4 = 150
  deepEqual('pixelate block2 uniform fill', readPixel(data, w, 2, 0), [167, 100, 100, 150]);
  deepEqual('pixelate block2 uniform fill 2', readPixel(data, w, 3, 1), [167, 100, 100, 150]);
}
{
  // Transparent pixels must not darken the block color (their RGB is meaningless).
  const w = 2, h = 1;
  const data = makeBuffer([[[255, 0, 0, 255], [0, 0, 0, 0]]], w, h);
  E.pixelate(data, w, h, 2);
  deepEqual('pixelate ignores RGB of transparent pixels', readPixel(data, w, 0, 0), [255, 0, 0, 128]);
  const clear = makeBuffer([[[9, 9, 9, 0], [7, 7, 7, 0]]], w, h);
  E.pixelate(clear, w, h, 2);
  deepEqual('pixelate fully transparent block stays transparent', readPixel(clear, w, 1, 0), [0, 0, 0, 0]);
}

// ---------- 2. pixelate(): non-divisible edge blocks ----------
{
  // 3x3 image, block=2 -> blocks are 2x2, 1x2 (right edge), 2x1 (bottom edge), 1x1 (corner)
  const w = 3, h = 3, block = 2;
  const pixels = [
    [[0, 0, 0, 255], [10, 0, 0, 255], [100, 0, 0, 255]],
    [[20, 0, 0, 255], [30, 0, 0, 255], [120, 0, 0, 255]],
    [[200, 0, 0, 255], [210, 0, 0, 255], [255, 0, 0, 255]],
  ];
  const data = makeBuffer(pixels, w, h);
  E.pixelate(data, w, h, block);
  // top-left 2x2 block avg r = (0+10+20+30)/4 = 15
  deepEqual('edge block top-left avg', readPixel(data, w, 0, 0), [15, 0, 0, 255]);
  deepEqual('edge block top-left avg (mirrored corner)', readPixel(data, w, 1, 1), [15, 0, 0, 255]);
  // right edge column block (x=2, y:0-1) is only 1 pixel wide -> avg of (100,120)/2 = 110, unaffected by other blocks
  deepEqual('edge block right column avg', readPixel(data, w, 2, 0), [110, 0, 0, 255]);
  deepEqual('edge block right column avg (row 2)', readPixel(data, w, 2, 1), [110, 0, 0, 255]);
  // bottom-left block (x:0-1, y=2) is 2x1 -> avg of (200,210)/2 = 205
  deepEqual('edge block bottom row avg', readPixel(data, w, 0, 2), [205, 0, 0, 255]);
  deepEqual('edge block bottom row avg 2', readPixel(data, w, 1, 2), [205, 0, 0, 255]);
  // bottom-right corner block is a single pixel -> unchanged
  deepEqual('edge block corner single pixel unchanged', readPixel(data, w, 2, 2), [255, 0, 0, 255]);
}

// ---------- 3. pixelate() only ever touches the buffer it is given ----------
// Mirrors what render() does: extract a region's own sub-buffer, pixelate it,
// and composite it back into the full image at the region's offset. Pixels
// outside the region must be byte-for-byte unchanged.
{
  const W = 6, H = 4;
  const full = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < full.length; i++) full[i] = (i * 37) % 256; // deterministic noise
  const before = full.slice();

  const region = { x: 2, y: 1, w: 3, h: 2 };
  // Extract region sub-buffer (row by row, since ImageData rows are not contiguous in the parent buffer)
  const sub = new Uint8ClampedArray(region.w * region.h * 4);
  for (let ry = 0; ry < region.h; ry++) {
    for (let rx = 0; rx < region.w; rx++) {
      const srcIdx = ((region.y + ry) * W + (region.x + rx)) * 4;
      const dstIdx = (ry * region.w + rx) * 4;
      for (let c = 0; c < 4; c++) sub[dstIdx + c] = full[srcIdx + c];
    }
  }
  E.pixelate(sub, region.w, region.h, 2);
  // Composite back
  for (let ry = 0; ry < region.h; ry++) {
    for (let rx = 0; rx < region.w; rx++) {
      const srcIdx = (ry * region.w + rx) * 4;
      const dstIdx = ((region.y + ry) * W + (region.x + rx)) * 4;
      for (let c = 0; c < 4; c++) full[dstIdx + c] = sub[srcIdx + c];
    }
  }

  let outsideUnchanged = true;
  let insideChanged = false;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inRegion = x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h;
      const idx = (y * W + x) * 4;
      const same = full[idx] === before[idx] && full[idx + 1] === before[idx + 1] && full[idx + 2] === before[idx + 2] && full[idx + 3] === before[idx + 3];
      if (!inRegion && !same) outsideUnchanged = false;
      if (inRegion && !same) insideChanged = true;
    }
  }
  check('pixelate via region composite leaves outside pixels untouched', outsideUnchanged);
  check('pixelate via region composite changes inside pixels', insideChanged);
}

// ---------- 4. normalizeRect(): reverse drag + out-of-bounds clipping ----------
{
  deepEqual('normalizeRect forward drag', E.normalizeRect(10, 10, 30, 40, 100, 100), { x: 10, y: 10, w: 20, h: 30 });
  deepEqual('normalizeRect reverse drag (both axes)', E.normalizeRect(30, 40, 10, 10, 100, 100), { x: 10, y: 10, w: 20, h: 30 });
  deepEqual('normalizeRect reverse drag (x only)', E.normalizeRect(30, 10, 10, 40, 100, 100), { x: 10, y: 10, w: 20, h: 30 });
  deepEqual('normalizeRect clips negative start', E.normalizeRect(-20, -20, 30, 30, 100, 100), { x: 0, y: 0, w: 30, h: 30 });
  deepEqual('normalizeRect clips beyond image bounds', E.normalizeRect(80, 80, 150, 150, 100, 100), { x: 80, y: 80, w: 20, h: 20 });
  deepEqual('normalizeRect clips both edges past bounds', E.normalizeRect(-50, -50, 200, 200, 100, 100), { x: 0, y: 0, w: 100, h: 100 });
  equal('normalizeRect rejects zero-area drag', E.normalizeRect(10, 10, 10, 10, 100, 100), null);
  equal('normalizeRect rejects sub-2px width', E.normalizeRect(10, 10, 11, 20, 100, 100), null);
  equal('normalizeRect rejects sub-2px height', E.normalizeRect(10, 10, 20, 11, 100, 100), null);
  equal('normalizeRect rejects fully out-of-bounds drag', E.normalizeRect(-30, -30, -5, -5, 100, 100), null);
  equal('normalizeRect rounds fractional coords', JSON.stringify(E.normalizeRect(10.4, 10.4, 20.6, 30.6, 100, 100)), JSON.stringify({ x: 10, y: 10, w: 11, h: 21 }));
}

// ---------- 5. toImageCoords(): display-to-image scaling ----------
{
  // Canvas displayed at 200x100 CSS px but backed by an 800x400 image (4x scale).
  const rect = { left: 50, top: 20, width: 200, height: 100 };
  deepEqual('toImageCoords scales by 4x at origin', E.toImageCoords(50, 20, rect, 800, 400), { x: 0, y: 0 });
  deepEqual('toImageCoords scales by 4x at offset', E.toImageCoords(100, 45, rect, 800, 400), { x: 200, y: 100 });
  deepEqual('toImageCoords at bottom-right corner', E.toImageCoords(250, 120, rect, 800, 400), { x: 800, y: 400 });

  // 1:1 scale (no CSS resizing applied)
  const rect1x = { left: 0, top: 0, width: 400, height: 300 };
  deepEqual('toImageCoords 1:1 scale', E.toImageCoords(150, 90, rect1x, 400, 300), { x: 150, y: 90 });

  // Non-uniform scale (should not happen given aspect-ratio preserving CSS, but the
  // formula must still apply scaleX/scaleY independently rather than assuming square scale)
  const rectNonUniform = { left: 0, top: 0, width: 100, height: 50 };
  deepEqual('toImageCoords independent x/y scale', E.toImageCoords(50, 25, rectNonUniform, 200, 200), { x: 100, y: 100 });
}

// ---------- summary ----------

// Actual full page and shared-shortcut regressions. Canvas operations below are receipts,
// not browser-rendering evidence. sharp reads and encodes the real fixture bytes.
const pageSource=source;
const legacyCounts={PASS:passes,FAIL:failures};
{
const {createHash}=await import('node:crypto');
const {createRequire}=await import('node:module');
const {relative}=await import('node:path');
const {pathToFileURL}=await import('node:url');
const vm=(await import('node:vm')).default;
const {loadPage}=await import(pathToFileURL(join(root,'scripts/astro-page-harness.mjs')));
const ROOT=root,require=createRequire(join(ROOT,'package.json'));
const {parseFragment,defaultTreeAdapter}=require('parse5'),sharp=require('sharp');
const paths={pixel:process.env.ZT_B14_SOURCE?relative(ROOT,process.env.ZT_B14_SOURCE):'src/components/tools/PixelateImageTool.astro'},slugs={pixel:'pixelate-image'},source={pixel:pageSource};
const sha=s=>createHash('sha256').update(s).digest('hex');
const layout=readFileSync(join(ROOT,'src/layouts/ToolLayout.astro'),'utf8');
const shortcut=layout.slice(layout.indexOf('// ── Keyboard shortcuts:'),layout.indexOf('// ── Copy button visual feedback'));
const must=(b,m)=>{if(!b)throw Error('Regression prerequisite: '+m);};
const checks=[],unhandled=[],observations=[];let phase='init';
const onRejection=e=>unhandled.push({phase,message:e?.message||String(e)});process.on('unhandledRejection',onRejection);
function check(id,expected,actual){const status=JSON.stringify(expected)===JSON.stringify(actual)?'PASS':'FAIL';checks.push({id,status,expected,actual});console.log(status+' '+id);}
const settle=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
const waitFor=async(fn)=>{const until=Date.now()+5000;while(!fn()){if(Date.now()>until)throw Error('Boundary not reached: '+phase);await new Promise(r=>setTimeout(r,5));}};
async function scene(id,fn){phase=id;try{await fn();}catch(e){checks.push({id,status:'FAIL',actual:e.stack});console.error(e);}}
const labels=vm.runInNewContext(source.pixel.match(/var STRINGS = [\s\S]*?\n      \};/)[0]+';STRINGS'),L=labels.en;
function page(order='shared-after',lang='en'){
 const key='pixel';
 const clipboard=[],timers=new Map(),persistCalls=[],execCalls=[],tracks=[],tasks=[],downloads=[],blobs=new Map(),encodes=[],decodes=[],yields=[];
 const controls={holdEncode:false,holdDecode:false,holdYield:false};
 let timerId=0,clock=0,doc,urlId=0;
 // RGBA/2D boundary: enough for this probe's opaque 2x2 fixtures; not a Canvas rendering conformance test.
 function pixels(c){const n=(c.width||0)*(c.height||0)*4;if(!c.rgba||c.rgba.length!==n)c.rgba=new Uint8ClampedArray(n);return c.rgba;}
 function canvasContext(c){return{canvas:c,fillStyle:'#000000',clearRect(x,y,w,h){const d=pixels(c);for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)d.fill(0,(yy*c.width+xx)*4,(yy*c.width+xx)*4+4);},
  putImageData(img,x,y){const d=pixels(c);for(let yy=0;yy<img.height;yy++)for(let xx=0;xx<img.width;xx++)d.set(img.data.subarray((yy*img.width+xx)*4,(yy*img.width+xx)*4+4),((y+yy)*c.width+x+xx)*4);},
  getImageData(x,y,w,h){const data=new Uint8ClampedArray(w*h*4),d=pixels(c);for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)data.set(d.subarray(((y+yy)*c.width+x+xx)*4,((y+yy)*c.width+x+xx)*4+4),(yy*w+xx)*4);return{data,width:w,height:h};},
  drawImage(src,...a){must(src,'drawImage source exists');const data=src.rgba||pixels(src);let sx=0,sy=0,sw=src.width,sh=src.height,dx,dy,dw,dh;if(a.length===8)[sx,sy,sw,sh,dx,dy,dw,dh]=a;else{[dx,dy,dw=sw,dh=sh]=a;}const out=pixels(c);for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){const si=((sy+Math.floor(y*sh/dh))*src.width+sx+Math.floor(x*sw/dw))*4,di=((dy+y)*c.width+dx+x)*4;const alpha=data[si+3]/255;for(let z=0;z<3;z++)out[di+z]=Math.round(data[si+z]*alpha+out[di+z]*(1-alpha));out[di+3]=Math.round((alpha+out[di+3]/255*(1-alpha))*255);}},
  fillRect(x,y,w,h){const rgb=this.fillStyle.match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16));const d=pixels(c);for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)d.set([...rgb,255],(yy*c.width+xx)*4);},save(){},restore(){},setLineDash(){},strokeRect(){throw Error('Unrequested outline path');}};}
 function encodeCanvas(c,callback,mime){const rgba=Buffer.from(pixels(c)),width=c.width,height=c.height,held=controls.holdEncode;
  const job={mime,width,height,rgba:[...rgba],held,ready:false,delivered:false,deliver(value){must(job.ready&&!job.delivered,'encode delivered once and ready');job.delivered=true;callback(arguments.length?value:job.blob);}};encodes.push(job);
  let encoder=sharp(rgba,{raw:{width,height,channels:4}});encoder=mime==='image/jpeg'?encoder.jpeg():mime==='image/webp'?encoder.webp():encoder.png();
  encoder.toBuffer().then(bytes=>{job.blob=new Blob([bytes],{type:mime});job.ready=true;if(!held)job.deliver();},e=>{job.error=e.message;job.blob=null;job.ready=true;if(!held)job.deliver();});
 }
 function decode(file){const held=controls.holdDecode,d=deferred(),job={name:file.name,held,ready:false,delivered:false,deliver(){must(job.ready&&!job.delivered,'decode delivered once and ready');job.delivered=true;job.error?d.reject(job.error):d.resolve(job.bitmap);}};decodes.push(job);
  file.arrayBuffer().then(bytes=>sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer({resolveWithObject:true})).then(({data,info})=>{job.bitmap={width:info.width,height:info.height,rgba:new Uint8ClampedArray(data),closed:false,close(){this.closed=true;}};job.ready=true;if(!held)job.deliver();},error=>{job.error=error;job.ready=true;if(!held)job.deliver();});return d.promise;
 }
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
    constructor(type, extra = {}) { Object.assign(this, { type, bubbles: false, defaultPrevented: false, isTrusted: false }, extra); }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.stopped = true; }
  }
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, listeners: {}, id: '', className: '', type: tag === 'input' ? 'text' : '', style: {}, text: '', _value: '', dirtyValue: false, disabled: false, hidden: false }); }
    get value() {
      if (!this.dirtyValue && this.tagName === 'TEXTAREA') return this.textContent;
      if (!this.dirtyValue && this.tagName === 'SELECT') return (this.querySelectorAll('option').find(o=>o.selected)||this.querySelector('option'))?.value ?? '';
      return this._value;
    }
    set value(v) { let x=String(v);if(this.tagName==='SELECT'&&!this.querySelectorAll('option').some(o=>o.value===x))x='';if(this.tagName==='INPUT'&&this.type==='number'&&x!==''&&!Number.isFinite(Number(x)))x='';this._value=x;this.dirtyValue=true; }
    get firstChild() { return this.children[0]??null; }
    get dataset() { const el=this;return new Proxy({}, {get(_,key){return el.getAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()));},set(_,key,value){el.setAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()),value);return true;}}); }
    get parentElement() { return this.parentNode; }
    get isConnected() { return doc.contains(this); }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) el.className = (el.className + ' ' + c).trim(); }, remove(c) { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); }, toggle(c,force) { const yes=force??!this.contains(c);yes?this.add(c):this.remove(c);return yes; } }; }
    setAttribute(k, v) { this.attributes[k] = String(v); if (['id', 'class', 'type', 'value'].includes(k)) this[k === 'class' ? 'className' : k] = String(v); if (['hidden', 'disabled', 'checked', 'selected'].includes(k)) this[k] = true; }
    getAttribute(k) { if (['id', 'class', 'type'].includes(k)) return this[k === 'class' ? 'className' : k] || null; return this.attributes[k] ?? null; }
    removeAttribute(k) { delete this.attributes[k]; if (['hidden','disabled','checked'].includes(k)) this[k]=false; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(v) { for (const child of this.children) child.parentNode = null; this.children = []; this.text = String(v); }
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
        for (const fn of el.listeners[event.type] || []) {const result=fn.call(el,event);if(result&&typeof result.then==='function')tasks.push(result);}
        if (!event.bubbles || event.stopped) break;
      }
      return !event.defaultPrevented;
    }
    dispatch(type, extra = {}) { return this.dispatchEvent(new EventStub(type, { bubbles: true, ...extra })); }
    click() { if(this.disabled)return;if(this.tagName==='A'&&this.download){downloads.push({name:this.download,blob:blobs.get(this.href)});return;}this.focus();this.dispatch('click'); }
    select() { doc.selectedElement=this; }
    focus() { if(doc.activeElement===this)return;const old=doc.activeElement;doc.activeElement=this;if(old)old.dispatchEvent(new EventStub('blur'));this.dispatchEvent(new EventStub('focus')); }
    getContext(kind) { must(this.tagName==='CANVAS'&&kind==='2d','canvas context'); return this._ctx??=canvasContext(this); }
    toBlob(callback,mime='image/png') { encodeCanvas(this,callback,mime); }
    getBoundingClientRect() { return {left:0,top:0,width:this.width||0,height:this.height||0}; }
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
  widget.innerHTML=source[key].replace(/^---[\s\S]*?---\s*/,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').split('<style')[0].replace(/\{\/\*[\s\S]*?\*\/\}/g,'');
  doc.getElementById=id=>descendants(doc).find(el=>el.id===id)??null;
  doc.getElementsByName=name=>descendants(doc).filter(el=>el.getAttribute('name')===name);
  doc.createElement=tag=>new Element(tag);doc.activeElement=doc.body;
  doc.execCommand=command=>{execCalls.push(command);return false;};
  const persist={clear(slug){persistCalls.push(['clear',slug]);},save(...args){persistCalls.push(['save',...args]);},load(){return {};}};
  const globals={document:doc,Blob,File,TextEncoder,TextDecoder,URL:{createObjectURL(blob){const url='blob:memory-'+(++urlId);blobs.set(url,blob);return url;},revokeObjectURL(url){blobs.delete(url);}},Uint8Array,Uint8ClampedArray,ArrayBuffer,
   Image:class{set src(url){const file=blobs.get(url);decode(file).then(b=>{Object.assign(this,{width:b.width,height:b.height,naturalWidth:b.width,naturalHeight:b.height,rgba:b.rgba});this.onload?.();},()=>this.onerror?.());}},
   ImageData:class{constructor(data,width,height){Object.assign(this,{data,width,height});}},createImageBitmap:decode,
   MutationObserver:class{observe(){} disconnect(){}},matchMedia:()=>({addEventListener(){}}),getComputedStyle:()=>({getPropertyValue:()=>''}),requestAnimationFrame:fn=>globals.setTimeout(fn,16),cancelAnimationFrame:id=>globals.clearTimeout(id),
   MessageChannel:class{constructor(){this.port1={};this.port2={postMessage:()=>{const job={delivered:false,deliver:()=>{must(!job.delivered,'yield only once');job.delivered=true;this.port1.onmessage({data:null});}};yields.push(job);if(!controls.holdYield)queueMicrotask(job.deliver);}};}},
   _slug:slugs[key],ztPersist:persist,trackTool(...a){tracks.push(a);},performance:{now:()=>performance.now()},
   ClipboardItem:class{constructor(data){this.data=data;}},navigator:{clipboard:{writeText(value){const d=deferred();clipboard.push({...d,value});return d.promise;},write(value){const d=deferred();clipboard.push({...d,value});return d.promise;}}},
   setTimeout(fn,ms){timers.set(++timerId,{fn,ms,due:clock+ms});return timerId;},clearTimeout(id){timers.delete(id);},
  };
  if(order==='shared-before')vm.runInNewContext(shortcut,{document:doc,window:{ztPersist:persist},_slug:slugs[key]},{filename:'ToolLayout.astro:actual-shortcut'});
  const actual=loadPage(paths[key],{lang,globals});
  if(order==='shared-after')actual.run(shortcut);
  const get=id=>{const el=doc.getElementById(id);must(el,key+' ID '+id);return el;};
  return{get,doc,widget,globals,clipboard,timers,persistCalls,execCalls,tracks,downloads,encodes,decodes,yields,controls,actual,
   file(file){const input=get('pxi-file');input.files=[file];input.value='C:\\fakepath\\'+file.name;input.dispatch('change');},
   drop(file){get('pxi-wrap').dispatch('drop',{dataTransfer:{files:[file]}});},
   ctrlL(id,key='l',meta=false){get(id).focus();return get(id).dispatch('keydown',{key,ctrlKey:!meta,metaKey:meta});},
   change(id,value){get(id).value=value;get(id).dispatch('change');},
   tick(ms){clock+=ms;for(;;){const ready=[...timers].filter(([,t])=>t.due<=clock).sort((a,b)=>a[1].due-b[1].due)[0];if(!ready)break;timers.delete(ready[0]);ready[1].fn();}},
  };
}
const originalPixels=[255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255];
const pngBytes=await sharp(Buffer.from(originalPixels),{raw:{width:2,height:2,channels:4}}).png().toBuffer();
const pngFile=(name='old.png')=>new File([pngBytes],name,{type:'image/png'});
const badFile=()=>new File(['not image'],'bad.txt',{type:'text/plain'});
function heldFile(file){const read=file.arrayBuffer.bind(file),d=deferred();let ready=false;Object.defineProperty(file,'arrayBuffer',{value:async()=>{const bytes=await read();ready=true;await d.promise;return bytes;}});return{file,release:d.resolve,ready:()=>ready};}
async function rgbaOf(blob){return [...await sharp(Buffer.from(await blob.arrayBuffer())).ensureAlpha().raw().toBuffer()];}
const snap=p=>({controls:p.get('pxi-controls').hidden,canvas:p.get('pxi-canvas-wrap').hidden,actions:p.get('pxi-actions').hidden,width:p.get('pxi-canvas').width||0,height:p.get('pxi-canvas').height||0,status:p.get('pxi-status').textContent,file:p.get('pxi-file').value,dimensions:p.get('pxi-dim-status').textContent});
const cleared=[true,true,true,0,0,'','',''];
async function load(p,name='old.png'){const n=p.decodes.length;p.file(pngFile(name));await waitFor(()=>p.decodes[n]?.delivered&&!p.get('pxi-actions').hidden);await settle();}
await scene('golden',async()=>{
 const p=page();await load(p);check(phase+'/actual-PNG-decode-receipt',originalPixels,[...p.get('pxi-canvas').rgba]);p.get('pxi-entire').checked=true;p.get('pxi-entire').dispatch('change');check(phase+'/actual-pixelate-calls',Array(4).fill([128,128,128,255]).flat(),[...p.get('pxi-canvas').rgba]);p.get('pxi-download').click();await waitFor(()=>p.downloads.length===1);check(phase+'/download-name','old-pixelated.png',p.downloads[0].name);check(phase+'/complete-PNG-receipt',Array(4).fill([128,128,128,255]).flat(),await rgbaOf(p.downloads[0].blob));p.get('pxi-copy').click();await waitFor(()=>p.clipboard.length===1);check(phase+'/complete-copy-PNG',sha(new Uint8Array(await p.encodes.at(-1).blob.arrayBuffer())),sha(new Uint8Array(await p.clipboard[0].value[0].data['image/png'].arrayBuffer())));p.clipboard[0].resolve();await settle();p.get('pxi-clear').click();check(phase+'/clear',cleared,Object.values(snap(p)));
});
for(const order of ['shared-before','shared-after'])for(const meta of [false,true])await scene('clear/'+order+'/'+meta,async()=>{
 const p=page(order);await load(p);p.change('pxi-format','image/webp');p.get('pxi-strength').value='24';p.get('pxi-strength').dispatch('input');p.get('pxi-entire').checked=true;p.get('pxi-entire').dispatch('change');p.get('pxi-file').value='C:\\fakepath\\old.png';p.ctrlL('pxi-download','L',meta);await settle();check(phase+'/derived-cleared',cleared,Object.values(snap(p)));check(phase+'/settings-kept',['image/webp','24',true],[p.get('pxi-format').value,p.get('pxi-strength').value,p.get('pxi-entire').checked]);check(phase+'/shared-once',1,p.persistCalls.filter(v=>v[0]==='clear').length);
 const q=page(order);q.controls.holdDecode=true;q.file(pngFile('late.png'));await waitFor(()=>q.decodes[0]?.ready);q.ctrlL('pxi-drop','l',meta);q.decodes[0].deliver();await settle();check(phase+'/late-decode-cleared',cleared,Object.values(snap(q)));check(phase+'/late-bitmap-closed',true,q.decodes[0].bitmap.closed);
});
for(const fallback of [false,true])await scene('decode-lifecycle/'+fallback,async()=>{
 const p=page();if(fallback)p.actual.ctx.createImageBitmap=undefined;p.controls.holdDecode=true;p.file(pngFile('old.png'));await waitFor(()=>p.decodes[0]?.ready);p.file(pngFile('new.png'));await waitFor(()=>p.decodes[1]?.ready);p.decodes[1].deliver();await settle();const before=snap(p);p.decodes[0].deliver();await settle();check(phase+'/late-source-does-not-overwrite',before,snap(p));p.get('pxi-download').click();await waitFor(()=>p.downloads.length===1);check(phase+'/current-name','new-pixelated.png',p.downloads[0].name);if(!fallback)check(phase+'/late-bitmap-closed',true,p.decodes[0].bitmap.closed);
 const q=page();if(fallback)q.actual.ctx.createImageBitmap=undefined;q.controls.holdDecode=true;q.file(pngFile('late.png'));await waitFor(()=>q.decodes[0]?.ready);q.file(badFile());const invalid=q.get('pxi-status').textContent;q.decodes[0].deliver();await settle();check(phase+'/invalid-keeps-error',[true,L.statusNotImage],[q.get('pxi-actions').hidden,q.get('pxi-status').textContent]);check(phase+'/actual-invalid-error',L.statusNotImage,invalid);
 const r=page();if(fallback)r.actual.ctx.createImageBitmap=undefined;r.controls.holdDecode=true;r.file(new File(['bad png'],'bad.png',{type:'image/png'}));await waitFor(()=>r.decodes[0]?.ready);r.file(pngFile('new.png'));await waitFor(()=>r.decodes[1]?.ready);r.decodes[1].deliver();await settle();const current=snap(r);r.decodes[0].deliver();await settle();check(phase+'/late-decode-error-keeps-current',current,snap(r));
});
for(const action of ['clear','new-source'])await scene('download-snapshot/'+action,async()=>{
 const p=page();await load(p);p.controls.holdEncode=true;p.get('pxi-download').click();await waitFor(()=>p.encodes[0]?.ready);if(action==='clear')p.get('pxi-clear').click();else await load(p,'new.png');const before=snap(p);p.encodes[0].deliver();await settle();check(phase+'/name','old-pixelated.png',p.downloads[0].name);check(phase+'/source-pixels-snapshot',originalPixels,await rgbaOf(p.downloads[0].blob));check(phase+'/no-current-feedback-write',before,snap(p));
 const q=page();await load(q);q.controls.holdEncode=true;q.get('pxi-download').click();await waitFor(()=>q.encodes[0]?.ready);if(action==='clear')q.get('pxi-clear').click();else await load(q,'new.png');const state=snap(q);q.encodes[0].deliver(null);await settle();check(phase+'/late-error-does-not-write',state,snap(q));check(phase+'/null-blob-no-download',0,q.downloads.length);
});
await scene('PNG-file-versus-pasted-JPEG',async()=>{
 const p=page();p.controls.holdDecode=true;p.file(pngFile('old.png'));await waitFor(()=>p.decodes[0]?.ready);const bytes=await sharp(Buffer.from(originalPixels),{raw:{width:2,height:2,channels:4}}).jpeg().toBuffer(),file=new File([bytes],'paste.jpg',{type:'image/jpeg'});p.doc.dispatch('paste',{clipboardData:{items:[{type:'image/jpeg',getAsFile:()=>file}]}});await waitFor(()=>p.decodes[1]?.ready);p.decodes[1].deliver();await settle();const before=snap(p);p.decodes[0].deliver();await settle();check(phase+'/old-file-keeps-current-paste',before,snap(p));check(phase+'/old-bitmap-closed',true,p.decodes[0].bitmap.closed);p.get('pxi-download').click();await waitFor(()=>p.downloads.length===1);check(phase+'/pasted-source-name','pasted-image-pixelated.png',p.downloads[0].name);check(phase+'/pasted-JPEG-source-dimensions',[2,2],[p.decodes[1].bitmap.width,p.decodes[1].bitmap.height]);
});
await scene('actual-blob-type-fallback-name',async()=>{
 const p=page();await load(p);p.change('pxi-format','image/webp');p.controls.holdEncode=true;p.get('pxi-download').click();await waitFor(()=>p.encodes[0]?.ready);const png=new Blob([await sharp(Buffer.from(originalPixels),{raw:{width:2,height:2,channels:4}}).png().toBuffer()],{type:'image/png'});p.encodes[0].deliver(png);await settle();check(phase+'/actual-PNG-name','old-pixelated.png',p.downloads[0].name);check(phase+'/complete-fallback-bytes',sha(new Uint8Array(await png.arrayBuffer())),sha(new Uint8Array(await p.downloads[0].blob.arrayBuffer())));
});
for(const lang of ['en','zh','ja','ko'])await scene('copy/'+lang,async()=>{
 const t=labels[lang],p=page('shared-after',lang);await load(p);p.get('pxi-copy').click();await waitFor(()=>p.clipboard.length===1);p.clipboard[0].reject(Error('denied'));await settle();check(phase+'/current-error',t.statusCopyFailed,p.get('pxi-status').textContent);p.get('pxi-copy').click();await waitFor(()=>p.clipboard.length===2);p.clipboard[1].resolve();await settle();check(phase+'/retry-success',t.statusCopied,p.get('pxi-status').textContent);
 for(const outcome of ['resolve','reject']){const q=page('shared-after',lang);await load(q);q.get('pxi-copy').click();await waitFor(()=>q.clipboard.length===1);await load(q,'new.png');const before=snap(q);q.clipboard[0][outcome](outcome==='reject'?Error('late'):undefined);await settle();check(phase+'/'+outcome+'-new-source-keeps-state',before,snap(q));q.get('pxi-copy').click();await waitFor(()=>q.clipboard.length===2);q.get('pxi-clear').click();q.clipboard[1][outcome](outcome==='reject'?Error('late'):undefined);await settle();check(phase+'/'+outcome+'-clear-keeps-state',cleared,Object.values(snap(q)));}
 const r=page('shared-after',lang);await load(r);r.controls.holdEncode=true;r.get('pxi-copy').click();await waitFor(()=>r.encodes[0]?.ready);r.get('pxi-clear').click();r.encodes[0].deliver();await settle();check(phase+'/clear-before-encoding-no-old-clipboard',0,r.clipboard.length);check(phase+'/clear-before-encoding-no-feedback',cleared,Object.values(snap(r)));
 for(const mode of ['missing','sync-throw']){const q=page('shared-after',lang);await load(q);let native=0;const n=Object.create({get clipboard(){native++;throw Error('native');}});Object.defineProperty(n,'clipboard',{value:mode==='missing'?undefined:{write(){throw Error('sync');}},writable:true});q.actual.ctx.navigator=n;q.get('pxi-copy').click();if(mode==='sync-throw')await waitFor(()=>q.encodes[0]?.delivered);await settle();check(phase+'/'+mode+'-native-access-zero',0,native);check(phase+'/'+mode+'-error',mode==='missing'?t.statusCopyUnsupported:t.statusCopyFailed,q.get('pxi-status').textContent);}
});
await scene('late-draft-frame-after-clear-and-new-source',async()=>{
 const p=page();await load(p);const canvas=p.get('pxi-canvas');canvas.dispatch('pointerdown',{clientX:0,clientY:0,pointerId:1});canvas.dispatch('pointermove',{clientX:2,clientY:2,pointerId:1});const late=[...p.timers.values()].find(v=>v.ms===16);must(late,'actual draft frame scheduled');p.get('pxi-clear').click();check(phase+'/draft-frame-cancelled',0,[...p.timers.values()].filter(v=>v.ms===16).length);late.fn();await settle();check(phase+'/forced-old-frame-does-not-write',cleared,Object.values(snap(p)));await load(p,'new.png');const before=snap(p);late.fn();await settle();canvas.dispatch('pointerup',{clientX:2,clientY:2,pointerId:1});check(phase+'/old-drag-does-not-add-new-region',before,snap(p));
});

await settle();check('no-unhandled-rejections',[],unhandled);process.removeListener('unhandledRejection',onRejection);
const pageCounts={PASS:checks.filter(c=>c.status==='PASS').length,FAIL:checks.filter(c=>c.status==='FAIL').length};
passes+=pageCounts.PASS;failures+=pageCounts.FAIL;
const report={node:process.version,source:process.env.ZT_B14_SOURCE||paths[Object.keys(paths)[0]],sourceSHA:sha(pageSource),legacyCounts,pageCounts,counts:{PASS:passes,FAIL:failures},checks,observations};
if(process.env.ZT_B14_REPORT){const {writeFileSync}=await import('node:fs');writeFileSync(process.env.ZT_B14_REPORT,JSON.stringify(report,null,2)+'\n');}
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode=failures?1:0;
