// CSS to Tailwind — border colors, transition timing and @media blocks are not lost
//
// Read:  src/components/tools/CssToTailwindTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); src/content/tools/css-to-tailwind/{en,zh,ja,ko}.mdx
//        (each ```css block followed by a plain ``` block must convert to that output)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Expected classes are Tailwind's documented utilities (tailwindcss.com/docs: border-color,
// transition-property, transition-duration, transition-timing-function, transition-delay,
// responsive design breakpoints sm 640px / md 768px / lg 1024px / xl 1280px / 2xl 1536px).
// Covers: `border: 1px solid #e5e7eb` keeps the color (before: dropped without a keep
// comment), a border part the table cannot map keeps the whole declaration, `transition:
// all 0.2s` writes the duration (before: plain `transition`, 150 ms), timing functions and
// delays, transitions the tool cannot express are kept, rules nested in @media are parsed
// (before: `/* keep: .btn { padding: 2rem */`), min-width breakpoints become prefixes,
// other media queries are labelled and not prefixed, and the tool page examples.
//
// Run: node scripts/test-css-to-tailwind.mjs

import { loadPage, readComponent, frontmatterStrings } from './astro-page-harness.mjs';
import { parseFragment } from 'parse5';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CssToTailwindTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in CssToTailwindTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { convertCss };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}
const c = (css) => E.convertCss(css);

// ---------- border shorthand ----------
eq('border keeps its color', c('border: 1px solid #e5e7eb;'), 'border border-solid border-gray-200');
eq('border with a named color', c('border: 2px dashed white;'), 'border-2 border-dashed border-white');
eq('border width only', c('border: 1px;'), 'border');
eq('border with a color outside the table is kept whole', c('border: 1px solid #123456;'), '/* keep: border: 1px solid #123456 */');
eq('border with an unknown width is kept whole', c('border: 3px solid #e5e7eb;'), '/* keep: border: 3px solid #e5e7eb */');
eq('border: none', c('border: none;'), 'border-none');

// ---------- transition ----------
eq('transition: all 0.2s', c('transition: all 0.2s;'), 'transition-all duration-200');
eq('transition: opacity 300ms ease-in-out', c('transition: opacity 300ms ease-in-out;'), 'transition-opacity duration-300 ease-in-out');
eq('transition with delay', c('transition: transform 150ms linear 75ms;'), 'transition-transform duration-150 ease-linear delay-75');
eq('transition: background-color 1s ease-out', c('transition: background-color 1s ease-out;'), 'transition-colors duration-1000 ease-out');
eq('transition without a duration is 0s in CSS', c('transition: all;'), 'transition-all duration-0');
eq('duration outside the scale is kept', c('transition: all 0.25s;'), '/* keep: transition: all 0.25s */');
eq('several transitions are kept', c('transition: color 0.2s, transform 0.3s;'), '/* keep: transition: color 0.2s, transform 0.3s */');
eq('cubic-bezier is kept', c('transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);'), '/* keep: transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) */');
eq('unknown property is kept', c('transition: width 0.2s;'), '/* keep: transition: width 0.2s */');

// ---------- @media ----------
eq('rule inside @media min-width 768px gets md:', c('@media (min-width: 768px) { .btn { padding: 2rem; } }'), '/* .btn (md) */\nmd:p-8');
eq('all default breakpoints', [640, 1024, 1280, 1536].map((w) => c('@media (min-width:' + w + 'px){a{display:none}}').split('\n')[1]).join(' '), 'sm:hidden lg:hidden xl:hidden 2xl:hidden');
eq('other media queries are labelled, not prefixed', c('@media (max-width: 600px) { .a { display: none; } }'), '/* @media (max-width: 600px) .a */\nhidden');
eq('keep comments inside @media', c('@media (min-width: 768px) { .a { margin-top: 13px; } }'), '/* .a (md) */\n/* keep: margin-top: 13px */');
eq('rules before and after @media', c('.a { display: flex; }\n@media (min-width: 1024px) { .a { display: grid; } .b { opacity: 0.5; } }\n.c { cursor: pointer; }'),
  '/* .a */\nflex\n\n/* .a (lg) */\nlg:grid\n\n/* .b (lg) */\nlg:opacity-50\n\n/* .c */\ncursor-pointer');
eq('a comment with braces does not break parsing', c('/* { not a rule } */ .a { display: block; }'), '/* .a */\nblock');

// ---------- existing behaviour kept ----------
eq('flexbox card', c('.card {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 1rem;\n  padding: 1.5rem;\n  border-radius: 0.5rem;\n}'),
  '/* .card */\nflex flex-col items-center gap-4 p-6 rounded-lg');

// ---------- keep comments show the declaration as typed (before: lowercased) ----------
eq('keep comment keeps the case of a string', c('content: "Hello";'), '/* keep: content: "Hello" */');
eq('keep comment keeps a URL as typed', c('background-image: url("/img/Hero.PNG");'), '/* keep: background-image: url("/img/Hero.PNG") */');
eq('keep comment keeps a custom property name', c('--Brand-Color: #FF6600;'), '/* keep: --Brand-Color: #FF6600 */');
eq('keep comment inside a rule keeps the case', c('.a { font-family: "Noto Sans JP", sans-serif; }'), '/* .a */\n/* keep: font-family: "Noto Sans JP", sans-serif */');
eq('matching still ignores case', c('DISPLAY: FLEX; color: #3B82F6;'), 'flex text-blue-500');

// ---------- box-shadow: only Tailwind's default shadows (before: any value became `shadow`) ----------
// Values from the Tailwind v3 box-shadow docs (v3.tailwindcss.com/docs/box-shadow, v3.4.17).
eq('shadow-sm', c('box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);'), 'shadow-sm');
eq('shadow', c('box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);'), 'shadow');
eq('shadow-md', c('box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);'), 'shadow-md');
eq('shadow-lg', c('box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);'), 'shadow-lg');
eq('shadow-xl', c('box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);'), 'shadow-xl');
eq('shadow-2xl', c('box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25);'), 'shadow-2xl');
eq('shadow-inner', c('box-shadow: inset 0 2px 4px 0 rgb(0 0 0 / 0.05);'), 'shadow-inner');
eq('box-shadow: none', c('box-shadow: none;'), 'shadow-none');
eq('white space inside the value does not matter', c('box-shadow:\n  0 4px 6px -1px rgb(0 0 0/0.1),\n  0 2px 4px -2px rgb( 0 0 0 / 0.1 );'), 'shadow-md');
eq('a custom shadow is kept', c('box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);'), '/* keep: box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15) */');
// "rgb (" with a space is not a function call in CSS, so the value is invalid, not a default shadow.
eq('a space before ( is kept as written', c('box-shadow: 0 1px 2px 0 rgb (0 0 0 / 0.05);'), '/* keep: box-shadow: 0 1px 2px 0 rgb (0 0 0 / 0.05) */');
eq('the same shadow written with rgba() is kept', c('box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);'), '/* keep: box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05) */');
eq('a colored default shadow is kept', c('box-shadow: 0 25px 50px -12px rgb(59 130 246 / 0.25);'), '/* keep: box-shadow: 0 25px 50px -12px rgb(59 130 246 / 0.25) */');
{
  // Cross-check against the installed Tailwind's own theme: v4 keeps every v3 default shadow
  // value, some under new names (shadow-xs is v3's shadow-sm; the bare shadow and shadow-inner
  // are in its "Deprecated" theme block).
  const { createRequire: req } = await import('node:module');
  const twDir = dirname(req(join(root, 'package.json')).resolve('tailwindcss/package.json'));
  const theme = readFileSync(join(twDir, 'theme.css'), 'utf8');
  const vars = Object.fromEntries([...theme.matchAll(/--(shadow(?:-\w+)?):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  const v3Class = { 'shadow-2xs': null, 'shadow-xs': 'shadow-sm', 'shadow-sm': 'shadow', 'shadow-md': 'shadow-md', 'shadow-lg': 'shadow-lg', 'shadow-xl': 'shadow-xl', 'shadow-2xl': 'shadow-2xl', 'shadow': 'shadow', 'shadow-inner': 'shadow-inner' };
  same('tailwindcss theme.css shadow variables', Object.keys(vars).sort(), Object.keys(v3Class).sort());
  for (const [name, cls] of Object.entries(v3Class)) {
    eq('theme.css --' + name + ' converts to ' + (cls || 'a keep comment'), c('box-shadow: ' + vars[name] + ';'), cls || '/* keep: box-shadow: ' + vars[name] + ' */');
  }
}

// ---------- grid templates: only N equal tracks (before: repeat(3, 200px) became grid-cols-3) ----------
// Tailwind's grid-cols-N / grid-rows-N are repeat(N, minmax(0, 1fr)).
eq('repeat(N, 1fr) columns', c('grid-template-columns: repeat(3, 1fr);'), 'grid-cols-3');
eq('repeat(N, minmax(0, 1fr)) columns', c('grid-template-columns: repeat(4, minmax(0, 1fr));'), 'grid-cols-4');
eq('white space inside repeat()', c('grid-template-columns: repeat( 2 ,minmax( 0 , 1fr ) );'), 'grid-cols-2');
eq('fixed columns are kept', c('grid-template-columns: repeat(3, 200px);'), '/* keep: grid-template-columns: repeat(3, 200px) */');
eq('minmax with another minimum is kept', c('grid-template-columns: repeat(2, minmax(100px, 300px));'), '/* keep: grid-template-columns: repeat(2, minmax(100px, 300px)) */');
eq('repeat() followed by another track is kept', c('grid-template-columns: repeat(2, 1fr) 200px;'), '/* keep: grid-template-columns: repeat(2, 1fr) 200px */');
eq('repeat(0, 1fr) is kept', c('grid-template-columns: repeat(0, 1fr);'), '/* keep: grid-template-columns: repeat(0, 1fr) */');
eq('auto-fill is kept', c('grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));'), '/* keep: grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)) */');
eq('repeat(N, 1fr) rows', c('grid-template-rows: repeat(2, 1fr);'), 'grid-rows-2');
// Tailwind v3.4.17 has grid-cols-1 … grid-cols-12 and grid-rows-1 … grid-rows-12 only
// (v3.tailwindcss.com/docs/grid-template-columns, …/grid-template-rows); a larger N is kept.
eq('12 columns', c('grid-template-columns: repeat(12, 1fr);'), 'grid-cols-12');
eq('13 columns are kept', c('grid-template-columns: repeat(13, 1fr);'), '/* keep: grid-template-columns: repeat(13, 1fr) */');
eq('100 columns are kept', c('grid-template-columns: repeat(100, minmax(0, 1fr));'), '/* keep: grid-template-columns: repeat(100, minmax(0, 1fr)) */');
eq('12 rows', c('grid-template-rows: repeat(12, minmax(0, 1fr));'), 'grid-rows-12');
eq('13 rows are kept', c('grid-template-rows: repeat(13, 1fr);'), '/* keep: grid-template-rows: repeat(13, 1fr) */');
eq('a leading zero is kept', c('grid-template-columns: repeat(012, 1fr);'), '/* keep: grid-template-columns: repeat(012, 1fr) */');
eq('fixed rows are kept', c('grid-template-rows: repeat(3, 100px);'), '/* keep: grid-template-rows: repeat(3, 100px) */');
// Stated on the tool pages: an end line after the span is not kept (col-span-N is span N / span N).
eq('span N / end line keeps only the span', c('grid-column: span 2 / 4;'), 'col-span-2');

// ---------- the examples on the tool pages ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/css-to-tailwind/' + lang + '.mdx'), 'utf8');
  const re = /```css\n([\s\S]*?)\n```\s*\n[^`]*```\n([\s\S]*?)\n```/g;
  let m;
  let count = 0;
  while ((m = re.exec(mdx))) {
    count++;
    eq(lang + ': example ' + count + ' output', c(m[1]), m[2]);
  }
  check(lang + ': page has at least two examples', count >= 2, String(count));
}


// ---------- complete page lifecycle + real ToolLayout keyboard handler ----------
// Only DOM, clipboard completion and timer delivery are controlled; the whole page script runs.
const lifecycleSpec = {"slug": "css-to-tailwind", "component": "CssToTailwindTool", "prefix": "c2t", "input": "c2t-css", "source": "display: flex; padding: 1rem;", "next": "display: grid;", "expected": "flex p-4", "file": "src/components/tools/CssToTailwindTool.astro"};
lifecycleSpec.src = source;
const pageStrings = frontmatterStrings(readComponent(lifecycleSpec.file).frontmatter);
const clientStrings = lang => runInNewContext(source.match(/const CLIENT_T = \{[^;]+;/)[0] + ';CLIENT_T', { T: pageStrings[lang] });
const sourceLayout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = sourceLayout.slice(sourceLayout.indexOf("      document.addEventListener('keydown'", sourceLayout.indexOf('// ── Keyboard shortcuts')), sourceLayout.indexOf('      // ── Copy button visual feedback'));
check('actual shared shortcut extracted', shortcut.includes('window.ztPersist.clear(_slug)'));
const unhandled = [];
const onUnhandled = error => unhandled.push(String(error?.message || error));
process.on('unhandledRejection', onUnhandled);
const settle = () => new Promise(resolve => setImmediate(resolve));
const copied = { en:'Copied!', zh:'已复制！', ja:'コピー済み！', ko:'복사됨!' };
const normal = { en:'Copy', zh:'复制', ja:'コピー', ko:'복사' };
const copyFailure = { en:'Copy failed. Please try again.', zh:'复制失败，请重试。', ja:'コピーに失敗しました。再試行してください。', ko:'복사하지 못했습니다. 다시 시도하세요.' };
function same(name, actual, expected) { check(name, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected)); }
function lifecyclePage(lang='en',order='before') {
  const s = lifecycleSpec;
  const nodes=[],byId=new Map(),docHandlers={};
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const markup=s.src.slice(s.src.indexOf('---',3)+3,s.src.indexOf('<script')).replace(/placeholder=\{T\.(\w+)\}/g, (_,key) => 'placeholder="' + escape(pageStrings[lang][key]) + '"').replace(/\{T\.(\w+)\}/g, (_,key) => escape(pageStrings[lang][key]));
  let document;
  function text(n){return n.nodeName==='#text'?n.value:(n.childNodes||[]).map(text).join('');}
  function visit(n){
    if(n.tagName){
      const attrs=Object.fromEntries((n.attrs||[]).map(a=>[a.name,a.value]));
      const handlers={};
      const el={tagName:n.tagName.toUpperCase(),id:attrs.id||'',type:attrs.type||'text',attributes:attrs,value:attrs.value||'',textContent:text(n),className:attrs.class||'',disabled:'disabled'in attrs,checked:'checked'in attrs,placeholder:attrs.placeholder||'',
        getAttribute(k){return Object.hasOwn(this.attributes,k)?this.attributes[k]:null;},
        setAttribute(k,v){this.attributes[k]=String(v);if(k==='disabled')this.disabled=true;},
        addEventListener(k,fn){(handlers[k]||=[]).push(fn);},
        focus(){document.activeElement=this;},
        dispatch(k,init={}){const e={type:k,target:this,currentTarget:this,defaultPrevented:false,cancelBubble:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.cancelBubble=true;},...init};for(const f of handlers[k]||[])f.call(this,e);if(!e.cancelBubble)for(const f of docHandlers[k]||[])f.call(document,e);return e;},
        click(){if(!this.disabled)this.dispatch('click');},
      };
      nodes.push(el);if(el.id)byId.set(el.id,el);
    }
    for(const c of n.childNodes||[])visit(c);
  }
  visit(parseFragment(markup));
  const selectAll=(selector)=>{
    if(selector==='textarea, input[type="text"]')return nodes.filter(e=>e.tagName==='TEXTAREA'||e.tagName==='INPUT'&&e.type==='text');
    const m=selector.match(/\[(data-i18n(?:-ph)?)\]$/);if(m)return nodes.filter(e=>Object.hasOwn(e.attributes,m[1]));
    throw Error('unexpected selector '+selector);
  };
  const widget={dataset:{strings:JSON.stringify(clientStrings(lang))},contains:(e)=>nodes.includes(e),querySelectorAll:selectAll};
  document={documentElement:{lang},activeElement:null,getElementById(id){if(!byId.has(id))throw Error('missing actual DOM id '+id);return byId.get(id);},querySelectorAll:selectAll,
    querySelector(selector){if(selector==='.tool-widget'||selector==='.c2t-wrap')return widget;if(selector==='.tool-widget .btn-primary')return nodes.find(e=>e.className.split(/\s+/).includes('btn-primary'))||null;throw Error('unexpected selector '+selector);},
    addEventListener(k,fn){(docHandlers[k]||=[]).push(fn);},execCommand(){throw Error('OS clipboard blocked');},
  };
  let now=0,seq=0;const timers=new Map(),requests=[],tracks=[],clears=[];
  const globals={document, navigator:{clipboard:{writeText(text){return new Promise((resolve,reject)=>requests.push({text,resolve,reject}));},write(){throw Error('unexpected clipboard.write');}}},
    setTimeout(fn,delay){const id=++seq;timers.set(id,{fn,due:now+delay,delay});return id;},clearTimeout(id){timers.delete(id);},trackTool:(...a)=>tracks.push(a),ztPersist:{clear:slug=>clears.push(slug)}};
  const before={...globals,_slug:s.slug};before.window=before;
  if(order==='before')runInNewContext(shortcut,before);
  const loaded=loadPage(s.file,{lang,globals});
  if(order==='after')loaded.run('var _slug='+JSON.stringify(s.slug)+';\n'+shortcut);
  const $=(id)=>document.getElementById(id);
  const out=$(s.prefix+'-output'),copy=$(s.prefix+'-copy'),status=$(s.prefix+'-status'),input=$(s.input);
  return {s,lang,order,document,$,out,copy,status,input,requests,tracks,clears,timers,loaded,
    advance(ms){const end=now+ms;let guard=0;while(true){const next=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;if(++guard>100)throw Error('clock runaway');now=next[1].due;timers.delete(next[0]);next[1].fn();}now=end;},
    type(v){input.focus();input.value=v;input.dispatch('input');},
    convert(v=s.source){this.type(v);$('c2t-convert').click();},
    clearKey(){input.focus();input.dispatch('keydown',{key:'l',ctrlKey:true});},
  };
}

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  let p = lifecyclePage(lang);
  p.type(lifecycleSpec.source); p.advance(1000);
  same(lang + ' input timing boundary', p.out.value, '');
  p.$('c2t-convert').click();
  same(lang + ' exact normal conversion', p.out.value, lifecycleSpec.expected);
  p.copy.click(); same(lang + ' copied full bytes', p.requests[0].text, lifecycleSpec.expected);
  p.requests[0].resolve(); await settle(); same(lang + ' normal copied', p.copy.textContent, copied[lang]);
  p.advance(1500); same(lang + ' normal reset timer', p.copy.textContent, normal[lang]);
  const n = unhandled.length;
  p.copy.click(); p.requests[1].reject(Error('controlled clipboard rejection')); await settle();
  same(lang + ' rejection handled', unhandled.length, n);
  same(lang + ' localized failure visible', p.status.textContent, copyFailure[lang]);
  same(lang + ' failed copy is not success', p.copy.textContent, normal[lang]);
  p.copy.click(); p.requests[2].resolve(); await settle();
  same(lang + ' same-output retry copies', p.copy.textContent, copied[lang]);
  same(lang + ' retry clears owned failure', p.status.textContent, '');
  same(lang + ' retry preserves output', p.out.value, lifecycleSpec.expected);
  p = lifecyclePage(lang); p.convert(); p.loaded.ctx.navigator.clipboard = undefined;
  let thrown; try { p.copy.click(); } catch (error) { thrown = error.message; }
  await settle(); same(lang + ' missing API does not throw', thrown, undefined);
  same(lang + ' missing API shows failure', p.status.textContent, copyFailure[lang]);
  for (const order of ['before', 'after']) {
    p = lifecyclePage(lang, order); p.convert(); p.out.focus(); p.out.dispatch('keydown', { key:'l', ctrlKey:true });
    same(lang + order + ' CtrlL values/status', [p.input.value, p.out.value, p.status.textContent], ['', '', '']);
    same(lang + order + ' CtrlL preserves shared clear', p.clears, [lifecycleSpec.slug]);
    same(lang + order + ' CtrlL focuses primary input', p.document.activeElement.id, lifecycleSpec.input);
    same(lang + order + ' CtrlL copy label', p.copy.textContent, normal[lang]);

    p = lifecyclePage(lang, order); p.convert();
    p.document.activeElement = {};
    const before = [p.input.value, p.out.value, p.status.textContent];
    // Dispatch from an outside node through the document listener path without assigning widget focus.
    p.out.dispatch('keydown', { key:'l', ctrlKey:true });
    same(lang + order + ' outside focus unchanged', [p.input.value, p.out.value, p.status.textContent], before);
  }
}
for (const order of ['before', 'after']) {
  const p = lifecyclePage('en', order); p.type(lifecycleSpec.source);
  const ev = p.input.dispatch('keydown', { key:'Enter', ctrlKey:true });
  same(order + ' CtrlEnter converts exactly once', p.tracks.length, 1);
  same(order + ' CtrlEnter prevents browser default', ev.defaultPrevented, true);
  p.$('c2t-clear').click(); same(order + ' Clear resets', [p.input.value, p.out.value, p.status.textContent], ['', '', '']);
  same(order + ' Clear focuses input', p.document.activeElement.id, lifecycleSpec.input);
}

for (const boundary of ["CtrlL", "input", "new-output", "same-output", "Clear"]) {
  for (const finish of ['resolve', 'reject']) {
    const p = lifecyclePage(); p.convert(); p.copy.click();
    if (boundary === 'CtrlL') p.clearKey();
    else if (boundary === 'Clear') p.$('c2t-clear').click();
    else if (boundary === 'input') p.type(lifecycleSpec.next);
    else if (boundary === 'same-output') p.convert();

    else p.convert(lifecycleSpec.next);
    const state = [p.out.value, p.status.textContent, p.copy.textContent], n = unhandled.length;
    p.requests[0][finish](finish === 'reject' ? Error('controlled stale rejection') : undefined); await settle();
    same(boundary + ' late ' + finish + ' cannot mutate page', [p.out.value, p.status.textContent, p.copy.textContent], state);
    same(boundary + ' late ' + finish + ' handled', unhandled.length, n);
  }
}
for (const oldOutcome of ['resolve', 'reject']) {
  const p = lifecyclePage(); p.convert(); p.copy.click(); p.copy.click();
  p.requests[1].reject(Error('new request fails')); await settle();
  same('new request owns error', p.status.textContent, copyFailure.en);
  const n = unhandled.length;
  p.requests[0][oldOutcome](oldOutcome === 'reject' ? Error('old request fails') : undefined); await settle();
  same('older ' + oldOutcome + ' preserves newer error', [p.status.textContent, p.copy.textContent], [copyFailure.en, normal.en]);
  same('older ' + oldOutcome + ' handled', unhandled.length, n);
  p.copy.click(); p.requests[2].resolve(); await settle(); same('retry after reordered copies', [p.status.textContent, p.copy.textContent], ['', copied.en]);
}
{
  const p = lifecyclePage(); p.convert(); p.copy.click(); p.requests[0].resolve(); await settle();
  const oldTimer = [...p.timers.values()].find(t => t.delay === 1500).fn;
  p.advance(100); p.copy.click(); p.requests[1].resolve(); await settle(); p.advance(1400);
  same('old timer cannot clear newer feedback', p.copy.textContent, copied.en);
  oldTimer(); same('already-dispatched old timer is guarded', p.copy.textContent, copied.en);
  p.advance(100); same('current timer restores after own interval', p.copy.textContent, normal.en);
  p.copy.click(); p.requests[2].resolve(); await settle();
  const clearedTimer = [...p.timers.values()].find(t => t.delay === 1500).fn;
  p.clearKey(); clearedTimer(); same('timer after CtrlL stays clean', [p.status.textContent, p.copy.textContent], ['', normal.en]);
}
await settle(); process.removeListener('unhandledRejection', onUnhandled);


// ---------- v2 page layout ----------
const { createHash } = await import('node:crypto');
const { createRequire } = await import('node:module');
const requireRoot = createRequire(join(root, 'package.json'));
const { transform } = await import(requireRoot.resolve('@astrojs/compiler', { paths: [requireRoot.resolve('astro')] }));
const { transform: parseJs } = await import('esbuild');
const { compile: compileMdx } = await import('@mdx-js/mdx');
const { default: yaml } = await import('js-yaml');
const sha = text => createHash('sha256').update(text).digest('hex');
const fullEngine = source.match(/^ *\/\* ── engine:start ── \*\/[\s\S]*?^ *\/\* ── engine:end ── \*\//m)[0];
// Updated with each approved engine change (2026-10-09: keep comments keep the typed case;
// box-shadow maps only Tailwind's default shadows, and a space before ( does not match;
// grid templates map only N equal tracks, N = 1 to 12).
same('v2 exact engine bytes', sha(fullEngine), '3a9d7a56fad7779ac15a0279c82719e6b9a3726133411c4177a63ab049d5d0b7');
const markup = source.slice(source.indexOf('---', 3) + 3, source.indexOf('<script'));
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const script = source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];
check('v2 direct root', /^\s*<div class="c2t-wrap"/.test(markup));
check('v2 controls/status/panels order', /class="c2t-toolbar"[\s\S]*id="c2t-status"[\s\S]*class="c2t-panels zt-io"/.test(markup));
same('v2 shared panes', (markup.match(/zt-io-pane/g) || []).length, 2);
same('v2 shared fills', (markup.match(/zt-io-fill/g) || []).length, 2);
same('v2 keeps three real buttons', [...markup.matchAll(/<button id="([^"]+)"/g)].map(m => m[1]), ['c2t-convert', 'c2t-clear', 'c2t-copy']);
check('v2 labels remain associated', markup.includes('for="c2t-css"') && markup.includes('for="c2t-output"'));
check('v2 output remains focusable readonly textarea', /<textarea id="c2t-output"[^>]*readonly/.test(markup));
check('v2 tips never nest in labels/buttons', !/<(label|button)\b[^>]*>(?:(?!<\/\1>)[\s\S])*<Toggletip/.test(markup));
same('v2 five actual tip bindings', [...markup.matchAll(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}/g)].map(m => m.slice(1)), [
 ['c2t-tip-convert','convert','convert'], ['c2t-tip-clear','clear','clear'], ['c2t-tip-copy','copy','copy'], ['c2t-tip-input','cssInput','input'], ['c2t-tip-output','tailwindClasses','output'],
]);
check('v2 no runtime translation', !/data-i18n|var STRINGS|pageLang/.test(script + markup));
check('v2 script remains inside root after controls', source.indexOf('<script') > source.indexOf('<details') && /<\/script>\s*<\/div>\s*<style>/.test(source));
check('v2 zero-minimum flex root', /\.c2t-wrap\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-width:\s*0;[^}]*min-height:\s*0;/.test(css));
check('v2 reserved scrolling status', /\.c2t-status\s*\{[^}]*height:\s*1\.5rem;[^}]*min-height:\s*1\.5rem;[^}]*flex:\s*none;[^}]*overflow:\s*auto;/.test(css));
check('v2 textarea internal scroll', /\.c2t-panel textarea\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*auto;/.test(css));
check('v2 toolbar touch height', /\.c2t-toolbar button\s*\{\s*min-height:\s*44px;/.test(css));
check('v2 mobile input and output bounds', /@media \(max-width: 860px\)[\s\S]*height: 180px;[\s\S]*@media \(max-width: 640px\)[\s\S]*height: 144px;[\s\S]*height: 240px;/.test(css));
check('v2 mobile empty output follows actual textarea value', /@media \(max-width: 860px\)[\s\S]*\.c2t-result-pane:has\(#c2t-output:placeholder-shown\)\s*\{\s*display: none;/.test(css));
check('v2 output placeholder is localized desktop empty hint', markup.includes('placeholder={T.tailwindPlaceholder}'));
check('v2 coverage remains accessible outside hidden result', /<\/div>\s*<details class="c2t-coverage">[\s\S]*T.coverageDesc/.test(markup));
check('v2 registry convert', /['"]css-to-tailwind['"]\s*:\s*['"]convert['"]/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
const LEGACY_STRINGS = {
  "en": {
    "cssInput": "CSS Input",
    "tailwindClasses": "Tailwind Classes",
    "copy": "Copy",
    "copied": "Copied!",
    "copyFailed": "Copy failed. Please try again.",
    "convert": "Convert to Tailwind",
    "clear": "Clear",
    "coverageNotes": "Coverage notes",
    "coverageDesc": "Unmapped properties are listed as /* keep: property: value */ comments in the output so you can handle them manually.",
    "tailwindPlaceholder": "Tailwind classes appear here...",
    "converted": "Converted.",
    "noProps": "/* No mappable properties found */"
  },
  "zh": {
    "cssInput": "CSS 输入",
    "tailwindClasses": "Tailwind 类名",
    "copy": "复制",
    "copied": "已复制！",
    "copyFailed": "复制失败，请重试。",
    "convert": "转换为 Tailwind",
    "clear": "清除",
    "coverageNotes": "覆盖说明",
    "coverageDesc": "未映射的属性以 /* keep: property: value */ 注释形式输出，供手动处理。",
    "tailwindPlaceholder": "Tailwind 类名显示在此...",
    "converted": "已转换。",
    "noProps": "/* 未找到可映射的属性 */"
  },
  "ja": {
    "cssInput": "CSS 入力",
    "tailwindClasses": "Tailwind クラス",
    "copy": "コピー",
    "copied": "コピー済み！",
    "copyFailed": "コピーに失敗しました。再試行してください。",
    "convert": "Tailwind に変換",
    "clear": "クリア",
    "coverageNotes": "カバレッジ説明",
    "coverageDesc": "マッピングできないプロパティは /* keep: property: value */ コメントとして出力されます。",
    "tailwindPlaceholder": "Tailwind クラスがここに表示されます...",
    "converted": "変換済み。",
    "noProps": "/* マッピング可能なプロパティが見つかりません */"
  },
  "ko": {
    "cssInput": "CSS 입력",
    "tailwindClasses": "Tailwind 클래스",
    "copy": "복사",
    "copied": "복사됨!",
    "copyFailed": "복사하지 못했습니다. 다시 시도하세요.",
    "convert": "Tailwind로 변환",
    "clear": "지우기",
    "coverageNotes": "커버리지 안내",
    "coverageDesc": "매핑되지 않은 속성은 /* keep: property: value */ 주석으로 출력됩니다.",
    "tailwindPlaceholder": "Tailwind 클래스가 여기에 표시됩니다...",
    "converted": "변환 완료.",
    "noProps": "/* 매핑 가능한 속성을 찾을 수 없습니다 */"
  }
};
for (const lang of ['en','zh','ja','ko']) {
  same(lang + ' legacy strings unchanged', Object.fromEntries(Object.keys(LEGACY_STRINGS[lang]).map(k => [k, pageStrings[lang][k]])), LEGACY_STRINGS[lang]);
  same(lang + ' tip keys', Object.keys(pageStrings[lang].tips).sort(), ['clear','convert','copy','input','output']);
  same(lang + ' client keys exclude tips and UI-only copy', Object.keys(clientStrings(lang)).sort(), ['converted','copied','copy','copyFailed','noProps']);
  for (const text of Object.values(pageStrings[lang].tips)) check(lang + ' tip is built-only factual text', typeof text === 'string' && text.length > 15 && !JSON.stringify(clientStrings(lang)).includes(text));
  const mdx = readFileSync(join(root, 'src/content/tools/css-to-tailwind/' + lang + '.mdx'), 'utf8');
  const [,front,body] = mdx.split('---'); const parsed = yaml.load(front);
  same(lang + ' five steps', parsed.steps.length, 5);
  check(lang + ' steps precede FAQ', front.indexOf('steps:') < front.indexOf('faqItems:'));
  check(lang + ' bounded plain steps', parsed.steps.every(x => typeof x === 'string' && x.length <= 280 && !/[<>]/.test(x)) && parsed.steps.join('').length <= 1200);
  same(lang + ' MDX content contract', contractProblems('css-to-tailwind', lang), '');
  check(lang + ' no Usage section', !/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body));
  let error = ''; try { await compileMdx(body); } catch (e) { error = String(e); } same(lang + ' actual MDX compile', error, '');
}
const compiled = await transform(source, { filename:'src/components/tools/CssToTailwindTool.astro' });
same('v2 Astro diagnostics', compiled.diagnostics.filter(d => d.severity === 1), []);
let compiledError = ''; try { await parseJs(compiled.code, {loader:'ts',format:'esm'}); } catch (e) { compiledError = String(e); } same('v2 generated Astro module parses', compiledError, '');
const compiledCss = compiled.css.join('\n');
check('v2 compiled CSS resolves all global selectors', !compiledCss.includes(':global('));
check('v2 compiled theme ancestor stays unscoped', /\[data-theme=dark\] \.c2t-status/.test(compiledCss) || /\[data-theme="dark"\] \.c2t-status/.test(compiledCss));
check('v2 compiled mobile empty selector retained', compiledCss.includes(':placeholder-shown') && /max-width:\s*860px/.test(compiledCss));
new Function(script); check('v2 real client script parses without tips', !script.includes('TIPS'));


console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
