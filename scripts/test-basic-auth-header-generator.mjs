// Basic Auth Header Generator — decoding reports the right reason for non-UTF-8 credentials
//
// Read:  src/components/tools/BasicAuthHeaderGeneratorTool.astro (extracts the real engine
//        block between the `engine:start` / `engine:end` markers), the 4 tool page mdx files,
//        and the actual ToolLayout keyboard handler; complete page runs in a DOM/clipboard VM.
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: RFC 7617 §2 example (Aladdin / open sesame) and the two §2.1 examples
// ("test" / "123£" sent as UTF-8 "dGVzdDoxMjPCow==" and as ISO-8859-1 "dGVzdDoxMjOj").
// Before the fix the ISO-8859-1 token was reported as "Invalid Base64 token." because the
// strict UTF-8 decoder threw inside the same try block; now it decodes as ISO-8859-1 and is
// marked so the page can say why. Also: header / scheme / token forms, first-colon split,
// real Base64 errors still reported as invalidBase64, missing colon, 4 language strings.
//
// Run: node scripts/test-basic-auth-header-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/BasicAuthHeaderGeneratorTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in BasicAuthHeaderGeneratorTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { decodeCredentials };')();

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
function errorOf(input) {
  try { E.decodeCredentials(input); return null; } catch (e) { return e.message; }
}

eq('RFC 7617 §2 example', E.decodeCredentials('Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=='), { username: 'Aladdin', password: 'open sesame', charset: 'utf-8' });
eq('RFC 7617 §2.1 UTF-8 example', E.decodeCredentials('dGVzdDoxMjPCow=='), { username: 'test', password: '123£', charset: 'utf-8' });
eq('RFC 7617 §2.1 ISO-8859-1 example is decoded, not "invalid Base64"', E.decodeCredentials('dGVzdDoxMjOj'), { username: 'test', password: '123£', charset: 'iso-8859-1' });
eq('full Authorization header, any case', E.decodeCredentials('authorization:  basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=='), { username: 'Aladdin', password: 'open sesame', charset: 'utf-8' });
eq('split at the first colon', E.decodeCredentials(Buffer.from('user:pa:ss').toString('base64')), { username: 'user', password: 'pa:ss', charset: 'utf-8' });
eq('UTF-8 username', E.decodeCredentials(Buffer.from('José:pässword', 'utf8').toString('base64')).username, 'José');
eq('page example cmVu6WU6czNjcmV0 (renée / s3cret in ISO-8859-1)', E.decodeCredentials('cmVu6WU6czNjcmV0'), { username: 'renée', password: 's3cret', charset: 'iso-8859-1' });
eq('ISO-8859-1 username', E.decodeCredentials(Buffer.from('José:x', 'latin1').toString('base64')), { username: 'José', password: 'x', charset: 'iso-8859-1' });
eq('empty password', E.decodeCredentials(Buffer.from('user:').toString('base64')), { username: 'user', password: '', charset: 'utf-8' });

eq('bad Base64 character', errorOf('Basic abc$'), 'invalidBase64');
eq('Base64 length 4n+1', errorOf('QWxhZ'), 'invalidBase64');
eq('URL-safe alphabet is rejected', errorOf('Basic QWxh-_'), 'invalidBase64');
eq('other scheme', errorOf('Bearer abc'), 'invalidScheme');
eq('empty input', errorOf('   '), 'missingDecode');
eq('no colon', errorOf(Buffer.from('nocolon').toString('base64')), 'missingColon');

// strings
const keysOf = (lang) => {
  const block = source.slice(source.indexOf(lang + ': {'), source.indexOf('}', source.indexOf(lang + ': {')));
  return [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]).sort();
};
const en = keysOf('en');
check('en has decodedLatin1', en.includes('decodedLatin1'));
for (const lang of ['zh', 'ja', 'ko']) eq(lang + ' STRINGS keys match en', keysOf(lang), en);

// pages
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/basic-auth-header-generator', lang + '.mdx'), 'utf8');
  check(lang + ': page describes the ISO-8859-1 fallback, not a Base64 error', mdx.includes('cmVu6WU6czNjcmV0') && !/Invalid Base64 token\.\", even|Base64 token 无效。」，尽管|Base64 トークンが無効です。」になります|유효하지 않습니다.\"가 됩니다/.test(mdx), lang);
}

// Complete page lifecycle: actual markup/IIFE and ToolLayout listener in either order.
// Only DOM, clipboard and time are controlled; no algorithm or page handler is mirrored.
{
  const pageScript = /<script\b[^>]*>([\s\S]*?)<\/script>/.exec(source)[1];
  const layout = readFileSync(join(root,'src/layouts/ToolLayout.astro'),'utf8');
  const keyboard = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'),layout.indexOf('// ── Copy button visual feedback'));
  const tableStart=pageScript.indexOf('var STRINGS = {'),tableEnd=pageScript.indexOf('\n      };',tableStart);
  const STRINGS=vm.runInNewContext(pageScript.slice(tableStart,tableEnd+9)+';STRINGS;');
function deferred() { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; }
async function settle() { for(let i=0;i<16;i++) await Promise.resolve(); }
function makePage(lang='en',layoutFirst=false) {
  const all=[], ids=new Map(), timers=[], clipboard=[], persist=[], failures=[];
  let timerId=0, holdClipboard=false, fallbackCalls=0;
  const doc={listeners:new Map(),activeElement:null,documentElement:{lang}};
  const matches=(node,selector)=>{
    if(selector.includes(',')) return selector.split(',').some(x=>matches(node,x.trim()));
    const parts=selector.trim().split(/\s+(?![^\[]*\])/);
    if(parts.length>1) {const last=parts.pop();if(!matches(node,last))return false;let p=node.parentNode;while(p){if(matches(p,parts.join(' ')))return true;p=p.parentNode;}return false;}
    if(selector.startsWith('#'))return node.id===selector.slice(1);
    if(selector.startsWith('.'))return node.classList.contains(selector.slice(1));
    const m=/^(\w+)?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/.exec(selector);
    return !!m&&(!m[1]||node.tagName===m[1].toUpperCase())&&(!m[2]||(m[3]===undefined?node.hasAttribute(m[2]):node.getAttribute(m[2])===m[3]));
  };
  class Element {
    constructor(tag,attrs={}) {this.tagName=tag.toUpperCase();this.attrs={...attrs};this.id=attrs.id||'';this.className=attrs.class||'';this.type=attrs.type||'';this.value=attrs.value||'';this.hidden='hidden'in attrs;this.disabled='disabled'in attrs;this.style={};this.childNodes=[];this.parentNode=null;this.listeners=new Map();this._text='';all.push(this);if(this.id)ids.set(this.id,this);
      this.classList={contains:k=>this.className.split(/\s+/).includes(k),add:k=>{if(!this.classList.contains(k))this.className=(this.className+' '+k).trim();},remove:k=>{this.className=this.className.split(/\s+/).filter(x=>x!==k).join(' ');},toggle:(k,on)=>{const yes=on===undefined?!this.classList.contains(k):on;this.classList[yes?'add':'remove'](k);return yes;}};
    }
    get textContent(){return this._text+this.childNodes.map(n=>n.textContent).join('');}
    set textContent(v){this._text=String(v??'');for(const n of this.childNodes)n.parentNode=null;this.childNodes=[];}
    get children(){return this.childNodes;}
    appendChild(el){this.childNodes.push(el);el.parentNode=this;return el;}
    removeChild(el){this.childNodes=this.childNodes.filter(n=>n!==el);el.parentNode=null;return el;}
    getAttribute(k){if(k==='type')return this.type;if(k==='class')return this.className;return this.attrs[k]??null;}
    hasAttribute(k){return k in this.attrs;}
    setAttribute(k,v){this.attrs[k]=String(v);if(k==='class')this.className=String(v);if(k==='type')this.type=String(v);}
    contains(n){for(let p=n;p;p=p.parentNode)if(p===this)return true;return false;}
    querySelectorAll(s){return all.filter(n=>n!==this&&this.contains(n)&&matches(n,s));}
    querySelector(s){return this.querySelectorAll(s)[0]||null;}
    closest(s){for(let p=this;p;p=p.parentNode)if(matches(p,s))return p;return null;}
    addEventListener(t,f){if(!this.listeners.has(t))this.listeners.set(t,[]);this.listeners.get(t).push(f);}
    focus(){doc.activeElement=this;}
    select(){this.focus();}
    fire(type,extra={}){const e={type,target:this,key:'',ctrlKey:false,metaKey:false,isComposing:false,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};for(let p=this;p&&!e.stopped;p=p.parentNode)for(const f of p.listeners.get(type)||[]) invoke(f,p,e);if(!e.stopped)for(const f of doc.listeners.get(type)||[])invoke(f,doc,e);return e;}
    click(){if(!this.disabled)this.fire('click');}
  }
  function invoke(f,receiver,e){try{const r=f.call(receiver,e);if(r?.catch)r.catch(error=>failures.push(String(error.stack||error)));}catch(error){failures.push(String(error.stack||error));}}
  doc.body=new Element('body');const widget=doc.body.appendChild(new Element('section',{class:'tool-widget'}));
  Object.assign(doc,{
    getElementById(id){if(!ids.has(id))throw Error('Missing real markup id '+id);return ids.get(id);},
    querySelector:s=>doc.body.querySelector(s),querySelectorAll:s=>doc.body.querySelectorAll(s),
    createElement:t=>new Element(t),createTextNode:t=>{const n=new Element('#text');n.textContent=t;return n;},
    addEventListener(t,f){if(!doc.listeners.has(t))doc.listeners.set(t,[]);doc.listeners.get(t).push(f);},
    execCommand(){fallbackCalls++;throw Error('Native fallback copy is forbidden in this VM');},
  });
  let markup=source.slice(source.indexOf('---',3)+3,source.indexOf('<script'));
  const stack=[widget], tag=/<\/?([a-z][\w:-]*)\b[^>]*>/gi;let m,offset=0;
  while((m=tag.exec(markup))){const before=markup.slice(offset,m.index);if(before.trim())stack.at(-1)._text+=before;offset=tag.lastIndex;const name=m[1].toLowerCase();if(m[0][1]==='/'){const i=stack.findLastIndex(x=>x.tagName===name.toUpperCase());if(i>0)stack.length=i;continue;}const attrs={};for(const a of m[0].matchAll(/\s([\w:-]+)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]??'';const el=stack.at(-1).appendChild(new Element(name,attrs));if(!/^(input|br|hr|img|meta|link)$/.test(name)&&!m[0].endsWith('/>'))stack.push(el);}
  const get=id=>doc.getElementById(id);
  const stubClipboard={write(){const d=deferred();clipboard.push({api:'write',d});if(!holdClipboard)d.resolve();return d.promise;},writeText(text){const d=deferred();clipboard.push({api:'writeText',text,d});if(!holdClipboard)d.resolve();return d.promise;}};
  const timeout=(fn,ms=0)=>{const t={id:++timerId,fn,ms};timers.push(t);return t.id;};
  const window={setTimeout:timeout,trackTool(){},ztPersist:{clear:s=>persist.push(s)}};
  const context=vm.createContext({document:doc,window,navigator:{clipboard:stubClipboard},TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,atob,btoa,console,setTimeout:timeout,clearTimeout:id=>{const i=timers.findIndex(t=>t.id===id);if(i>=0)timers.splice(i,1);},_slug:'basic-auth-header-generator'});
  if(layoutFirst)vm.runInContext(keyboard,context);
  vm.runInContext(pageScript,context,{filename:'BasicAuthHeaderGeneratorTool.astro',timeout:5000});
  if(!layoutFirst)vm.runInContext(keyboard,context);
  return {lang,get,widget,context,clipboard,persist,failures,
    set(id,value){const el=get(id);el.value=value;el.fire('input');},click:id=>get(id).click(),
    ctrlL(id,meta=false){const el=get(id);el.focus();return el.fire('keydown',{key:'l',ctrlKey:!meta,metaKey:meta});},
    async timers(){const due=timers.filter(t=>t.ms===0);for(const t of due){timers.splice(timers.indexOf(t),1);t.fn();}await settle();},
    holdClipboard(){holdClipboard=true;},
    copyButton(target){return doc.querySelector('[data-copy-target="'+target+'"]');},
    summary(){return {scriptErrors:failures.length,fallbackCalls};},
    async nextFeedbackTimer(){const t=timers.find(t=>t.ms===1200);if(!t)throw Error('Missing feedback timer');timers.splice(timers.indexOf(t),1);t.fn();await settle();},
  };
}

  const pages=[],unhandled=[];
  const onUnhandled=e=>unhandled.push(String(e));process.on('unhandledRejection',onUnhandled);
  async function page(lang,order=false){const p=makePage(lang,order);pages.push(p);await settle();return p;}
  const generated=['bahg-full-header','bahg-token','bahg-curl','bahg-fetch'];
  const decoded=['bahg-decoded-username','bahg-decoded-password'];
  const clean=p=>!p.get('bahg-username').value&&!p.get('bahg-password').value&&!p.get('bahg-decode-input').value&&generated.concat(decoded).every(id=>!p.get(id).textContent)&&p.get('bahg-generate-output').hidden&&p.get('bahg-decode-output').hidden&&!p.get('bahg-generate-status').textContent&&!p.get('bahg-decode-status').textContent;
  function examples(p){p.click('bahg-load-generate-example');p.click('bahg-load-decode-example');}
  for(const lang of ['en','zh','ja','ko']) {
    for(const order of [false,true])for(const shown of [false,true]) {
      const p=await page(lang,order);examples(p);if(shown)p.click('bahg-toggle-password');
      check(lang+' examples generate known header and decode colon password',p.get('bahg-full-header').textContent==='Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=='&&p.get('bahg-decoded-username').textContent==='user'&&p.get('bahg-decoded-password').textContent==='p:a:ss');
      p.ctrlL(shown?'bahg-password':'bahg-decode-input',order);await p.timers();
      check(lang+' '+order+'/'+shown+' Ctrl/L clears both credentials, results and status',clean(p));
      check(lang+' '+order+'/'+shown+' Ctrl/L keeps password visibility and runs shared persistence',p.get('bahg-password').type===(shown?'text':'password')&&p.persist.length===1);
      examples(p);p.click('bahg-clear-generate');p.click('bahg-clear-decode');check(lang+' both explicit Clear controls remain equivalent',clean(p));
      examples(p);p.context.document.body.focus();p.context.document.body.fire('keydown',{key:'l',ctrlKey:true});await p.timers();
      check(lang+' Ctrl/L outside tool preserves credentials',p.get('bahg-password').value==='open sesame'&&p.persist.length===1);
    }
    for(const mode of ['generate','decode']) {
      const target=mode==='generate'?'bahg-full-header':'bahg-decoded-password';
      for(const change of ['clear','ctrlL','valid','invalid'])for(const outcome of ['resolve','reject']) {
        const p=await page(lang);examples(p);p.holdClipboard();const button=p.copyButton(target);button.click();
        check(lang+' '+mode+' '+change+'/'+outcome+' copies actual displayed text',p.clipboard.length===1&&p.clipboard[0].text===p.get(target).textContent);
        if(change==='clear')p.click('bahg-clear-'+mode);
        if(change==='ctrlL'){p.ctrlL('bahg-password');await p.timers();}
        if(change==='valid'){
          if(mode==='generate'){p.set('bahg-username','new');p.click('bahg-generate');}
          else {p.set('bahg-decode-input','Basic bmV3OnZhbHVl');p.click('bahg-decode');}
        }
        if(change==='invalid'){
          if(mode==='generate'){p.set('bahg-username','bad:user');p.click('bahg-generate');}
          else {p.set('bahg-decode-input','Bearer token');p.click('bahg-decode');}
        }
        const status=p.get('bahg-'+mode+'-status'), snapshot={status:status.textContent,kind:status.className,button:button.textContent};
        p.clipboard[0].d[outcome](outcome==='reject'?new Error('synthetic clipboard denial'):undefined);await settle();
        check(lang+' '+mode+' late copy '+outcome+' preserves '+change+' status',status.textContent===snapshot.status&&status.className===snapshot.kind);
        check(lang+' '+mode+' late copy '+outcome+' preserves '+change+' button',button.textContent===snapshot.button&&!button.classList.contains('copied'));
      }
      for(const failure of ['reject','missing-api','missing-method','sync-throw']) {
        const p=await page(lang);examples(p);const button=p.copyButton(target);
        if(failure==='reject')p.context.navigator.clipboard.writeText=()=>Promise.reject(new Error('denied'));
        if(failure==='missing-api')delete p.context.navigator.clipboard;
        if(failure==='missing-method')delete p.context.navigator.clipboard.writeText;
        if(failure==='sync-throw')p.context.navigator.clipboard.writeText=()=>{throw Error('unavailable');};
        button.click();await settle();const status=p.get('bahg-'+mode+'-status');
        check(lang+' '+mode+' current '+failure+' is localized visible failure',status.textContent===STRINGS[lang].copyFailed&&status.className.includes('error')&&!button.classList.contains('copied'));
        check(lang+' '+mode+' current '+failure+' causes no script error',p.failures.length===0,p.failures);
      }
      {
        const p=await page(lang);examples(p);const button=p.copyButton(target);button.click();await settle();
        check(lang+' '+mode+' successful copy gives localized feedback',button.classList.contains('copied')&&button.textContent===STRINGS[lang].copied);
        p.click('bahg-clear-'+mode);
        check(lang+' '+mode+' Clear resets copy feedback immediately',button.textContent===STRINGS[lang].copy&&!button.classList.contains('copied'));
        p.click('bahg-load-'+mode+'-example');button.click();await settle();await p.nextFeedbackTimer();
        check(lang+' '+mode+' old feedback timer cannot erase new success',button.classList.contains('copied')&&button.textContent===STRINGS[lang].copied);
        await p.nextFeedbackTimer();check(lang+' '+mode+' current feedback timer resets normally',!button.classList.contains('copied')&&button.textContent===STRINGS[lang].copy);
        button.click();await settle();button.click();await settle();await p.nextFeedbackTimer();
        check(lang+' '+mode+' earlier copy timer cannot erase latest copy',button.classList.contains('copied'));
        await p.nextFeedbackTimer();
      }
      {
        const p=await page(lang);examples(p);const button=p.copyButton(target);button.click();await settle();
        p.holdClipboard();button.click();p.clipboard.at(-1).d.reject(new Error('new denial'));await settle();await p.nextFeedbackTimer();
        check(lang+' '+mode+' current failure after success clears outdated Copied feedback',!button.classList.contains('copied')&&button.textContent===STRINGS[lang].copy&&p.get('bahg-'+mode+'-status').textContent===STRINGS[lang].copyFailed);
      }
      {
        const p=await page(lang);examples(p);p.holdClipboard();const button=p.copyButton(target);button.click();
        p.click('bahg-clear-'+(mode==='generate'?'decode':'generate'));p.clipboard[0].d.resolve();await settle();
        check(lang+' '+mode+' independent panel clear preserves current copy feedback',button.classList.contains('copied')&&button.textContent===STRINGS[lang].copied);
      }
      {
        const p=await page(lang);examples(p);p.holdClipboard();const button=p.copyButton(target);button.click();button.click();
        p.clipboard[1].d.resolve();await settle();const status=p.get('bahg-'+mode+'-status').textContent;
        p.clipboard[0].d.reject(new Error('old denial'));await settle();
        check(lang+' '+mode+' old request failure cannot overwrite latest success',p.get('bahg-'+mode+'-status').textContent===status&&button.classList.contains('copied'));
      }
    }
    {
      const p=await page(lang);examples(p);
      for(const target of generated.concat(decoded)){const button=p.copyButton(target);button.click();await settle();check(lang+' copy target '+target+' preserves full text',p.clipboard.at(-1).text===p.get(target).textContent);}
      const old=p.get('bahg-full-header').textContent;p.set('bahg-password','changed');
      check(lang+' manual generate keeps result until next action',p.get('bahg-full-header').textContent===old);
      p.click('bahg-generate');check(lang+' next Generate uses edited input',p.get('bahg-full-header').textContent==='Authorization: Basic QWxhZGRpbjpjaGFuZ2Vk');
    }
  }
  await new Promise(resolve=>setImmediate(resolve));process.removeListener('unhandledRejection',onUnhandled);
  check('page copies never create an unhandled rejection',unhandled.length===0,unhandled);
  for(const [i,p] of pages.entries())check('page lifecycle '+i+' has no script errors or native clipboard calls',p.failures.length===0&&p.summary().fallbackCalls===0,p.failures);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
