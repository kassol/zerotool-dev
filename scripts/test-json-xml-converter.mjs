// Read: complete JsonXmlConverterTool.astro inline script; the 4 tool pages
//       (src/content/tools/json-xml-converter/{en,zh,ja,ko}.mdx). Write: stdout only.
// Real click/input handlers; XML DOM substitutes (hand-built nodes, or a tree built with the
// sax 1.6.1 strict parser for the page examples) are not a DOMParser implementation.
// Actual DOMParser acceptance is checked separately in ego-browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const sax = createRequire(import.meta.url)('sax');
const source = readFileSync(new URL('../src/components/tools/JsonXmlConverterTool.astro', import.meta.url), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); } }
function text(value, type = 3) { return { nodeType: type, nodeValue: value, textContent: value }; }
function node(name, children = [], attrs = []) {
  return { nodeType: 1, tagName: name, attributes: attrs, childNodes: children,
    get textContent() { return children.filter(n => n.nodeType !== 7 && n.nodeType !== 8).map(n => n.textContent).join(''); } };
}
// XML text → substitute document; a sax error becomes a parsererror element
function saxDoc(raw) {
  const p = sax.parser(true), stack = [{ childNodes: [] }];
  let error = null;
  p.onerror = e => { error = error || e.message.split('\n')[0]; p.error = null; };
  p.onopentag = t => { const n = node(t.name, [], Object.entries(t.attributes).map(([name, value]) => ({ name, value })));
    stack.at(-1).childNodes.push(n); stack.push(n); };
  p.onclosetag = () => stack.pop();
  p.ontext = v => { if (stack.length > 1) stack.at(-1).childNodes.push(text(v)); };
  p.oncdata = v => stack.at(-1).childNodes.push(text(v, 4));
  p.oncomment = v => { if (stack.length > 1) stack.at(-1).childNodes.push(text(v, 8)); };
  p.write(raw).close();
  const root = stack[0].childNodes.find(n => n.nodeType === 1);
  return { documentElement: root, querySelector: () => (error || !root ? { textContent: error || 'no root' } : null) };
}
function page(lang = 'en', root = node('root')) {
  const elements = new Map(), copied = [], timers = new Map(), docEvents = {}; let id = 0, document;
  const get = key => {
    if (!elements.has(key)) { const events = {}; elements.set(key, { value: '', checked: false, disabled: false, textContent: '',
      focus() { document.activeElement = this; }, addEventListener(k, fn) { events[k] = fn; }, fire(k, ev = {}) { events[k]?.(ev); }, click() { if (!this.disabled) this.fire('click'); } }); }
    return elements.get(key);
  };
  get('jx-root').value = 'root'; get('jx-pretty').checked = true;
  document = { documentElement: { lang }, activeElement: get('jx-json'), getElementById: get, querySelectorAll: () => [], querySelector: () => ({ contains: el => [...elements.values()].includes(el) }), addEventListener(k, fn) { docEvents[k] = fn; } };
  vm.runInNewContext(source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1], {
    document, window: {},
    navigator: { clipboard: { writeText: async v => copied.push(v) } },
    DOMParser: class { parseFromString(raw) { return root === 'sax' ? saxDoc(raw) : { documentElement: root, querySelector: () => null }; } },
    setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(i) { timers.delete(i); }
  });
  return { get, copied, docKey(ev) { docEvents.keydown?.({ preventDefault() {}, ...ev }); }, flush() { const jobs = [...timers.values()]; timers.clear(); jobs.forEach(fn => fn()); } };
}
const decl = '<?xml version="1.0" encoding="UTF-8"?>';
for (const [raw, xml] of [
  ['{"name":"Alice","age":30}', '<root><name>Alice</name><age>30</age></root>'],
  ['{"tags":["a","b"]}', '<root><tags>a</tags><tags>b</tags></root>'],
  ['[{"id":1},{"id":2}]', '<root><item><id>1</id></item><item><id>2</id></item></root>'],
  ['{"empty":{},"note":null}', '<root><empty></empty><note></note></root>'],
  ['{"中文":"甲","名前":"乙","한글":"丙","é":"丁"}', '<root><中文>甲</中文><名前>乙</名前><한글>丙</한글><é>丁</é></root>'],
  ['{"é":"x","a·b":"y"}', '<root><é>x</é><a·b>y</a·b></root>'],
  ['{"a-b":"x<&>"}', '<root><a-b>x&lt;&amp;&gt;</a-b></root>']
]) await test('compatible JSON → XML ' + raw, () => { const p = page(); p.get('jx-pretty').checked = false;
  p.get('jx-json').value = raw; p.get('jx-to-xml').click(); assert.equal(p.get('jx-xml').value, decl + xml); });

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  for (const [raw, path] of [
    ['{"a":[[1,2],[3]]}', '$["a"][0]'], ['{"a":[]}', '$["a"]'], ['[]', '$'],
    ['{"a":[1,[]]}', '$["a"][1]'], ['{"a":{"b":[]}}', '$["a"]["b"]'],
    ['{"first name":1,"first_name":2}', '$["first name"]'], ['{"a b":1,"a?b":2}', '$["a b"]'],
    ['{"2026":1}', '$["2026"]'], ['{"":1}', '$[""]'], ['{"ns:key":1}', '$["ns:key"]'],
    ['{"x":"a\\u0000b"}', '$["x"]']
  ]) await test(lang + ' reject and clear ' + raw, async () => {
    const p = page(lang); p.get('jx-json').value = '{"ok":1}'; p.get('jx-to-xml').click();
    p.get('jx-json').value = raw; p.get('jx-to-xml').click();
    assert.equal(p.get('jx-xml').value, ''); assert.equal(p.get('jx-copy-xml').disabled, true);
    assert.ok(p.get('jx-status').textContent.includes(path), p.get('jx-status').textContent);
    p.get('jx-copy-xml').click(); assert.equal(p.copied.length, 0);
  });
  for (const [root, path] of [
    [node('root', [node('entry', [], [{ name: 'id', value: '7' }])]), '/root/entry[1]/@id'],
    [node('root', [text('before'), node('b', [text('after')])]), '/root'],
    [node('root', [text('before', 4), node('b', [text('after')])]), '/root'],
    [node('root', [node('entry', [text('inside'), node('b')])]), '/root/entry[1]']
  ]) await test(lang + ' XML attribute/mixed content rejection ' + path, () => {
    const p = page(lang, root); p.get('jx-json').value = '{"stale":1}'; p.get('jx-xml').value = '<root/>';
    p.get('jx-to-json').click(); assert.equal(p.get('jx-json').value, '');
    assert.equal(p.get('jx-copy-json').disabled, true); assert.ok(p.get('jx-status').textContent.includes(path));
  });
}
await test('XML repeated and prototype-named elements keep every value', () => {
  const p = page('en', node('root', [node('hasOwnProperty', [text('a')]), node('hasOwnProperty', [text('b')]), node('__proto__', [text('c')]), node('constructor', [text('d')])]));
  p.get('jx-xml').value = '<root/>'; p.get('jx-to-json').click();
  assert.deepEqual(JSON.parse(p.get('jx-json').value), JSON.parse('{"root":{"hasOwnProperty":["a","b"],"__proto__":"c","constructor":"d"}}'));
});
await test('leaf CDATA remains text; formatting whitespace around elements is ignored', () => {
  const p = page('en', node('root', [text('\n  '), node('a', [text(' x ', 4)]), text('\n')]));
  p.get('jx-xml').value = '<root/>'; p.get('jx-to-json').click(); assert.deepEqual(JSON.parse(p.get('jx-json').value), { root: { a: ' x ' } });
});
await test('invalid root name rejects; empty root name keeps the default', () => {
  const p = page(); p.get('jx-json').value = '{"a":1}'; p.get('jx-root').value = '123 data'; p.get('jx-to-xml').click();
  assert.equal(p.get('jx-xml').value, ''); assert.match(p.get('jx-status').textContent, /\$/);
  p.get('jx-root').value = ''; p.get('jx-to-xml').click(); assert.match(p.get('jx-xml').value, /<root>/);
});
await test('both empty inputs and pending edits invalidate old opposite output', () => {
  const p = page(); p.get('jx-json').value = '{"a":1}'; p.get('jx-to-xml').click(); p.get('jx-json').value = ''; p.get('jx-to-xml').click();
  assert.equal(p.get('jx-xml').value, ''); p.get('jx-json').value = '{"a":1}'; p.get('jx-to-xml').click();
  p.get('jx-json').fire('input'); assert.equal(p.get('jx-xml').value, '');
  p.get('jx-xml').value = '<root/>'; p.get('jx-to-json').click(); p.get('jx-xml').value = ''; p.get('jx-to-json').click();
  assert.equal(p.get('jx-json').value, '');
});
await test('editing a panel clears the status of the previous conversion', () => {
  const p = page('en', 'sax'); p.get('jx-xml').value = '<r><a>1</a></r>'; p.get('jx-to-json').click();
  assert.equal(p.get('jx-status').textContent, 'Converted XML to JSON.');
  p.get('jx-json').value = '{"x":1}'; p.get('jx-json').fire('input'); assert.equal(p.get('jx-status').textContent, '');
  p.flush(); assert.equal(p.get('jx-status').textContent, 'Converted JSON to XML.');
  p.get('jx-xml').fire('input'); assert.equal(p.get('jx-status').textContent, '');
});
await test('opposite edit cancels the pending conversion', () => {
  const p = page('en', node('root', [node('new', [text('value')])]));
  p.get('jx-json').value = '{"old":1}'; p.get('jx-json').fire('input');
  p.get('jx-xml').value = '<root><new>value</new></root>'; p.get('jx-xml').fire('input'); p.flush();
  assert.deepEqual(JSON.parse(p.get('jx-json').value), { root: { new: 'value' } });
  assert.equal(p.get('jx-xml').value, '<root><new>value</new></root>');
});
await test('clear cancels both pending timers', () => {
  const p = page(); p.get('jx-json').value = '{"a":1}'; p.get('jx-json').fire('input');
  p.get('jx-clear').click(); p.flush();
  assert.equal(p.get('jx-json').value, ''); assert.equal(p.get('jx-xml').value, '');
  assert.equal(p.get('jx-status').textContent, '');
});
// ToolLayout's document keydown clicks the first .btn-primary (JSON → XML) on Ctrl/Cmd+Enter and
// empties text fields on Ctrl/Cmd+L without input events.
await test('panel Ctrl+Enter stops the page-wide shortcut', () => {
  const p = page('en', 'sax');
  for (const id of ['jx-json', 'jx-xml']) {
    const ev = { key: 'Enter', ctrlKey: true, stopped: false, prevented: false,
      stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
    p.get(id).value = id === 'jx-json' ? '{"a":1}' : '<r><a>1</a></r>'; p.get(id).fire('keydown', ev);
    assert.ok(ev.stopped && ev.prevented, id);
  }
  assert.deepEqual(JSON.parse(p.get('jx-json').value), { r: { a: '1' } });
});
await test('Ctrl+L resets copy buttons and status once both panels are empty', () => {
  const p = page('en', 'sax'); p.get('jx-json').value = '{"a":1}'; p.get('jx-to-xml').click();
  assert.equal(p.get('jx-copy-xml').disabled, false);
  p.get('jx-json').value = ''; p.get('jx-xml').value = '';
  p.docKey({ key: 'l', metaKey: true }); p.flush();
  assert.equal(p.get('jx-copy-xml').disabled, true); assert.equal(p.get('jx-copy-json').disabled, true);
  assert.equal(p.get('jx-status').textContent, '');
});
await test('copy buttons start disabled', () => {
  const p = page(); assert.equal(p.get('jx-copy-json').disabled, true); assert.equal(p.get('jx-copy-xml').disabled, true);
});

// Valid input that the mapping rejects was labelled "Invalid JSON" / "Invalid XML".
const STR = new Function('return ' + /var STRINGS = (\{[\s\S]*?\n      \});/.exec(source)[1])();
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  await test(lang + ' status prefix separates syntax errors from mapping limits', () => {
    for (const k of Object.keys(STR.en)) assert.ok(STR[lang][k], lang + ' ' + k);
    const p = page(lang, 'sax');
    p.get('jx-json').value = '{"2026":1}'; p.get('jx-to-xml').click();
    assert.ok(p.get('jx-status').textContent.startsWith(STR[lang].cannotToXml + ': '), p.get('jx-status').textContent);
    p.get('jx-json').value = '{"a":1,}'; p.get('jx-to-xml').click();
    assert.ok(p.get('jx-status').textContent.startsWith(STR[lang].invalidJson + ': '), p.get('jx-status').textContent);
    p.get('jx-xml').value = '<r id="1"/>'; p.get('jx-to-json').click();
    assert.ok(p.get('jx-status').textContent.startsWith(STR[lang].cannotToJson + ': '), p.get('jx-status').textContent);
    p.get('jx-xml').value = '<r>'; p.get('jx-to-json').click();
    assert.ok(p.get('jx-status').textContent.startsWith(STR[lang].invalidXml + ': '), p.get('jx-status').textContent);
  });
}

// Pretty print used to write a scalar root as <root>\n  hello\n</root>: the indentation became
// part of the root text, so pretty and compact output read back as different values.
for (const [raw, back] of [['"hello"', 'hello'], ['42', '42'], ['true', 'true'], ['"  x  "', '  x  '], ['null', ''], ['{}', '']]) {
  for (const pretty of [true, false]) await test('root ' + raw + ' pretty=' + pretty + ' adds no text', () => {
    const p = page('en', 'sax'); p.get('jx-pretty').checked = pretty;
    p.get('jx-json').value = raw; p.get('jx-to-xml').click();
    const xml = p.get('jx-xml').value;
    assert.equal(xml, decl + (pretty ? '\n' : '') + (back ? '<root>' + back + '</root>' : '<root></root>'));
    p.get('jx-xml').value = xml; p.get('jx-to-json').click();
    assert.deepEqual(JSON.parse(p.get('jx-json').value), { root: back });
  });
}

// Tool pages: {/* jx-to-xml */} → the next ```json block, converted with pretty print and root
// "root", must equal the next ```xml block; {/* jx-to-json */} the other way round (XML read by the
// sax tree above). {/* jx-error: {"dir","input"} */} → the status line for that input must appear
// in the next 700 characters of the page.
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const rel = `src/content/tools/json-xml-converter/${lang}.mdx`;
  const mdx = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
  const fence = (from, kind) => { const m = mdx.slice(from).match(new RegExp('```' + kind + '\\n([\\s\\S]*?)\\n```')); return m ? m[1] : null; };
  let n = 0;
  for (const m of mdx.matchAll(/\{\/\* jx-to-(xml|json) \*\/\}/g)) {
    n++;
    await test(rel + ' example ' + n, () => {
      const p = page(lang, 'sax'); p.get('jx-pretty').checked = true;
      if (m[1] === 'xml') { p.get('jx-json').value = fence(m.index, 'json'); p.get('jx-to-xml').click(); assert.equal(p.get('jx-xml').value, fence(m.index, 'xml')); }
      else { p.get('jx-xml').value = fence(m.index, 'xml'); p.get('jx-to-json').click(); assert.equal(p.get('jx-json').value, fence(m.index, 'json')); }
    });
  }
  for (const m of mdx.matchAll(/\{\/\* jx-error: (\{.*?\}) \*\/\}/g)) {
    n++;
    await test(rel + ' error example ' + n, () => {
      const spec = JSON.parse(m[1]), p = page(lang, 'sax');
      p.get(spec.dir === 'json' ? 'jx-json' : 'jx-xml').value = spec.input;
      p.get(spec.dir === 'json' ? 'jx-to-xml' : 'jx-to-json').click();
      const status = p.get('jx-status').textContent;
      assert.equal(p.get(spec.dir === 'json' ? 'jx-xml' : 'jx-json').value, '');
      assert.ok(mdx.slice(m.index, m.index + 700).includes(status), status);
    });
  }
  await test(rel + ' has checked examples', () => assert.ok(n >= 5, String(n)));
  await test(rel + ' drops the old renaming and dropping claims', () => {
    assert.ok(!/become[s]? <code>\{'_'\}<\/code>|<_2026>|are dropped|被直接丢弃|そのまま破棄|그대로 버려/.test(mdx));
  });
}


/* ── Full production IIFE and actual ToolLayout shortcuts ── */
{
  const { parseFragment } = await import('parse5');
  const { createHash } = await import('node:crypto');
  const js = source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];
  const layout = readFileSync(new URL('../src/layouts/ToolLayout.astro', import.meta.url), 'utf8');
  const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
  assert.ok(shortcut.includes("document.addEventListener('keydown'"));
  const hash = value => createHash('sha256').update(value).digest('hex');
  const checks = [];
  function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    checks.push(ok);
    if (!ok) console.log('FAIL ' + name + '\n actual: ' + JSON.stringify(actual) + '\n expected: ' + JSON.stringify(expected));
  }
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const onUnhandled = error => unhandled.push(String(error));
process.on('unhandledRejection', onUnhandled);
const descendants = e => e.children.flatMap(c => [c, ...descendants(c)]);
function page(lang = 'en', shellFirst = false, preset = {}, active = null) {
  let document, now = 0, nextTimer = 0;
  const timers = new Map(), copies = [], clears = [], tracks = [];
  function simple(e, selector) {
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    const rest = selector.replace(/\[[^\]]+\]/g, '');
    const tag = /^[\w-]+/.exec(rest)?.[0], id = /#([\w-]+)/.exec(rest)?.[1];
    return (!tag || e.tagName === tag.toUpperCase()) && (!id || e.id === id)
      && [...rest.matchAll(/\.([\w-]+)/g)].every(m => e.classList.contains(m[1]))
      && attrs.every(a => a[2] === undefined ? e.getAttribute(a[1]) !== null : e.getAttribute(a[1]) === a[2]);
  }
  function matches(e, selector) {
    return selector.split(',').some(part => {
      const pieces = part.trim().split(/\s+(?![^\[]*\])/);
      if (!simple(e, pieces.pop())) return false;
      let parent = e.parentNode;
      while (pieces.length) { while (parent && !simple(parent, pieces.at(-1))) parent = parent.parentNode; if (!parent) return false; pieces.pop(); parent = parent.parentNode; }
      return true;
    });
  }
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.value = ''; this.textContent = ''; this.className = ''; this.id = ''; this.disabled = false; this.hidden = false; }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(...cs) { el.className = [...new Set([...el.className.split(/\s+/).filter(Boolean), ...cs])].join(' '); }, remove(...cs) { el.className = el.className.split(/\s+/).filter(c => !cs.includes(c)).join(' '); } }; }
    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = String(v); if (k === 'id') this.id = String(v); if (k === 'disabled') this.disabled = true; if (k === 'checked') this.checked = true; if (k === 'value') this.value = String(v); if (k === 'hidden') this.hidden = true; if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); }
    getAttribute(k) { return Object.hasOwn(this.attributes, k) ? this.attributes[k] : null; }
    removeAttribute(k) { delete this.attributes[k]; if (k === 'disabled') this.disabled = false; if (k === 'hidden') this.hidden = false; }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    contains(c) { return c === this || descendants(this).includes(c); }
    querySelectorAll(s) { return descendants(this).filter(e => matches(e, s)); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    closest(s) { for (let e = this; e; e = e.parentNode) if (matches(e, s)) return e; return null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    focus() { document.activeElement = this; }
    dispatch(type, init = {}) {
      const e = { type, target: this, currentTarget: this, key: '', ctrlKey: false, metaKey: false, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...init };
      for (let node = this; node; node = node.parentNode) { e.currentTarget = node; for (const fn of node.listeners[type] || []) fn.call(node, e); if (e.stopped) break; }
      return e;
    }
    click() { if (!this.disabled) { this.focus(); return this.dispatch('click'); } }
  }
  document = new Element('#document'); document.documentElement = { lang };
  document.body = document.appendChild(new Element('body')); document.activeElement = document.body;
  const widget = document.body.appendChild(new Element('section')); widget.className = 'tool-widget';
  const esc = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const markup = source.replace(/^---[\s\S]*?---\s*/, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').split('<style')[0]
    .replace(/data-strings=\{JSON\.stringify\(T\)\}/g, 'data-strings="' + esc(JSON.stringify(STR[lang])) + '"')
    .replace(/data-lang=\{lang\}/g, 'data-lang="' + lang + '"').replace(/\{T\.(\w+)\}/g, (_, k) => esc(STR[lang][k]));
  function append(ast, parent) { for (const node of ast.childNodes || []) { if (!node.tagName) { if (node.nodeName === '#text') parent.textContent += node.value; continue; } const e = parent.appendChild(new Element(node.tagName)); for (const a of node.attrs) e.setAttribute(a.name, a.value); append(node, e); if (e.tagName === 'TEXTAREA') e.value = e.textContent; } }
  append(parseFragment(markup), widget);
  document.getElementById = id => descendants(document).find(e => e.id === id) || null;
  const get = id => { const e = document.getElementById(id); if (!e) throw Error('Missing production ID ' + id); return e; };
  for (const [id, value] of Object.entries(preset)) get(id).value = value;
  if (active) get(active).focus();
  const context = { document, console, exports: {}, module: { exports: {} },
    DOMParser: class { parseFromString(raw) { const doc = saxDoc(raw); const err = doc.querySelector('parsererror'); if (err) err.querySelector = () => null; return doc; } }, _slug: 'json-xml-converter',
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); copies.push({ value, resolve, reject }); return promise; } } },
    setTimeout(fn, ms = 0) { const id = ++nextTimer; timers.set(id, { fn, ms, due: now + ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    ztPersist: { clear(slug) { clears.push(slug); } }, trackTool(...args) { tracks.push(args); } };
  context.window = context; vm.createContext(context);
  const installShared = () => vm.runInContext(shortcut, context, { filename: 'ToolLayout.shortcuts.js' });
  if (shellFirst) installShared(); vm.runInContext(js, context, { filename: 'JsonXmlConverterTool.page.js' }); if (!shellFirst) installShared();
  function advance(ms) { const end = now + ms; let executions = 0; for (;;) { const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0]; if (!next) break; if (++executions > 1000) throw Error('Timer runaway'); now = next[1].due; timers.delete(next[0]); next[1].fn(); } now = end; }
  return { get, document, context, copies, clears, tracks, timers, advance,
    input(id, value) { get(id).focus(); get(id).value = value; get(id).dispatch('input'); },
    key(id, key = 'l', modifier = 'ctrlKey') { (id ? get(id) : document.body).focus(); return document.activeElement.dispatch('keydown', { key, [modifier]: true }); },
    copy(id) { get(id).click(); return copies.at(-1); },
    snapshot() { return { json: get('jx-json').value, xml: get('jx-xml').value, status: get('jx-status').textContent, statusClass: get('jx-status').className, copyJson: get('jx-copy-json').textContent, copyXml: get('jx-copy-xml').textContent, disabledJson: get('jx-copy-json').disabled, disabledXml: get('jx-copy-xml').disabled }; } };
}

const JSON_TEXT = '{"name":"demo","port":8080}';
const XML_TEXT = '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <name>demo</name>\n  <port>8080</port>\n</root>';
const golden = p => { p.input('jx-json', JSON_TEXT); p.advance(400); };
check('marked engine immutable', hash(source.slice(source.indexOf('/* ── engine:start'), source.indexOf('/* ── engine:end') + '/* ── engine:end ── */'.length)), 'f365806a64671f7942535e4df1e77940395b174daa5bf0f0d2937cfe50a2fa41');
check('XML reverse algorithm immutable', hash(source.slice(source.indexOf('      function xmlNodeToJson'), source.indexOf('      function convertXmlToJson'))), '8ecdbe621da6a1f595efc244c4088f74c6db9c6b6d9f8e6b9911cc7fa9d4e408');
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const S = STR[lang];
  for (const shellFirst of [false, true]) {
    const p = page(lang, shellFirst), tag = lang + '/' + shellFirst;
    golden(p); check(tag + ' real timed JSON conversion', p.get('jx-xml').value, XML_TEXT);
    p.input('jx-xml', '<root><name>demo</name></root>'); p.advance(400);
    check(tag + ' SAX nodes through actual reverse handler', p.get('jx-json').value, '{\n  "root": {\n    "name": "demo"\n  }\n}');
    for (const side of ['json', 'xml']) {
      golden(p); p.tracks.length = 0;
      p.key('jx-' + side, 'Enter');
      check(tag + '/' + side + ' Enter propagation stays stopped', p.tracks.length, 1);
      check(tag + '/' + side + ' requested manual direction', p.get('jx-status').textContent, side === 'json' ? S.convertedToXml : S.convertedToJson);
    }
    golden(p); p.input('jx-json', '{"queued":1}');
    p.key('jx-copy-json', 'L', 'metaKey');
    check(tag + ' shared CtrlL clears texts and persistence once', [p.get('jx-json').value, p.get('jx-xml').value, p.get('jx-root').value, p.clears], ['', '', '', ['json-xml-converter']]);
    check(tag + ' CtrlL state clears synchronously', [p.get('jx-status').textContent, p.get('jx-copy-json').disabled, p.get('jx-copy-xml').disabled], ['', true, true]);
    const cleared = p.snapshot(); p.advance(2000); check(tag + ' no queued work after CtrlL', p.snapshot(), cleared);
    golden(p); const outside = p.snapshot(); p.key(null); p.advance(0); check(tag + ' outside CtrlL untouched', p.snapshot(), outside);
    for (const side of ['json', 'xml']) {
      const id = 'jx-copy-' + side, field = 'jx-' + side, labelKey = side === 'json' ? 'copyJson' : 'copyXml';
      const q = page(lang, shellFirst); golden(q);
      const savedClipboard = q.context.navigator.clipboard; delete q.context.navigator.clipboard;
      let thrown = ''; try { q.copy(id); } catch (e) { thrown = String(e); }
      check(tag + '/' + side + ' no API controlled localized error', [thrown, q.get('jx-status').classList.contains('error'), typeof S.copyFailed === 'string' && q.get('jx-status').textContent === S.copyFailed], ['', true, true]);
      q.context.navigator.clipboard = savedClipboard; const retryApi = q.copy(id); retryApi.resolve(); await settle();
      check(tag + '/' + side + ' API recovery success', [q.get(id).textContent, q.get('jx-status').classList.contains('error')], [S.copied, false]);
      q.advance(1500); check(tag + '/' + side + ' current copy timer', q.get(id).textContent, S.copy);
      const fail = q.copy(id), beforeUnhandled = unhandled.length; fail.reject(Error('controlled copy rejection')); await settle();
      check(tag + '/' + side + ' rejection caught', unhandled.length - beforeUnhandled, 0);
      check(tag + '/' + side + ' rejection localized', q.get('jx-status').classList.contains('error') && typeof S.copyFailed === 'string' && q.get('jx-status').textContent === S.copyFailed, true);
      const retry = q.copy(id); check(tag + '/' + side + ' retry complete bytes', retry.value, q.get(field).value); retry.resolve(); await settle();
      check(tag + '/' + side + ' retry clears copy error', [q.get(id).textContent, q.get('jx-status').classList.contains('error')], [S.copied, false]);
      for (const action of ['input', 'result', 'clear', 'shortcut']) for (const outcome of ['resolve', 'reject']) {
        const r = page(lang, shellFirst); golden(r); const job = r.copy(id), beforeUnhandled = unhandled.length;
        if (action === 'clear') r.get('jx-clear').click();
        else if (action === 'shortcut') r.key(id);
        else { r.input(field, side === 'json' ? '{"new":3}' : '<root><new>3</new></root>'); if (action === 'result') r.advance(400); }
        const current = r.snapshot(); job[outcome](outcome === 'reject' ? Error('controlled stale copy') : undefined); await settle();
        check(tag + '/' + side + '/' + action + '/' + outcome + ' stale feedback ignored', r.snapshot(), current);
        check(tag + '/' + side + '/' + action + '/' + outcome + ' rejection caught', unhandled.length - beforeUnhandled, 0);
      }
      for (const outcome of ['reject', 'resolve']) {
        const r = page(lang, shellFirst); golden(r); const initial = r.snapshot(), expected = { ...initial, [labelKey]: S.copied };
        const old = r.copy(id), fresh = r.copy(id), beforeUnhandled = unhandled.length;
        check(tag + '/' + side + '/' + outcome + ' same-value captured twice', [old.value, fresh.value, old !== fresh], [r.get(field).value, r.get(field).value, true]);
        fresh.resolve(); await settle(); r.advance(500); old[outcome](outcome === 'reject' ? Error('controlled old same-value rejection') : undefined); await settle();
        check(tag + '/' + side + '/' + outcome + ' newest copy survives old completion', r.snapshot(), expected);
        check(tag + '/' + side + '/' + outcome + ' old rejection caught', unhandled.length - beforeUnhandled, 0);
        r.advance(500); r.copy(id).resolve(); await settle(); r.advance(500);
        check(tag + '/' + side + '/' + outcome + ' old timer leaves new feedback', r.snapshot(), expected);
        r.advance(1000); check(tag + '/' + side + '/' + outcome + ' own timer expires', r.snapshot(), initial);
      }
      for (const action of ['clear', 'input']) {
        const r = page(lang, shellFirst); golden(r); r.copy(id).resolve(); await settle();
        if (action === 'clear') r.get('jx-clear').click(); else r.input(field, side === 'json' ? '{"b":2}' : '<b>2</b>');
        r.advance(400); const current = r.snapshot(); r.advance(1500); check(tag + '/' + side + '/' + action + ' old success timer ignored', r.snapshot(), current);
      }
    }
  }
}
await settle(); process.removeListener('unhandledRejection', onUnhandled);
passed += checks.filter(Boolean).length; failed += checks.filter(v => !v).length;
}

console.log(`${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
