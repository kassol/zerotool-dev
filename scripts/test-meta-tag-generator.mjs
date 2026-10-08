// Meta Tag Generator — generated <head> block
//
// Read:  src/components/tools/MetaTagGeneratorTool.astro (runs the real buildHead() and its escape
//        helpers between the `engine:start` / `engine:end` markers),
//        src/content/blog/meta-tag-generator-guide/{en,ja}.mdx (`mtg-check` examples, `mtg-live` tag
//        lists), dist/{,ja/}tools/meta-tag-generator/index.html (SKIP without a build)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// The output is parsed with parse5 as the <head> of a page, the way a site would use it. Before the
// fix the JSON-LD block was written with plain JSON.stringify, so a title or description containing
// a closing script tag ended the script element early and the rest became markup. `<` is now written
// as \u003c inside JSON-LD; JSON.parse reads it back to the same string. The default case is the
// example quoted on the English tool page.
//
// Run: node scripts/test-meta-tag-generator.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const root = process.env.ZT_TEST_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const { parse, parseFragment } = createRequire(join(root, 'package.json'))('parse5');
const source = readFileSync(process.env.ZT_FIX_SOURCE || join(root, 'src/components/tools/MetaTagGeneratorTool.astro'), 'utf8');
const STRINGS = Function(source.split('// strings:start')[1].split('// strings:end')[0] + ';return STRINGS;')();
const clientKeys = ['copy', 'copied', 'copyFailed', 'fillToPreview'];
const s = source.indexOf('/* ── engine:start ── */');
const e = source.indexOf('/* ── engine:end ── */');
if (s < 0 || e <= s) { console.error('FAIL: engine block not found'); process.exit(1); }
const { buildHead } = new Function('fields', source.slice(s, e) + '\nreturn { buildHead };')({});

let passes = 0, failures = 0;
function eq(name, got, expected) { check(name, got === expected, got); }
function check(name, ok, detail) { if (ok) passes++; else { failures++; console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : '')); } }
function walk(n, f) { f(n); (n.childNodes || []).forEach((c) => walk(c, f)); }
function headOf(html) {
  const doc = parse('<!doctype html><html><head>' + html + '</head><body></body></html>');
  const out = { meta: {}, scripts: [], title: null, bodyNodes: 0 };
  walk(doc, (n) => {
    if (n.tagName === 'meta') {
      const a = Object.fromEntries(n.attrs.map((x) => [x.name, x.value]));
      out.meta[a.property || a.name] = a.content;
    }
    if (n.tagName === 'title') out.title = n.childNodes.map((c) => c.value).join('');
    if (n.tagName === 'script') out.scripts.push(n.childNodes.map((c) => c.value).join(''));
    if (n.tagName === 'body') out.bodyNodes = n.childNodes.length;
  });
  return out;
}

const base = {
  title: 'ZeroTool — Free browser-based dev utilities', description: 'A growing library of one-task tools that run entirely in your browser. No accounts, no uploads.',
  canonical: 'https://zerotool.dev/', siteName: 'ZeroTool', author: 'ZeroTool Workshop', keywords: 'dev tools, meta tags, open graph, twitter card',
  language: 'en', themeColor: '#5b3d20', robotsIndex: 'index', robotsFollow: 'follow', viewport: true, ogType: 'website', ogLocale: 'en_US',
  ogImage: 'https://zerotool.dev/og/json-formatter.png', ogImageWidth: '1200', ogImageHeight: '630', ogImageAlt: 'ZeroTool cover image',
  twCard: 'summary_large_image', twSite: '@zerotooldev', twCreator: '@zerotooldev', twImage: '', schemaType: '',
};

const d = headOf(buildHead(base));
check('og:url equals the canonical field', d.meta['og:url'] === 'https://zerotool.dev/');
check('twitter:image falls back to og:image', d.meta['twitter:image'] === base.ogImage);
check('robots always written', d.meta.robots === 'index, follow');
check('no JSON-LD without a schema type', d.scripts.length === 0);

const tricky = { ...base, title: 'Build "Notes" & <tips>', description: 'x</script><img src=x onerror=alert(1)>y', schemaType: 'Article', author: 'Jane Doe' };
const out = buildHead(tricky);
const h = headOf(out);
check('title text survives', h.title === tricky.title, h.title);
check('og:description attribute survives', h.meta['og:description'] === tricky.description, h.meta['og:description']);
check('JSON-LD stays one script element', h.scripts.length === 1, h.scripts.length);
check('nothing leaks into <body>', h.bodyNodes === 0, h.bodyNodes);
let ld = null;
try { ld = JSON.parse(h.scripts[0]); } catch (err) { check('JSON-LD parses', false, err.message); }
if (ld) {
  check('JSON-LD description round-trips', ld.description === tricky.description, ld.description);
  check('JSON-LD name round-trips', ld.name === tricky.title, ld.name);
  check('Article gets a Person author', ld.author && ld.author['@type'] === 'Person' && ld.author.name === 'Jane Doe');
}

// ---------- the Open Graph guide (en) and the OGP guide (ja) ----------
// `mtg-check: {json}` → the next html block equals buildHead() for those fields on top of an empty
// form (viewport off, robots index/follow, card summary_large_image). `mtg-live: path` → the next text
// block equals the og:/twitter: tag names in that dist page, extracted with the regex the guides give
// for the curl command (needs `npm run build`; SKIP without dist).
{
  const empty = {
    title: '', description: '', canonical: '', siteName: '', author: '', keywords: '', language: 'en', themeColor: '',
    robotsIndex: 'index', robotsFollow: 'follow', viewport: false, ogType: 'website', ogLocale: '', ogImage: '',
    ogImageWidth: '', ogImageHeight: '', ogImageAlt: '', twCard: 'summary_large_image', twSite: '', twCreator: '', twImage: '', schemaType: '',
  };
  const tagRe = /(property|name)="(og|twitter):[a-z_:]+"/g;
  for (const lang of ['en', 'ja']) {
    const guide = readFileSync(join(root, 'src/content/blog/meta-tag-generator-guide', lang + '.mdx'), 'utf8');
    const fm = guide.match(/^---\n([\s\S]*?)\n---/)[1];
    check(lang + ' guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
    const tpl = [/^## What (is|are) /m, /^## .*Online/m, /^## .* in Code/m, /^## (Summary|Conclusion)/m].filter((re) => re.test(guide));
    check(lang + ' guide has no template headings', tpl.length === 0, tpl.map(String).join(' '));
    const checks = [...guide.matchAll(/\{\/\* mtg-check: (\{.*?\}) \*\/\}\s*```html\n([\s\S]*?)```/g)];
    check(lang + ' guide has mtg-check blocks', checks.length >= 1, checks.length);
    for (const m of checks) {
      const v = { ...empty, ...JSON.parse(m[1]) };
      const out = buildHead(v);
      check(lang + ' mtg-check output: ' + v.title.slice(0, 20), m[2].trimEnd() === out, '\n' + out);
      check(lang + ' mtg-check output parses as one head', headOf(out).bodyNodes === 0);
      if (lang === 'ja') {
        check('ja guide quotes the title and description counter values',
          guide.includes(`タイトルは ${v.title.length} 文字、説明は ${v.description.length} 文字`), v.title.length + '/' + v.description.length);
      }
    }
    const lives = [...guide.matchAll(/\{\/\* mtg-live: (\S+) \*\/\}\s*```text\n([\s\S]*?)```/g)];
    check(lang + ' guide has an mtg-live block', lives.length === 1, lives.length);
    for (const m of lives) {
      let page = null;
      try { page = readFileSync(join(root, 'dist', m[1]), 'utf8'); } catch {}
      if (!page) { console.log('SKIP: ' + lang + ' mtg-live (no dist/' + m[1] + ')'); continue; }
      const head = page.slice(0, page.indexOf('</head>'));
      const names = (head.match(tagRe) || []).join('\n');
      check(lang + ' mtg-live tag list matches dist/' + m[1], m[2].trimEnd() === names, '\n' + names);
    }
    check(lang + ' guide gives the curl regex the test uses', guide.includes(`grep -oE '(property|name)="(og|twitter):[a-z_:]+"'`));
  }
}

// ---------- complete page copy lifecycle ----------
const layout=readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');const a=layout.indexOf("      document.addEventListener('keydown'",layout.indexOf('// ── Keyboard shortcuts'));const shortcut=layout.slice(a,layout.indexOf('      // ── Copy button visual feedback',a));if(!shortcut.includes('window.ztPersist.clear(_slug)'))throw Error('shortcut drift');
const flushPage = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };
function page(s,lang='en',order='before'){
 const docHandlers={},copies=[],digests=[],exec=[],saved=[],cleared=[],tracks=[];let document,now=0,seq=0,selection=null;const timers=new Map();
 const walk=n=>n.children.flatMap(c=>[c,...walk(c)]);
 function simple(e,selector){let rest=selector;const tag=rest.match(/^[a-z][a-z0-9-]*/i);if(tag){if(e.tagName!==tag[0].toUpperCase())return false;rest=rest.slice(tag[0].length);}for(const m of rest.matchAll(/([.#])([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g)){if(m[1]==='#'&&e.id!==m[2]||m[1]==='.'&&!e.classList.contains(m[2]))return false;if(m[3]&&(e.getAttribute(m[3])===null||m[4]!==undefined&&e.getAttribute(m[3])!==m[4]))return false;}return true;}
 function matches(e,selector){if(selector.includes(','))return selector.split(/,\s*/).some(x=>matches(e,x));const parts=selector.split(/\s+(?![^\[]*\])/);if(!simple(e,parts.pop()))return false;for(const part of parts.reverse()){let p=e.parentNode;while(p&&!simple(p,part))p=p.parentNode;if(!p)return false;e=p;}return true;}
 function element(tag,attrs={}){
  const listeners={};const el={tagName:tag.toUpperCase(),attributes:{...attrs},parentNode:null,childNodes:[],dataset:Object.fromEntries(Object.entries(attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5),v])),style:{},disabled:'disabled'in attrs,checked:'checked'in attrs,_value:attrs.value,
   get children(){return this.childNodes.filter(n=>n.tagName);},get id(){return this.attributes.id||'';},set id(v){this.attributes.id=v;},get type(){return this.attributes.type||(this.tagName==='INPUT'?'text':'');},set type(v){this.attributes.type=v;},get className(){return this.attributes.class||'';},set className(v){this.attributes.class=String(v);},
   get options(){return walk(this).filter(e=>e.tagName==='OPTION');},get value(){if(this._value!==undefined)return this._value;if(this.tagName==='SELECT'){const x=this.options.find(e=>e.attributes.selected!==undefined)||this.options[0];return x?x.value:'';}return '';},set value(v){this._value=String(v);},
   get textContent(){return this.childNodes.map(n=>n.tagName?n.textContent:n.value).join('');},set textContent(v){this.childNodes=[{value:String(v),parentNode:this}];},
   get innerHTML(){return this._html||'';},set innerHTML(v){this._html=String(v);this.childNodes=parseFragment(this._html).childNodes.map(n=>wrap(n,this));},
   getAttribute(k){return Object.hasOwn(this.attributes,k)?this.attributes[k]:null;},setAttribute(k,v){this.attributes[k]=String(v);if(k==='disabled')this.disabled=true;},removeAttribute(k){delete this.attributes[k];if(k==='disabled')this.disabled=false;},
   appendChild(n){n.parentNode=this;this.childNodes.push(n);return n;},removeChild(n){this.childNodes=this.childNodes.filter(x=>x!==n);n.parentNode=null;},remove(){this.parentNode?.removeChild(this);},contains(n){for(;n;n=n.parentNode)if(n===this)return true;return false;},closest(q){for(let n=this;n;n=n.parentNode)if(matches(n,q))return n;return null;},
   querySelectorAll(q){return walk(this).filter(e=>matches(e,q));},querySelector(q){return this.querySelectorAll(q)[0]||null;},
   addEventListener(k,f){(listeners[k]||=[]).push(f);},focus(){document.activeElement=this;},select(){selection=this;},dispatch(k,init={}){const e={type:k,target:this,currentTarget:this,defaultPrevented:false,cancelBubble:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.cancelBubble=true;},...init};for(const f of listeners[k]||[])f.call(this,e);if(!e.cancelBubble)for(const f of docHandlers[k]||[])f.call(document,e);return e;},click(){if(!this.disabled)this.dispatch('click');},
  };el.classList={contains:c=>el.className.split(/\s+/).includes(c),add(...c){el.className=[...new Set([...el.className.split(/\s+/).filter(Boolean),...c])].join(' ');},remove(...c){el.className=el.className.split(/\s+/).filter(x=>!c.includes(x)).join(' ');},toggle(c,on){const add=on===undefined?!this.contains(c):on;this[add?'add':'remove'](c);return add;}};return el;
 }
 function wrap(n,parent){if(!n.tagName)return{value:n.value||'',parentNode:parent};const e=element(n.tagName,Object.fromEntries((n.attrs||[]).map(a=>[a.name,a.value])));e.parentNode=parent;e.childNodes=(n.childNodes||[]).map(n=>wrap(n,e));if(e.tagName==='TEXTAREA')e.value=e.textContent;return e;}
 const body=element('body'),widget=element('section',{class:'tool-widget'});body.appendChild(widget);const markup=s.source.slice(s.source.indexOf('---',3)+3,s.source.indexOf('<script is:inline')).replace(/<Toggletip[\s\S]*?<\/Toggletip>/g,'').replace(/placeholder=\{L\.([A-Za-z]+)\}/g,(_,key)=>'placeholder="'+String(STRINGS[lang][key]).replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"').replace(/\{L\.([A-Za-z]+)\}/g,(_,key)=>String(STRINGS[lang][key]).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')).replace(/<style[\s\S]*?<\/style>/g,'').replace(/\{\/\*[\s\S]*?\*\/\}/g,'');widget.childNodes=parseFragment(markup).childNodes.map(n=>wrap(n,widget));
 document={body,documentElement:{lang},activeElement:body,createElement:tag=>element(tag),getElementById(id){const e=walk(body).find(e=>e.id===id);if(!e)throw Error('Missing real DOM '+id);return e;},querySelectorAll:q=>body.querySelectorAll(q),querySelector:q=>body.querySelector(q),addEventListener(k,f){(docHandlers[k]||=[]).push(f);},execCommand(command){exec.push({command,text:selection?.value});return options.fallbackSuccess;}};
 const options={holdDigest:false,fallbackSuccess:false};
 const globals={document,TextEncoder,Uint8Array,URL,isSecureContext:true,btoa:bin=>Buffer.from(bin,'binary').toString('base64'),crypto:{subtle:{digest(algo,bytes){const real=webcrypto.subtle.digest(algo,bytes);const job={algo,input:Buffer.from(bytes).toString('utf8'),ready:false};digests.push(job);if(!options.holdDigest)return real;return new Promise((resolve,reject)=>{job.resolve=()=>resolve(job.value);job.reject=()=>reject(Error('controlled digest rejection'));real.then(value=>{job.value=value;job.ready=true;},reject);});}}},navigator:{clipboard:{writeText:text=>new Promise((resolve,reject)=>copies.push({text,resolve,reject})),write(){throw Error('unexpected native clipboard');}}},setTimeout(fn,delay){const id=++seq;timers.set(id,{fn,due:now+delay,delay});return id;},clearTimeout:id=>timers.delete(id),ztPersist:{load(){return null;},save:(slug,v)=>saved.push({slug,value:JSON.parse(JSON.stringify(v))}),clear:slug=>cleared.push(slug)},trackTool:(...x)=>tracks.push(x),fetch(){throw Error('network forbidden');}};
 const context={...globals,_slug:s.slug,CLIENT_T:Object.fromEntries(clientKeys.map(key=>[key,STRINGS[lang][key]]))};context.window=context;const ctx=vm.createContext(context);if(order==='before')vm.runInContext(shortcut,ctx);vm.runInContext(s.source.match(/<script is:inline[^>]*>([\s\S]*?)<\/script>/)[1],ctx,{filename:s.file});if(order==='after')vm.runInContext(shortcut,ctx);
 const $=id=>document.getElementById(id);return{$,document,window:context,globals,options,copies,digests,exec,saved,cleared,tracks,timers,input(id,value,ev='input'){$(id).focus();$(id).value=value;$(id).dispatch(ev);},click:selector=>{const e=selector.startsWith('#')?$(selector.slice(1)):document.querySelector(selector);if(!e)throw Error('No real selector '+selector);e.click();},key(id){$(id).focus();$(id).dispatch('keydown',{key:'l',ctrlKey:true});},advance(ms){const end=now+ms;for(let g=0;;g++){if(g>100)throw Error('timer runaway');const next=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;now=next[1].due;timers.delete(next[0]);next[1].fn();}now=end;},async deliver(n){for(let i=0;!digests[n].ready&&i<30;i++)await flushPage();if(!digests[n].ready)throw Error('real digest not ready');digests[n].resolve();await flushPage();}};
}

const spec = { slug: 'meta-tag-generator', file: 'src/components/tools/MetaTagGeneratorTool.astro', source };
const normalCopy = { en: 'Copy', zh: '复制', ja: 'コピー', ko: '복사' };
const copiedLabel = { en: 'Copied!', zh: '已复制！', ja: 'コピー済み！', ko: '복사됨!' };
const copyFailure = { en: 'Copy failed.', zh: '操作失败。', ja: '操作失敗。', ko: '작업 실패.' };
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const p = page(spec, lang), output = p.$('mtg-output').textContent;
  p.click('#mtg-copy');
  check(lang + ': copy snapshot contains complete generated head', p.copies[0].text === output);
  p.copies[0].reject(Error('controlled current refusal')); await flushPage();
  check(lang + ': failed current API/fallback is visible and retryable', p.$('mtg-copy').textContent === copyFailure[lang] && !p.$('mtg-copy').disabled && p.exec.length === 1 && p.exec[0].text === output);
  p.click('#mtg-copy'); p.copies[1].resolve(); await flushPage();
  check(lang + ': same-head retry succeeds without editing', p.$('mtg-copy').textContent === copiedLabel[lang]);
  p.advance(1500);
  check(lang + ': feedback restores stable original label', p.$('mtg-copy').textContent === normalCopy[lang]);
}


for (const order of ['before', 'after']) for (const mod of ['ctrlKey', 'metaKey']) {
  const p = page(spec, 'en', order);
  p.input('mtg-title', 'Old title'); p.input('mtg-description', 'old description'); p.input('mtg-canonical', 'https://example.com/keep'); p.input('mtg-og-image', 'https://example.com/og.png');
  p.input('mtg-tw-image', 'https://example.com/twitter.png'); p.input('mtg-og-image-width', '987'); p.input('mtg-robots-index', 'noindex', 'change'); p.$('mtg-viewport').checked = false; p.$('mtg-viewport').dispatch('change');
  p.click('[data-platform="twitter"]'); p.click('#mtg-copy'); p.$('mtg-title').focus(); p.$('mtg-title').dispatch('keydown', { key: 'L', [mod]: true });
  const output = p.$('mtg-output').textContent;
  check(order + '/' + mod + ': text/textarea clear and counts recompute synchronously', !p.$('mtg-title').value && !p.$('mtg-description').value && !p.$('mtg-theme-color-text').value && p.$('mtg-title-counter').textContent === '0 / 60' && p.$('mtg-description-counter').textContent === '0 / 160' && !output.includes('Old title') && !output.includes('old description'));
  check(order + '/' + mod + ': URL/number/select/color/checkbox remain and head recomputes', p.$('mtg-canonical').value === 'https://example.com/keep' && p.$('mtg-og-image').value === 'https://example.com/og.png' && p.$('mtg-og-image-width').value === '987' && p.$('mtg-robots-index').value === 'noindex' && !p.$('mtg-viewport').checked && p.$('mtg-theme-color').value === '#5b3d20' && output.includes('https://example.com/keep') && output.includes('987') && !output.includes('name="viewport"') && p.cleared.length === 1 && p.saved.length === 0);
  check(order + '/' + mod + ': current Twitter preview retains native URL strategy', p.$('mtg-preview').innerHTML.includes('src="https://example.com/twitter.png"') && !p.$('mtg-preview').innerHTML.includes('Old title'));
  const count = p.exec.length; p.copies[0].reject(); await flushPage();
  check(order + '/' + mod + ': clear invalidates old copy fallback', p.exec.length === count && p.$('mtg-copy').textContent === 'Copy');
  p.input('mtg-title', 'Retained'); p.document.body.focus(); p.document.body.dispatch('keydown', { key: 'l', [mod]: true });
  check(order + '/' + mod + ': outside focus remains unchanged', p.$('mtg-title').value === 'Retained' && p.cleared.length === 1);
}
for (const older of ['resolve', 'reject']) for (const current of ['resolve', 'reject']) {
  const p = page(spec); p.click('#mtg-copy'); p.click('#mtg-copy'); p.copies[1][current](); await flushPage();
  const label = p.$('mtg-copy').textContent, calls = p.exec.length; p.copies[0][older](); await flushPage();
  check('same head ' + older + '/' + current + ': latest request owns feedback/fallback', p.$('mtg-copy').textContent === label && p.exec.length === calls && calls === (current === 'reject' ? 1 : 0));
}
for (const completion of ['resolve', 'reject']) {
  const p = page(spec); p.click('#mtg-copy'); p.input('mtg-title', 'New title'); const output = p.$('mtg-output').textContent;
  p.copies[0][completion](); await flushPage();
  check('new head invalidates old copy ' + completion, p.$('mtg-copy').textContent === 'Copy' && p.$('mtg-output').textContent === output && p.exec.length === 0);
}
{
  const p = page(spec); p.click('#mtg-copy'); p.copies[0].resolve(); await flushPage();
  const oldTimer = [...p.timers.values()].find(t => t.delay === 1500).fn; p.advance(500); p.click('#mtg-copy'); p.copies[1].resolve(); await flushPage();
  oldTimer(); p.advance(1000); check('cancelled/expired timer cannot clear newer feedback', p.$('mtg-copy').textContent === 'Copied!' && p.$('mtg-copy').classList.contains('copied'));
  p.advance(500); eq('current timer restores stable original', p.$('mtg-copy').textContent, 'Copy');
}
for (const kind of ['missing', 'throw', 'insecure']) for (const fallbackSuccess of [false, true]) {
  const p = page(spec); p.options.fallbackSuccess = fallbackSuccess; const output = p.$('mtg-output').textContent; let native = 0, writes = 0;
  Object.setPrototypeOf(p.globals.navigator, { get clipboard() { native++; throw Error('native clipboard forbidden'); } });
  Object.defineProperty(p.globals.navigator, 'clipboard', { configurable: true, value: kind === 'missing' ? undefined : { writeText() { writes++; throw Error('sync failure'); } } });
  if (kind === 'insecure') p.window.isSecureContext = false;
  let threw = false; try { p.click('#mtg-copy'); } catch { threw = true; } await flushPage();
  check(kind + '/' + fallbackSuccess + ': guarded fallback preserves full bytes and visible outcome', !threw && !native && writes === (kind === 'throw' ? 1 : 0) && p.exec.length === 1 && p.exec[0].text === output && p.$('mtg-copy').textContent === (fallbackSuccess ? 'Copied!' : 'Copy failed.') && !p.$('mtg-copy').disabled);
}
for (const platform of ['facebook', 'twitter', 'discord']) {
  const p = page(spec); p.input('mtg-og-image', 'https://example.com/og.png'); p.input('mtg-tw-image', 'https://example.com/tw.png'); p.click('[data-platform="' + platform + '"]');
  check(platform + ': existing inert img source and lazy network boundary retained', p.$('mtg-preview').innerHTML.includes('src="https://example.com/' + (platform === 'twitter' ? 'tw' : 'og') + '.png"') && p.$('mtg-preview').innerHTML.includes('loading="lazy"'));
}

// Analytics: one `update` event per committed change (change event), as in color-palette-generator.
// Before the fix update() sent one on page load, on every keystroke and on every preview tab click.
{
  const p = page(spec);
  eq('analytics: no event on page load', p.tracks.length, 0);
  p.input('mtg-title', 'Draft'); p.input('mtg-title', 'Draft title');
  eq('analytics: no event per input', p.tracks.length, 0);
  p.$('mtg-title').dispatch('change');
  check('analytics: one event when the text field is committed', p.tracks.length === 1 && p.tracks[0][0] === 'meta-tag-generator' && p.tracks[0][1] === 'update', JSON.stringify(p.tracks));
  p.input('mtg-og-type', 'article', 'change');
  eq('analytics: one event per select change', p.tracks.length, 2);
  p.$('mtg-viewport').checked = false; p.$('mtg-viewport').dispatch('change');
  eq('analytics: one event per checkbox change', p.tracks.length, 3);
  p.click('[data-platform="facebook"]');
  eq('analytics: switching the preview tab sends no event', p.tracks.length, 3);
}
// Preview domain: without a canonical URL the preview derives a domain from the site name. A name
// with no ASCII letters or digits ("週末さんぽ帖") gave ".com"; it now falls back to example.com.
for (const [name, want] of [['週末さんぽ帖', 'example.com'], ['小王咖啡', 'example.com'], ['My Site', 'mysite.com']]) {
  const p = page(spec, 'ja');
  p.input('mtg-canonical', ''); p.input('mtg-site-name', name); p.click('[data-platform="twitter"]');
  check('preview domain for site name ' + name + ' is ' + want, p.$('mtg-preview').innerHTML.includes('>' + want + '<'), p.$('mtg-preview').innerHTML.slice(0, 400));
}

// ---------- tool pages (src/content/tools/meta-tag-generator/{lang}.mdx) ----------
// `{/* mtg-check: {json} */}` before an ```html block. With "page": true the page script runs in the
// page language (the form starts with the sample values for that language), each "input" entry is
// applied in order (select: change event; boolean: checkbox `checked` + change; other: input event)
// and the block must equal #mtg-output. Without "page" the block equals buildHead() on an empty form,
// as in the guides. The block must sit after the annotation and before the next annotation or H2, and
// every ```html block on the four tool pages must be such an output.
{
  const { fencedBlocks, toolMdxContract } = await import('./lib/tool-mdx-contract.mjs');
  const emptyForm = {
    title: '', description: '', canonical: '', siteName: '', author: '', keywords: '', language: 'en', themeColor: '',
    robotsIndex: 'index', robotsFollow: 'follow', viewport: false, ogType: 'website', ogLocale: '', ogImage: '',
    ogImageWidth: '', ogImageHeight: '', ogImageAlt: '', twCard: 'summary_large_image', twSite: '', twCreator: '', twImage: '', schemaType: '',
  };
  function toolPageOutput(example, lang) {
    if (!example.page) return buildHead({ ...emptyForm, ...example });
    const p = page(spec, lang);
    for (const [id, value] of Object.entries(example.input || {})) {
      const el = p.$(id);
      if (typeof value === 'boolean') { el.checked = value; el.dispatch('change'); }
      else p.input(id, value, el.tagName === 'SELECT' ? 'change' : 'input');
    }
    return p.$('mtg-output').textContent;
  }
  // `{/* mtg-count: {"title": "…", "description": "…"} */}`: type both into the page; the two counter
  // texts ("N / 60", "M / 160") must appear as inline code after the annotation.
  function counterTexts(example, lang) {
    const p = page(spec, lang);
    p.input('mtg-title', example.title); p.input('mtg-description', example.description);
    return [p.$('mtg-title-counter').textContent, p.$('mtg-description-counter').textContent];
  }
  const inlineCode = (text, value) => text.includes('<code>' + value + '</code>') || text.includes('`' + value + '`');
  const covered = { en: 0, zh: 0, ja: 0, ko: 0 };
  const contract = toolMdxContract('meta-tag-generator', { annotations: [{ tag: 'mtg-check', min: 2, verify({ spec: example, after, lang }) {
    const out = toolPageOutput(example, lang);
    if (headOf(out).bodyNodes !== 0) return 'output does not parse as one head';
    const hit = fencedBlocks(after).some((b) => b.text.trimEnd() === out);
    if (hit) covered[lang]++;
    return hit ? null : 'no fenced block after the annotation equals the generated head:\n' + out;
  } }, { tag: 'mtg-count', verify({ spec: example, after, lang }) {
    const missing = counterTexts(example, lang).filter((t) => !inlineCode(after, t));
    return missing.length ? 'counter text not shown as inline code: ' + missing.join(', ') : null;
  } }] });
  for (const r of contract.results) check('tool page ' + r.message, r.ok);
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const html = fencedBlocks(contract.docs[lang].body).filter((b) => b.lang === 'html').length;
    check(lang + ' every html block on the tool page is a checked generator output', html === covered[lang], html + ' html blocks, ' + covered[lang] + ' checked');
  }
}

// v2 presentation checks; all original engine/blog/live-dist and FIX lifecycle groups remain above.
const baselineRetained = passes;
const markupV2=source.slice(source.indexOf('---',3)+3,source.indexOf('<script is:inline'));
const cssV2=source.slice(source.indexOf('<style'));
check('v2 generate shared rail',markupV2.includes('class="mtg-rail zt-rail"'));
check('v2 300px rail and bounded results',cssV2.includes('grid-template-columns: 300px minmax(0, 1fr)')&&cssV2.includes('flex: 1 1 0; min-height: 0;'));
check('v2 860 stack and 640 phone',cssV2.includes('max-width: 860px')&&cssV2.includes('max-width: 640px'));
check('v2 main44/dense24',cssV2.includes('min-height: 44px')&&cssV2.includes('min-height: 24px'));
check('v2 reserved status',cssV2.includes('.mtg-status-slot { min-height: 2.8em'));
check('v2 Copy/status before fields/options',markupV2.indexOf('id="mtg-copy"')<markupV2.indexOf('class="mtg-status-slot"')&&markupV2.indexOf('class="mtg-status-slot"')<markupV2.indexOf('id="mtg-title"')&&markupV2.indexOf('id="mtg-title"')<markupV2.indexOf('<details class="mtg-options">'));
check('v2 secondary metadata defaults closed',markupV2.includes('<details class="mtg-options">'));
check('v2 all 23 actual inputs preserved unique',['title','description','canonical','site-name','author','keywords','language','theme-color','theme-color-text','robots-index','robots-follow','viewport','og-type','og-locale','og-image','og-image-width','og-image-height','og-image-alt','tw-card','tw-site','tw-creator','tw-image','schema-type'].every(id=>(markupV2.match(new RegExp('id="mtg-'+id+'"','g'))||[]).length===1));
check('v2 only Copy plus four platform buttons',(markupV2.match(/<button /g)||[]).length===5);
check('v2 four old platform actions retained',['google','facebook','twitter','discord'].every(k=>markupV2.includes('data-platform="'+k+'"')));
check('v2 all tips use slots',(markupV2.match(/<Toggletip /g)||[]).length===16&&!/<Toggletip[^>]*text=/.test(markupV2));
check('v2 runtime translation loops absent',!source.includes("querySelectorAll('[data-i18n]')"));
check('v2 client only four actual dynamic keys',source.includes("const CLIENT_T = Object.fromEntries(['copy', 'copied', 'copyFailed', 'fillToPreview']"));
check('v2 head output internal scroll',cssV2.includes('.mtg-output { min-height: 0; flex: 1 1 0; overflow: auto; white-space: pre; }'));
check('v2 empty platform section hidden below 860',cssV2.includes('.mtg-platform-view[data-empty="true"] { display: none; }'));
for(const lang of ['en','zh','ja','ko']){
 const p=page(spec,lang);eq(lang+' v2 SSR Copy',p.$('mtg-copy').textContent,STRINGS[lang].copy);eq(lang+' v2 SSR title label',p.document.querySelector('[for="mtg-title"]').textContent.replace(/\s+/g,' ').trim(),STRINGS[lang].title+' '+p.$('mtg-title-counter').textContent);eq(lang+' v2 SSR placeholder',p.$('mtg-title').getAttribute('placeholder'),STRINGS[lang].titlePh);
 eq(lang+' v2 visible image request notice',p.document.querySelector('.mtg-network-notice').textContent,STRINGS[lang].networkNotice);
 check(lang+' v2 sixteen nonempty localized tips',Object.keys(STRINGS[lang].tips).length===16&&Object.values(STRINGS[lang].tips).every(v=>typeof v==='string'&&v.length>10));
 eq(lang+' v2 initial seeded preview retained',p.document.querySelector('.mtg-platform-view').getAttribute('data-empty'),'false');
 const mdx=readFileSync(join(root,'src/content/tools/meta-tag-generator',lang+'.mdx'),'utf8'),block=mdx.match(/^steps:\n([\s\S]*?)(?=^faqItems:)/m)?.[1];check(lang+' v2 steps before FAQ',!!block);const steps=block?.trim().split('\n').map(x=>JSON.parse(x.trim().slice(2)))||[];check(lang+' v2 step count/length constraints',steps.length===5&&steps.every(x=>x.length<=280)&&steps.join('').length<=1200);check(lang+' v2 Usage section removed',!/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(mdx));if(lang==='en')check('v2 EN remains at least400 words',mdx.replace(/^---[\s\S]*?---/,'').replace(/<[^>]*>/g,' ').split(/\s+/).filter(Boolean).length>=400);
}
for(const order of ['before','after']){
 const p=page(spec,'en',order);p.$('mtg-canonical').value='';p.$('mtg-og-image').value='';p.$('mtg-tw-image').value='';p.key('mtg-title');eq(order+' v2 empty platform state follows exact render conditions',p.document.querySelector('.mtg-platform-view').getAttribute('data-empty'),'true');check(order+' v2 retained settings keep robots output',p.$('mtg-output').textContent.includes('name="robots"')&&!p.$('mtg-copy').disabled);p.input('mtg-title','Back');eq(order+' v2 input restores platform state',p.document.querySelector('.mtg-platform-view').getAttribute('data-empty'),'false');p.input('mtg-title','');p.input('mtg-description','');p.input('mtg-tw-image','https://example.com/twitter-only.png');eq(order+' v2 Twitter image alone preserves old empty strategy',p.document.querySelector('.mtg-platform-view').getAttribute('data-empty'),'true');
}
// A fixed-size budget protects the phone result opening without changing editable targets.
const cssTree = createRequire(join(root, 'package.json'))('postcss').parse(cssV2.replace(/^<style[^>]*>/, '').replace(/<\/style>[\s\S]*$/, ''));
function phoneDeclarations(selector) {
  const values = {};
  cssTree.walkRules(rule => {
    if (!rule.selectors.includes(selector)) return;
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type !== 'atrule' || parent.name !== 'media') continue;
      const max = parent.params.match(/max-width:\s*([\d.]+)px/);
      const min = parent.params.match(/min-width:\s*([\d.]+)px/);
      if (max && 390 > Number(max[1]) || min && 390 < Number(min[1])) return;
    }
    rule.walkDecls(decl => { values[decl.prop] = decl.value; });
  });
  return values;
}
function phonePixels(value) {
  const match = String(value).match(/^([\d.]+)(px|rem|em)?$/);
  return match ? Number(match[1]) * (match[2] === 'rem' || match[2] === 'em' ? 16 : 1) : NaN;
}
const phoneRail = phoneDeclarations('.mtg-rail');
const phoneStatus = phoneDeclarations('.mtg-status-slot');
const phoneDescription = phoneDeclarations('.mtg-rail > .mtg-field .tool-textarea');
const phoneNotice = phoneDeclarations('.mtg-network-notice');
const phonePrimary = phoneDeclarations('.mtg-rail > .mtg-field .tool-input');
const phoneCopy = phoneDeclarations('.mtg-actions .btn-copy');
const phonePlatform = phoneDeclarations('.mtg-platform-view');
const phoneBudget = phonePixels(phoneStatus['min-height']) + phonePixels(phoneDescription.height) +
  4 * phonePixels(phoneRail.gap) + 3 * phonePixels(phoneNotice['font-size']) * Number(phoneNotice['line-height']);
check('phone initial rail and notice budget keeps result opening space and 44px edit/actions',
  Number.isFinite(phoneBudget) && phoneBudget <= 135 && phonePixels(phoneStatus['min-height']) >= 16 &&
  phonePixels(phoneDescription.height) >= 44 && phonePixels(phoneDescription['min-height']) >= 44 &&
  phonePixels(phonePrimary['min-height']) >= 44 && phonePixels(phoneCopy['min-height']) >= 44 &&
  phonePixels(phonePlatform['flex-basis']) >= 256,
  { fixedSizeBudget: phoneBudget, requiredMaximum: 135, platformArea: phonePixels(phonePlatform['flex-basis']) });

const report={slug:'meta-tag-generator',counts:{PASS:passes,FAIL:failures},baselineRetained,featureChecks:passes-baselineRetained,defaultLiveDistDetectionRetained:true};
if(process.env.ZT_FEATURE_REPORT)writeFileSync(process.env.ZT_FEATURE_REPORT,JSON.stringify(report,null,2)+'\n');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
