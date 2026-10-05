// JSON to JSON Schema — every generated schema must accept the sample it was generated from
//
// Read:  src/components/tools/JsonToJsonSchemaTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: array items are merged across all elements (this project's ajv validates the sample
// against its own generated schema, draft-07): objects with different keys (properties are the
// union, required is the intersection), integer + number → number, mixed scalar types, objects
// mixed with null / scalars / arrays in one array (object and array keywords sit next to a type
// list; they only apply to instances of that type), nested arrays of objects, empty arrays,
// null-valued keys not required, root-level arrays; exact output for single objects is unchanged.
//
// Run: node scripts/test-json-to-json-schema.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv from 'ajv';

import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToJsonSchemaTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JsonToJsonSchemaTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { inferSchema };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}

const ajv = new Ajv({ allowUnionTypes: true });
function acceptsOwnSample(name, sample) {
  const schema = E.inferSchema(sample);
  let validate;
  try { validate = ajv.compile(schema); }
  catch (e) { check(name + ' (schema compiles)', false, e.message); return schema; }
  const ok = validate(sample);
  check(name + ' (sample passes its schema)', ok, JSON.stringify(validate.errors) + ' schema ' + JSON.stringify(schema));
  return schema;
}
function rejects(name, schema, value) {
  const validate = ajv.compile(schema);
  check(name, !validate(value), 'accepted ' + JSON.stringify(value));
}

// ---------- the reported defect: array of objects inferred from the first one only ----------
{
  const s = acceptsOwnSample('objects with different keys', [{ id: 1, name: 'a' }, { id: 2, email: 'b@example.com' }]);
  eq('properties are the union, required the intersection', s, {
    type: 'array',
    items: {
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' }, email: { type: 'string' } },
      required: ['id'],
    },
  });
  rejects('still rejects an item without the shared key', s, [{ name: 'x' }]);
  rejects('still rejects a wrong property type', s, [{ id: 'x' }]);
}
{
  const s = acceptsOwnSample('same key, different types', [{ v: 1 }, { v: 'one' }, { v: true }]);
  eq('type list for the key', s.items.properties.v, { type: ['integer', 'string', 'boolean'] });
}
{
  const s = acceptsOwnSample('integer then number', [1, 2.5, 3]);
  eq('integer + number → number', s, { type: 'array', items: { type: 'number' } });
  rejects('number items still reject strings', s, ['1']);
}
eq('number then integer keeps first position', E.inferSchema(['a', 2.5, 1]).items, { type: ['string', 'number'] });
eq('only integers stay integer', E.inferSchema([1, 2]).items, { type: 'integer' });
{
  const s = acceptsOwnSample('objects mixed with null', [{ a: 1 }, null, { a: 2, b: 'x' }]);
  eq('type list plus object keywords', s.items, {
    type: ['object', 'null'],
    properties: { a: { type: 'integer' }, b: { type: 'string' } },
    required: ['a'],
  });
  rejects('object keywords still apply to objects', s, [{ b: 'x' }]);
}
acceptsOwnSample('objects mixed with scalars and arrays', [{ a: 1 }, 'x', 3, [1, 'y'], [], false]);
{
  const s = acceptsOwnSample('null in one object is not required', [{ a: 1, b: 2 }, { a: null, b: 3 }]);
  eq('a is nullable and optional', s.items.properties.a, { type: ['integer', 'null'] });
  eq('b required', s.items.required, ['b']);
}
{
  const s = acceptsOwnSample('nested arrays of objects', {
    users: [
      { name: 'a', tags: [{ k: 1 }] },
      { name: 'b', tags: [{ k: 2, v: 'x' }, { v: 'y' }], admin: true },
    ],
  });
  eq('nested items merged', s.properties.users.items.properties.tags.items, {
    type: 'object',
    properties: { k: { type: 'integer' }, v: { type: 'string' } },
  });
}
acceptsOwnSample('nested objects with different shapes', [{ meta: { a: 1 } }, { meta: { b: [1] } }, { meta: 'none' }]);
acceptsOwnSample('arrays of arrays', [[1, 2], ['a'], [[{ x: 1 }], [null]]]);
{
  const s = acceptsOwnSample('empty and non-empty arrays', { rows: [[], [1]] });
  eq('items from the non-empty array', s.properties.rows.items, { type: 'array', items: { type: 'integer' } });
}
eq('empty array', E.inferSchema([]), { type: 'array', items: {} });
eq('only empty arrays inside', E.inferSchema([[], []]), { type: 'array', items: { type: 'array', items: {} } });
acceptsOwnSample('root scalar', 42);
acceptsOwnSample('root null', null);
acceptsOwnSample('__proto__ key kept as a property', JSON.parse('[{"__proto__": 1}, {"__proto__": "x"}]'));
check('__proto__ is an own property', Object.prototype.hasOwnProperty.call(
  E.inferSchema(JSON.parse('{"__proto__": 1}')).properties, '__proto__'));

// ---------- single values keep their earlier output ----------
eq('seed example', E.inferSchema({
  name: 'Alice', age: 30, active: true, scores: [95, 87, 92],
  address: { street: '123 Main St', city: 'Wonderland' },
}), {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'integer' },
    active: { type: 'boolean' },
    scores: { type: 'array', items: { type: 'integer' } },
    address: {
      type: 'object',
      properties: { street: { type: 'string' }, city: { type: 'string' } },
      required: ['street', 'city'],
    },
  },
  required: ['name', 'age', 'active', 'scores', 'address'],
});
eq('empty object', E.inferSchema({}), { type: 'object', properties: {} });
eq('null value not required', E.inferSchema({ a: null }), { type: 'object', properties: { a: { type: 'null' } } });


// ---------- real complete page lifecycle; controlled DOM, clipboard and clock boundaries ----------
const pageScript = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const pageLabels = vm.runInNewContext('(' + source.match(/var STRINGS = (\{[\s\S]*?\n\s*\});/)[1] + ')');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes("document.addEventListener('keydown'")) throw Error('Shared shortcut not found');
const engineLines = source.slice(source.lastIndexOf('\n', startIndex) + 1, endIndex + END_MARK.length);
eq('protected engine byte count', Buffer.byteLength(engineLines), 2682);
eq('protected engine SHA256', createHash('sha256').update(engineLines).digest('hex'), "b365427768f716319576990a7657b8d80532b6f96ad61c45a4aa52217a95e8ec");
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const onUnhandled = reason => unhandled.push(String(reason));
process.on('unhandledRejection', onUnhandled);
function page(lang, shellFirst = false) {
  const copies = [], tracks = [], clears = [], timers = new Map(), docEvents = {};
  let now = 0, timerId = 0, doc;
  const decode = s => s.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const descendants = el => el.children.flatMap(c => [c, ...descendants(c)]);
  function matches(el, selector) {
    return selector.split(',').some(part => {
      const words = part.trim().split(/\s+/);
      if (words.length > 1) {
        if (!matches(el, words.pop())) return false;
        for (let p = el.parentElement; p; p = p.parentElement) if (matches(p, words.join(' '))) return true;
        return false;
      }
      const tag = /^[a-z][\w-]*/i.exec(part)?.[0], id = /#([\w-]+)/.exec(part)?.[1];
      return (!tag || el.tagName === tag.toUpperCase()) && (!id || el.id === id)
        && [...part.matchAll(/\.([\w-]+)/g)].every(m => el.classList.contains(m[1]))
        && [...part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(m => m[2] === undefined ? m[1] in el.attributes : el.attributes[m[1]] === m[2]);
    });
  }
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), attributes: {}, dataset: {}, listeners: {}, children: [], parentElement: null, className: '', value: '', textContent: '', checked: false, hidden: false }); }
    setAttribute(key, value) {
      this.attributes[key] = value;
      if (['id', 'type', 'value'].includes(key)) this[key] = value;
      if (key === 'class') this.className = value;
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    getAttribute(key) { return this.attributes[key] ?? null; }
    removeAttribute(key) { delete this.attributes[key]; if (key.startsWith('data-')) delete this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; }
    get parentNode() { return this.parentElement; }
    set innerHTML(value) { this.renderedHTML = value; }
    get innerHTML() { return this.renderedHTML ?? ''; }
    get classList() { const e = this; return { contains(c) { return e.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) e.className += ' ' + c; }, remove(c) { e.className = e.className.split(/\s+/).filter(v => v !== c).join(' '); } }; }
    appendChild(e) { this.children.push(e); e.parentElement = this; }
    querySelectorAll(s) { return descendants(this).filter(e => matches(e, s)); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    contains(e) { return this === e || descendants(this).includes(e); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type) { for (const fn of this.listeners[type] || []) fn.call(this, { target: this, type, preventDefault() {} }); }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { doc.activeElement = this; }
  }
  const body = new Element('body'), widget = new Element('section'); widget.className = 'tool-widget'; body.appendChild(widget);
  const markup = source.split('\n---')[1].split('<script')[0];
  const stack = [widget];
  for (const token of markup.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>|([^<]+)/g)) {
    if (token[3] !== undefined) { stack.at(-1).textContent += decode(token[3]).trim(); continue; }
    if (token[0].startsWith('</')) { if (stack.at(-1).tagName !== token[1].toUpperCase()) throw Error('Unbalanced real markup'); stack.pop(); continue; }
    const el = new Element(token[1]);
    for (const a of token[2].matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)) el.setAttribute(a[1], decode(a[2] ?? a[3]));
    el.hidden = /(?:^|\s)hidden(?:\s|$)/.test(token[2]);
    stack.at(-1).appendChild(el);
    if (!['input', 'br', 'hr'].includes(token[1]) && !token[2].endsWith('/')) stack.push(el);
  }
  const get = id => { const el = descendants(body).find(e => e.id === id); if (!el) throw Error('Missing real ID ' + id); return el; };
  doc = { body, documentElement: { lang }, activeElement: body, getElementById: get, querySelector: s => body.querySelector(s), querySelectorAll: s => body.querySelectorAll(s), addEventListener(type, fn) { (docEvents[type] ||= []).push(fn); } };
  const context = { document: doc, _slug: 'json-to-json-schema', console,
    trackTool: (...args) => tracks.push(args), ztPersist: { clear: slug => clears.push(slug) },
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); copies.push({ value, resolve, reject }); return promise; } } },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, due: now + ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
  };
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(pageScript, context, { filename: 'JsonToJsonSchemaTool.astro' });
  if (!shellFirst) vm.runInContext(shortcut, context);
  return { get, context, copies, tracks, clears, timers, doc,
    input(value) { get('jjs-input').value = value; get('jjs-input').dispatch('input'); },
    key(id = 'jjs-input', key = 'l', modifier = 'ctrlKey') { (typeof id === 'string' ? get(id) : id || body).focus(); const e = { key, [modifier]: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; for (const fn of docEvents.keydown || []) fn(e); return e; },
    advance(ms) { const end = now + ms; for (;;) { const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0]; if (!next) break; timers.delete(next[0]); now = next[1].due; next[1].fn(); } now = end; },
  };
}
const output = p => p.get('jjs-output').value;
const status = p => p.get('jjs-error');
const snapshot = p => JSON.stringify(["jjs-input", "jjs-output", "jjs-error", "jjs-copy"].map(id => { const e = p.get(id); return [e.value, e.checked, e.textContent, e.className, e.hidden]; }));
const goldenInput = "{\"name\":\"Ada\",\"count\":2}", nextInput = "{\"next\":true}", invalidInput = "{";
const run = (p, value = goldenInput) => { p.input(value);  };
const goldenCode = "{\n  \"$schema\": \"http://json-schema.org/draft-07/schema#\",\n  \"type\": \"object\",\n  \"properties\": {\n    \"name\": {\n      \"type\": \"string\"\n    },\n    \"count\": {\n      \"type\": \"integer\"\n    }\n  },\n  \"required\": [\n    \"name\",\n    \"count\"\n  ]\n}";
const copy = p => { p.get('jjs-copy').click(); return p.copies.at(-1); };
const copyFailure = {
  en: 'Copy failed. Please copy the output manually.', zh: '复制失败，请手动复制输出。',
  ja: 'コピーに失敗しました。出力を手動でコピーしてください。', ko: '복사하지 못했습니다. 출력을 직접 복사하세요.',
};
try {
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const L = pageLabels[lang], p = page(lang); check(lang + ': initial seed preserved', p.get('jjs-input').value.includes('Alice') && output(p).includes('Wonderland') === false && !!JSON.parse(output(p)).properties.address);
    run(p); eq(lang + ': real page golden bytes', output(p), goldenCode);
    p.input(nextInput); check(lang + ': input converts immediately', output(p).includes('"next"'));
    const converted = p.tracks.length; p.key('jjs-input', 'Enter'); eq(lang + ': no invented primary action', p.tracks.length, converted);
    for (const shellFirst of [false, true]) for (const modifier of ['ctrlKey', 'metaKey']) {
      const q = page(lang, shellFirst); run(q);
      const prefix = lang + ': shared clear ' + shellFirst + '/' + modifier;
      const outside = snapshot(q); q.key(null, 'l', modifier); eq(prefix + ' outside unchanged', snapshot(q), outside);
      q.input(invalidInput); q.key('jjs-copy', 'L', modifier);
      check(prefix + ' clears input/output/status/error', !q.get('jjs-input').value && !output(q) && !status(q).textContent && !q.get('jjs-input').classList.contains('error'));
      check(prefix + ' restores input focus', q.doc.activeElement === q.get('jjs-input'));
      eq(prefix + ' cancels timers', q.timers.size, 0);
      eq(prefix + ' shared storage clear once', q.clears.join(','), 'json-to-json-schema');

      const cleared = snapshot(q); q.advance(1600); eq(prefix + ' remains clear', snapshot(q), cleared);
    }
    const invalid = page(lang); run(invalid); run(invalid, invalidInput);
    check(lang + ': invalid input positive control', !!status(invalid).textContent && !status(invalid).hidden);
    eq(lang + ': invalid input clears previous output', output(invalid), '');
    run(invalid, '');
    check(lang + ': empty removes error/output/status', !invalid.get('jjs-input').classList.contains('error') && !output(invalid) && !status(invalid).textContent);
    run(invalid, invalidInput); invalid.get('jjs-clear').click();
    check(lang + ': Clear removes invalid state', !status(invalid).textContent && !output(invalid) && !invalid.get('jjs-input').classList.contains('error'));
    check(lang + ': Clear focuses input', invalid.doc.activeElement === invalid.get('jjs-input'));
    const q = page(lang); run(q);
    const good = copy(q); eq(lang + ': Copy exact output bytes', good.value, goldenCode); good.resolve(); await settle();
    eq(lang + ': current copy succeeds', q.get('jjs-copy').textContent, L.copied); q.advance(1500); eq(lang + ': current timer restores Copy', q.get('jjs-copy').textContent, L.copy);
    const failuresBefore = unhandled.length; copy(q).reject(Error('denied')); await settle();
    eq(lang + ': localized current rejection', status(q).textContent, copyFailure[lang]);
    check(lang + ': copy failure visible', !status(q).hidden);
    eq(lang + ': rejection handled', unhandled.length, failuresBefore);
    const retry = copy(q); eq(lang + ': retry identical output', retry.value, goldenCode); retry.resolve(); await settle();
    eq(lang + ': direct retry succeeds', q.get('jjs-copy').textContent, L.copied);
    check(lang + ': direct retry clears copy failure', status(q).textContent !== copyFailure[lang]);
    for (const missing of ['clipboard', 'writeText', 'throw']) {
      const r = page(lang); run(r);
      r.context.navigator.clipboard = missing === 'clipboard' ? undefined : missing === 'writeText' ? {} : { writeText() { throw Error('unavailable'); } };
      let thrown; try { r.get('jjs-copy').click(); } catch (e) { thrown = e; }
      check(lang + ': unavailable API handled ' + missing, !thrown);
      eq(lang + ': unavailable API visible ' + missing, status(r).textContent, copyFailure[lang]);
      eq(lang + ': unavailable API never claims copied ' + missing, r.get('jjs-copy').textContent, L.copy);
    }
    for (const action of ["input", "clear", "shortcut", "result", "error"]) for (const outcome of ['resolve', 'reject', 'timer']) {
      const r = page(lang); run(r); const old = copy(r); let oldTimer;
      if (outcome === 'timer') { old.resolve(); await settle(); oldTimer = [...r.timers.values()].find(t => t.due === 1500)?.fn; }
      if (action === 'input') r.input(nextInput);
      if (action === 'clear') r.get('jjs-clear').click();
      if (action === 'shortcut') r.key();
      if (action === 'result') run(r, nextInput);
      if (action === 'error') run(r, invalidInput);

      const before = snapshot(r), rejectedBefore = unhandled.length;
      // Replay a captured callback even after cancellation to verify obsolete work cannot write.
      if (outcome === 'timer') { check(lang + ': real feedback timer captured ' + action, !!oldTimer); oldTimer?.(); }
      else { old[outcome](Error('late')); await settle(); }
      eq(lang + ': stale ' + action + '/' + outcome, snapshot(r), before);
      eq(lang + ': stale rejection handled ' + action + '/' + outcome, unhandled.length, rejectedBefore);
    }
    const t = page(lang); run(t); copy(t).resolve(); await settle(); t.advance(1000); copy(t).resolve(); await settle(); t.advance(500);
    eq(lang + ': old timer cannot overwrite newer Copied', t.get('jjs-copy').textContent, L.copied);
    t.advance(1000); eq(lang + ': latest timer expires normally', t.get('jjs-copy').textContent, L.copy);
    const order = page(lang); run(order); const first = copy(order), second = copy(order); second.reject(Error('current')); await settle(); first.resolve(); await settle();
    eq(lang + ': older success preserves newer error', status(order).textContent, copyFailure[lang]);
    eq(lang + ': older success cannot claim copied', order.get('jjs-copy').textContent, L.copy);
    const reverse = page(lang); run(reverse); const older = copy(reverse), newer = copy(reverse); newer.resolve(); await settle(); const fresh = snapshot(reverse); older.reject(Error('late')); await settle();
    eq(lang + ': older rejection preserves newer success', snapshot(reverse), fresh);
  }
} finally { await settle(); process.removeListener('unhandledRejection', onUnhandled); }
eq('no unhandled clipboard rejections', unhandled.length, 0);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
