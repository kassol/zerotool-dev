// SVG to JSX — attribute names converted, values kept; caller props override the SVG's own
//
// Read:  src/components/tools/SvgToJsxTool.astro (extracts the real engine block between the
//        `engine:start` / `engine:end` markers, so this test cannot drift from the shipped source)
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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transformSync } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/SvgToJsxTool.astro'), 'utf8');

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
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  try {
    const nodes = {};
    const node = (id) => nodes[id] ||= { value: id === 'stj-name' ? 'Icon' : '', checked: false, disabled: false, textContent: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
    runInNewContext(source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1], { document: { documentElement: { lang }, querySelectorAll: () => [], getElementById: node }, window: {}, navigator: {}, setTimeout: (fn) => fn(), clearTimeout() {} });
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

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
