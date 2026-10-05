// HTML to JSX — attribute names converted, attribute values kept; event handlers become functions
//
// Read:  src/components/tools/HtmlToJsxTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); src/content/tools/html-to-jsx/*.mdx (the Example
//        output of each language page is recomputed)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: attribute values are copied as written (the words class / for / style / onclick
// inside a value are not renamed; this is what htmltojsx does: it maps the attribute name
// only and copies the value), single / double / unquoted values, boolean attributes, `>` and
// `/` inside quoted values, inline style to object, on* attributes renamed to the React name
// (onMouseOver, onDoubleClick, onKeyDown ...) and their code wrapped in an arrow function with
// entities decoded (React throws on a string listener), void and self-closing tags, comments
// (a */ inside is written as * /); the HTML attribute names from react-dom possibleStandardNames.js
// (autocomplete, srcset, novalidate ... were copied lowercase and made React warn); the English page
// login form example.
//
// Run: node scripts/test-html-to-jsx.mjs

import { loadPage } from './astro-page-harness.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { parseFragment } from 'parse5';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/HtmlToJsxTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in HtmlToJsxTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { htmlToJsx };')();

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
const jsx = (html) => E.htmlToJsx(html);

// ---------- the reported defect: values rewritten ----------
eq('for / class inside a URL value are kept',
  jsx('<a href="/search?for=1&class=2">x</a>'),
  '<a href="/search?for=1&class=2">x</a>');
eq('attribute words inside title / alt are kept',
  jsx('<img alt="class for tabindex" title="style=red onclick=x">'),
  '<img alt="class for tabindex" title="style=red onclick=x" />');
eq('style= inside another value is not converted',
  jsx('<div data-x="style=color:red">x</div>'),
  '<div data-x="style=color:red">x</div>');
eq('names are still converted', jsx('<label for="a" class="b" tabindex="0">x</label>'),
  '<label htmlFor="a" className="b" tabIndex="0">x</label>');
eq('names are case-insensitive', jsx('<div CLASS="a" ReadOnly>x</div>'), '<div className="a" readOnly>x</div>');
eq('data-for / aria-* names untouched', jsx('<b data-for="x" aria-label="for">y</b>'),
  '<b data-for="x" aria-label="for">y</b>');

// ---------- the reported defect: event handlers output as strings ----------
eq('onclick → onClick arrow function',
  jsx('<button onclick="save()">Save</button>'),
  '<button onClick={(event) => { save() }}>Save</button>');
eq('onmouseover → onMouseOver', jsx('<div onmouseover="hi()">x</div>'),
  '<div onMouseOver={(event) => { hi() }}>x</div>');
eq('ondblclick → onDoubleClick', jsx('<div ondblclick="a()">x</div>'),
  '<div onDoubleClick={(event) => { a() }}>x</div>');
eq('onkeydown → onKeyDown', jsx('<input onkeydown="k(event)">'),
  '<input onKeyDown={(event) => { k(event) }} />');
eq('ONCHANGE upper case', jsx('<select ONCHANGE="c()"></select>'),
  '<select onChange={(event) => { c() }}></select>');
eq('entities in handler code decoded',
  jsx('<button onclick="alert(&quot;a &amp; b&quot;)">x</button>'),
  '<button onClick={(event) => { alert("a & b") }}>x</button>');
eq('single-quoted handler with double quotes',
  jsx('<a onclick=\'go("x"); return false;\'>x</a>'),
  '<a onClick={(event) => { go("x"); return false; }}>x</a>');
eq('empty handler', jsx('<a onclick="">x</a>'), '<a onClick={(event) => {}}>x</a>');
eq('handler with // comment closes on a new line', jsx('<a onclick="go() // note">x</a>'),
  '<a onClick={(event) => { go() // note\n}}>x</a>');
eq('> inside a quoted handler does not end the tag',
  jsx('<button onclick="if (a > b) go()">x</button>'),
  '<button onClick={(event) => { if (a > b) go() }}>x</button>');
eq('on* name that is not a DOM event is kept as written', jsx('<x-el onfoo="f()"></x-el>'),
  '<x-el onfoo="f()"></x-el>');
eq('name that only starts with "on" letters', jsx('<input one="1">'), '<input one="1" />');

// ---------- values: quoting ----------
eq('single quotes kept', jsx("<a title='say \"hi\"'>x</a>"), "<a title='say \"hi\"'>x</a>");
eq('unquoted value gets double quotes', jsx('<td colspan=2>x</td>'), '<td colSpan="2">x</td>');
eq('boolean attribute kept', jsx('<input disabled required>'), '<input disabled required />');
eq('entities in plain values kept', jsx('<a title="&lt;b&gt;">x</a>'), '<a title="&lt;b&gt;">x</a>');
eq('spaces around = removed', jsx('<a href = "/x">x</a>'), '<a href="/x">x</a>');
eq('multi-line attributes keep their line breaks',
  jsx('<div\n  class="a"\n  id="b">x</div>'), '<div\n  className="a"\n  id="b">x</div>');
eq('Object.prototype names are not looked up', jsx('<x-a constructor="c" tostring>x</x-a>'),
  '<x-a constructor="c" tostring>x</x-a>');

// ---------- style ----------
eq('style → object', jsx('<div style="color: red; font-size: 14px">x</div>'),
  '<div style={{ "color": "red", "fontSize": "14px" }}>x</div>');
eq('style with url quotes', jsx('<div style="background-image: url(\'a.png\')">x</div>'),
  '<div style={{ "backgroundImage": "url(\'a.png\')" }}>x</div>');
eq('style single-quoted', jsx("<p style='margin:0'>x</p>"), '<p style={{ "margin": "0" }}>x</p>');
eq('style entities decoded', jsx('<p style="font-family: &quot;Inter&quot;">x</p>'),
  '<p style={{ "fontFamily": "\\\"Inter\\\"" }}>x</p>');

// ---------- tags ----------
eq('void tag self-closed', jsx('<br>'), '<br />');
eq('already self-closed void tag', jsx('<br/>'), '<br />');
eq('self-closing with attrs', jsx('<img src="a.png" />'), '<img src="a.png" />');
eq('slash inside a quoted value is not a self-close', jsx('<a href="/x/">x</a>'), '<a href="/x/">x</a>');
eq('closing tags untouched', jsx('<p>a</p>'), '<p>a</p>');
eq('comment', jsx('<!-- footer -->'), '{/* footer */}');
eq('text containing class= is untouched', jsx('<p>class="x" for="y"</p>'), '<p>class="x" for="y"</p>');
eq('page example',
  jsx('<label for="email" class="lbl">Email</label>\n<input id="email" type="email" required>\n<div style="background-image: url(\'a.png\'); font-size:14px">x</div>\n<!-- footer -->'),
  '<label htmlFor="email" className="lbl">Email</label>\n<input id="email" type="email" required />\n<div style={{ "backgroundImage": "url(\'a.png\')", "fontSize": "14px" }}>x</div>\n{/* footer */}');

// ---------- more attribute names (react-dom possibleStandardNames.js) ----------
for (const [html, react] of [
  ['accept-charset', 'acceptCharset'], ['autocapitalize', 'autoCapitalize'], ['autocomplete', 'autoComplete'],
  ['autoplay', 'autoPlay'], ['cellpadding', 'cellPadding'], ['cellspacing', 'cellSpacing'], ['charset', 'charSet'],
  ['controlslist', 'controlsList'], ['datetime', 'dateTime'], ['enterkeyhint', 'enterKeyHint'],
  ['fetchpriority', 'fetchPriority'], ['formaction', 'formAction'], ['formenctype', 'formEncType'],
  ['formmethod', 'formMethod'], ['formnovalidate', 'formNoValidate'], ['formtarget', 'formTarget'],
  ['hreflang', 'hrefLang'], ['http-equiv', 'httpEquiv'], ['inputmode', 'inputMode'], ['itemprop', 'itemProp'],
  ['itemscope', 'itemScope'], ['itemtype', 'itemType'], ['nomodule', 'noModule'], ['novalidate', 'noValidate'],
  ['playsinline', 'playsInline'], ['popovertarget', 'popoverTarget'], ['referrerpolicy', 'referrerPolicy'],
  ['spellcheck', 'spellCheck'], ['srcdoc', 'srcDoc'], ['srclang', 'srcLang'], ['srcset', 'srcSet'],
]) {
  eq('rename ' + html, jsx('<x ' + html + '="v">'), '<x ' + react + '="v">');
  eq('rename upper-case ' + html, jsx('<x ' + html.toUpperCase() + '>'), '<x ' + react + '>');
}
eq('comment containing */', jsx('<!-- a */ b -->'), '{/* a * / b */}');

// ---------- English page login form ----------
{
  const page = readFileSync(join(root, 'src/content/tools/html-to-jsx/en.mdx'), 'utf8');
  const input = '<form action="/login" method="post" novalidate>\n  <label for="user" class="field-label">Username</label>\n  <input id="user" name="user" autocomplete="username" maxlength="32" autofocus>\n  <button type="submit" onclick="track(&quot;login&quot;)">Sign in</button>\n</form>';
  const out = jsx(input);
  eq('login form output', out, '<form action="/login" method="post" noValidate>\n  <label htmlFor="user" className="field-label">Username</label>\n  <input id="user" name="user" autoComplete="username" maxLength="32" autoFocus />\n  <button type="submit" onClick={(event) => { track("login") }}>Sign in</button>\n</form>');
  check('page shows the login input', page.includes(input));
  check('page shows the login output', page.includes(out));
}

// ---------- every language page: the Example output is the converter's output ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const page = readFileSync(join(root, 'src/content/tools/html-to-jsx/' + lang + '.mdx'), 'utf8');
  const m = page.match(/```html\n([\s\S]*?)\n```[\s\S]*?```jsx\n([\s\S]*?)\n```/);
  check('page example found ' + lang, !!m);
  if (m) eq('page example output ' + lang, jsx(m[1]), m[2]);
  check('page no longer says text is copied unescaped ' + lang, !page.includes("a {'<'} b and {'{'}name{'}'}"));
}

// A-HTMLJSX-STYLE / A-HTMLJSX-TEXT-BRACES: compile the actual entry point.
// Optional real rendering uses an isolated, pinned React installation, never a new repo dependency.
let React, renderToStaticMarkup;
if (process.env.JSX_REACT_REFERENCE_DIR) {
  const reference = createRequire(join(process.env.JSX_REACT_REFERENCE_DIR, 'package.json'));
  React = reference('react');
  ({ renderToStaticMarkup } = reference('react-dom/server'));
  if (React.version !== '19.2.0' || reference('react-dom/package.json').version !== '19.2.0') throw Error('React reference must be 19.2.0');
} else console.log('SKIP: real React rendering — set JSX_REACT_REFERENCE_DIR to isolated React/ReactDOM 19.2.0');
function compiled(html) {
  const code = transformSync('export default () => (' + jsx(html) + ');', { loader: 'jsx', format: 'cjs', jsxFactory: 'h' }).code;
  const mod = { exports: {} };
  const h = (type, props, ...children) => ({ type, props: props || {}, children });
  new Function('h', 'module', 'exports', code)(h, mod, mod.exports);
  return mod.exports.default();
}
function regression(name, fn) {
  try { fn(); } catch (e) { check(name, false, e.errors?.[0]?.text || e.message); }
}
const styles = [
  ['--Accent: red; color:blue', { '--Accent': 'red', color: 'blue' }],
  ['-ms-transform:none; -webkit-mask:none', { msTransform: 'none', WebkitMask: 'none' }],
  ['background-image:url(data:image/png;base64,AA==); color:red', { backgroundImage: 'url(data:image/png;base64,AA==)', color: 'red' }],
  ['content:"a;b:c"; font-family:"a\\b"', { content: '"a;b:c"', fontFamily: '"a\\b"' }],
  ['--token:var(--fallback, rgb(1 2 3)); COLOR:red;', { '--token': 'var(--fallback, rgb(1 2 3))', color: 'red' }],
  ['--payload:{a:b;c:d};--list:[a;b]; content:"<>&{}"', { '--payload': '{a:b;c:d}', '--list': '[a;b]', content: '"<>&{}"' }],
  ['--a:red; --A:blue; margin:0', { '--a': 'red', '--A': 'blue', margin: '0' }],
  ['--x:a\\ ', { '--x': 'a\\ ' }],
  ['--x:a\\  ;color:red', { '--x': 'a\\ ', color: 'red' }],
  ['--x:\\61 ', { '--x': '\\61 ' }],
  ['--x:a\u00a0', { '--x': 'a\u00a0' }],
  ['content:"a\\\r\nb"', { content: '"a\\\r\nb"' }],
];
for (const [style, expected] of styles) regression('style compile ' + style, () => {
  const html = '<p style="' + style.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">x</p>';
  eq('compiled style values ' + style, JSON.stringify(compiled(html).props.style), JSON.stringify(expected));
  if (React) {
    const actual = renderToStaticMarkup(React.createElement('p', compiled(html).props, 'x'));
    const wanted = renderToStaticMarkup(React.createElement('p', { style: expected }, 'x'));
    eq('React style readback ' + style, actual, wanted);
  }
});
for (const text of ['{name}', 'a } b { c > d', '&amp; &#123;x&#125;', '{{user}} 😀']) regression('text compile ' + text, () => {
  const tree = compiled('<p>' + text + '</p>');
  const expected = parseFragment('<p>' + text + '</p>').childNodes[0].childNodes[0].value;
  eq('compiled text is literal ' + text, tree.children.join(''), expected);
  if (React) eq('React text readback ' + text, parseFragment(renderToStaticMarkup(React.createElement(tree.type, tree.props, ...tree.children))).childNodes[0].childNodes[0].value, expected);
});
regression('generated handler is not escaped as text', () => {
  const tree = compiled('<button onclick="event.target.textContent = &quot;{done}&quot;">{go}</button>');
  const event = { target: {} };
  tree.props.onClick(event);
  eq('handler remains executable', event.target.textContent, '{done}');
  eq('button braces remain literal', tree.children[0], '{go}');
});
for (const style of ['color:red;color:blue', 'color:red !important', 'color', ':red', 'color:', 'color:url(a', 'content:"x', 'color:red)', 'co\\lor:red', 'color:/* x */red', '--x:a\\\nb', '--x:a\\\r\nb']) {
  let error;
  try { jsx('<p style=\'' + style + '\'>x</p>'); } catch (e) { error = e; }
  check('refuses unrepresentable CSS ' + style, !!error?.code && Number.isInteger(error.position), error?.message);
}
// Run the full shipped inline script, so rejection cannot leave an old output copyable.
for (const lang of ['en', 'zh', 'ja', 'ko']) regression('page refusal ' + lang, () => {
  const nodes = {};
  const node = (id) => nodes[id] ||= { value: '', disabled: false, textContent: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
  const document = { addEventListener() {}, documentElement: { lang }, querySelectorAll: () => [], getElementById: node };
  runInNewContext(source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1], { document, window: {}, navigator: {}, setTimeout: (fn) => fn(), clearTimeout() {} });
  node('htj-input').value = '<p style="color:red">x</p>';
  node('htj-input').listeners.input();
  check('page valid output ' + lang, !!node('htj-output').value && !node('htj-copy').disabled);
  node('htj-input').value = '<p style="color:red !important">x</p>';
  node('htj-input').listeners.input();
  check('page clears old output and disables copy ' + lang, node('htj-output').value === '' && node('htj-copy').disabled);
  check('page explains refusal ' + lang, !!node('htj-status').textContent);
  node('htj-input').value = '<p>{x}</p>';
  node('htj-input').listeners.input();
  check('page recovers after refusal ' + lang, !!node('htj-output').value && !node('htj-copy').disabled && node('htj-status').textContent === '');
});


// ---------- complete page lifecycle + real ToolLayout keyboard handler ----------
// Only DOM, clipboard completion and timer delivery are controlled; the whole page script runs.
const lifecycleSpec = {"slug": "html-to-jsx", "component": "HtmlToJsxTool", "prefix": "htj", "input": "htj-input", "source": "<label class=\"a\" for=\"x\">Hi</label>", "next": "<input class=\"b\">", "expected": "<label className=\"a\" htmlFor=\"x\">Hi</label>", "invalid": "<div style=\"color:red;color:blue\">x</div>", "file": "src/components/tools/HtmlToJsxTool.astro"};
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
  const markup=s.src.slice(s.src.indexOf('---',3)+3,s.src.indexOf('<script'));
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
  const widget={contains:(e)=>nodes.includes(e),querySelectorAll:selectAll};
  document={documentElement:{lang},activeElement:null,getElementById(id){if(!byId.has(id))throw Error('missing actual DOM id '+id);return byId.get(id);},querySelectorAll:selectAll,
    querySelector(selector){if(selector==='.tool-widget')return widget;if(selector==='.tool-widget .btn-primary')return nodes.find(e=>e.className.split(/\s+/).includes('btn-primary'))||null;throw Error('unexpected selector '+selector);},
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

for (const boundary of ["CtrlL", "input", "new-output", "same-output", "invalid"]) {
  for (const finish of ['resolve', 'reject']) {
    const p = lifecyclePage(); p.convert(); p.copy.click();
    if (boundary === 'CtrlL') p.clearKey();

    else if (boundary === 'input') p.type(lifecycleSpec.next);
    else if (boundary === 'same-output') p.convert();
    else if (boundary === 'invalid') p.convert(lifecycleSpec.invalid);
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

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
