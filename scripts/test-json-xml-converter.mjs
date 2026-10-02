// Read: complete JsonXmlConverterTool.astro inline script. Write: stdout only.
// Real click/input handlers; XML DOM substitutes are not a DOMParser implementation.
// Actual DOMParser acceptance is checked separately in ego-browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/components/tools/JsonXmlConverterTool.astro', import.meta.url), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); } }
function text(value, type = 3) { return { nodeType: type, nodeValue: value, textContent: value }; }
function node(name, children = [], attrs = []) {
  return { nodeType: 1, tagName: name, attributes: attrs, childNodes: children, textContent: children.map(n => n.textContent).join('') };
}
function page(lang = 'en', root = node('root')) {
  const elements = new Map(), copied = [], timers = new Map(); let id = 0;
  const get = key => {
    if (!elements.has(key)) { const events = {}; elements.set(key, { value: '', checked: false, disabled: false, textContent: '',
      addEventListener(k, fn) { events[k] = fn; }, fire(k) { events[k]?.({}); }, click() { if (!this.disabled) this.fire('click'); } }); }
    return elements.get(key);
  };
  get('jx-root').value = 'root'; get('jx-pretty').checked = true;
  vm.runInNewContext(source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1], {
    document: { documentElement: { lang }, getElementById: get, querySelectorAll: () => [] }, window: {},
    navigator: { clipboard: { writeText: async v => copied.push(v) } },
    DOMParser: class { parseFromString() { return { documentElement: root, querySelector: () => null }; } },
    setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(i) { timers.delete(i); }
  });
  return { get, copied, flush() { const jobs = [...timers.values()]; timers.clear(); jobs.forEach(fn => fn()); } };
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
console.log(`${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
