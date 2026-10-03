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
  const elements = new Map(), copied = [], timers = new Map(), docEvents = {}; let id = 0;
  const get = key => {
    if (!elements.has(key)) { const events = {}; elements.set(key, { value: '', checked: false, disabled: false, textContent: '',
      addEventListener(k, fn) { events[k] = fn; }, fire(k, ev = {}) { events[k]?.(ev); }, click() { if (!this.disabled) this.fire('click'); } }); }
    return elements.get(key);
  };
  get('jx-root').value = 'root'; get('jx-pretty').checked = true;
  vm.runInNewContext(source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1], {
    document: { documentElement: { lang }, getElementById: get, querySelectorAll: () => [], addEventListener(k, fn) { docEvents[k] = fn; } }, window: {},
    navigator: { clipboard: { writeText: async v => copied.push(v) } },
    DOMParser: class { parseFromString(raw) { return root === 'sax' ? saxDoc(raw) : { documentElement: root, querySelector: () => null }; } },
    setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(i) { timers.delete(i); }
  });
  return { get, copied, docKey(ev) { docEvents.keydown?.(ev); }, flush() { const jobs = [...timers.values()]; timers.clear(); jobs.forEach(fn => fn()); } };
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

console.log(`${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
