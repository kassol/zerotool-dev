// HTML Minifier — minify keeps visible spaces, non-breaking spaces and leading fragment content
//
// Read:  src/components/tools/HtmlMinifierTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers), node_modules/parse5 (spec-compliant HTML
//        parser, used here in place of the browser's DOMParser through a small DOM adapter),
//        src/content/tools/html-minifier/{en,zh,ja,ko}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Defects covered (before the fix):
//   - an element with a single text child was trimmed, so <strong>Note: </strong>text
//     rendered as "Note:text"; inline (phrasing) elements now keep a collapsed edge space,
//     block elements are still trimmed (CSS drops that space anyway);
//   - whitespace was matched with \s, which includes U+00A0, so &nbsp; became a normal
//     space; only HTML ASCII whitespace (tab, LF, FF, CR, space) is collapsed now;
//   - in fragment mode only <body> children were written, so a comment before the first
//     element (the parser puts it on the Document) and <title> / <link> / <meta> / <style>
//     before body content (the parser puts them in <head>) were dropped.
// Also: the page's "before / after minify" example is the engine output.
//
// Run: node scripts/test-html-minifier.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'package.json'));
const parse5 = require('parse5');
const source = readFileSync(join(root, 'src/components/tools/HtmlMinifierTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in HtmlMinifierTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { processDoc };')();

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

// parse5 tree -> the DOM subset the engine reads
function toDom(node) {
  switch (node.nodeName) {
    case '#document': {
      const kids = node.childNodes.map(toDom);
      return { nodeType: 9, childNodes: kids, doctype: kids.find((k) => k.nodeType === 10) || null, documentElement: kids.find((k) => k.nodeType === 1) || null };
    }
    case '#documentType': return { nodeType: 10, name: node.name };
    case '#text': return { nodeType: 3, data: node.value };
    case '#comment': return { nodeType: 8, data: node.data };
    default: {
      const content = node.content || node;
      return {
        nodeType: 1,
        tagName: node.tagName.toUpperCase(),
        attributes: node.attrs.map((a) => ({ name: (a.prefix ? a.prefix + ':' : '') + a.name, value: a.value })),
        childNodes: content.childNodes.map(toDom),
        get innerHTML() { return parse5.serialize(content); },
      };
    }
  }
}
const run = (html, mode = 'minify', indent = '  ') => E.processDoc(toDom(parse5.parse(html)), html, mode, indent);

// ── inline vs block edge spaces ──
eq('inline element keeps its trailing space', run('<p><strong>Note: </strong>read this.</p>'), '<p><strong>Note: </strong>read this.</p>');
eq('inline element: runs collapse to one space', run('<p><em>  a  </em>b</p>'), '<p><em> a </em>b</p>');
eq('link keeps edge space', run('<p>See<a href="/x"> docs</a>.</p>'), '<p>See<a href="/x"> docs</a>.</p>');
eq('block element is still trimmed', run('<p>  hello   world  </p>'), '<p>hello world</p>');
eq('heading trimmed', run('<h1>\n  Title\n</h1>'), '<h1>Title</h1>');

// ── non-breaking spaces ──
{
  const out = run('<p>Price:&nbsp;&nbsp;10&nbsp;EUR</p>');
  eq('&nbsp; is not collapsed', out, '<p>Price:\u00a0\u00a010\u00a0EUR</p>');
  eq('&nbsp; at the edge of a block is kept', run('<p>&nbsp;indent</p>'), '<p>\u00a0indent</p>');
  eq('&nbsp; kept in beautify', run('<p>&nbsp;x</p>', 'beautify'), '<p>\u00a0x</p>\n');
  eq('ideographic space U+3000 is not HTML whitespace', run('<p>\u3000全角</p>'), '<p>\u3000全角</p>');
}

// ── fragment content the parser moves out of <body> ──
eq('conditional comment before the first element is kept', run('<!--[if mso]><table><tr><td><![endif]--><p>x</p>'), '<!--[if mso]><table><tr><td><![endif]--><p>x</p>');
eq('ordinary comment before the first element is removed in minify', run('<!-- note --><p>x</p>'), '<p>x</p>');
eq('comment before the first element kept in beautify', run('<!-- note --><p>x</p>', 'beautify'), '<!-- note -->\n<p>x</p>\n');
eq('<link> and <style> in a fragment are kept', run('<link rel="stylesheet" href="a.css"><style>p{color:red}</style><p>x</p>'), '<link rel="stylesheet" href="a.css"><style>p{color:red}</style><p>x</p>');
eq('<title> and <meta> in a fragment are kept', run('<title>T</title>\n<meta charset="utf-8">\n<p>x</p>'), '<title>T</title> <meta charset="utf-8"> <p>x</p>');

// ── unchanged behaviour ──
eq('pre is verbatim', run('<pre>  a\n   b </pre>'), '<pre>  a\n   b </pre>');
eq('whitespace-only text between inline elements stays a space', run('<p><span>A</span> <span>B</span></p>'), '<p><span>A</span> <span>B</span></p>');
eq('boolean attribute', run('<input disabled="">'), '<input disabled>');
eq('full document', run('<!DOCTYPE html><html><head><title>t</title></head><body><p> a </p></body></html>'), '<!doctype html><html><head><title>t</title></head><body><p>a</p></body></html>');

// ── tool pages: before / after example ──
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/html-minifier', lang + '.mdx'), 'utf8');
  const blocks = [...mdx.matchAll(/```html\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  check(lang + ': page has the before / after blocks', blocks.length >= 2, String(blocks.length));
  if (blocks.length >= 2) eq(lang + ': after-minify block is the engine output', blocks[1], run(blocks[0]));
  check(lang + ': page no longer says inline spaces / nbsp / leading comments are lost', !/Note:read this|Price: 10 EUR|Note:</.test(mdx), lang);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
