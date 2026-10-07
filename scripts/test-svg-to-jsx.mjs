// SVG to JSX — attribute names converted, values kept; caller props override the SVG's own
//
// Read:  src/components/tools/SvgToJsxTool.astro (extracts the real engine block between the
//        `engine:start` / `engine:end` markers, so this test cannot drift from the shipped source)
//        and src/content/tools/svg-to-jsx/*.mdx (example pairs are recomputed)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: attribute values are copied as written (the words class / stroke-width / tabindex
// inside aria-label, <title> text or another value are not renamed; before the fix
// `aria-label="class schedule"` became `"className schedule"`; same approach as html-to-jsx:
// parse each name = value pair and map only the name); single / double / unquoted values,
// `>` and `/` inside quoted values, xmlns removed; `{...props}` (and `ref={ref}`) placed after
// the root <svg>'s own attributes, as svgr's default `expandProps: 'end'` does
// (react-svgr.com/docs/options, "Expand props"; packages/babel-preset adds `ref` before the
// props spread), so `<Icon width={48} fill="red" />` wins over width="24" / fill="none"
// (checked by compiling the output with esbuild and evaluating it with a stub
// React.createElement); the page example output.
//
// Run: node scripts/test-svg-to-jsx.mjs

import { loadPage, readComponent, frontmatterStrings } from './astro-page-harness.mjs';
import { parseFragment } from 'parse5';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transformSync } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/SvgToJsxTool.astro'), 'utf8');
const pageStrings = frontmatterStrings(readComponent('src/components/tools/SvgToJsxTool.astro').frontmatter);
const clientStrings = lang => runInNewContext(source.match(/const CLIENT_T = \{[^;]+;/)[0] + ';CLIENT_T', { T: pageStrings[lang] });

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in SvgToJsxTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { svgToJsx };')();

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

// Returns the JSX between `return (` and `);`, unindented, with all options off.
function body(svg, opts = {}) {
  const out = E.svgToJsx(svg, 'Icon', !!opts.ts, !!opts.ref, !!opts.memo);
  const m = out.match(/return \(\n([\s\S]*)\n {2}\);/);
  return m ? m[1].split('\n').map((l) => l.replace(/^ {4}/, '')).join('\n') : out;
}

// Compile the whole component with esbuild and render it with a stub React.
function render(svg, callerProps, opts = {}) {
  const code = E.svgToJsx(svg, 'Icon', !!opts.ts, !!opts.ref, !!opts.memo);
  const js = transformSync(code, { loader: opts.ts ? 'tsx' : 'jsx', format: 'cjs', jsx: 'transform' }).code;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    forwardRef: (fn) => ({ render: fn }),
    memo: (c) => c,
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(() => React, module, module.exports);
  let C = module.exports.default;
  if (C && C.render) return C.render(callerProps, 'REF');
  return C(callerProps);
}

// ---------- the reported defect: values rewritten ----------
eq('class inside aria-label is kept',
  body('<svg aria-label="class schedule" viewBox="0 0 1 1"></svg>'),
  '<svg aria-label="class schedule" viewBox="0 0 1 1" {...props}></svg>');
eq('attribute names inside another value are kept',
  body('<svg><path data-note="stroke-width tabindex fill-rule clip-path" d="M0 0"/></svg>'),
  '<svg {...props}><path data-note="stroke-width tabindex fill-rule clip-path" d="M0 0" /></svg>');
eq('hyphenated words inside a value are not camel-cased',
  body('<svg><text font-family="sans-serif" aria-label="a-b x-y=1">t</text></svg>'),
  '<svg {...props}><text fontFamily="sans-serif" aria-label="a-b x-y=1">t</text></svg>');
eq('text content is untouched',
  body('<svg><title>class stroke-width="2"</title></svg>'),
  '<svg {...props}><title>class stroke-width="2"</title></svg>');
eq('names are still converted',
  body('<svg><g class="a" tabindex="0" stroke-width="2" fill-rule="evenodd" clip-path="url(#c)"/></svg>'),
  '<svg {...props}><g className="a" tabIndex="0" strokeWidth="2" fillRule="evenodd" clipPath="url(#c)" /></svg>');
eq('unknown hyphenated name camel-cased', body('<svg><rect foo-bar-baz="1"/></svg>'),
  '<svg {...props}><rect fooBarBaz="1" /></svg>');
eq('data-* and aria-* names untouched', body('<svg data-x-y="1" aria-hidden="true"></svg>'),
  '<svg data-x-y="1" aria-hidden="true" {...props}></svg>');

// ---------- values: quoting and tag boundaries ----------
eq('single quotes kept', body("<svg><path d='M0 0' stroke-width='2'/></svg>"),
  "<svg {...props}><path d='M0 0' strokeWidth='2' /></svg>");
eq('unquoted value gets double quotes', body('<svg><path stroke-width=2 d=M0 /></svg>'),
  '<svg {...props}><path strokeWidth="2" d="M0" /></svg>');
eq('> inside a quoted value does not end the tag',
  body('<svg><text aria-label="a > b" font-size="12">x</text></svg>'),
  '<svg {...props}><text aria-label="a > b" fontSize="12">x</text></svg>');
eq('/ inside a quoted value is not a self-close',
  body('<svg><a href="/x/"><path d="M0 0"/></a></svg>'),
  '<svg {...props}><a href="/x/"><path d="M0 0" /></a></svg>');
eq('xmlns and xmlns:* removed', body('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink=\'http://www.w3.org/1999/xlink\' viewBox="0 0 1 1"></svg>'),
  '<svg viewBox="0 0 1 1" {...props}></svg>');
eq('xmlns inside a value is kept', body('<svg aria-label=" xmlns=&quot;x&quot;"></svg>'),
  '<svg aria-label=" xmlns=&quot;x&quot;" {...props}></svg>');
eq('comments are lowered without rewriting their embedded tags',
  body('<svg><!-- <g class="x"> --></svg>'), '<svg {...props}>{/* <g class="x"> */}</svg>');
eq('XML declaration removed', body('<?xml version="1.0" encoding="UTF-8"?>\n<svg></svg>'), '<svg {...props}></svg>');
eq('multi-line attributes keep their line breaks',
  body('<svg\n  class="a"\n  viewBox="0 0 1 1">\n</svg>'),
  '<svg\n  className="a"\n  viewBox="0 0 1 1" {...props}>\n</svg>');

// ---------- the reported defect: props spread position ----------
const PLUS = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path stroke="#000" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>';
eq('page example', E.svgToJsx(PLUS, 'PlusIcon', false, false, false),
  "import React from 'react';\n\nfunction PlusIcon(props) {\n  return (\n    <svg width=\"24\" height=\"24\" fill=\"none\" viewBox=\"0 0 24 24\" {...props}><path stroke=\"#000\" strokeWidth=\"2\" strokeLinecap=\"round\" d=\"M12 5v14M5 12h14\" /></svg>\n  );\n}\n\nexport default PlusIcon;");
eq('forwardRef: ref then props, after own attributes', body(PLUS, { ref: true }).split('>')[0],
  '<svg width="24" height="24" fill="none" viewBox="0 0 24 24" ref={ref} {...props}');
eq('props only on the root svg', (body('<svg><svg width="1"></svg></svg>').match(/\{\.\.\.props\}/g) || []).length, 1);

for (const opts of [{}, { ts: true }, { ref: true }, { ts: true, ref: true, memo: true }]) {
  const label = JSON.stringify(opts);
  const el = render(PLUS, { width: 48, fill: 'red', className: 'ic' }, opts);
  eq('caller width wins ' + label, el.props.width, 48);
  eq('caller fill wins ' + label, el.props.fill, 'red');
  eq('own attributes kept when caller omits them ' + label, el.props.height, '24');
  eq('caller className applied ' + label, el.props.className, 'ic');
  if (opts.ref) eq('ref forwarded ' + label, el.props.ref, 'REF');
}
const plain = render(PLUS, {});
eq('no caller props: SVG defaults', plain.props.width + ' ' + plain.props.fill, '24 none');
eq('child path attributes compiled', render(PLUS, {}).children[0].props.strokeWidth, '2');

// A-SVGJSX-UNLOWERED-NODES: actual component output, JSX/TSX compilation and real React readback.
let React, renderToStaticMarkup;
if (process.env.JSX_REACT_REFERENCE_DIR) {
  const reference = createRequire(join(process.env.JSX_REACT_REFERENCE_DIR, 'package.json'));
  React = reference('react');
  ({ renderToStaticMarkup } = reference('react-dom/server'));
  if (React.version !== '19.2.0' || reference('react-dom/package.json').version !== '19.2.0') throw Error('React reference must be 19.2.0');
} else console.log('SKIP: real React rendering — set JSX_REACT_REFERENCE_DIR to isolated React/ReactDOM 19.2.0');
const css = '.x { fill:red; --text:"a\\b" }\n@media (min-width:1px) { .x { opacity:.5 } }';
const complex = '<svg width="24"><!-- <g class="x"> */ {x} --><style><![CDATA[' + css + ']]></style><g style="--Accent:red;-ms-transform:none;fill:blue"><text>{label}</text><use xlink:href="#shape"/></g></svg>';
for (const opts of [{}, { ts: true }, { ref: true }, { ts: true, ref: true, memo: true }]) {
  try {
    const tree = render(complex, { width: 48 }, opts);
    eq('style node string ' + JSON.stringify(opts), tree.children[0].children[0], css);
    eq('inline style object ' + JSON.stringify(opts), JSON.stringify(tree.children[1].props.style), JSON.stringify({ '--Accent': 'red', msTransform: 'none', fill: 'blue' }));
    eq('SVG text braces ' + JSON.stringify(opts), tree.children[1].children[0].children[0], '{label}');
    eq('xlink mapped ' + JSON.stringify(opts), tree.children[1].children[1].props.xlinkHref, '#shape');
    if (React) {
      const code = transformSync(E.svgToJsx(complex, 'Icon', !!opts.ts, !!opts.ref, !!opts.memo), { loader: opts.ts ? 'tsx' : 'jsx', format: 'cjs' }).code;
      const mod = { exports: {} };
      new Function('require', 'module', 'exports', code)(() => React, mod, mod.exports);
      const out = renderToStaticMarkup(React.createElement(mod.exports.default, { width: 48 }));
      check('real React SVG readback ' + JSON.stringify(opts), out.includes('width="48"') && out.includes(css) && out.includes('--Accent:red') && out.includes('xlink:href="#shape"') && out.includes('{label}') && !out.includes('<!--'), out);
    }
  } catch (e) { check('SVG nodes compile/render ' + JSON.stringify(opts), false, e.errors?.[0]?.text || e.message); }
}
// CSS declaration boundaries in a style attribute (same parser as html-to-jsx): semicolons
// inside quotes and url(), entity-encoded quotes, CSS escapes and custom properties keep
// their exact value after esbuild compilation.
for (const [attr, expected] of [
  ['background:url(data:image/png;base64,AA==);fill:red', { background: 'url(data:image/png;base64,AA==)', fill: 'red' }],
  ["background-image:url('a;b.svg')", { backgroundImage: "url('a;b.svg')" }],
  ['--label:&quot;a;b&quot;', { '--label': '"a;b"' }],
  ['font-family:&quot;A\\&quot;B&quot;, serif', { fontFamily: '"A\\"B", serif' }],
  ['content:"\\201C";-ms-filter:none', { content: '"\\201C"', msFilter: 'none' }],
  ['--Brand-Color: #00f ; STROKE-WIDTH:2', { '--Brand-Color': '#00f', strokeWidth: '2' }],
]) {
  try {
    const props = render("<svg style='" + attr.replace(/'/g, '&#39;') + "'></svg>", {}).props;
    eq('SVG style boundary ' + attr, JSON.stringify(props.style), JSON.stringify(expected));
  } catch (e) { check('SVG style boundary ' + attr, false, e.errors?.[0]?.text || e.message); }
}
for (const style of ['fill:red;fill:blue', 'fill:red !important', 'fill:url(a', 'fill:', 'fill', 'fill:/*x*/red']) {
  let error;
  try { body('<svg><path style="' + style + '"/></svg>'); } catch (e) { error = e; }
  check('SVG refuses unrepresentable CSS ' + style, !!error?.code && Number.isInteger(error.position));
}
// Every language page: each ```svg / ```jsx example pair is the converter's output; the
// Illustrator example's rendered markup quoted on the page is what React 19.2.0 renders.
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const page = readFileSync(join(root, 'src/content/tools/svg-to-jsx/' + lang + '.mdx'), 'utf8');
  const pairs = [...page.matchAll(/```svg\n([\s\S]*?)\n```[\s\S]*?```jsx\n([\s\S]*?)\n```/g)];
  eq('page examples found ' + lang, pairs.length, 2);
  for (const [, input, output] of pairs) {
    const name = (output.match(/function (\w+)\(props\)/) || [])[1];
    eq('page example output ' + lang + ' ' + name, E.svgToJsx(input, name, false, false, false), output);
    if (React && /<style>/.test(input)) {
      const code = transformSync(output, { loader: 'jsx', format: 'cjs' }).code;
      const mod = { exports: {} };
      new Function('require', 'module', 'exports', code)(() => React, mod, mod.exports);
      const html = renderToStaticMarkup(React.createElement(mod.exports.default));
      check('page quotes the React markup ' + lang, page.includes('`' + html + '`'), html);
    }
  }
  check('page no longer says comments and <style> are kept ' + lang, !/<style>\{`/.test(page));
}
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  try {
    const nodes = {};
    const node = (id) => nodes[id] ||= { value: id === 'stj-name' ? 'Icon' : '', checked: false, disabled: false, textContent: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
    runInNewContext(source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1], { document: { addEventListener() {}, documentElement: { lang }, querySelectorAll: () => [], querySelector: () => ({dataset:{strings:JSON.stringify(clientStrings(lang))}}), getElementById: node }, window: {}, navigator: {}, setTimeout: (fn) => fn(), clearTimeout() {} });
    node('stj-input').value = '<svg><text>{x}</text></svg>';
    node('stj-input').listeners.input();
    check('SVG page valid output ' + lang, !!node('stj-output').value && !node('stj-copy').disabled);
    node('stj-input').value = '<svg style="fill:red !important"/>';
    node('stj-input').listeners.input();
    check('SVG page clears old output/disables copy ' + lang, node('stj-output').value === '' && node('stj-copy').disabled && !!node('stj-status').textContent);
    node('stj-input').value = '<svg/>';
    node('stj-input').listeners.input();
    check('SVG page recovers ' + lang, !!node('stj-output').value && !node('stj-copy').disabled && node('stj-status').textContent === '');
  } catch (e) { check('SVG page refusal ' + lang, false, e.message); }
}


// ---------- complete page lifecycle + real ToolLayout keyboard handler ----------
// Only DOM, clipboard completion and timer delivery are controlled; the whole page script runs.
const lifecycleSpec = {"slug": "svg-to-jsx", "component": "SvgToJsxTool", "prefix": "stj", "input": "stj-input", "source": "<svg viewBox=\"0 0 1 1\"><path stroke-width=\"2\" /></svg>", "next": "<svg width=\"2\"/>", "expected": "import React from 'react';\n\nfunction MyIcon(props) {\n  return (\n    <svg viewBox=\"0 0 1 1\" {...props}><path strokeWidth=\"2\" /></svg>\n  );\n}\n\nexport default MyIcon;", "invalid": "<svg style=\"fill:red;fill:blue\"/>", "file": "src/components/tools/SvgToJsxTool.astro"};
lifecycleSpec.src = source;
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
    querySelector(selector){if(selector==='.tool-widget'||selector==='.stj-wrap')return widget;if(selector==='.tool-widget .btn-primary')return nodes.find(e=>e.className.split(/\s+/).includes('btn-primary'))||null;throw Error('unexpected selector '+selector);},
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
    convert(v=s.source){this.type(v);this.advance(200);},
    clearKey(){input.focus();input.dispatch('keydown',{key:'l',ctrlKey:true});},
  };
}

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  let p = lifecyclePage(lang);
  p.type(lifecycleSpec.source); p.advance(199);
  same(lang + ' input timing boundary', p.out.value, '');
  p.advance(1);
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
    same(lang + order + ' empty copy disabled', p.copy.disabled, true);
    p.type(lifecycleSpec.invalid); p.advance(200); check(lang + order + ' refusal visible', !!p.status.textContent);
    p.clearKey(); same(lang + order + ' CtrlL clears refusal', p.status.textContent, '');
    p.type(lifecycleSpec.source); same(lang + order + ' debounce pending', [...p.timers.values()].filter(t => t.delay === 200).length, 1);
    p.clearKey(); same(lang + order + ' CtrlL cancels debounce', [...p.timers.values()].filter(t => t.delay === 200).length, 0);
    p.advance(200); same(lang + order + ' no late output', [p.out.value, p.status.textContent, p.copy.disabled], ['', '', true]);
    p = lifecyclePage(lang, order); p.convert();
    p.document.activeElement = {};
    const before = [p.input.value, p.out.value, p.status.textContent];
    // Dispatch from an outside node through the document listener path without assigning widget focus.
    p.out.dispatch('keydown', { key:'l', ctrlKey:true });
    same(lang + order + ' outside focus unchanged', [p.input.value, p.out.value, p.status.textContent], before);
  }
}
{ const p = lifecyclePage(); p.convert(); const before = [p.out.value, p.tracks.length]; p.input.dispatch('keydown', { key:'Enter', ctrlKey:true }); same('CtrlEnter has no primary action', [p.out.value, p.tracks.length], before); }

for (const boundary of ["CtrlL", "input", "new-output", "same-output", "invalid", "name", "option"]) {
  for (const finish of ['resolve', 'reject']) {
    const p = lifecyclePage(); p.convert(); p.copy.click();
    if (boundary === 'CtrlL') p.clearKey();

    else if (boundary === 'input') p.type(lifecycleSpec.next);
    else if (boundary === 'same-output') p.convert();
    else if (boundary === 'invalid') p.convert(lifecycleSpec.invalid);
    else if (boundary === 'name') { p.$('stj-name').value = 'NewIcon'; p.$('stj-name').dispatch('input'); }
    else if (boundary === 'option') { p.$('stj-typescript').checked = true; p.$('stj-typescript').dispatch('change'); }
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
{
  const p = lifecyclePage(); p.convert(); p.$('stj-name').value = 'plus-icon'; p.$('stj-name').dispatch('input');
  p.advance(199); check('name stays pending for 200ms', p.out.value.includes('function MyIcon(props)'));
  p.advance(1); check('name applies filter and capitalization', p.out.value.includes('function Plusicon(props)'));
  for (const [id, part] of [['stj-typescript', 'React.FC<React.SVGProps<SVGSVGElement>>'], ['stj-forwardref', 'forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>'], ['stj-memo', 'export default memo(Plusicon);']]) {
    p.$(id).checked = true; p.$(id).dispatch('change'); check(id + ' applies synchronously', p.out.value.includes(part));
  }
  p.clearKey(); same('CtrlL shared clears name while retaining option preferences', [p.$('stj-name').value, p.$('stj-typescript').checked, p.$('stj-forwardref').checked, p.$('stj-memo').checked], ['', true, true, true]);
  p.type(lifecycleSpec.source); p.$('stj-memo').dispatch('change');
  const count = p.tracks.length; p.advance(200); same('immediate option conversion cancels pending duplicate', p.tracks.length, count);
}
await settle(); process.removeListener('unhandledRejection', onUnhandled);

// ---------- v2 page layout ----------
{
const { createHash } = await import('node:crypto');
const requireRoot = createRequire(join(root, 'package.json'));
const { transform } = await import(requireRoot.resolve('@astrojs/compiler', { paths: [requireRoot.resolve('astro')] }));
const { transform: parseJs } = await import('esbuild');
const { compile: compileMdx } = await import('@mdx-js/mdx');
const { default: yaml } = await import('js-yaml');
const sha = text => createHash('sha256').update(text).digest('hex');
const fullEngine = source.match(/^ *\/\* ── engine:start ── \*\/[\s\S]*?^ *\/\* ── engine:end ── \*\//m)[0];
same('v2 exact engine bytes', sha(fullEngine), '68244686047cd62518c2988b28514c4177a99be7c41e3d015a6edeb770801418');
const markup = source.slice(source.indexOf('---', 3) + 3, source.indexOf('<script'));
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const script = source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];
check('v2 direct root', /^\s*<div class="stj-wrap"/.test(markup));
check('v2 controls/status/panels order', /class="stj-options"[\s\S]*id="stj-status"[\s\S]*class="stj-panes zt-io"/.test(markup));
same('v2 shared panes', (markup.match(/zt-io-pane/g) || []).length, 2);
same('v2 shared fills', (markup.match(/zt-io-fill/g) || []).length, 2);
same('v2 retains the only real action button', [...markup.matchAll(/<button id="([^"]+)"/g)].map(m => m[1]), ['stj-copy']);
check('v2 labels remain associated', markup.includes('for="stj-input"') && markup.includes('for="stj-output"'));
check('v2 output remains focusable readonly textarea', /<textarea\s+id="stj-output"[^>]*readonly/.test(markup));
check('v2 tips never nest in labels/buttons', !/<(label|button)\b[^>]*>(?:(?!<\/\1>)[\s\S])*<Toggletip/.test(markup));
same('v2 seven actual tip bindings', [...markup.matchAll(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}/g)].map(m => m.slice(1)), [
 ['stj-tip-name','componentName','name'], ['stj-tip-typescript','typescript','typescript'], ['stj-tip-forwardref','forwardRef','forwardRef'], ['stj-tip-memo','memo','memo'], ['stj-tip-copy','copy','copy'], ['stj-tip-input','inputLabel','input'], ['stj-tip-output','outputLabel','output'],
]);
check('v2 name remains editable with original default', /<input id="stj-name"[^>]*type="text"[^>]*value="MyIcon"/.test(markup));
same('v2 checkbox defaults remain unchecked', [...markup.matchAll(/<input type="checkbox" id="([^"]+)"([^>]*)>/g)].map(m => [m[1], /checked/.test(m[2])]), [['stj-typescript',false],['stj-forwardref',false],['stj-memo',false]]);
check('v2 name and checkbox touch targets', /\.stj-name-input\s*\{[^}]*min-height:\s*44px/.test(css) && /\.stj-checkbox-label\s*\{[^}]*min-height:\s*44px/.test(css));
check('v2 mobile controls use bounded two columns', /@media \(max-width: 640px\)[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(css));
check('v2 no runtime translation', !/data-i18n|var STRINGS|pageLang/.test(script + markup));
check('v2 script remains inside root after controls', source.indexOf('<script') > source.indexOf('id="stj-output"') && /<\/script>\s*<\/div>\s*<style>/.test(source));
check('v2 zero-minimum flex root', /\.stj-wrap\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-width:\s*0;[^}]*min-height:\s*0;/.test(css));
check('v2 reserved scrolling status', /#stj-status\s*\{[^}]*height:\s*1\.5rem;[^}]*min-height:\s*1\.5rem;[^}]*flex:\s*none;[^}]*overflow:\s*auto;/.test(css));
check('v2 textarea internal scroll', /\.stj-textarea\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*auto;/.test(css));
check('v2 toolbar touch height', /\.stj-copy-btn\s*\{\s*min-height:\s*44px;/.test(css));
check('v2 mobile input and output bounds', /@media \(max-width: 860px\)[\s\S]*height: 180px;[\s\S]*@media \(max-width: 640px\)[\s\S]*height: 120px;[\s\S]*height: 240px;/.test(css));
check('v2 mobile empty output follows actual textarea value', /@media \(max-width: 860px\)[\s\S]*\.stj-result-pane:has\(#stj-output:placeholder-shown\)\s*\{\s*display: none;/.test(css));
check('v2 output placeholder is localized desktop empty hint', markup.includes('placeholder={T.empty}'));
check('v2 registry convert', /['"]svg-to-jsx['"]\s*:\s*['"]convert['"]/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
const MDX_PROTECTION = {
  "en": {
    "frontSHA": "e930931a50b9d6b2ccc904bace080dcc644b863f0f7246e97e8baae7d8fec527",
    "bodySHA": "eec5f462c19d7d78cb38bd40bddeefcad395cc696bac6c0dd692ab584e3fdf5c"
  },
  "zh": {
    "frontSHA": "c63344f701c68e8099f7940a9a9b2f4a49cb7d765338bf4f3e295debf1b16874",
    "bodySHA": "c3761171c3ccc71325e4302bd14422c0a44b0c7947a24e021bd33bd1d3b517b6"
  },
  "ja": {
    "frontSHA": "ef7fba79d8d478c350cbeb2007e22eb2b80dfdd99e35f8bd94cc70331e6bc8d7",
    "bodySHA": "0809b74378ce0f5a5694378db760ac6e88f251884bd0a485e40389192b2102db"
  },
  "ko": {
    "frontSHA": "c822346223c3158fed09eb60b088c98d81069d96acc4f3b9cbd1cb3e083c60ec",
    "bodySHA": "79980f29509e79a9da5f9552d6f211b849a1174987a78e73f0e716c755479d67"
  }
};
const LEGACY_STRINGS = {
  "en": {
    "inputLabel": "SVG Input",
    "outputLabel": "JSX Output",
    "copy": "Copy",
    "copied": "Copied!",
    "copyFailed": "Copy failed. Please try again.",
    "placeholder": "<!-- paste your SVG here -->",
    "componentName": "Component name",
    "typescript": "TypeScript (React.FC)",
    "forwardRef": "forwardRef",
    "memo": "memo",
    "refused": "Cannot convert style at position {position}: {reason}. Output cleared.",
    "reasons": {
      "syntax": "invalid declaration or unclosed CSS syntax",
      "property": "unsupported or escaped property name",
      "duplicate": "repeated property cannot preserve CSS fallback order",
      "priority": "!important cannot be preserved in a React style object",
      "comment": "CSS comments require manual conversion"
    }
  },
  "zh": {
    "inputLabel": "SVG 输入",
    "outputLabel": "JSX 输出",
    "copy": "复制",
    "copied": "已复制！",
    "copyFailed": "复制失败，请重试。",
    "placeholder": "<!-- 粘贴 SVG 到这里 -->",
    "componentName": "组件名称",
    "typescript": "TypeScript (React.FC)",
    "forwardRef": "forwardRef 包裹",
    "memo": "memo 包裹",
    "refused": "样式第 {position} 个字符无法转换：{reason}。已清空输出。",
    "reasons": {
      "syntax": "声明无效或 CSS 语法未闭合",
      "property": "属性名不支持或含转义",
      "duplicate": "重复属性无法保留 CSS 回退顺序",
      "priority": "React 样式对象无法保留 !important",
      "comment": "CSS 注释需要手动转换"
    }
  },
  "ja": {
    "inputLabel": "SVG 入力",
    "outputLabel": "JSX 出力",
    "copy": "コピー",
    "copied": "コピー済み！",
    "copyFailed": "コピーに失敗しました。再試行してください。",
    "placeholder": "<!-- SVGをここに貼り付け -->",
    "componentName": "コンポーネント名",
    "typescript": "TypeScript (React.FC)",
    "forwardRef": "forwardRef ラップ",
    "memo": "memo ラップ",
    "refused": "スタイルの {position} 文字目を変換できません：{reason}。出力を消去しました。",
    "reasons": {
      "syntax": "宣言が無効、または CSS 構文が閉じていません",
      "property": "未対応またはエスケープされたプロパティ名",
      "duplicate": "重複プロパティの CSS フォールバック順序を保持できません",
      "priority": "React のスタイルオブジェクトでは !important を保持できません",
      "comment": "CSS コメントは手動で変換してください"
    }
  },
  "ko": {
    "inputLabel": "SVG 입력",
    "outputLabel": "JSX 출력",
    "copy": "복사",
    "copied": "복사됨!",
    "copyFailed": "복사하지 못했습니다. 다시 시도하세요.",
    "placeholder": "<!-- SVG를 여기에 붙여넣기 -->",
    "componentName": "컴포넌트 이름",
    "typescript": "TypeScript (React.FC)",
    "forwardRef": "forwardRef 래핑",
    "memo": "memo 래핑",
    "refused": "스타일 {position}번째 문자를 변환할 수 없습니다: {reason}. 출력을 지웠습니다.",
    "reasons": {
      "syntax": "잘못된 선언 또는 닫히지 않은 CSS 구문",
      "property": "지원하지 않거나 이스케이프된 속성 이름",
      "duplicate": "중복 속성의 CSS 대체 순서를 보존할 수 없습니다",
      "priority": "React 스타일 객체는 !important를 보존할 수 없습니다",
      "comment": "CSS 주석은 직접 변환해야 합니다"
    }
  }
};
for (const lang of ['en','zh','ja','ko']) {
  same(lang + ' legacy strings unchanged', Object.fromEntries(Object.keys(LEGACY_STRINGS[lang]).map(k => [k, pageStrings[lang][k]])), LEGACY_STRINGS[lang]);
  same(lang + ' tip keys', Object.keys(pageStrings[lang].tips).sort(), ['copy','forwardRef','input','memo','name','output','typescript']);
  same(lang + ' client keys exclude tips and UI-only copy', Object.keys(clientStrings(lang)).sort(), ['copied','copy','copyFailed','reasons','refused']);
  for (const text of Object.values(pageStrings[lang].tips)) check(lang + ' tip is built-only factual text', typeof text === 'string' && text.length > 15 && !JSON.stringify(clientStrings(lang)).includes(text));
  const mdx = readFileSync(join(root, 'src/content/tools/svg-to-jsx/' + lang + '.mdx'), 'utf8');
  const [,front,body] = mdx.match(/^---([\s\S]*?)---([\s\S]*)$/); const parsed = yaml.load(front);
  same(lang + ' six steps', parsed.steps.length, 6);
  check(lang + ' steps precede FAQ', front.indexOf('steps:') < front.indexOf('faqItems:'));
  check(lang + ' bounded plain steps', parsed.steps.every(x => typeof x === 'string' && x.length <= 280 && !/[<>]/.test(x)) && parsed.steps.join('').length <= 1200);
  same(lang + ' protected FAQ/SEO frontmatter', sha(front.replace(/steps:\n(?:  - .*\n)+/, '')), MDX_PROTECTION[lang].frontSHA);
  same(lang + ' non-Usage body exact', sha(body), MDX_PROTECTION[lang].bodySHA);
  check(lang + ' no Usage section', !/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body));
  let error = ''; try { await compileMdx(body); } catch (e) { error = String(e); } same(lang + ' actual MDX compile', error, '');
}
const compiledAstro = await transform(source, { filename:'src/components/tools/SvgToJsxTool.astro' });
same('v2 Astro diagnostics', compiledAstro.diagnostics.filter(d => d.severity === 1), []);
let compiledError = ''; try { await parseJs(compiledAstro.code, {loader:'ts',format:'esm'}); } catch (e) { compiledError = String(e); } same('v2 generated Astro module parses', compiledError, '');
const compiledCss = compiledAstro.css.join('\n');
check('v2 compiled CSS resolves all global selectors', !compiledCss.includes(':global('));
check('v2 compiled mobile empty selector retained', compiledCss.includes(':placeholder-shown') && /max-width:\s*860px/.test(compiledCss));
new Function(script); check('v2 real client script parses without tips', !script.includes('TIPS'));

}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
