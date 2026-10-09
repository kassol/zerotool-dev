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

import { createRequire } from 'node:module';
import { transform as esbuildTransform } from 'esbuild';
import { compile as compileMdx } from '@mdx-js/mdx';
import { annotations, contractProblems, examplePairs, fencedBlocks } from './lib/tool-mdx-contract.mjs';

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

// JSON syntax errors (S2-10f, 2026-10-09): lineCol and jsonSyntaxError are copied verbatim from
// json-formatter-engine.js, and errJson, errJsonAt and the jsonParse reasons verbatim from
// HarFileAnalyzerTool.astro. A syntax error shows line, column and cause in the page language
// instead of "Invalid JSON: " plus the browser's English message; line and column count from the
// start of the text box.
const JSON_ENGINE = readFileSync(join(root, 'src/components/tools/json-formatter-engine.js'), 'utf8');
const HAR_SOURCE = readFileSync(join(root, 'src/components/tools/HarFileAnalyzerTool.astro'), 'utf8');
const HAR_S = new Function('return ' + HAR_SOURCE.slice(HAR_SOURCE.indexOf('const STRINGS = ') + 16, HAR_SOURCE.indexOf('\n};\n', HAR_SOURCE.indexOf('const STRINGS = ')) + 2))();
function fnSrc(src, name) {
  const lines = src.split('\n');
  const at = lines.findIndex((l) => new RegExp('^\\s*function ' + name + '\\(').test(l));
  if (at < 0) return '';
  const indent = lines[at].match(/^\s*/)[0];
  let end = at + 1;
  while (end < lines.length && lines[end] !== indent + '}') end++;
  return lines.slice(at, end + 1).map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l)).join('\n');
}
// [input, jsonSyntaxError code, line, column, character]
const JSON_ERRORS = [
  ['\n\n{"a":1,}', 'trailingComma', 3, 7],
  ['{\u201cname\u201d: "Alice"}', 'smartQuote', 1, 2, '\u201c'],
  ['{"name": "Alice"} // sample\n', 'comment', 1, 19],
  ["  {'name': 'Alice'}", 'singleQuote', 1, 4],
];
const jsonErrorMessage = (lang, code, line, col, ch) => HAR_S[lang].errJsonAt.replace('{line}', line).replace('{col}', col).replace('{reason}', HAR_S[lang].jsonParse[code].replace('{ch}', ch ?? ''));

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

// ---------- facts stated in the page prose and FAQ (S2) ----------
{
  // en: a sample with only the success response rejects every error response
  const v = ajv.compile(E.inferSchema([{ ok: true, data: { id: 7 } }]));
  check('en prose: success-only sample rejects the error response', !v([{ ok: false, error: 'not found' }]));
  // zh: a sample with only the record that has a street rejects street: []
  const amap = ajv.compile(E.inferSchema({ geocodes: [{ street: '阜通东大街', number: '6号' }] }));
  check('zh prose/FAQ: string-only sample rejects street: []', !amap({ geocodes: [{ street: [], number: [] }] }));
  // ja FAQ: the half-width kana pattern accepts ﾎｯｶｲﾄﾞｳ and rejects full-width ホッカイドウ; the type stays string
  const kana = ajv.compile({ type: 'string', pattern: '^[ｦ-ﾟ]+$' });
  check('ja FAQ: half-width kana pattern', kana('ﾎｯｶｲﾄﾞｳ') && kana('ﾋﾞﾊﾞｲｼ') && !kana('ホッカイドウ'));
  eq('ja FAQ: half-width kana and full-width digits are plain strings', E.inferSchema({ k: 'ﾎｯｶｲﾄﾞｳ', d: '０７９' }).properties, { k: { type: 'string' }, d: { type: 'string' } });
  // ko FAQ local-kakao-xy and prose: keyword search (string x / y) and coord2regioncode (number x / y) merged in one array
  const kakao = E.inferSchema([
    { meta: { total_count: 14 }, documents: [{ x: '127.05902969025047', y: '37.51207412593136' }] },
    { meta: { total_count: 2 }, documents: [{ x: 127.10459896729914, y: 37.40269721785548 }] },
  ]);
  eq('ko FAQ/prose: merged Kakao x / y become ["string","number"]', kakao.items.properties.documents.items.properties, { x: { type: ['string', 'number'] }, y: { type: ['string', 'number'] } });
  // ja prose: the zipcode type comes from the JSON type, not from the leading 0
  eq('ja prose: zipcode as a JSON number is integer', E.inferSchema({ zipcode: 790177 }).properties.zipcode, { type: 'integer' });
  eq('ja prose: zipcode as a JSON string is string', E.inferSchema({ zipcode: '0790177' }).properties.zipcode, { type: 'string' });
}


// ---------- real complete page lifecycle; controlled DOM, clipboard and clock boundaries ----------
const pageScript = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const pageLabels = vm.runInNewContext('(' + source.match(/const STRINGS = (\{[\s\S]*?\n\});/)[1] + ')');
const runtimeLabels = lang => vm.runInNewContext('(' + source.match(/const CLIENT_T = (\{[\s\S]*?\n\});/)[1] + ')', { L: pageLabels[lang] });
{
  for (const lang of ['en', 'zh', 'ja', 'ko']) for (const key of ['errJson', 'errJsonAt', 'jsonParse']) {
    eq(`JSON errors: ${lang} ${key} is the text of HarFileAnalyzerTool.astro`, pageLabels[lang][key], HAR_S[lang][key]);
    eq(`JSON errors: ${lang} ${key} reaches the page script`, runtimeLabels(lang)[key], HAR_S[lang][key]);
  }
  const rs = source.indexOf('/* ── json-reason:start ── */'), re = source.indexOf('/* ── json-reason:end ── */');
  eq('JSON errors: the json-reason block sits outside the engine block', rs > endIndex && re > rs, true);
  for (const name of ['lineCol', 'jsonSyntaxError']) {
    const mine = rs > 0 ? fnSrc(source.slice(rs, re), name) : '';
    eq(`JSON errors: ${name} is the same as in json-formatter-engine.js`, mine !== '' && mine === fnSrc(JSON_ENGINE, name), true);
  }
}
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
  const tipAbout = JSON.parse(readFileSync(join(root, 'src/i18n/' + lang + '.json'), 'utf8'))['tool.tipAbout'];
  // Render the shared component's actual button/panel boundary; browser QA checks popover geometry.
  const markup = source.split('\n---')[1].split('<script')[0]
    .replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{L\.(\w+)\}>\{L\.tips\.(\w+)\}<\/Toggletip>/g, (_, id, about, tip) =>
      '<span class="zt-tip"><button type="button" data-zt-tip="' + id + '" aria-label="' + escape(tipAbout.replace('{name}', pageLabels[lang][about])) + '"></button><span id="' + id + '" role="note">' + escape(pageLabels[lang].tips[tip]) + '</span></span>')
    .replace(/=\{JSON\.stringify\(CLIENT_T\)\}/g, () => '="' + escape(JSON.stringify(runtimeLabels(lang))) + '"')
    .replace(/=\{L\.(\w+)\}/g, (_, key) => '="' + escape(pageLabels[lang][key]) + '"')
    .replace(/\{L\.(\w+)\}/g, (_, key) => escape(pageLabels[lang][key]));
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
    // Analytics: one event per committed change (the textarea change event), not on load or per keystroke.
    const ga = page(lang); eq(lang + ': GA: page load sends nothing', ga.tracks.length, 0);
    ga.input('{"a":1}'); ga.input('{"a":12}'); eq(lang + ': GA: input events send nothing', ga.tracks.length, 0);
    ga.get('jjs-input').dispatch('change'); eq(lang + ': GA: committed change sends one convert event', JSON.stringify(ga.tracks), JSON.stringify([['json-to-json-schema', 'convert']]));
    ga.input('{'); ga.get('jjs-input').dispatch('change'); eq(lang + ': GA: invalid input change sends nothing', ga.tracks.length, 1);
    ga.input(''); ga.get('jjs-input').dispatch('change'); eq(lang + ': GA: empty input change sends nothing', ga.tracks.length, 1);
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
    // S2-10f: line, column and cause in the page language; before, "Invalid JSON: " plus the browser's English message.
    eq(lang + ': unclosed object names the early end', status(invalid).textContent, jsonErrorMessage(lang, 'unexpectedEnd', 1, 2));
    for (const [input, code, line, col, ch] of JSON_ERRORS) {
      const w = page(lang); run(w); run(w, input);
      eq(lang + ': JSON error ' + code + ' in the page language', [status(w).textContent, status(w).hidden, output(w), w.doc.querySelector('.jjs-wrap').dataset.empty], [jsonErrorMessage(lang, code, line, col, ch), false, '', 'true']);
    }
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


// ---------- v2 page layout ----------
const layoutMarkup = source.split('\n---')[1].split('<script')[0];
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
check('v2 registered as convert', /'json-to-json-schema':\s*'convert'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
check('v2 direct flex root with zero minimum size', /^\s*<div\s+class="jjs-wrap"/.test(layoutMarkup) && /\.jjs-wrap\s*\{[^}]*display:\s*flex;[^}]*min-width:\s*0;[^}]*min-height:\s*0;/.test(css));
check('v2 controls/status precede panels', layoutMarkup.indexOf('class="jjs-actions"') < layoutMarkup.indexOf('id="jjs-error"') && layoutMarkup.indexOf('id="jjs-error"') < layoutMarkup.indexOf('zt-io"'));
eq('v2 two shared panels', (layoutMarkup.match(/\bzt-io-pane\b/g) || []).length, 2);
check('v2 input uses shared fill', /id="jjs-input"\s+class="zt-io-fill"/.test(layoutMarkup));
check('v2 output is a labelled keyboard scroller', /id="jjs-output"[^>]*tabindex="0"[^>]*aria-labelledby="jjs-output-label"/.test(layoutMarkup) && /\.jjs-output\s*\{[^}]*overflow:\s*auto;/.test(css) && /\.jjs-output:focus-visible\s*\{[^}]*outline:/.test(css));
check('v2 status space is reserved', /\.jjs-status\s*\{[^}]*min-height:\s*2\.4rem;/.test(css));
check('v2 long status cannot grow the panels', /\.jjs-status\s*\{[^}]*height:\s*2\.4rem;[^}]*overflow:\s*auto;/.test(css));
check('v2 mobile input is bounded', /@media \(max-width: 860px\)/.test(css) && /height:\s*144px;\s*min-height:\s*144px;/.test(css));
check('v2 mobile output has fixed height', /\.jjs-output\s*\{[^}]*height:\s*22rem;/.test(css));
check('v2 phone controls remain reachable', /@media \(max-width: 640px\)/.test(css) && /min-height:\s*44px/.test(css));
check('v2 empty state follows current output value', /data-empty="true"/.test(layoutMarkup) && /\.jjs-wrap\[data-empty="true"\] \.jjs-output-pane/.test(css) && /wrap\.dataset\.empty/.test(pageScript));
check('v2 four-language build-time text, tips excluded from script', !/data-i18n/.test(source) && !/STRINGS|L\.tips|\.tips\b/.test(pageScript));
eq('v2 original action buttons retained', [...layoutMarkup.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map(m => m[1]).sort().join(','), "jjs-clear,jjs-copy");
const tipMap = [["clear", "clear", "clear"], ["input", "inputJson", "input"], ["copy", "copy", "copy"]];
eq('v2 actual Toggletip count', (layoutMarkup.match(/<Toggletip\b/g) || []).length, tipMap.length);
for (const [id, about, key] of tipMap) check('v2 tip binding ' + id, layoutMarkup.includes('<Toggletip id="jjs-tip-' + id + '" lang={lang} about={L.' + about + '}>{L.tips.' + key + '}</Toggletip>'));
// Hashes captured before migrating Usage; all other frontmatter and body are protected.
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const L = pageLabels[lang], p = page(lang);
  const emptyState = () => p.doc.querySelector('.jjs-wrap').dataset.empty;
  eq(lang + ': v2 initial seed reveals output', emptyState(), 'false');
  p.input(''); eq(lang + ': v2 empty input hides output', emptyState(), 'true');
  run(p); eq(lang + ': v2 valid input reveals output', emptyState(), 'false');
  run(p, invalidInput); eq(lang + ': v2 invalid input hides output', emptyState(), 'true');
  run(p); p.get('jjs-clear').click(); eq(lang + ': v2 Clear hides output', emptyState(), 'true');
  run(p); p.key('jjs-output'); eq(lang + ': v2 CtrlL hides output', emptyState(), 'true');
  run(p); copy(p).reject(Error('controlled failure')); await settle();
  eq(lang + ': v2 copy failure keeps output visible', emptyState(), 'false');
  copy(p).resolve(); await settle(); eq(lang + ': v2 same-result copy retry keeps output visible', emptyState(), 'false');
  eq(lang + ': v2 same tip keys', Object.keys(L.tips).sort().join(','), tipMap.map(x => x[2]).sort().join(','));
  for (const [id, about, key] of tipMap) {
    check(lang + ': v2 plain localized tip ' + id, typeof L[about] === 'string' && !!L[about].trim() && !/[<>]/.test(L[about]) && typeof L.tips[key] === 'string' && !!L.tips[key].trim() && !/[<>]/.test(L.tips[key]));
    eq(lang + ': v2 rendered tip ' + id, p.get('jjs-tip-' + id).textContent, L.tips[key]);
  }
  check(lang + ': v2 localized empty state', !!L.empty && layoutMarkup.includes('{L.empty}'));
  check(lang + ': v2 serialized data excludes all tips', !('tips' in runtimeLabels(lang)) && !('empty' in runtimeLabels(lang)) && Object.values(L.tips).every(tip => !p.doc.querySelector('.jjs-wrap').dataset.strings.includes(tip)));
  const mdx = readFileSync(join(root, 'src/content/tools/json-to-json-schema/' + lang + '.mdx'), 'utf8');
  const [, fm, body] = mdx.match(/^---\n([\s\S]*?\n)---\n([\s\S]*)$/);
  const stepsText = fm.match(/^steps:\n((?:  - .*\n)+)/m)[1];
  const steps = stepsText.trimEnd().split('\n').map(line => JSON.parse(line.slice(4)));
  check(lang + ': v2 steps bounds/order', steps.length > 0 && steps.length <= 8 && steps.every(x => [...x].length <= 280 && !/[<>]/.test(x)) && steps.reduce((n, x) => n + [...x].length, 0) <= 1200 && fm.indexOf('steps:') < fm.indexOf('faqItems:'));
  for (const key of ["inputJson", "clear", "copy"]) check(lang + ': v2 steps use actual ' + key, steps.join('\n').includes(L[key]));
  eq(lang + ': MDX content contract', contractProblems('json-to-json-schema', lang), '');
  // The page shows the schema with short objects on one line, so compare the parsed values.
  const schemaPairs = examplePairs(body, (b) => b.lang === 'json', (b) => b.lang === 'json' && /"\$schema"/.test(b.text));
  check(lang + ': has JSON → schema examples', schemaPairs.length > 0);
  eq(lang + ': each schema example equals the engine output', schemaPairs.filter(([a, b]) => JSON.stringify(JSON.parse(b.text)) !== JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', ...E.inferSchema(JSON.parse(a.text)) })).map(([, b]) => b.text), []);
  // {/* jjs-check: {"accepts": [...], "rejects": [...]} */} (spec optional): the first two json code blocks after the
  // marker are the input and the schema the engine generates from it (compared as parsed JSON); every value in
  // "accepts" must pass that schema and every value in "rejects" must fail it (Ajv draft-07).
  const notes = annotations(body, 'jjs-check');
  check(lang + ': has at least 2 jjs-check examples', notes.length >= 2, String(notes.length));
  notes.forEach((note, i) => {
    const blocks = fencedBlocks(note.after).filter((b) => b.lang === 'json');
    const tag = lang + ': jjs-check #' + (i + 1);
    if (blocks.length < 2) { check(tag + ' has input and schema blocks', false, String(blocks.length)); return; }
    const schema = { $schema: 'http://json-schema.org/draft-07/schema#', ...E.inferSchema(JSON.parse(blocks[0].text)) };
    eq(tag + ' schema equals the engine output', JSON.parse(blocks[1].text), schema);
    const validate = ajv.compile(schema);
    check(tag + ' input passes its schema', validate(JSON.parse(blocks[0].text)));
    for (const v of note.spec?.accepts ?? []) check(tag + ' accepts ' + JSON.stringify(v), validate(v), JSON.stringify(validate.errors));
    for (const v of note.spec?.rejects ?? []) check(tag + ' rejects ' + JSON.stringify(v), !validate(v));
  });
  check(lang + ': v2 no duplicate Usage', !/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>|^## How to/m.test(body));
  try { await compileMdx(body); check(lang + ': v2 MDX compiles', true); } catch (e) { check(lang + ': v2 MDX compiles', false, e.message); }
  for (const shellFirst of [false, true]) for (const focus of ['output', 'copy-tip']) {
    const q = page(lang, shellFirst); run(q);
    q.key(focus === 'output' ? q.get('jjs-output') : q.doc.querySelector('[data-zt-tip="jjs-tip-copy"]'));
    check(lang + ': v2 result CtrlL focus ' + shellFirst + '/' + focus, q.doc.activeElement === q.get('jjs-input') && !q.get('jjs-input').value && !output(q) && !status(q).textContent && q.clears.length === 1);
  }
}
try {
  const require = createRequire(import.meta.url);
  const { transform: astroTransform } = await import(require.resolve('@astrojs/compiler', { paths: [dirname(require.resolve('astro'))] }));
  const compiled = await astroTransform(source, { filename: 'JsonToJsonSchemaTool.astro' });
  check('v2 Astro compiler has no error diagnostics', !compiled.diagnostics.some(d => d.severity === 1), JSON.stringify(compiled.diagnostics));
  await esbuildTransform(compiled.code, { loader: 'ts' }); check('v2 generated Astro module parses', true);
} catch (e) { check('v2 Astro compilation', false, e.message); }
check('v2 dark error ancestors are global', css.includes(':global(:root:not([data-theme="light"]))') && css.includes(':global([data-theme="dark"])'));


console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
