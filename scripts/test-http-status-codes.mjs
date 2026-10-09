// Execute HttpStatusCodesTool's complete inline script and ToolLayout's real keyboard handler.
// DOM/event/clipboard boundaries use the lockfile's domino implementation; no browser or network.
// The 64-row dictionary follows the IANA registry snapshot below (codes and names); the row
// hash pins the reviewed descriptions.
// Run: node scripts/test-http-status-codes.mjs. Writes stdout only; exit 1 on a failed assertion.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import domino from '@mixmark-io/domino';
import {loadPage,frontmatterStrings} from './astro-page-harness.mjs';
import { contractProblems, fencedBlocks } from './lib/tool-mdx-contract.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const source=readFileSync(join(root,'src/components/tools/HttpStatusCodesTool.astro'),'utf8');
const layout=readFileSync(join(root,'src/layouts/ToolLayout.astro'),'utf8');
const shortcut=layout.slice(layout.indexOf('// ── Keyboard shortcuts:'),layout.indexOf('// ── Copy button visual feedback'));
const sha=s=>createHash('sha256').update(s).digest('hex');
let passes=0,failures=0;
function check(name,ok,detail){if(ok){passes++;return;}failures++;console.log('FAIL '+name+(detail===undefined?'':' — '+JSON.stringify(detail)));}
function eq(name,actual,expected){check(name,JSON.stringify(actual)===JSON.stringify(expected),{actual,expected});}
const script=source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const STRINGS=frontmatterStrings(source.split('---')[1]);
const markupTemplate=source.replace(/^---\n[\s\S]*?\n---\s*/,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/g,'');
const esc=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function renderMarkup(lang){
 const T=STRINGS[lang];
 const i18n=JSON.parse(readFileSync(join(root,'src/i18n',lang+'.json'),'utf8'));
 return markupTemplate
  .replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g,(_all,id,about,key)=>'<span class="zt-tip"><button type="button" data-zt-tip="'+id+'" aria-label="'+esc(i18n['tool.tipAbout'].replace('{name}',T[about]))+'"></button><span id="'+id+'" class="zt-tip-pop" hidden>'+esc(T.tips[key])+'</span></span>')
  .replace(/=\{T\.(\w+)\}/g,(_all,key)=>'="'+esc(T[key])+'"')
  .replace(/\{T\.(\w+)\}/g,(_all,key)=>esc(T[key]));
}
const EXPECTED_CODES=[100,101,102,103,104,200,201,202,203,204,205,206,207,208,226,300,301,302,303,304,305,306,307,308,400,401,402,403,404,405,406,407,408,409,410,411,412,413,414,415,416,417,418,421,422,423,424,425,426,428,429,431,451,500,501,502,503,504,505,506,507,508,510,511];
function page(lang,order){
 const markup=renderMarkup(lang);
 const document=domino.createDocument('<html lang="'+lang+'"><body><main class="tool-widget">'+markup+'</main><input id="outside" type="text"></body></html>');
 Object.defineProperty(document,'activeElement',{value:document.body,writable:true,configurable:true});
 for(const e of Array.from(document.querySelectorAll('input,button,[tabindex]')))Object.defineProperty(e,'focus',{value:()=>{document.activeElement=e;}});
 const clears=[],tracks=[],effects=[];
 const globals={document,_slug:'http-status-codes',ztPersist:{clear:slug=>clears.push(slug)},trackTool:(...args)=>tracks.push(args),navigator:{clipboard:{writeText(){effects.push('clipboard');throw Error('Unexpected clipboard');}}},fetch(){effects.push('network');throw Error('Unexpected network');}};
 if(order==='shared-before'){const context=vm.createContext(globals);context.window=context;vm.runInContext(shortcut,context);}
 const real=loadPage('src/components/tools/HttpStatusCodesTool.astro',{lang,globals});
 if(order==='shared-after')real.run(shortcut);
 const search=document.getElementById('hs-search');
 function type(text){search.value=text;const e=document.createEvent('Event');e.initEvent('input',true,true);search.dispatchEvent(e);}
 function key(target,values){target.focus();const e=document.createEvent('Event');e.initEvent('keydown',true,true);Object.assign(e,{key:'l',ctrlKey:false,metaKey:false,...values});target.dispatchEvent(e);return e;}
 const rows=()=>[...document.querySelectorAll('.hs-row')].map(e=>({code:e.querySelector('.hs-code').textContent,name:e.querySelector('.hs-name').textContent,description:e.querySelector('.hs-desc').textContent}));
 return{document,search,type,key,rows,codes:()=>rows().map(r=>+r.code),empty:()=>document.getElementById('hs-empty').style.display!=='none',clears,tracks,effects,flush:()=>real.flush()};
}
check('actual shared CtrlL handler loaded',shortcut.includes("widget.querySelectorAll('textarea, input[type=\"text\"]')")&&shortcut.includes('window.ztPersist.clear(_slug)'));
for(const lang of ['en','zh','ja','ko'])for(const order of ['shared-before','shared-after']){
 const p=page(lang,order),tag=lang+'/'+order,all=p.rows();
 eq(tag+' original full dictionary codes',p.codes(),EXPECTED_CODES);
 eq(tag+' original dictionary names/descriptions',sha(JSON.stringify(all)),'28523eb99f150ee6b560ffe7aa35ea5da844f85740e9b5fad2e126ed2397c7d2');
 eq(tag+' original five category headings',[...p.document.querySelectorAll('.hs-cat-hdr')].map(e=>e.textContent),['1xx Informational','2xx Success','3xx Redirection','4xx Client Error','5xx Server Error']);
 eq(tag+' localized placeholder',p.search.placeholder,STRINGS[lang].searchPlaceholder);
 p.type('404');eq(tag+' numeric search also matches description',p.codes(),[404,410]);
 p.type('  tEaPoT  ');eq(tag+' trim/case-insensitive name search',p.codes(),[418]);
 p.type('websocket');eq(tag+' description search',p.codes(),[101]);
 p.type('xx_no_status_xx');eq(tag+' unmatched search has zero rows',p.codes(),[]);check(tag+' unmatched message visible',p.empty());eq(tag+' localized no-match text',p.document.getElementById('hs-empty').textContent,STRINGS[lang].noMatch);
 p.type('');eq(tag+' manual empty query restores full table',p.rows(),all);check(tag+' manual empty query hides no-match',!p.empty());
 for(const value of ['404','xx_no_status_xx'])for(const modifiers of [{ctrlKey:true},{metaKey:true}])for(const key of ['l','L']){
  p.type(value);const before=p.clears.length,tracked=p.tracks.length,e=p.key(p.search,{...modifiers,key});
  const label=tag+'/'+value+'/'+(modifiers.ctrlKey?'Ctrl':'Meta')+'+'+key;
  eq(label+' search is empty',p.search.value,'');eq(label+' all original rows restored',p.rows(),all);check(label+' no-match hidden',!p.empty());eq(label+' shared persistence clears once',p.clears.slice(before),['http-status-codes']);check(label+' focus remains in input',p.document.activeElement===p.search);check(label+' browser shortcut suppressed',e.defaultPrevented);eq(label+' clear does not invent a search analytics event',p.tracks.length,tracked);p.flush();eq(label+' stable after pending callbacks',p.rows(),all);
  p.type('200');eq(label+' subsequent input still filters',p.codes(),[200]);
 }
 p.type('404');const before=p.clears.length,html=p.document.getElementById('hs-list').innerHTML;
 const plain=p.key(p.search,{key:'l'});eq(tag+' plain L preserves query',p.search.value,'404');eq(tag+' plain L preserves table',p.document.getElementById('hs-list').innerHTML,html);check(tag+' plain L is not prevented',!plain.defaultPrevented);
 const outside=p.document.getElementById('outside');outside.value='outside';const out=p.key(outside,{ctrlKey:true});eq(tag+' outside shortcut preserves query',p.search.value,'404');eq(tag+' outside shortcut preserves unrelated input',outside.value,'outside');eq(tag+' outside shortcut does not clear storage',p.clears.length,before);check(tag+' outside shortcut is not prevented',!out.defaultPrevented);
 for(const modifiers of [{ctrlKey:true},{metaKey:true}]){const e=p.key(p.search,{...modifiers,key:'Enter'});eq(tag+' modifier Enter has no primary action',p.document.getElementById('hs-list').innerHTML,html);check(tag+' no primary action does not prevent Enter',!e.defaultPrevented);}
 eq(tag+' no network or clipboard side effect',p.effects,[]);
}
// Unmarked core protection: CODES/CLASSES, rendering and filtering stay byte-for-byte original.
const dictionary=source.slice(source.indexOf('      var CODES ='),source.indexOf('      var listEl ='));
const render=source.slice(source.indexOf('      function badgeCls'),source.indexOf("      searchEl.addEventListener('input'"));
const a=source.indexOf("      searchEl.addEventListener('input'"),b=source.indexOf('\n      });',a)+'\n      });'.length;
eq('original dictionary/classes bytes',Buffer.byteLength(dictionary),9005);
eq('original dictionary/classes SHA',sha(dictionary),'2f358a8ac599fab1bdb90c406ab0bd5d095b4cff2169cccab049e6014dd7e275');
eq('original badge/render/initial table SHA',sha(render),'48181e7afab19a757d75a4ce1da78bd3e203a03387d31a1e63a405d8197e2b64');
eq('original input filter SHA',sha(source.slice(a,b)),'d0ef652ae2ace149a5f7d2ceeae699a164f1a17f39c660bd3110b5ead17b58d2');

// ---------- v2 page layout ----------
const require=createRequire(join(root,'package.json'));
const astroRequire=createRequire(require.resolve('astro/package.json'));
const compiled=await astroRequire('@astrojs/compiler').transform(source,{filename:join(root,'src/components/tools/HttpStatusCodesTool.astro'),scopedStyleStrategy:'attribute'});
check('v2 Astro compile has no errors',!compiled.diagnostics.some(d=>d.severity===1));
let moduleError='';
try{await require('esbuild').transform(compiled.code,{loader:'ts',format:'esm'});}catch(error){moduleError=String(error);}
eq('v2 generated Astro module parses',moduleError,'');
const css=compiled.css.join('\n');
check('v2 direct root',/^<div class="hs-wrap">/.test(markupTemplate));
check('v2 root flex has zero minimum dimensions',/\.hs-wrap\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*min-width:\s*0[^}]*min-height:\s*0/.test(css));
check('v2 result fills remaining desktop height',/\.hs-result-section\s*\{[^}]*flex:\s*1 1 0[^}]*min-width:\s*0[^}]*min-height:\s*0/.test(css));
check('v2 list bounds and internally scrolls long results',/\.hs-list\s*\{[^}]*flex:\s*1 1 0[^}]*min-width:\s*0[^}]*min-height:\s*0[^}]*overflow:\s*auto[^}]*scrollbar-gutter:\s*stable/.test(css));
check('v2 actual rows cannot shrink instead of scrolling',/\.hs-list\s*>\s*\*\s*\{\s*flex:\s*none/.test(css));
check('v2 fixed no-match status cannot push the list',/\.hs-status\s*\{[^}]*height:\s*2\.8em[^}]*overflow:\s*auto/.test(css));
check('v2 860px result has fixed positive height',/@media\s*\(max-width:\s*860px\)[\s\S]*?\.hs-result-section\s*\{\s*flex:\s*none;\s*height:\s*26rem/.test(css));
check('v2 640px result and search remain usable',/@media\s*\(max-width:\s*640px\)[\s\S]*?\.hs-result-section\s*\{\s*height:\s*24rem;?\s*\}\s*\.hs-search-row input\s*\{\s*min-height:\s*44px/.test(css));
check('v2 heading/status/result order',markupTemplate.indexOf('id="hs-search"')<markupTemplate.indexOf('id="hs-status"')&&markupTemplate.indexOf('id="hs-status"')<markupTemplate.indexOf('class="hs-result-section"'));
check('v2 build-time strings replace runtime i18n',!/data-i18n|document\.documentElement\.lang/.test(source));
check('v2 zero localization or tip payload in client',!/STRINGS|TIPS|CLIENT_T|define:vars|data-strings/.test(script)&&!source.includes('define:vars'));
eq('v2 original core and complete FIX tail bytes',Buffer.byteLength(source.slice(source.indexOf('      var CODES ='),source.indexOf('  </script>'))),11525);
eq('v2 original core and complete FIX tail SHA',sha(source.slice(source.indexOf('      var CODES ='),source.indexOf('  </script>'))),'bbd1885e4dfb2b872a74c5886844054af7fe31a0d25ba37ee12e6215dd017dd9');
const tipBindings=[...markupTemplate.matchAll(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g)];
eq('v2 two literal tip IDs',tipBindings.map(m=>m[1]),['hs-tip-search','hs-tip-results']);
check('v2 no tip button nested in an input label',!/<label\b[^>]*>[\s\S]*?<Toggletip[\s\S]*?<\/label>/.test(markupTemplate));
const {compile}=await import('@mdx-js/mdx');
for(const lang of ['en','zh','ja','ko']){
 const T=STRINGS[lang],p=page(lang,'shared-after'),doc=p.document;
 eq('v2 '+lang+' same localized keys',Object.keys(T),Object.keys(STRINGS.en));
 eq('v2 '+lang+' same tip keys',Object.keys(T.tips),['search','results']);
 check('v2 '+lang+' tips are plain text',Object.values(T.tips).every(t=>t&&t.length<=280&&!/[<>\n]|https?:/.test(t)));
 eq('v2 '+lang+' visible localized input label',doc.querySelector('label[for="hs-search"]').textContent,T.searchLabel);
 eq('v2 '+lang+' visible localized result label',doc.getElementById('hs-results-label').textContent,T.resultsLabel);
 eq('v2 '+lang+' result is a keyboard-accessible region',[doc.getElementById('hs-list').getAttribute('tabindex'),doc.getElementById('hs-list').getAttribute('role'),doc.getElementById('hs-list').getAttribute('aria-label')],['0','region',T.resultsLabel]);
 eq('v2 '+lang+' no invented action buttons',doc.querySelectorAll('button:not([data-zt-tip])').length,0);
 eq('v2 '+lang+' reference table defaults to all 64 rows',p.rows().length,64);
 for(const [,id,about,key] of tipBindings){
  eq('v2 '+lang+' localized tip '+id,doc.getElementById(id).textContent,T.tips[key]);
  check('v2 '+lang+' accessible about '+id,doc.querySelector('[data-zt-tip="'+id+'"]').getAttribute('aria-label').includes(T[about]));
 }
 const content=readFileSync(join(root,'src/content/tools/http-status-codes',lang+'.mdx'),'utf8');
 const data=require('js-yaml').load(content.match(/^---\n([\s\S]*?)\n---/)[1]);
 eq('v2 '+lang+' three steps',data.steps.length,3);
 check('v2 '+lang+' steps bounded',data.steps.every(t=>typeof t==='string'&&t.length<=280&&!/[<>\n]/.test(t))&&data.steps.join('').length<=1200);
 check('v2 '+lang+' steps before FAQ',content.indexOf('steps:')<content.indexOf('faqItems:'));
 check('v2 '+lang+' Usage removed',!/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(content));
 eq('v2 '+lang+' MDX content contract', contractProblems('http-status-codes', lang), '');
 const jsBlock=c=>fencedBlocks(c).find(b=>b.lang==='javascript')?.text;
 eq('v2 '+lang+' JavaScript example same as the English page',jsBlock(content),jsBlock(readFileSync(join(root,'src/content/tools/http-status-codes/en.mdx'),'utf8')));
 let error='';try{await compile(content.replace(/^---\n[\s\S]*?\n---/,''));}catch(e){error=String(e);}
 eq('v2 '+lang+' real MDX compiles',error,'');
 for(const order of ['shared-before','shared-after'])for(const focus of ['[data-zt-tip="hs-tip-search"]','[data-zt-tip="hs-tip-results"]','#hs-list']){
  const q=page(lang,order);q.type('xx_no_status_xx');q.key(q.document.querySelector(focus),{ctrlKey:true});
  eq('v2 '+lang+'/'+order+'/'+focus+' actual CtrlL clears and refocuses',[q.search.value,q.rows().length,q.empty(),q.document.activeElement.id,q.clears],['',64,false,'hs-search',['http-status-codes']]);
 }
}
// Check emitted selectors against actual dynamically created nodes, without Astro scope attributes.
{
 const p=page('en','shared-after');
 for(const className of ['hs-cat-hdr','hs-row','hs-code','hs-body','hs-name','hs-desc']){
  const selector=css.match(new RegExp('\\.'+className+'\\s*\\{'))?.[0].replace(/\s*\{$/,'');
  check('v2 compiled selector matches generated '+className,!!selector&&p.document.querySelectorAll(selector).length>0);
 }
 for(const category of ['1xx','2xx','3xx','4xx','5xx']){
  check('v2 manual dark category selector remains global '+category,new RegExp('\\[data-theme="dark"\\]\\s+\\.hs-cat-'+category+'\\s*\\{').test(css));
  check('v2 system dark category selector remains global '+category,new RegExp(':root:not\\(\\[data-theme="light"\\]\\)\\s+\\.hs-cat-'+category+'\\s*\\{').test(css));
 }
 p.type('x'.repeat(100000));eq('v2 long query has no results',p.rows().length,0);check('v2 long query shows no-match',p.empty());
 p.type('');eq('v2 empty after long query restores every complete row',sha(JSON.stringify(p.rows())),'28523eb99f150ee6b560ffe7aa35ea5da844f85740e9b5fad2e126ed2397c7d2');
}
// ---------- approved changes to the protected filter (2026-10-09) ----------
// 8. The search event is sent once per committed change (not on every input event), and the
// query is NFKC-normalized, so full-width digits and letters from an IME match.
for(const lang of ['en','zh','ja','ko']){
 const p=page(lang,'shared-after'),change=()=>{const e=p.document.createEvent('Event');e.initEvent('change',true,true);p.search.dispatchEvent(e);};
 for(const q of ['4','40','404'])p.type(q);
 eq(lang+' 8 typing sends no search event',p.tracks.length,0);
 change();eq(lang+' 8 change sends one search event',p.tracks,[['http-status-codes','search']]);
 p.type('');change();eq(lang+' 8 change to an empty query sends nothing',p.tracks.length,1);
 p.type('４０４');eq(lang+' 8 full-width digits match',p.codes(),[404,410]);
 p.type('ＴｅａＰｏｔ');eq(lang+' 8 full-width letters match',p.codes(),[418]);
 p.type('\u3000５０３\u3000');eq(lang+' 8 ideographic spaces are trimmed',p.codes(),[503]);
}

// ---------- IANA registry and worked examples ----------
// IANA "HTTP Status Code Registry", http-status-codes-1.csv, registry updated 2025-09-15,
// downloaded 2026-10-09 from https://www.iana.org/assignments/http-status-codes/. Ranges marked
// Unassigned are left out.
const IANA_UPDATED='2025-09-15';
const IANA=Object.fromEntries(`100 Continue|101 Switching Protocols|102 Processing|103 Early Hints|104 Upload Resumption Supported (TEMPORARY - registered 2024-11-13, extension registered 2025-09-15, expires 2026-11-13)|200 OK|201 Created|202 Accepted|203 Non-Authoritative Information|204 No Content|205 Reset Content|206 Partial Content|207 Multi-Status|208 Already Reported|226 IM Used|300 Multiple Choices|301 Moved Permanently|302 Found|303 See Other|304 Not Modified|305 Use Proxy|306 (Unused)|307 Temporary Redirect|308 Permanent Redirect|400 Bad Request|401 Unauthorized|402 Payment Required|403 Forbidden|404 Not Found|405 Method Not Allowed|406 Not Acceptable|407 Proxy Authentication Required|408 Request Timeout|409 Conflict|410 Gone|411 Length Required|412 Precondition Failed|413 Content Too Large|414 URI Too Long|415 Unsupported Media Type|416 Range Not Satisfiable|417 Expectation Failed|418 (Unused)|421 Misdirected Request|422 Unprocessable Content|423 Locked|424 Failed Dependency|425 Too Early|426 Upgrade Required|428 Precondition Required|429 Too Many Requests|431 Request Header Fields Too Large|451 Unavailable For Legal Reasons|500 Internal Server Error|501 Not Implemented|502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout|505 HTTP Version Not Supported|506 Variant Also Negotiates|507 Insufficient Storage|508 Loop Detected|510 Not Extended (OBSOLETED)|511 Network Authentication Required`.split('|').map(x=>[+x.slice(0,3),x.slice(4)]));
{
 const rows=page('en','shared-after').rows(),list=Object.fromEntries(rows.map(r=>[+r.code,r.name]));
 eq('IANA: every listed code is an IANA entry',Object.keys(list).filter(c=>!IANA[c]).map(Number),[]);
 eq('IANA: every registry entry is in the list',Object.keys(IANA).filter(c=>!list[c]).map(Number),[]);
 eq('IANA: every name equals the registry name',Object.keys(list).filter(c=>list[c]!==IANA[c]).map(c=>[+c,list[c],IANA[c]]),[]);
 eq('IANA: list order follows the registry',rows.map(r=>+r.code),Object.keys(IANA).map(Number));
 const desc=Object.fromEntries(rows.map(r=>[+r.code,r.description]));
 eq('IANA: 104 says temporary and when it expires',/temporar/i.test(desc[104])&&desc[104].includes('2026-11-13'),true);
 eq('IANA: 305 deprecated, 306 unused (RFC 9110 15.4.6, 15.4.7)',[/deprecated/i.test(desc[305])&&desc[305].includes('15.4.6'),/no longer used/i.test(desc[306])&&desc[306].includes('15.4.7')],[true,true]);
 eq('IANA: 418 reserved, with the RFC 9110 section and the teapot origin',/reserved/i.test(desc[418])&&desc[418].includes('15.5.19')&&/teapot/i.test(desc[418]),true);
 eq('IANA: 413 and 422 keep the former names searchable',[desc[413].includes('Payload Too Large'),desc[422].includes('Unprocessable Entity')],[true,true]);
 eq('IANA: 426 needs an Upgrade header (RFC 9110 15.5.22)',/Upgrade:/.test(desc[426])&&desc[426].includes('15.5.22')&&!desc[426].includes('TLS/1.0'),true);
 eq('IANA: 510 obsoleted',/obsolete/i.test(desc[510]),true);
}
// {/* hsc-check: {"q":"..."} */} is followed by a code block with the rows the real page shows
// for that search, one "code name" per line, or the page's no-match text.
// {/* hsc-iana */} marks the Limits text that compares the list with the registry.
const hscVerify=({spec,after,lang})=>{
 const block=fencedBlocks(after)[0];if(!block)return 'no output block';
 const p=page(lang,'shared-after');p.type(spec.q);
 const got=p.rows().length?p.rows().map(r=>r.code+' '+r.name).join('\n'):STRINGS[lang].noMatch;
 return got===block.text?null:'the page shows:\n'+got;
};
const ianaVerify=({after})=>{
 const missing=['64','104','418','510','15.5.19',IANA_UPDATED].filter(x=>!after.includes(x));
 return missing.length?'Limits text does not mention '+missing.join(', '):null;
};
const exampleOpts={annotations:[{tag:'hsc-check',min:2,verify:hscVerify},{tag:'hsc-iana',min:1,verify:ianaVerify}]};
for(const lang of ['en','zh','ja','ko'])eq(lang+' worked examples and registry note match the page',contractProblems('http-status-codes',lang,exampleOpts),'');

check('v2 registered as analyze',/'http-status-codes':\s*'analyze'/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')));

console.log('\n'+passes+' passed, '+failures+' failed');
process.exitCode=failures?1:0;
