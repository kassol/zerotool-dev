// HTTP Header Analyzer — parsing, hints and the claims on the tool pages
//
// Read:  src/components/tools/HttpHeaderAnalyzerTool.astro (extracts HEADER_DB and the functions
//        from detectType to applyHints), src/content/tools/http-header-analyzer/{en,zh,ja,ko}.mdx,
//        src/data/persistence.ts
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: HTTP/2 and HTTP/3 pseudo-headers listed in their own group with RFC references and
// setting the message type (they used to be dropped); request / response / header-only
// detection, obs-fold; the
// hints for the problem response on the English page; the credentials warning is dropped when the
// pasted headers name a specific Allow-Origin (it used to show for every credentialed response);
// the X-XSS-Protection description no longer recommends `1; mode=block`; the SameSite note no
// longer says every browser defaults to Lax; the header count in the four seoDescriptions matches
// HEADER_DB; the page stays `disabled` in persistence.ts and the script stores nothing.
//
// Run: node scripts/test-http-header-analyzer.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { contractProblems, fencedBlocks } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/HttpHeaderAnalyzerTool.astro'), 'utf8');
const pages = Object.fromEntries(['en', 'zh', 'ja', 'ko'].map((l) => [l, readFileSync(join(root, `src/content/tools/http-header-analyzer/${l}.mdx`), 'utf8')]));
const dbStart = source.indexOf('var HEADER_DB');
const dbEnd = source.indexOf('var CATEGORY_ORDER');
const fnStart = source.indexOf('function detectType');
const fnEnd = source.indexOf('function localizedCategory');
if (dbStart < 0 || dbEnd <= dbStart || fnStart < 0 || fnEnd <= fnStart) {
  console.error('FAIL: could not locate HEADER_DB or the parser in HttpHeaderAnalyzerTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(dbStart, dbEnd) + source.slice(fnStart, fnEnd) + '\nreturn { parseHeaders, HEADER_DB };')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + e + '\n  actual   ' + a);
}
const hintsOf = (parsed, name) => parsed.headers.filter((h) => h.lower === name).flatMap((h) => h.hints.map((x) => x.sev + ': ' + x.text));

// detection and parsing
eq('response', E.parseHeaders('HTTP/1.1 404 Not Found\nX-A: 1').type, 'response');
eq('request', E.parseHeaders('OPTIONS /api HTTP/1.1\nHost: a').type, 'request');
eq('PROPFIND is not recognized', E.parseHeaders('PROPFIND /a HTTP/1.1\nHost: a').type, 'unknown');
eq('obs-fold', E.parseHeaders('X-Long: a\n  b').headers[0].value, 'a b');
// HTTP/2 and HTTP/3 pseudo-headers (RFC 9113 §8.3, RFC 9114 §4.3, RFC 8441 :protocol) are listed
// in their own group and set the message type; they used to be dropped
const h2res = E.parseHeaders(':status: 200\ncontent-type: text/plain\nset-cookie: a=b');
eq('pseudo-header kept', h2res.headers.map((h) => [h.name, h.value, h.cat]), [[':status', '200', 'pseudo'], ['content-type', 'text/plain', 'content'], ['set-cookie', 'a=b', 'cookie']]);
eq(':status makes a response', h2res.type, 'response');
eq(':status has a description', /RFC 9113/.test(h2res.headers[0].desc), true);
const h2req = E.parseHeaders(':method: GET\n:authority: example.com\n:scheme: https\n:path: /a?b=1\naccept: */*');
eq(':method makes a request', h2req.type, 'request');
eq('request pseudo-headers', h2req.headers.filter((h) => h.cat === 'pseudo').map((h) => h.name + '=' + h.value), [':method=GET', ':authority=example.com', ':scheme=https', ':path=/a?b=1']);
eq(':protocol (RFC 8441)', /8441/.test(E.parseHeaders(':protocol: websocket').headers[0].desc), true);
eq('unknown pseudo-header named as such', E.parseHeaders(':foo: 1').headers[0].desc, 'Not a pseudo-header defined for HTTP/2 or HTTP/3.');
eq('status line still wins', E.parseHeaders('HTTP/2 200\n:status: 200').type, 'response');
eq('value with colons', E.parseHeaders(':path: /a:b').headers[0].value, '/a:b');
eq('category order has pseudo after status', source.includes("var CATEGORY_ORDER = ['status', 'pseudo',"), true);
const strings=vm.runInNewContext(source.slice(source.indexOf('const STRINGS ='),source.indexOf('const T = STRINGS[lang]')).replace(/ as const;/,';')+';STRINGS;');
for (const lang of ['en', 'zh', 'ja', 'ko']) eq(lang + ' has catPseudo', typeof strings[lang].catPseudo === 'string' && strings[lang].catPseudo.length > 0, true);
eq('header count', Object.keys(E.HEADER_DB).length, 88);
eq('unknown header is custom', E.parseHeaders('X-Request-Id: 7f3a').headers[0].cat, 'custom');

// the problem response on the English page
const problem = [
  'HTTP/2 200',
  'content-type: text/html; charset=utf-8',
  'strict-transport-security: max-age=86400',
  "content-security-policy: script-src 'self' 'unsafe-inline'",
  'access-control-allow-origin: *',
  'access-control-allow-credentials: true',
  'set-cookie: sid=31d4d96e407aad42; Path=/',
  'cache-control: no-store, max-age=600',
  'server: nginx',
].join('\n');
eq('page shows the problem response', pages.en.includes(problem), true);
const p = E.parseHeaders(problem);
eq('problem: response', [p.type, p.statusLine], ['response', 'HTTP/2 200']);
eq('problem: HSTS', hintsOf(p, 'strict-transport-security')[0], 'warn: max-age < 1 year (31536000s). Many preload lists require ≥ 1 year.');
eq('problem: CSP', hintsOf(p, 'content-security-policy'), ["warn: 'unsafe-inline' defeats most XSS protection. Use nonces or hashes instead.", 'info: No default-src — define one as a safety net.']);
eq('problem: credentials with *', hintsOf(p, 'access-control-allow-credentials'), ['warn: Credentialed CORS requires explicit Allow-Origin (no wildcard).']);
eq('problem: cookie', hintsOf(p, 'set-cookie').length, 3);
eq('problem: cache-control', hintsOf(p, 'cache-control'), ['warn: no-store and max-age together — no-store wins, max-age is dead weight.']);
eq('problem: server', hintsOf(p, 'server').length, 1);
for (const quote of [
  'max-age &lt; 1 year (31536000s). Many preload lists require ≥ 1 year.',
  "'unsafe-inline' defeats most XSS protection. Use nonces or hashes instead.",
  'Credentialed CORS requires explicit Allow-Origin (no wildcard).',
]) eq('page quotes ' + quote, pages.en.includes(quote), true);

// credentials warning only with a wildcard or no origin
const explicit = E.parseHeaders('HTTP/1.1 200 OK\nAccess-Control-Allow-Origin: https://app.example.com\nAccess-Control-Allow-Credentials: true');
eq('explicit origin: no credentials warning', hintsOf(explicit, 'access-control-allow-credentials'), []);
const alone = E.parseHeaders('HTTP/1.1 200 OK\nAccess-Control-Allow-Credentials: true');
eq('no origin pasted: warning stays', hintsOf(alone, 'access-control-allow-credentials').length, 1);

// texts that used to be wrong
eq('X-XSS-Protection description', /mode=block is the safer/.test(E.HEADER_DB['x-xss-protection'].desc), false);
eq('SameSite note', hintsOf(E.parseHeaders('HTTP/1.1 200 OK\nSet-Cookie: a=b; Secure; HttpOnly'), 'set-cookie'), ['info: No SameSite — Chrome treats the cookie as Lax, Firefox and Safari do not. Set it explicitly.']);
eq('cookie name containing httponly', hintsOf(E.parseHeaders('HTTP/1.1 200 OK\nSet-Cookie: httponly=1; Secure; SameSite=Lax'), 'set-cookie').length, 1);

// header count claims and sensitive page
const n = String(Object.keys(E.HEADER_DB).length);
for (const [lang, text] of Object.entries(pages)) {
  const desc = /^seoDescription: "(.*)"$/m.exec(text)[1];
  eq(lang + ': seoDescription states the header count', desc.includes(n) && !desc.includes('100+'), true);
  eq(lang + ': no fetch -v', text.includes('fetch -v'), false);
}
eq('persistence disabled', /'http-header-analyzer': 'disabled'/.test(readFileSync(join(root, 'src/data/persistence.ts'), 'utf8')), true);
eq('script stores nothing', /localStorage|sessionStorage|ztPersist|fetch\(/.test(source), false);

// ---------- real page controls and shared shortcuts ----------
// Execute the complete inline IIFE with actual markup, localized strings and shared keydown.
// Only DOM/clipboard delivery are controlled; parse5 decodes the real rendered output.
console.log('Existing checks: '+passes+' passed, '+failures+' failed');
const pageStart=passes, requireFromRoot=createRequire(join(root,'package.json'));
const {parseFragment,defaultTreeAdapter}=requireFromRoot('parse5');
const inline=source.match(/<script is:inline[^>]*>([\s\S]*?)<\/script>/)[1];
const layout=readFileSync(join(root,'src/layouts/ToolLayout.astro'),'utf8');
const shortcut=layout.slice(layout.indexOf('// ── Keyboard shortcuts:'),layout.indexOf('// ── Copy button visual feedback'));
const must=(ok,message)=>{if(!ok)throw Error('Harness prerequisite: '+message);};
must(shortcut.includes('window.ztPersist.clear(_slug)'),'actual shared shortcut');
const settle=()=>new Promise(setImmediate);
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const escapeHtml=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const unhandled=[],onUnhandled=error=>unhandled.push(String(error));process.on('unhandledRejection',onUnhandled);
function page(lang='en',order='shared-after',options={}){
  const clipboard=[],downloads=[],timers=new Map(),tracks=[],blobs=new Map(),execCalls=[],clears=[];
  let timerId=0,doc,copyMode='pending',execMode=options.execMode??'false';
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
    get hidden() { return this._hidden || false; }
    set hidden(value) { this._hidden=!!value;if(value&&doc?.activeElement&&this.contains(doc.activeElement))doc.activeElement=doc.body; }
    get value() {
      if (!this.dirtyValue && this.tagName === 'TEXTAREA') return this.textContent;
      if (!this.dirtyValue && this.tagName === 'SELECT') return this.querySelector('option')?.value ?? '';
      return this._value;
    }
    set value(v) { this._value = String(v); this.dirtyValue = true; }
    get firstChild() { return this.children[0]??null; }
    get dataset() { const el=this;return new Proxy({}, {get(_,key){return el.getAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()));},set(_,key,value){el.setAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()),value);return true;}}); }
    get parentElement() { return this.parentNode; }
    get isConnected() { return doc.contains(this); }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) el.className = (el.className + ' ' + c).trim(); }, remove(c) { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); }, toggle(c,force) { const yes=force??!this.contains(c);yes?this.add(c):this.remove(c);return yes; } }; }
    setAttribute(k, v) { this.attributes[k] = String(v); if (['id', 'class', 'type', 'value'].includes(k)) this[k === 'class' ? 'className' : k] = String(v); if (['hidden', 'disabled', 'checked'].includes(k)) this[k] = true; }
    getAttribute(k) { if (['id', 'class', 'type'].includes(k)) return this[k === 'class' ? 'className' : k] || null; return this.attributes[k] ?? null; }
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
        for (const fn of el.listeners[event.type] || []) fn.call(el, event);
        if (!event.bubbles || event.stopped) break;
      }
      return !event.defaultPrevented;
    }
    dispatch(type, extra = {}) { return this.dispatchEvent(new EventStub(type, { bubbles: true, ...extra })); }
    click() { if(this.disabled)return;if(this.tagName==='A'&&this.download)downloads.push({name:this.download,blob:blobs.get(this.href)});this.dispatch('click'); }
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
  doc = new Element('#document'); doc.documentElement = new Element('html'); doc.documentElement.lang = lang; doc.appendChild(doc.documentElement);
  doc.body = new Element('body'); doc.documentElement.appendChild(doc.body);
  const widget = new Element('section'); widget.className = 'tool-widget'; doc.body.appendChild(widget);
  const {tips:TIPS,...client}=strings[lang];
  const markup = source.replace(/^---\n[\s\S]*?\n---\s*/,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').split('<style')[0].replace(/placeholder=\{("(?:[^"\\]|\\.)*")\}/g,(_,json)=>'placeholder="'+escapeHtml(JSON.parse(json))+'"')
    .replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g,(_,id,about,key)=>'<span class="zt-tip"><button type="button" data-zt-tip="'+id+'" aria-label="'+escapeHtml(client[about])+'"></button><span id="'+id+'" role="note">'+escapeHtml(TIPS[key])+'</span></span>')
    .replace(/=\{T\.(\w+)\}/g,(_,key)=>'="'+escapeHtml(client[key])+'"').replace(/\{T\.(\w+)\}/g,(_,key)=>escapeHtml(client[key]));
  widget.innerHTML = markup;
  doc.getElementById = id => descendants(doc).find(el => el.id === id) ?? null;
  doc.createElement = tag => new Element(tag);
  doc.activeElement = doc.body;
  doc.execCommand = command => { execCalls.push({command,text:doc.selectedElement?.value??null});if(execMode==='throw')throw Error('probe blocked execCommand');return execMode==='true'; };
  const scriptNode=new Element('script');widget.querySelector('.hha-wrap').appendChild(scriptNode);doc.currentScript=scriptNode;

  const sandbox={t:client,document:doc,console,TextEncoder,TextDecoder,Event:EventStub,Blob,
    _slug:'http-header-analyzer',ztPersist:{clear(slug){clears.push(slug);}},trackTool(...args){tracks.push(args);},
    setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout(id){timers.delete(id);},
    navigator:options.noClipboard?{}:{clipboard:{writeText(value){if(copyMode==='throw')throw Error('Synchronous copy denial');const d=deferred();clipboard.push({...d,value:String(value)});return d.promise;},write(){throw Error('Unexpected clipboard.write');}}},
    URL:{createObjectURL(blob){const url='blob:probe-'+blobs.size;blobs.set(url,blob);return url;},revokeObjectURL(url){blobs.delete(url);}},
  };
  sandbox.window=sandbox;const context=vm.createContext(sandbox);
  if(order==='shared-before')vm.runInContext(shortcut,context,{filename:'ToolLayout.astro:keydown'});
  vm.runInContext(inline,context,{filename:'HttpHeaderAnalyzerTool.astro:complete-inline',timeout:1000});
  if(order==='shared-after')vm.runInContext(shortcut,context,{filename:'ToolLayout.astro:keydown'});
  doc.currentScript=null;
  const get=id=>{const el=doc.getElementById(id);must(el,'source ID '+id);return el;};
  const nativeClipboard=sandbox.navigator.clipboard;
  return{order,doc,widget,get,clipboard,downloads,execCalls,timers,tracks,clears,
    copyMode(mode){copyMode=mode;sandbox.navigator.clipboard=mode==='missing'?undefined:nativeClipboard;},
    execMode(mode){execMode=mode;},
    input(id,text){get(id).value=text;get(id).dispatch('input');},
    key(id='hha-input',key='l',mod='ctrlKey'){const el=id==='outside'?doc.body:id.startsWith('tip:')?doc.querySelector('[data-zt-tip="'+id.slice(4)+'"]'):get(id);el.focus();const event=new EventStub('keydown',{bubbles:true,key,[mod]:true});el.dispatchEvent(event);return event;},
    flush(ms){for(const[id,t]of[...timers])if(t.ms===ms){timers.delete(id);t.fn();}},
    fire(id){const t=timers.get(id);must(t,'captured actual timer');timers.delete(id);t.fn();},
  };
}

const fixture='HTTP/1.1 200 OK\nX-Probe: old\nX-Probe: second\nContent-Type: text/plain';
const expected={_status:'HTTP/1.1 200 OK','x-probe':['old','second'],'content-type':'text/plain'};
function analyze(h,text=fixture){h.input('hha-input',text);h.get('hha-analyze').click();}
function snapshot(h){return{input:h.get('hha-input').value,status:h.get('hha-status').textContent,statusClass:h.get('hha-status').className,hidden:h.get('hha-result').hidden,json:h.get('hha-json-output').textContent,raw:h.get('hha-raw-output').textContent};}
for(const lang of ['en','zh','ja','ko']){
  const T=strings[lang],parsed=T.analyzed.replace('{n}','3').replace('{s}','s');
  for(const order of ['shared-before','shared-after']){
    const h=page(lang,order);analyze(h);
    eq(lang+' '+order+' real JSON full bytes',h.get('hha-json-output').textContent,JSON.stringify(expected,null,2));
    eq(lang+' '+order+' golden parsed status',h.get('hha-status').textContent,parsed);
    h.get('hha-tab-json').click();eq(lang+' JSON tab visible',[h.get('hha-panel-cat').hidden,h.get('hha-panel-raw').hidden,h.get('hha-panel-json').hidden],[true,true,false]);
    const old=snapshot(h);eq(lang+' outside CtrlL untouched',h.key('outside').defaultPrevented,false);eq(lang+' outside state kept',snapshot(h),old);
    eq(lang+' unmodified L untouched',h.key('hha-input','L','shiftKey').defaultPrevented,false);eq(lang+' unmodified state kept',snapshot(h),old);
    for(const mod of ['ctrlKey','metaKey'])for(const key of ['l','L']){
      analyze(h);h.get('hha-copy-json').click();const pending=h.clipboard.at(-1);
      eq(lang+' scoped shortcut prevents default',h.key('hha-tab-json',key,mod).defaultPrevented,true);
      eq(lang+' clear fields/status/result',[h.get('hha-input').value,h.get('hha-status').textContent,h.get('hha-result').hidden],['','',true]);
      eq(lang+' shared persistence called after focused result hides',h.clears.at(-1),'http-header-analyzer');
      const cleared=snapshot(h);pending.resolve();await settle();eq(lang+' pending copy cannot restore cleared state',snapshot(h),cleared);
      const count=h.clipboard.length;h.get('hha-copy-json').click();eq(lang+' cleared cache cannot copy',h.clipboard.length,count);eq(lang+' current empty copy says analyze first',h.get('hha-status').textContent,T.analyzeFirst);
    }
    analyze(h);h.get('hha-clear').click();eq(lang+' explicit clear same state',[h.get('hha-input').value,h.get('hha-status').textContent,h.get('hha-result').hidden],['','',true]);
    h.input('hha-input','HTTP/1.1 204 No Content\nX-Probe: new');h.key('hha-input','Enter');eq(lang+' CtrlEnter real Analyze',JSON.parse(h.get('hha-json-output').textContent),{_status:'HTTP/1.1 204 No Content','x-probe':'new'});
  }
  for(const mode of ['reject','throw','missing'])for(const fallback of ['true','false','throw']){
    const h=page(lang);analyze(h);h.copyMode(mode);h.execMode(fallback);let thrown=false;try{h.get('hha-copy-json').click();}catch{thrown=true;}
    if(mode==='reject')h.clipboard[0].reject(Error('Denied'));await settle();
    eq(lang+' '+mode+'/'+fallback+' no sync throw',thrown,false);eq(lang+' '+mode+'/'+fallback+' truthful status',h.get('hha-status').textContent,fallback==='true'?T.copied:T.copyFailed);
    eq(lang+' '+mode+'/'+fallback+' fallback exact bytes',h.execCalls.map(c=>[c.command,c.text]),[['copy',JSON.stringify(expected,null,2)]]);
    eq(lang+' fallback textarea removed',h.doc.body.querySelectorAll('textarea').length,1);
    h.copyMode('pending');h.get('hha-copy-json').click();eq(lang+' retry actual copy bytes',h.clipboard.at(-1).value,JSON.stringify(expected,null,2));h.clipboard.at(-1).resolve();await settle();eq(lang+' direct retry succeeds',h.get('hha-status').textContent,T.copied);
  }
  const edits={clear:h=>h.get('hha-clear').click(),ctrlL:h=>h.key(),input:h=>h.input('hha-input','X-Other: pending'),analyze:h=>analyze(h,'HTTP/1.1 204 No Content\nX-Probe: new'),invalid:h=>analyze(h,'unparseable'),empty:h=>analyze(h,''),example:h=>{h.get('hha-example').value='response-basic';h.get('hha-example').dispatch('change');}};
  for(const[name,edit]of Object.entries(edits))for(const outcome of ['resolve','reject']){
    const h=page(lang);analyze(h);h.get('hha-copy-json').click();const pending=h.clipboard[0];edit(h);const current=snapshot(h);
    pending[outcome](outcome==='reject'?Error('Old denial'):undefined);await settle();eq(lang+' late '+outcome+' after '+name+' leaves state',snapshot(h),current);eq(lang+' late '+outcome+' after '+name+' never invokes stale fallback',h.execCalls.length,0);
  }
  for(const outcome of ['resolve','reject'])for(const oldFirst of [true,false]){
    const h=page(lang);analyze(h);h.get('hha-copy-json').click();h.get('hha-copy-json').click();const pending=h.clipboard[0],newest=h.clipboard[1];
    if(!oldFirst){newest.resolve();await settle();}
    const current=snapshot(h);pending[outcome](Error('Old denial'));await settle();eq(lang+' overlapping '+outcome+' oldFirst='+oldFirst+' leaves newest state',snapshot(h),current);eq(lang+' overlapping stale failure cannot fallback',h.execCalls.length,0);
    if(oldFirst){newest.resolve();await settle();}eq(lang+' latest request succeeds',h.get('hha-status').textContent,T.copied);
  }
  const h=page(lang);analyze(h);h.input('hha-input','X-New: pending');eq(lang+' manual editing preserves displayed results',h.get('hha-json-output').textContent,JSON.stringify(expected,null,2));h.get('hha-copy-json').click();eq(lang+' new Copy exports displayed last analyzed result',h.clipboard.at(-1).value,JSON.stringify(expected,null,2));h.clipboard.at(-1).resolve();await settle();
  analyze(h,'');eq(lang+' empty Analyze prompt and no result',[h.get('hha-status').textContent,h.get('hha-result').hidden],[T.pastePrompt,true]);
  analyze(h,'unparseable');eq(lang+' input with no header line lists the line',[h.get('hha-status').textContent,h.get('hha-result').hidden],[T.empty+T.noteSep+T.invalidLines.replace('{n}','1'),false]);
}
await settle();eq('all clipboard rejections handled',unhandled,[]);process.removeListener('unhandledRejection',onUnhandled);
const protectedBytes={"dictionary":{"bytes":10097,"sha256":"fe0b5a0c6c248d1cdd58c90f32954f8282d391f5bc40a88affd3f9180c92d3a1"},"parser":{"bytes":10676,"sha256":"930f8cffdeab31ce53bab7305e929c19bd116ca6332700d77a6a1fd9fd3e8514"}};
for(const[key,start,end]of[['dictionary',dbStart,dbEnd],['parser',fnStart,fnEnd]])eq(key+' byte-exact',[Buffer.byteLength(source.slice(start,end)),createHash('sha256').update(source.slice(start,end)).digest('hex')],[protectedBytes[key].bytes,protectedBytes[key].sha256]);
console.log('Page lifecycle: '+(passes-pageStart)+' passed, '+failures+' total failures');

// ---------- v2 page layout ----------
const v2Start=passes;
const registry=readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8');
const markup=source.replace(/^---\n[\s\S]*?\n---\s*/,'').split('<script')[0];
const css=source.split('<style is:global>')[1].split('</style>')[0];
eq('registered analyze layout', /'http-header-analyzer':\s*'analyze'/.test(registry),true);
eq('direct tool root',markup.trim().startsWith('<div class="hha-wrap">'),true);
eq('root flex column with zero minimum',/\.hha-wrap\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-width:\s*0;[^}]*min-height:\s*0;/.test(css),true);
eq('controls then fixed status then input then results',markup.indexOf('class="hha-actions"')<markup.indexOf('id="hha-status"')&&markup.indexOf('id="hha-status"')<markup.indexOf('class="hha-input-section"')&&markup.indexOf('id="hha-input"')<markup.indexOf('id="hha-result"'),true);
eq('empty desktop input pane fills available height',/\.hha-wrap:has\(\.hha-result\[hidden\]\) \.hha-input-section\s*\{[^}]*flex:\s*1 1 0/.test(css),true);
eq('empty desktop actual textarea fills available height',/\.hha-wrap:has\(\.hha-result\[hidden\]\) #hha-input\s*\{[^}]*flex:\s*1 1 0;[^}]*height:\s*auto/.test(css),true);
eq('analyzed input stays short and scrollable',/#hha-input\s*\{[^}]*height:\s*180px;[^}]*min-height:\s*0;[^}]*resize:\s*none;[^}]*overflow:\s*auto/.test(css),true);
eq('status reserves height and scrolls',/#hha-status\s*\{[^}]*height:\s*3rem;[^}]*min-height:\s*3rem;[^}]*overflow:\s*auto/.test(css),true);
eq('result flex zero basis',/\.hha-result\s*\{[^}]*flex:\s*1 1 0;[^}]*min-width:\s*0;[^}]*min-height:\s*0/.test(css),true);
eq('all view panels have internal scrolling',/\.hha-panel\s*\{[^}]*flex:\s*1 1 0;[^}]*min-width:\s*0;[^}]*min-height:\s*0;[^}]*overflow:\s*auto/.test(css),true);
eq('dynamic categories keep natural content height',/\.hha-cat-section\s*\{[^}]*flex:\s*none/.test(css),true);
eq('raw and JSON text keep natural height within scroller',/\.hha-pre\s*\{[^}]*flex:\s*none/.test(css),true);
eq('dynamic cards styled globally',source.includes('<style is:global>')&&css.includes('.hha-card {'),true);
for(const selector of ['hha-panel','hha-result','hha-summary-pill'])eq(selector+' hidden remains hidden',new RegExp('\\.'+selector+'\\[hidden\\]\\s*\\{\\s*display:\\s*none').test(css),true);
const stacked=css.split('@media (max-width: 860px)')[1]?.split('@media')[0]||'',phone=css.split('@media (max-width: 640px)')[1]||'';
eq('stacked short editor includes empty state',stacked.includes('.hha-wrap:has(.hha-result[hidden]) #hha-input')&&stacked.includes('height: 140px'),true);
eq('stacked result bounded',/\.hha-result\s*\{[^}]*height:\s*24rem/.test(stacked),true);
eq('phone result bounded',/\.hha-result\s*\{[^}]*height:\s*22rem/.test(phone),true);
eq('stacked empty hint hidden',stacked.includes('.hha-empty { display: none; }'),true);
eq('phone select and tabs have touch height',phone.includes('.hha-example-select { min-height: 44px; }')&&/\.hha-tab\s*\{[^}]*min-height:\s*44px/.test(phone),true);
eq('build-time localized controls',!source.includes('data-i18n')&&!inline.includes('document.documentElement.lang'),true);
eq('tips removed from client object',source.includes('const { tips: TIPS, ...CLIENT_T } = T;')&&source.includes('define:vars={{ t: CLIENT_T }}'),true);
eq('client never reads tip content',/TIPS|\.tips\b/.test(inline),false);
eq('sensitive notice visible below result',markup.includes('<p class="hha-privacy">{T.privacyNote}</p>')&&markup.indexOf('class="hha-privacy"')>markup.indexOf('id="hha-panel-json"'),true);
const tipMap={analyze:'analyze',example:'exampleLabel',clear:'clear',copy:'copyJson',input:'rawHeaders',views:'views'};
eq('six tips only',[...markup.matchAll(/<Toggletip\b/g)].length,Object.keys(tipMap).length);
for(const[key,about]of Object.entries(tipMap))eq('tip binding '+key,markup.includes('id="hha-tip-'+key+'" lang={lang} about={T.'+about+'}>{TIPS.'+key+'}</Toggletip>'),true);
for(const lang of ['en','zh','ja','ko']){
  const T=strings[lang],h=page(lang);
  eq(lang+' localized keys',Object.keys(T).sort(),Object.keys(strings.en).sort());
  eq(lang+' tip keys',Object.keys(T.tips).sort(),Object.keys(tipMap).sort());
  for(const[key,value]of Object.entries(T.tips)){
    eq(lang+' '+key+' nonempty plain tip',typeof value==='string'&&value.trim().length>0&&!/[<>]/.test(value),true);
    eq(lang+' '+key+' tip placeholders',(value.match(/\{\w+\}/g)||[]).sort(),(strings.en.tips[key].match(/\{\w+\}/g)||[]).sort());
  }
  for(const[id,key]of Object.entries({'hha-analyze':'analyze','hha-clear':'clear','hha-copy-json':'copyJson','hha-tab-cat':'tabCategorized','hha-tab-raw':'tabRaw','hha-tab-json':'tabJson'}))eq(lang+' server text '+id,h.get(id).textContent,T[key]);
  eq(lang+' initial empty state',h.get('hha-result').hidden,true);
  eq(lang+' localized input label',h.doc.querySelector('label[for="hha-input"]').textContent,T.rawHeaders);
  eq(lang+' localized select accessible name',h.get('hha-example').getAttribute('aria-label'),T.exampleLabel);
  eq(lang+' direct sensitive note text',h.doc.querySelector('.hha-privacy').textContent,T.privacyNote);
  eq(lang+' note names unredacted fields',T.privacyNote.includes('Authorization')&&T.privacyNote.includes('Cookie'),true);
  eq(lang+' notice always outside hidden result',h.doc.querySelector('.hha-privacy').closest('.hha-result'),null);
  for(const[id,key]of [['response-secure','exResponseSecure'],['response-basic','exResponseBasic'],['request-auth','exRequestAuth'],['cors-preflight','exCorsPreflight']]){
    eq(lang+' sample option label '+id,h.get('hha-example').querySelector('option[value="'+id+'"]').textContent,T[key]);
    h.get('hha-example').value=id;h.get('hha-example').dispatch('change');
    eq(lang+' sample immediately analyzes '+id,h.get('hha-result').hidden,false);
    eq(lang+' sample selector resets '+id,h.get('hha-example').value,'');
  }
  const secretFixture='HTTP/2 200\nAuthorization: Bearer local-fixture\nCookie: session=local-fixture\nSet-Cookie: a=1\nSet-Cookie: b=2';
  analyze(h,secretFixture);
  const full=JSON.stringify({_status:'HTTP/2 200',authorization:'Bearer local-fixture',cookie:'session=local-fixture','set-cookie':['a=1','b=2']},null,2);
  eq(lang+' sensitive results retain actual values',h.get('hha-json-output').textContent,full);
  for(const tab of ['cat','raw','json']){
    h.get('hha-tab-'+tab).click();eq(lang+' active result '+tab,h.get('hha-panel-'+tab).hidden,false);
    eq(lang+' keyboard scroll target '+tab,h.get('hha-panel-'+tab).getAttribute('tabindex'),'0');
    h.get('hha-copy-json').click();eq(lang+' complete same copy in '+tab,h.clipboard.at(-1).value,full);h.clipboard.at(-1).resolve();await settle();
  }
  for(const order of ['shared-before','shared-after'])for(const target of ['hha-panel-cat','tip:hha-tip-views']){
    const x=page(lang,order);analyze(x);const count=x.clears.length;
    eq(lang+' '+order+' result focus clear '+target,x.key(target).defaultPrevented,true);
    eq(lang+' '+order+' input focus remains visible '+target,x.doc.activeElement.id,'hha-input');
    eq(lang+' '+order+' shared clear completes '+target,x.clears.length,count+1);
    eq(lang+' '+order+' cleared result hidden '+target,x.get('hha-result').hidden,true);
  }
  const steps=pages[lang].match(/^steps:\n((?:  - .+\n)+)/m)?.[1].trim().split('\n').map(line=>JSON.parse(line.trim().slice(2)))||[];
  eq(lang+' five usage steps',steps.length,5);
  eq(lang+' bounded plain steps',steps.every(x=>x.length>0&&x.length<=280&&!/<\/?[a-z]/i.test(x))&&steps.join('').length<=1200,true);
  eq(lang+' old usage removed',/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(pages[lang]),false);
  eq(lang+' MDX content contract', contractProblems('http-header-analyzer', lang), '');
}
const longPage=page();
const longHeaders=Array.from({length:1200},(_,i)=>'X-Entry-'+i+': '+('payload'+i).repeat(12));
analyze(longPage,'HTTP/1.1 200 OK\n'+longHeaders.join('\n'));
eq('long result renders every header',longPage.get('hha-panel-cat').querySelectorAll('.hha-card').length,1200);
const longJSON=JSON.stringify(Object.fromEntries([['_status','HTTP/1.1 200 OK'],...longHeaders.map(line=>{const i=line.indexOf(': ');return[line.slice(0,i).toLowerCase(),line.slice(i+2)];})]),null,2);
eq('long result JSON complete',longPage.get('hha-json-output').textContent,longJSON);
longPage.get('hha-copy-json').click();eq('long copy never truncates',longPage.clipboard.at(-1).value,longJSON);longPage.clipboard.at(-1).resolve();await settle();
console.log('v2 page layout: '+(passes-v2Start)+' passed, '+failures+' total failures');

// ---------- JSON view keys and analytics ----------
// The JSON view used a plain object: a header named __proto__ was dropped and names such as
// constructor or toString became [null, value]. Analyze sent an event on every click (also for
// the same input), and Copy JSON sent copy_json even when copying failed.
const fixStart=passes;
for(const lang of ['en','zh','ja','ko']){
  const h=page(lang);
  analyze(h,'HTTP/1.1 200 OK\nconstructor: a\n__proto__: b\nToString: c\nhasOwnProperty: d\nX-A: 1\nx-a: 2');
  eq(lang+' JSON keeps every header name',h.get('hha-json-output').textContent,
    '{\n  "_status": "HTTP/1.1 200 OK",\n  "constructor": "a",\n  "__proto__": "b",\n  "tostring": "c",\n  "hasownproperty": "d",\n  "x-a": [\n    "1",\n    "2"\n  ]\n}');
  const a=page(lang),count=name=>a.tracks.filter(t=>t[1]===name).length;
  analyze(a);analyze(a);a.get('hha-analyze').click();
  eq(lang+' same input analyzed again sends one event',count('analyze'),1);
  analyze(a,'HTTP/1.1 204 No Content\nX-Probe: new');eq(lang+' new input sends one more event',count('analyze'),2);
  a.get('hha-example').value='response-basic';a.get('hha-example').dispatch('change');eq(lang+' example sends an event',count('analyze'),3);
  a.get('hha-clear').click();analyze(a,'HTTP/1.1 204 No Content\nX-Probe: new');eq(lang+' clear resets the last tracked input',count('analyze'),4);
  analyze(a,'');analyze(a,'unparseable');eq(lang+' empty or invalid input sends no event',count('analyze'),4);
  analyze(a,'HTTP/1.1 204 No Content\nX-Probe: new');eq(lang+' input tracked last stays deduplicated',count('analyze'),4);
  a.get('hha-copy-json').click();eq(lang+' copy is not tracked before it succeeds',count('copy_json'),0);
  a.clipboard.at(-1).resolve();await settle();eq(lang+' successful copy tracked once',count('copy_json'),1);
  a.copyMode('reject');a.execMode('false');a.get('hha-copy-json').click();a.clipboard.at(-1).reject(Error('Denied'));await settle();
  eq(lang+' failed copy is not tracked',count('copy_json'),1);
  a.execMode('true');a.get('hha-copy-json').click();a.clipboard.at(-1).reject(Error('Denied'));await settle();
  eq(lang+' fallback copy success is tracked',count('copy_json'),2);
  a.copyMode('missing');a.execMode('true');a.get('hha-copy-json').click();eq(lang+' copy without Clipboard API tracked on success',count('copy_json'),3);
  a.execMode('false');a.get('hha-copy-json').click();eq(lang+' copy without Clipboard API not tracked on failure',count('copy_json'),3);
}
console.log('JSON keys and analytics: '+(passes-fixStart)+' passed, '+failures+' total failures');

// ---------- RFC parsing fixes (approved changes to the protected parser, 2026-10-09) ----------
const rfcStart=passes;
const names=p=>p.headers.map(h=>h.name);
// 1. The header section ends at the first empty line after a header line (RFC 9112 §2.1);
// curl -v "* " lines and "{ [n bytes data]" lines are skipped and "> " / "< " prefixes removed.
{
  const body=E.parseHeaders('HTTP/1.1 200 OK\nContent-Type: application/json\nContent-Length: 61\n\n{"code":0,"msg":"ok"}\n{\n  "name": "x"\n}');
  eq('1 body after the empty line is not read',[body.type,body.statusLine,names(body)],['response','HTTP/1.1 200 OK',['Content-Type','Content-Length']]);
  eq('1 stop line and lines left',body.stop,{line:4,rest:4});
  const lead=E.parseHeaders('\n\n  \nHTTP/1.1 204 No Content\nX-A: 1\n');
  eq('1 leading empty lines are skipped, trailing one leaves nothing',[lead.statusLine,names(lead),lead.stop],['HTTP/1.1 204 No Content',['X-A'],{line:6,rest:0}]);
  const verbose=E.parseHeaders('*   Trying 93.184.215.14:443...\n* Connected to example.com (93.184.215.14) port 443\n} [5 bytes data]\n> GET / HTTP/2\n> Host: example.com\n> user-agent: curl/8.7.1\n>\n* Request completely sent off\n< HTTP/2 200\n< content-type: text/html\n<\n<!doctype html>');
  eq('1 curl -v request part',[verbose.type,verbose.statusLine,names(verbose)],['request','GET / HTTP/2',['Host','user-agent']]);
  eq('1 curl -v stops at the bare > line',verbose.stop,{line:7,rest:5});
  const response=E.parseHeaders('< HTTP/1.1 200 OK\n< Server: nginx\n< Content-Type: text/xml;charset=utf-8\n<\n<?xml version="1.0"?>');
  eq('1 curl -v response part',[response.type,response.statusLine,names(response),hintsOf(response,'server').length],['response','HTTP/1.1 200 OK',['Server','Content-Type'],1]);
  eq('1 obs-fold still joins',E.parseHeaders('X-Long: a\n\tb\n  c').headers[0].value,'a b c');
  eq('1 no stop when no empty line',E.parseHeaders('X-A: 1').stop,null);
  for(const lang of ['en','zh','ja','ko']){
    const h=page(lang);analyze(h,'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{"code":0}\n{"next":1}');
    eq(lang+' 1 status names the stop line and the lines left',h.get('hha-status').textContent,strings[lang].analyzed.replace('{n}','1').replace('{s}','')+strings[lang].noteSep+strings[lang].bodyStop.replace('{line}','3').replace('{n}','2'));
    eq(lang+' 1 JSON has no body key',JSON.parse(h.get('hha-json-output').textContent),{_status:'HTTP/1.1 200 OK','content-type':'application/json'});
    analyze(h,'HTTP/1.1 200 OK\nContent-Type: application/json\n');
    eq(lang+' 1 no note without lines after the empty line',h.get('hha-status').textContent,strings[lang].analyzed.replace('{n}','1').replace('{s}',''));
  }
}
// 2. The HSTS max-age value may be a quoted-string (RFC 6797 §6.1, §6.1.1).
{
  const sts=v=>hintsOf(E.parseHeaders('HTTP/1.1 200 OK\nStrict-Transport-Security: '+v),'strict-transport-security');
  eq('2 quoted max-age of one year has no warning',sts('max-age="31536000"; includeSubDomains; preload'),[]);
  eq('2 quoted max-age with spaces',sts('max-age = "63072000" ; includeSubDomains; preload'),[]);
  eq('2 quoted short max-age still warns',sts('max-age="86400"; includeSubDomains; preload'),['warn: max-age < 1 year (31536000s). Many preload lists require ≥ 1 year.']);
  eq('2 plain max-age unchanged',sts('max-age=31536000; includeSubDomains; preload'),[]);
}
// 3. A line without an ASCII colon (or with an empty name) is listed as not read, with the
// original line number; a full-width colon (U+FF1A) has its own note.
{
  const p=E.parseHeaders('HTTP/1.1 200 OK\nContent-Type：text/html\nX-A: 1\njust text\n: no-name\nX-Wide：a: b');
  eq('3 only valid lines are headers',names(p),['X-A']);
  eq('3 invalid lines with line numbers and reasons',p.invalid,[
    {line:2,text:'Content-Type：text/html',problem:'fullwidthColon'},
    {line:4,text:'just text',problem:'noColon'},
    {line:5,text:': no-name',problem:'noName'},
    {line:6,text:'X-Wide：a: b',problem:'fullwidthColon'}]);
  eq('3 obs-fold keeps the first line number',E.parseHeaders('X-A: 1\nbad line\n  continued').invalid,[{line:2,text:'bad line continued',problem:'noColon'}]);
  eq('3 no invalid lines',E.parseHeaders('X-A: 1').invalid,[]);
  for(const lang of ['en','zh','ja','ko']){
    const T=strings[lang],h=page(lang);
    analyze(h,'HTTP/1.1 200 OK\nContent-Type：text/html\nX-A: 1\njust text');
    eq(lang+' 3 status counts the lines not read',h.get('hha-status').textContent,T.analyzed.replace('{n}','1').replace('{s}','')+T.noteSep+T.invalidLines.replace('{n}','2'));
    const section=h.get('hha-panel-cat').querySelector('.hha-cat-invalid');
    eq(lang+' 3 section heading',section?.querySelector('.hha-cat-title').textContent,T.catInvalid+' 2');
    eq(lang+' 3 cards list line, text and note',section?.querySelectorAll('.hha-card').map(c=>[c.querySelector('.hha-line-no').textContent,c.querySelector('.hha-h-value').textContent,c.querySelector('.hha-hint').textContent]),
      [[T.lineLabel.replace('{n}','2'),'Content-Type：text/html',T.hintWarn+': '+T.problems.fullwidthColon],[T.lineLabel.replace('{n}','4'),'just text',T.hintWarn+': '+T.problems.noColon]]);
    eq(lang+' 3 JSON and raw keep only header fields',[JSON.parse(h.get('hha-json-output').textContent),h.get('hha-raw-output').textContent],[{_status:'HTTP/1.1 200 OK','x-a':'1'},'HTTP/1.1 200 OK\nX-A: 1']);
    analyze(h,'only text\nmore text');
    eq(lang+' 3 nothing read: result shows the lines',[h.get('hha-status').textContent,h.get('hha-result').hidden,h.get('hha-panel-cat').querySelectorAll('.hha-card').length],[T.empty+T.noteSep+T.invalidLines.replace('{n}','2'),false,2]);
    eq(lang+' 3 problem texts are nonempty',['noColon','fullwidthColon','noName'].every(k=>typeof T.problems?.[k]==='string'&&T.problems[k].length>0),true);
  }
}
// 4. Whitespace between the field name and the colon makes the line invalid (RFC 9112 §5.1).
{
  const p=E.parseHeaders('HTTP/1.1 200 OK\nContent-Type : text/html\nX-Tab\t: 1\nX-Ok: 2\nX-Space-After:  3');
  eq('4 only lines without whitespace before the colon are headers',[names(p),p.headers.map(h=>h.value)],[['X-Ok','X-Space-After'],['2','3']]);
  eq('4 invalid lines',p.invalid,[{line:2,text:'Content-Type : text/html',problem:'spaceBeforeColon'},{line:3,text:'X-Tab\t: 1',problem:'spaceBeforeColon'}]);
  for(const lang of ['en','zh','ja','ko']){
    const T=strings[lang],h=page(lang);analyze(h,'GET / HTTP/1.1\nHost : example.com');
    eq(lang+' 4 note',h.get('hha-panel-cat').querySelector('.hha-card-invalid .hha-hint')?.textContent,T.hintWarn+': '+T.problems?.spaceBeforeColon);
    eq(lang+' 4 note names the RFC rule',/9112/.test(T.problems?.spaceBeforeColon??''),true);
  }
}
// 5. Method names are case-sensitive (RFC 9110 §9.1): "get" is not GET.
{
  const p=E.parseHeaders('get /api HTTP/1.1\nHost: example.com');
  eq('5 lowercase method is not a request line',[p.type,p.statusLine,names(p)],['unknown',null,['Host']]);
  eq('5 lowercase method listed with its own reason',p.invalid,[{line:1,text:'get /api HTTP/1.1',problem:'methodCase',method:'get',upper:'GET'}]);
  const abs=E.parseHeaders('Post https://example.com:8443/a HTTP/1.1\nHost: example.com');
  eq('5 absolute-form target with a colon is not read as a header',[abs.statusLine,names(abs),abs.invalid.map(x=>x.problem)],[null,['Host'],['methodCase']]);
  eq('5 uppercase still a request',E.parseHeaders('GET https://example.com:8443/a HTTP/1.1\nHost: a').type,'request');
  eq('5 lowercase line later is just a line without a colon',E.parseHeaders('X-A: 1\nget / HTTP/1.1').invalid.map(x=>x.problem),['noColon']);
  for(const lang of ['en','zh','ja','ko']){
    const T=strings[lang],h=page(lang);analyze(h,'get /api HTTP/1.1\nHost: example.com');
    eq(lang+' 5 note names the method',h.get('hha-panel-cat').querySelector('.hha-card-invalid .hha-hint')?.textContent,T.hintWarn+': '+(T.problems?.methodCase??'').replace('{method}','get').replace('{upper}','GET'));
    eq(lang+' 5 note has placeholders',/\{method\}/.test(T.problems?.methodCase??'')&&/\{upper\}/.test(T.problems.methodCase),true);
  }
}
// 6. 'unsafe-inline' next to a nonce or hash in the same directive is ignored by CSP2+ browsers
// (CSP3 §6.7.3.2; CSP2 script-src / style-src): a note, not the warning.
{
  const csp=v=>hintsOf(E.parseHeaders('HTTP/1.1 200 OK\nContent-Security-Policy: '+v),'content-security-policy');
  const ignored=d=>"info: 'unsafe-inline' in "+d+" is ignored by browsers that support CSP Level 2 or later, because the same directive has a nonce or hash (CSP3 section 6.7.3.2). Only older browsers use it.";
  const warn="warn: 'unsafe-inline' defeats most XSS protection. Use nonces or hashes instead.";
  eq('6 nonce in the same directive',csp("script-src 'nonce-r4nd0m' 'strict-dynamic' 'unsafe-inline' https:; object-src 'none'; base-uri 'none'"),[ignored('script-src'),'info: No default-src — define one as a safety net.']);
  eq('6 hash in one directive, none in another',csp("default-src 'self'; style-src 'unsafe-inline'; script-src 'sha256-AbC123+/=' 'unsafe-inline'"),[warn,ignored('script-src')]);
  eq('6 nonce in another directive does not help',csp("default-src 'self'; script-src 'nonce-a'; style-src 'unsafe-inline'"),[warn]);
  eq('6 case-insensitive keyword and directive',csp("Default-Src 'self'; Script-Src 'NONCE-a' 'UNSAFE-INLINE'"),[ignored('script-src')]);
  eq('6 plain unsafe-inline still warns',csp("default-src 'self' 'unsafe-inline'"),[warn]);
}
// 7. Only the first Strict-Transport-Security header is processed (RFC 6797 §8.1).
{
  const p=E.parseHeaders('HTTP/1.1 200 OK\nStrict-Transport-Security: max-age=63072000; includeSubDomains; preload\nstrict-transport-security: max-age=0\nSTRICT-TRANSPORT-SECURITY: max-age=10');
  const ignored='info: Ignored: a browser processes only the first Strict-Transport-Security header in a response (RFC 6797 section 8.1).';
  eq('7 first header checked, the rest ignored',p.headers.map(h=>h.hints.map(x=>x.sev+': '+x.text)),[[],[ignored],[ignored]]);
  const first=E.parseHeaders('HTTP/1.1 200 OK\nStrict-Transport-Security: max-age=0\nStrict-Transport-Security: max-age=63072000; includeSubDomains; preload');
  eq('7 a short first header still warns',first.headers[0].hints.length,3);
  eq('7 one header unchanged',E.parseHeaders('HTTP/1.1 200 OK\nStrict-Transport-Security: max-age=63072000; includeSubDomains; preload').headers[0].hints,[]);
}
console.log('RFC parsing fixes: '+(passes-rfcStart)+' passed, '+failures+' total failures');

// ---------- worked examples on the four pages ----------
// {/* hha-check: {"view":"json"|"raw"|"hints"|"cards"|"summary"} */} is followed by two code
// blocks: the input pasted into the tool and the output of the real page script for that view,
// in the page language. hints = every card with hints, in page order: the header name, then
// "  <label>: <hint>" lines. cards = each category heading, then "  <header name>" lines (the
// status section shows the first line).
// summary = the visible summary pills, one per line. status = the status line under the buttons.
// invalid = each line not read as a header: "<line label>: <text>", then "  <label>: <reason>". The input is pasted as written; nothing
// in the examples is a real credential.
const exampleStart=passes;
function rendered(lang,input,view){
  const h=page(lang);analyze(h,input);
  const panel=h.get('hha-panel-cat');
  if(view==='json')return h.get('hha-json-output').textContent;
  if(view==='raw')return h.get('hha-raw-output').textContent;
  if(view==='status')return h.get('hha-status').textContent;
  if(view==='summary')return ['hha-summary-type','hha-summary-status','hha-summary-count','hha-summary-security'].map(id=>h.get(id)).filter(el=>!el.hidden).map(el=>el.textContent).join('\n');
  if(view==='invalid')return panel.querySelectorAll('.hha-card-invalid').map(c=>c.querySelector('.hha-line-no').textContent+': '+c.querySelector('.hha-h-value').textContent+'\n  '+c.querySelector('.hha-hint').textContent).join('\n');
  if(view==='hints')return panel.querySelectorAll('.hha-card').filter(c=>c.querySelector('.hha-h-name')&&c.querySelectorAll('.hha-hint').length).map(c=>[c.querySelector('.hha-h-name').textContent,...c.querySelectorAll('.hha-hint').map(x=>'  '+x.textContent)].join('\n')).join('\n');
  if(view==='cards')return panel.querySelectorAll('section').map(s=>[s.querySelector('.hha-cat-title').textContent,...s.querySelectorAll('.hha-h-name, .hha-status-line').map(x=>'  '+x.textContent)].join('\n')).join('\n');
  throw Error('unknown view '+view);
}
const hhaVerify=({spec,after,lang})=>{
  const blocks=fencedBlocks(after);
  if(blocks.length<2)return 'needs an input block and an output block';
  const got=rendered(lang,blocks[0].text,spec.view);
  return got===blocks[1].text?null:'output differs; the page shows:\n'+got;
};
const exampleOpts={annotations:[{tag:'hha-check',min:2,verify:hhaVerify}]};
for(const lang of ['en','zh','ja','ko'])eq(lang+' worked examples match the page script',contractProblems('http-header-analyzer',lang,exampleOpts),'');
console.log('Worked examples: '+(passes-exampleStart)+' passed, '+failures+' total failures');

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
