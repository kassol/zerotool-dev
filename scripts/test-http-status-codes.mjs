// Execute HttpStatusCodesTool's complete inline script and ToolLayout's real keyboard handler.
// DOM/event/clipboard boundaries use the lockfile's domino implementation; no browser or network.
// The 61-row dictionary snapshot is the reviewed original page, including names/descriptions.
// Run: node scripts/test-http-status-codes.mjs. Writes stdout only; exit 1 on a failed assertion.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import domino from '@mixmark-io/domino';
import {loadPage} from './astro-page-harness.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const source=readFileSync(join(root,'src/components/tools/HttpStatusCodesTool.astro'),'utf8');
const layout=readFileSync(join(root,'src/layouts/ToolLayout.astro'),'utf8');
const shortcut=layout.slice(layout.indexOf('// ── Keyboard shortcuts:'),layout.indexOf('// ── Copy button visual feedback'));
const sha=s=>createHash('sha256').update(s).digest('hex');
let passes=0,failures=0;
function check(name,ok,detail){if(ok){passes++;return;}failures++;console.log('FAIL '+name+(detail===undefined?'':' — '+JSON.stringify(detail)));}
function eq(name,actual,expected){check(name,JSON.stringify(actual)===JSON.stringify(expected),{actual,expected});}
const script=source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const STRINGS=vm.runInNewContext('('+script.match(/var STRINGS = (\{[\s\S]*?\n\s{6}\});/)[1]+')');
const EXPECTED_CODES=[100,101,102,103,200,201,202,203,204,205,206,207,208,226,300,301,302,303,304,307,308,400,401,402,403,404,405,406,407,408,409,410,411,412,413,414,415,416,417,418,421,422,423,424,425,426,428,429,431,451,500,501,502,503,504,505,506,507,508,510,511];
function page(lang,order){
 const markup=source.replace(/^---\n[\s\S]*?\n---/,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/g,'');
 const document=domino.createDocument('<html lang="'+lang+'"><body><main class="tool-widget">'+markup+'</main><input id="outside" type="text"></body></html>');
 Object.defineProperty(document,'activeElement',{value:document.body,writable:true,configurable:true});
 for(const e of Array.from(document.querySelectorAll('input')))Object.defineProperty(e,'focus',{value:()=>{document.activeElement=e;}});
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
 eq(tag+' original dictionary names/descriptions',sha(JSON.stringify(all)),'3bfb32b42e1bfc9553e6c5ef2bec49537ea34bfa4bda44c148bf642ae24e780d');
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
eq('original dictionary/classes bytes',Buffer.byteLength(dictionary),8183);
eq('original dictionary/classes SHA',sha(dictionary),'138810d8f5551435104d9b00683a01e69541d5ab6cb79b2e143f3aa2dc567d0e');
eq('original badge/render/initial table SHA',sha(render),'776b117cf099c0e12b7b123c0d5ce500c56654573f4f427cd9d59ee92397321c');
eq('original input filter SHA',sha(source.slice(a,b)),'58a07e1f882f176d955bb4be178e9d1f292226194032340d80cbf29d0e201368');
console.log('\n'+passes+' passed, '+failures+' failed');
process.exitCode=failures?1:0;
