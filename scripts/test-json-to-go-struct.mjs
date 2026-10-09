// JSON to Go Struct — the structs compile, pass go vet, and decode the sample without losing fields
//
// Read:  src/components/tools/JsonToGoStructTool.astro (extracts the real engine block
//        src/layouts/ToolLayout.astro (the real shared keyboard listener in the page VM);
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); src/content/tools/json-to-go-struct/{en,zh,ja,ko}.mdx
// Write: stdout; one Go program per case under os.tmpdir() (removed at the end)
// Exit:  0 if all PASS, 1 if any FAIL
//
// When `go` is installed (local, GitHub ubuntu runners), each generated set of structs is put
// in a program that decodes the sample with encoding/json and DisallowUnknownFields, so a JSON
// key without a field (a field lost from a shared struct) is an error, and so is a decimal
// number such as 19.0 in an int field. The program is checked with `go vet` and run. Without
// Go those checks are SKIP and only the text of the output is checked. Cases: two nested
// objects with the same key and different fields, the same shape twice, 19.0 and 1e3 as
// float64, int and float mixed in one array or key, field names that cannot start an exported
// Go identifier (2fa, non-ASCII), two keys that give the same field name (user_id, userId),
// keys that a struct tag cannot name ("" and keys with a double quote), keys named
// constructor, top-level arrays, and the examples on the tool pages.
//
// Run: node scripts/test-json-to-go-struct.mjs

import vm from 'node:vm';
import { createHash } from 'node:crypto';

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToGoStructTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JsonToGoStructTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { parseJson, generateGo };')();

let failures = 0;
let passes = 0;
let skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}

const haveGo = spawnSync('go', ['version']).status === 0;
if (!haveGo) console.log('SKIP: go not installed; generated code is not compiled');
const tmp = mkdtempSync(join(tmpdir(), 'jgs-test-'));
let n = 0;
function gen(json, rootName = 'RootObject') {
  return E.generateGo(E.parseJson(json), rootName).code;
}
function decodes(name, json, opts = {}) {
  const code = gen(json);
  if (!haveGo) { skips++; return code; }
  const isArray = Array.isArray(JSON.parse(json));
  const program = [
    'package main',
    '',
    'import (',
    '\t"bytes"',
    '\t"encoding/json"',
    '\t"fmt"',
    '\t"os"',
    ')',
    '',
    code,
    '',
    'const sample = ' + JSON.stringify(json),
    '',
    'func main() {',
    '\tdec := json.NewDecoder(bytes.NewReader([]byte(sample)))',
    opts.allowUnknown ? '' : '\tdec.DisallowUnknownFields()',
    '\tvar v ' + (isArray ? '[]RootObject' : 'RootObject'),
    '\tif err := dec.Decode(&v); err != nil {',
    '\t\tfmt.Fprintln(os.Stderr, err)',
    '\t\tos.Exit(1)',
    '\t}',
    '}',
  ].join('\n');
  const dir = join(tmp, 'c' + (++n));
  spawnSync('mkdir', ['-p', dir]);
  writeFileSync(join(dir, 'main.go'), program);
  const env = { ...process.env, GO111MODULE: 'off', GOFLAGS: '' };
  const vet = spawnSync('go', ['vet', 'main.go'], { cwd: dir, encoding: 'utf8', env });
  check(name + ': go vet passes', vet.status === 0, vet.stderr + '\n' + code);
  const run = spawnSync('go', ['run', 'main.go'], { cwd: dir, encoding: 'utf8', env });
  check(name + ': decodes the sample' + (opts.allowUnknown ? '' : ' with DisallowUnknownFields'), run.status === 0, run.stderr + '\n' + code);
  return code;
}

// ---------- the reported defect: two nested objects with the same key ----------
{
  const code = decodes('a.meta and b.meta differ', '{"a":{"meta":{"x":1}},"b":{"meta":{"y":"s"}}}');
  check('a.meta keeps X', /type Meta struct \{\n\tX int `json:"x"`\n\}/.test(code), code);
  check('b.meta gets its own struct', /type BMeta struct \{\n\tY string `json:"y"`\n\}/.test(code), code);
}
{
  const code = decodes('same shape twice', '{"a":{"meta":{"x":1}},"b":{"meta":{"x":2}}}');
  eq('identical shapes share one struct', (code.match(/type \w*Meta struct/g) || []).length, 1);
}
decodes('array items with the same name', '{"a":{"items":[{"p":1}]},"b":{"items":[{"q":"x"}]}}');
{
  const code = decodes('nested key equal to the root name', '{"rootObject":{"z":1},"k":2}');
  check('the root keeps its name', /^type RootObject struct \{/.test(code), code);
}

// ---------- numbers: the reported 19.0 → int ----------
{
  const code = decodes('19.0 is float64', '{"price":19.0,"qty":3,"big":1e3,"neg":-0.0}');
  check('price float64', /Price float64 `json:"price"`/.test(code), code);
  check('qty int', /Qty int `json:"qty"`/.test(code), code);
  check('1e3 float64', /Big float64 `json:"big"`/.test(code), code);
}
{
  const code = decodes('int and float in one array', '{"values":[1,2.5,3]}');
  check('mixed numbers become []float64', /Values \[\]float64/.test(code), code);
}
{
  const code = decodes('int and float under one key in array items', '[{"v":1},{"v":2.5}]');
  check('merged key becomes float64', /V float64/.test(code), code);
}
eq('float root', gen('2.0'), 'type RootObject = float64');

// ---------- field names ----------
{
  const code = decodes('keys that cannot start an exported identifier', '{"2fa":true,"名前":"x","_id":1,"a-b":2,"type":"t"}');
  check('2fa field is exported', /\tX2fa bool `json:"2fa"`/.test(code), code);
  check('non-ASCII key gets an exported name', /\tX名前 string `json:"名前"`/.test(code), code);
}
{
  const code = decodes('two keys give the same field name', '{"user_id":1,"userId":2,"UserID":3}');
  check('field names are unique', new Set(code.match(/^\t\w+/gm)).size === 3, code);
}
{
  const code = decodes('keys a struct tag cannot name', '{"":1,"a\\"b":2,"ok":3}', { allowUnknown: true });
  check('empty key is listed in a comment', code.includes('// JSON key "" cannot be named in a struct tag'), code);
  check('key with a double quote is listed in a comment', code.includes('// JSON key "a\\"b" cannot be named in a struct tag'), code);
}
decodes('prototype key names', '{"constructor":{"a":1},"toString":"x","items":[{"constructor":1,"hasOwnProperty":2},{"constructor":3,"hasOwnProperty":4}]}');
decodes('top-level array', '[{"sku":"A1","qty":2},{"sku":"B2","note":"gift"}]');
decodes('nulls and nested arrays', '{"a":null,"b":[[1,2],[3]],"c":[{"d":null},{"d":{"e":1}}]}');

// ---------- tool page examples ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/json-to-go-struct/' + lang + '.mdx'), 'utf8');
  const re = /```json\n([\s\S]*?)\n```\s*\n[^`]*```go\n(type [\s\S]*?)\n```/g;
  let m;
  let count = 0;
  while ((m = re.exec(mdx))) {
    count++;
    eq(lang + ': example ' + count + ' output', gen(m[1]), m[2]);
  }
  check(lang + ': page has at least three examples', count >= 3, String(count));
}

// ---------- facts stated in the FAQ (nullable / json-tags, all four languages) ----------
eq('FAQ: a key that is only null becomes interface{}', gen('{"a":null}'), 'type RootObject struct {\n\tA interface{} `json:"a"`\n}');
eq('FAQ: null in some items and a value in others gives a pointer without omitempty', gen('[{"a":null},{"a":"x"}]'), 'type RootObject struct {\n\tA *string `json:"a"`\n}');
eq('FAQ: a key missing from some items gives a pointer with omitempty; a slice stays a slice', gen('[{"t":["a"],"n":1,"s":"x"},{"n":2}]'), 'type RootObject struct {\n\tT []string `json:"t,omitempty"`\n\tN int `json:"n"`\n\tS *string `json:"s,omitempty"`\n}');
check('FAQ: keys a struct tag cannot hold become comments', gen('{"":1,"a,b":2,"ok":3}').includes('// JSON key "a,b" cannot be named in a struct tag'));

rmSync(tmp, { recursive: true, force: true });
// Complete page lifecycle plus actual ToolLayout keyboard handler; DOM/clipboard/timers are boundary doubles.
const pageScript = source.slice(source.indexOf('(function () {'), source.indexOf('</script>', source.indexOf('(function () {')));
const pageLabels = vm.runInNewContext('(' + source.match(/const STRINGS = (\{[\s\S]*?\n\});/)[1] + ')');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes("document.addEventListener('keydown'")) throw Error('Shared shortcut not found');
const engineLines = source.slice(source.lastIndexOf('\n', startIndex) + 1, endIndex + END_MARK.length);
eq('page engine bytes including marker indentation', Buffer.byteLength(engineLines), 10240);
eq('page immutable engine SHA256', createHash('sha256').update(engineLines).digest('hex'), '8952aabbf23edcb1617b00851f52480e050f79bdfc0aee0e0fc9dd8a1c4387e5');
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const onUnhandled = reason => unhandled.push(String(reason));
process.on('unhandledRejection', onUnhandled);
function lifecyclePage(lang, shellFirst = false, extra = {}) {
  const copies = [], tracks = [], clears = [], downloads = [], blobs = new Map(), timers = new Map(), docEvents = {};
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
        && [...part.matchAll(/\[([\w-]+)="([^"]*)"\]/g)].every(m => el.attributes[m[1]] === m[2]);
    });
  }
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), attributes: {}, dataset: {}, listeners: {}, children: [], parentElement: null, className: '', value: '', textContent: '', checked: false }); }
    setAttribute(key, value) {
      this.attributes[key] = value;
      if (['id', 'type', 'value'].includes(key)) this[key] = value;
      if (key === 'class') this.className = value;
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    removeAttribute(key) { delete this.attributes[key]; }
    get classList() { const e = this; return { contains(c) { return e.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) e.className += ' ' + c; }, remove(c) { e.className = e.className.split(/\s+/).filter(v => v !== c).join(' '); } }; }
    appendChild(e) { this.children.push(e); e.parentElement = this; }
    querySelectorAll(s) { return descendants(this).filter(e => matches(e, s)); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    contains(e) { return this === e || descendants(this).includes(e); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type) { for (const fn of this.listeners[type] || []) fn.call(this, { target: this, type }); }
    click() { if (this.tagName === 'A') { downloads.push({ name: this.download, blob: blobs.get(this.href) }); return; } if (!this.disabled) this.dispatch('click'); }
    focus() { doc.activeElement = this; }
  }
  const body = new Element('body'), widget = new Element('section'); widget.className = 'tool-widget'; body.appendChild(widget);
  const markup = source.split('\n---')[1].split('<script')[0]
    .replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{L\.(\w+)\}>\{L\.tips\.(\w+)\}<\/Toggletip>/g, (_, id, about, tip) =>
      '<span class="zt-tip"><button type="button" data-zt-tip="' + id + '"></button><span id="' + id + '" role="note">' + escape(pageLabels[lang].tips[tip]) + '</span></span>')
    .replace(/=\{JSON\.stringify\(L\.(\w+)\)\}/g, (_, key) => '="' + escape(JSON.stringify(pageLabels[lang][key])) + '"')
    .replace(/=\{L\.(\w+)\}/g, (_, key) => '="' + escape(pageLabels[lang][key]) + '"')
    .replace(/\{L\.(\w+)\}/g, (_, key) => escape(pageLabels[lang][key]));
  const stack = [widget];
  for (const token of markup.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>|([^<]+)/g)) {
    if (token[3] !== undefined) { stack.at(-1).textContent += decode(token[3]).trim(); continue; }
    if (token[0].startsWith('</')) { if (stack.at(-1).tagName !== token[1].toUpperCase()) throw Error('Unbalanced real markup'); stack.pop(); continue; }
    const el = new Element(token[1]);
    for (const a of token[2].matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)) el.setAttribute(a[1], decode(a[2] ?? a[3]));
    stack.at(-1).appendChild(el);
    if (!['input', 'br', 'hr'].includes(token[1]) && !token[2].endsWith('/')) stack.push(el);
  }
  const get = id => { const el = descendants(body).find(e => e.id === id); if (!el) throw Error('Missing real ID ' + id); return el; };
  doc = { createElement: tag => new Element(tag), body, activeElement: body, getElementById: get, querySelector: s => body.querySelector(s), addEventListener(type, fn) { (docEvents[type] ||= []).push(fn); } };
  const context = { document: doc, _slug: 'json-to-go-struct', console, Blob, hljs: { highlightElement() {} },
    URL: { createObjectURL(blob) { const id = 'blob:' + blobs.size; blobs.set(id, blob); return id; }, revokeObjectURL() {} },
    trackTool: (...args) => tracks.push(args), ztPersist: { clear: slug => clears.push(slug) },
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); copies.push({ value, resolve, reject }); return promise; } } },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, due: now + ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
    ...extra,
  };
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(pageScript, context, { filename: 'JsonToGoStructTool.astro' });
  if (!shellFirst) vm.runInContext(shortcut, context);
  return { get, context, copies, tracks, clears, downloads, timers, doc,
    input(value) { get('jgs-input').value = value; get('jgs-input').dispatch('input'); },
    key(id = 'jgs-input', key = 'l', modifier = 'ctrlKey') { (typeof id === 'string' ? get(id) : id || body).focus(); const e = { key, [modifier]: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; for (const fn of docEvents.keydown || []) fn(e); return e; },
    advance(ms) { const end = now + ms; for (;;) { const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0]; if (!next) break; timers.delete(next[0]); now = next[1].due; next[1].fn(); } now = end; },
  };
}

const snapshot = p => JSON.stringify(['jgs-input', 'jgs-root-name', 'jgs-output-code', 'jgs-status', 'jgs-copy'].map(id => { const e = p.get(id); return [e.value, e.textContent, e.className, !!e.disabled]; }));
const golden = p => { p.input('{}'); p.advance(300); };
const goldenCode = "type RootObject struct {\n}";
const copy = p => { p.get('jgs-copy').click(); return p.copies.at(-1); };
const copyFailure = { en: 'Copy failed. Please copy the output manually.', zh: '复制失败，请手动复制输出。', ja: 'コピーに失敗しました。出力を手動でコピーしてください。', ko: '복사하지 못했습니다. 출력을 직접 복사하세요.' };
try {
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const L = pageLabels[lang], p = lifecyclePage(lang); golden(p);
    eq(lang + ': page golden complete bytes', p.get('jgs-output-code').textContent, goldenCode);
    eq(lang + ': localized current result', p.get('jgs-status').textContent, L.msgGenOne);
    p.get('jgs-root-name').value = 'Api'; p.get('jgs-root-name').dispatch('input'); p.advance(300);
    eq(lang + ': root still awaits Generate', p.get('jgs-output-code').textContent, goldenCode);
    p.get('jgs-convert').click();
    eq(lang + ': Generate applies root name', p.get('jgs-output-code').textContent.includes('Api'), true);
    p.get('jgs-clear').click();
    eq(lang + ': Clear preserves root name', p.get('jgs-root-name').value, 'Api');
    eq(lang + ': Clear removes derived state', !p.get('jgs-input').value && !p.get('jgs-output-code').textContent && !p.get('jgs-status').textContent, true);
    for (const shellFirst of [false, true]) for (const modifier of ['ctrlKey', 'metaKey']) {
      const q = lifecyclePage(lang, shellFirst); golden(q); q.input('{');
      q.key('jgs-copy', 'L', modifier);
      eq(lang + ': shared clear immediate ' + shellFirst + modifier, !q.get('jgs-input').value && !q.get('jgs-root-name').value && !q.get('jgs-output-code').textContent && !q.get('jgs-status').textContent, true);
      eq(lang + ': clear focuses input ' + shellFirst + modifier, q.doc.activeElement === q.get('jgs-input'), true);
      eq(lang + ': queued work cancelled ' + shellFirst + modifier, q.timers.size, 0);
      eq(lang + ': shared storage clear ' + shellFirst + modifier, q.clears.join(','), 'json-to-go-struct');
      q.advance(1);
      eq(lang + ': shared clear remains empty after deferred callbacks ' + shellFirst + modifier, !q.get('jgs-output-code').textContent && !q.get('jgs-status').textContent, true);
    }
    const outside = lifecyclePage(lang); golden(outside); const beforeOutside = snapshot(outside); outside.key(null); outside.advance(1); eq(lang + ': outside shortcut unchanged', snapshot(outside), beforeOutside);
    const invalid = lifecyclePage(lang); golden(invalid); invalid.input('{'); invalid.advance(300);
    eq(lang + ': error removes old result', invalid.get('jgs-output-code').textContent, '');
    eq(lang + ': invalid input is visibly marked', invalid.get('jgs-input').classList.contains('error'), true);

    invalid.input(''); invalid.advance(300);
    eq(lang + ': empty input removes error and status', !invalid.get('jgs-input').classList.contains('error') && !invalid.get('jgs-status').textContent && !invalid.get('jgs-output-code').textContent, true);
    const q = lifecyclePage(lang); golden(q);
    const good = copy(q); eq(lang + ': clipboard complete output bytes', good.value, goldenCode); good.resolve(); await settle(); eq(lang + ': copy success', q.get('jgs-copy').textContent, L.copied); q.advance(1500); eq(lang + ': current timer restores Copy', q.get('jgs-copy').textContent, L.copy);
    for (const failure of ['reject', 'missing']) {
      const beforeUnhandled = unhandled.length, clipboard = q.context.navigator.clipboard; let thrown = null;
      try { if (failure === 'missing') { q.context.navigator.clipboard = undefined; copy(q); } else copy(q).reject(Error('denied')); } catch (e) { thrown = e; }
      await settle(); eq(lang + ': copy ' + failure + ' does not throw', thrown, null); eq(lang + ': copy ' + failure + ' has translated failure', q.get('jgs-status').textContent, copyFailure[lang]); eq(lang + ': copy ' + failure + ' handled', unhandled.length, beforeUnhandled);
      q.context.navigator.clipboard = clipboard; const retry = copy(q); eq(lang + ': retry preserves bytes ' + failure, retry.value, goldenCode); retry.resolve(); await settle(); eq(lang + ': retry succeeds ' + failure, q.get('jgs-copy').textContent, L.copied); eq(lang + ': retry clears owned error ' + failure, q.get('jgs-status').textContent === copyFailure[lang], false);
    }
    for (const action of ["input", "clear", "shortcut", "result", "error", "example"]) for (const outcome of ['resolve', 'reject', 'timer']) {
      const r = lifecyclePage(lang); golden(r); const old = copy(r);
      if (outcome === 'timer') { old.resolve(); await settle(); }
      if (action === 'input') r.input('{"next":true}');
      if (action === 'root') { r.get('jgs-root-name').value = 'NewRoot'; r.get('jgs-root-name').dispatch('input'); }
      if (action === 'tab') r.doc.querySelector("[data-mode=\"typeddict\"]").click();
      if (action === 'clear') r.get('jgs-clear').click();
      if (action === 'shortcut') r.key();
      if (action === 'result') { r.input('{"next":true}'); r.get('jgs-convert').click(); }
      if (action === 'error') { r.input('{'); r.get('jgs-convert').click(); }
      if (action === 'example') r.get('jgs-example').click();
      const before = snapshot(r), rejectedBefore = unhandled.length;
      if (outcome === 'timer') r.advance(1500); else { old[outcome](Error('late')); await settle(); }
      if (outcome !== 'timer' || !['input', 'root'].includes(action)) eq(lang + ': stale ' + action + '/' + outcome, snapshot(r), before);
      else eq(lang + ': expired feedback after edit ' + action, r.get('jgs-copy').textContent, L.copy);
      eq(lang + ': stale rejection handled ' + action + '/' + outcome, unhandled.length, rejectedBefore);
    }
    const t = lifecyclePage(lang); golden(t); copy(t).resolve(); await settle(); t.advance(1000); copy(t).resolve(); await settle(); t.advance(500); eq(lang + ': old timer leaves newer feedback', t.get('jgs-copy').textContent, L.copied); t.advance(1000); eq(lang + ': new timer expires', t.get('jgs-copy').textContent, L.copy);
    const order = lifecyclePage(lang); golden(order); const first = copy(order), second = copy(order); second.reject(Error('current')); await settle(); first.resolve(); await settle(); eq(lang + ': older success keeps current copy failure', order.get('jgs-status').textContent, copyFailure[lang]); eq(lang + ': older success cannot claim copied', order.get('jgs-copy').textContent, L.copy);

  }
} finally { await settle(); process.removeListener('unhandledRejection', onUnhandled); }
eq('no unhandled clipboard rejections', unhandled.length, 0);


// ---------- v2 page layout ----------
const V2 = {
  "slug": "json-to-go-struct",
  "prefix": "jgs",
  "manual": true,
  "tips": [
    [
      "root-name",
      "rootName",
      "rootName"
    ],
    [
      "input",
      "jsonInput",
      "input"
    ],
    [
      "example",
      "example",
      "example"
    ],
    [
      "clear",
      "clear",
      "clear"
    ],
    [
      "copy",
      "copy",
      "copy"
    ],
    [
      "generate",
      "generate",
      "generate"
    ]
  ],
  "scriptSHA": "44515e40ae2995f2207878f7a878792eebebc412d01b414b48513ad680eb2119"
};
const hash = value => createHash('sha256').update(value).digest('hex');
const layoutMarkup = source.split('\n---')[1].split('<script')[0];
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const registration = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
const prefix = V2.prefix;
eq('v2 convert registration', new RegExp("'" + V2.slug + "':\\s*'convert'").test(registration), true);
eq('v2 original script preserved except removed redundant Generate listener and change-based analytics sent once per JSON and root name (S2-5), JSON errors in the page language and Copy disabled without output (S2-10)', hash(pageScript), V2.scriptSHA);
eq('v2 direct root', new RegExp('^\\s*<div\\s+class="' + prefix + '-wrap"').test(layoutMarkup), true);
eq('v2 root fills available height', css.includes('.' + prefix + '-wrap { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0;'), true);
eq('v2 control-status-panel reading order', layoutMarkup.indexOf('class="' + prefix + '-config"') < layoutMarkup.indexOf('class="' + prefix + '-actions"') && layoutMarkup.indexOf('class="' + prefix + '-actions"') < layoutMarkup.indexOf('id="' + prefix + '-status"') && layoutMarkup.indexOf('id="' + prefix + '-status"') < layoutMarkup.indexOf('class="' + prefix + '-panels zt-io"'), true);
eq('v2 two shared IO panes', (layoutMarkup.match(/\bzt-io-pane\b/g) || []).length, 2);
eq('v2 both editors fill panes', layoutMarkup.includes('id="' + prefix + '-input" class="zt-io-fill"') && layoutMarkup.includes('id="' + prefix + '-output" class="' + prefix + '-output zt-io-fill"'), true);
eq('v2 fixed status with internal overflow', css.includes('height: 2.8rem; flex: none; overflow: auto; overflow-wrap: anywhere;'), true);
eq('v2 bounded keyboard accessible output', layoutMarkup.includes('tabindex="0" aria-labelledby="' + prefix + '-output-label"') && css.includes('.' + prefix + '-output { margin: 0; overflow: auto; white-space: pre; }'), true);
eq('v2 actual output controls desktop empty hint', css.includes('.' + prefix + '-output-pane:has(#' + prefix + '-output-code:empty) .' + prefix + '-empty { display: flex; }'), true);
eq('v2 stacked empty pane hidden and result bounded', css.includes('@media (max-width: 860px)') && css.includes('.' + prefix + '-output-pane:has(#' + prefix + '-output-code:empty) { display: none; }') && css.includes('height: 22rem; min-height: 160px; resize: none;'), true);
eq('v2 phone input 144px and name inline', css.includes('height: 144px; min-height: 144px;') && css.includes('width: 100%; flex-direction: row; align-items: center;') && css.includes('@media (max-width: 640px)'), true);
eq('v2 44px actions', css.includes('.' + prefix + '-actions button, .' + prefix + '-panel-header button { min-height: 44px; }'), true);
eq('v2 dark ancestry global', css.includes(':global(:root:not([data-theme="light"]))') && css.includes(':global([data-theme="dark"])'), true);
eq('v2 tips remain build-time only', !/data-i18n|define:vars/.test(source) && !/STRINGS|L\.tips|\.tips\b/.test(pageScript), true);
eq('v2 exact actual tip count', (layoutMarkup.match(/<Toggletip\b/g) || []).length, V2.tips.length);
for (const [id, about, key] of V2.tips) eq('v2 exact tip binding ' + id, layoutMarkup.includes('<Toggletip id="' + prefix + '-tip-' + id + '" lang={lang} about={L.' + about + '}>{L.tips.' + key + '}</Toggletip>'), true);
const actualButtons = [...layoutMarkup.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map(m => m[1]).sort();
eq('v2 explicit buttons retained', actualButtons.join(','), ['clear','copy','example', ...(V2.manual ? ['convert'] : []), ...(prefix === 'jpdc' ? ['download'] : [])].map(id => prefix + '-' + id).sort().join(','));
if (!V2.manual) {
  eq('v2 no residual Generate label/action', !/generate:/.test(source) && !source.includes(prefix + '-convert') && !layoutMarkup.includes('btn-primary'), true);
  eq('v2 existing tab container shares segmented layout', layoutMarkup.includes(prefix + '-tabs zt-segmented'), true);
  eq('v2 selected segment contrasts in either theme', css.includes('.' + prefix + '-tab.active { background: var(--color-text); color: var(--color-bg); }'), true);
}
for (const lang of ['en','zh','ja','ko']) {
  const L = pageLabels[lang];
  eq(lang + ': v2 exact translated tip keys', Object.keys(L.tips).sort().join(','), V2.tips.map(t => t[2]).sort().join(','));
  for (const [id, about, key] of V2.tips) eq(lang + ': v2 localized plain tip ' + id, typeof L[about] === 'string' && !!L[about].trim() && !/[<>]/.test(L[about]) && typeof L.tips[key] === 'string' && !!L.tips[key].trim() && !/[<>]/.test(L.tips[key]), true);
  eq(lang + ': v2 localized empty text', typeof L.empty === 'string' && !!L.empty.trim() && layoutMarkup.includes('{L.empty}'), true);
  const p = lifecyclePage(lang), rootEl = p.doc.querySelector('.' + prefix + '-wrap');
  eq(lang + ': v2 only feedback forwarded', Object.keys(rootEl.dataset).sort().join(','), ['copy','copied','copyFailed','jsonParse','msgInvalidAt','msgInvalidJson','msgGenerated','msgGenOne','msgGenMany', ...(prefix === 'jkt' ? ['msgRootList'] : []), ...(prefix === 'jpdc' ? ['download'] : [])].sort().join(','));
  const mdx = readFileSync(join(root, 'src/content/tools/' + V2.slug + '/' + lang + '.mdx'), 'utf8');
  const [,fm,body] = mdx.match(/^---\n([\s\S]*?\n)---\n([\s\S]*)$/);
  const steps = fm.match(/^steps:\n((?:  - .*\n)+)/m)[1].trimEnd().split('\n').map(l => JSON.parse(l.slice(4)));
  eq(lang + ': v2 steps correspond to controls', steps.length, V2.tips.length);
  eq(lang + ': v2 step limits and order', fm.indexOf('steps:') < fm.indexOf('faqItems:') && steps.every(x => [...x].length <= 280 && !/[<>]/.test(x)) && steps.reduce((n,x) => n+[...x].length,0) <= 1200, true);
  for (const [, about] of V2.tips) eq(lang + ': v2 steps actual label ' + about, steps.join('\n').includes(L[about]), true);
  eq(lang + ': MDX content contract', contractProblems('json-to-go-struct', lang), '');
  eq(lang + ': v2 no duplicate usage', !/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body), true);
  for (const shellFirst of [false,true]) for (const focus of ['output','tip']) {
    const q = lifecyclePage(lang,shellFirst);golden(q);q.key(focus === 'output' ? q.get(prefix + '-output') : q.doc.querySelector('[data-zt-tip="' + prefix + '-tip-copy"]'));
    eq(lang + ': v2 output focus survives CtrlL ' + shellFirst + focus, q.doc.activeElement === q.get(prefix+'-input') && !q.get(prefix+'-input').value && !q.get(prefix+'-root-name').value && !q.get(prefix+'-output-code').textContent && !q.get(prefix+'-status').textContent && q.clears.length === 1, true);
  }
  const q=lifecyclePage(lang);golden(q);const n=q.tracks.length;q.key(prefix+'-input','Enter');eq(lang + ': v2 CtrlEnter main action',q.tracks.length-n,V2.manual?1:0);
  q.input('{"x":1}');q.key(prefix+'-input','Enter','metaKey');eq(lang + ': v2 MetaEnter main action',q.tracks.length-n,V2.manual?2:0);
  // Analytics: one event per committed change (input change, Generate, Example), not on load or per typing pause.
  const ga=lifecyclePage(lang);eq(lang + ': GA: page load sends nothing',ga.tracks.length,0);
  ga.input('{"a":1}');ga.advance(300);eq(lang + ': GA: typing pause sends nothing',ga.tracks.length,0);
  ga.get('jgs-input').dispatch('change');eq(lang + ': GA: committed change sends one generate event',JSON.stringify(ga.tracks),JSON.stringify([['json-to-go-struct','generate']]));
  ga.input('{"b":"x"}');ga.get('jgs-input').dispatch('change');eq(lang + ': GA: change before the debounce generates the new input first',[ga.get('jgs-output-code').textContent.includes('B string'),ga.tracks.length].join(),'true,2');ga.advance(300);eq(lang + ': GA: no second event after the debounce',ga.tracks.length,2);
  ga.input('{');ga.get('jgs-input').dispatch('change');eq(lang + ': GA: invalid input change sends nothing',ga.tracks.length,2);
  ga.get('jgs-convert').click();eq(lang + ': GA: Generate with invalid input sends nothing',ga.tracks.length,2);
  ga.get('jgs-example').click();eq(lang + ': GA: Example sends one event',ga.tracks.length,3);
  ga.get('jgs-convert').click();eq(lang + ': GA: Generate on the unchanged example sends nothing',ga.tracks.length,3);
  // One user action that fires both change (blur on mousedown) and click, or click (Ctrl/⌘+Enter) then change, counts once.
  const once=lifecyclePage(lang);once.input('{"c":1}');once.get('jgs-input').dispatch('change');once.get('jgs-convert').click();eq(lang + ': GA: change then Generate click sends one event',once.tracks.length,1);
  once.input('{"d":2}');once.key('jgs-input','Enter');once.get('jgs-input').dispatch('change');eq(lang + ': GA: Ctrl+Enter then change sends one event',once.tracks.length,2);
  once.get('jgs-root-name').value='Api';once.get('jgs-convert').click();eq(lang + ': GA: a new root name then Generate sends one event',once.tracks.length,3);
  once.get('jgs-clear').click();once.input('{"d":2}');once.get('jgs-root-name').value='Api';once.get('jgs-convert').click();eq(lang + ': GA: the same input after Clear sends again',once.tracks.length,4);
}


// ---------- invalid JSON: line, column and cause in the page language (S2-10) ----------
// Before S2-10 the status line showed "Invalid JSON: " and the browser's own parser message, in
// English on every page, with the position counted in the trimmed input. lineCol and
// jsonSyntaxError are copied verbatim from json-formatter-engine.js; the cause texts are the
// jsonParse texts of HarFileAnalyzerTool.astro and MarkdownTableGeneratorTool.astro (both compared).
// Copy is disabled whenever there is no output (before S2-10 it stayed enabled and did nothing).
{
  const fnSrc = (src, name) => {
    const lines = src.split('\n');
    const at = lines.findIndex((l) => new RegExp('^\\s*function ' + name + '\\(').test(l));
    if (at < 0) return '';
    const indent = lines[at].match(/^\s*/)[0];
    let end = at + 1;
    while (end < lines.length && lines[end] !== indent + '}') end++;
    return lines.slice(at, end + 1).map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l)).join('\n');
  };
  const stringsOf = (file, from = 0) => {
    const text = readFileSync(join(root, 'src/components/tools/' + file), 'utf8');
    const s0 = text.indexOf('const STRINGS = ', from);
    return new Function('return ' + text.slice(s0 + 'const STRINGS = '.length, text.indexOf('\n};', s0) + 2))();
  };
  const engineEnd = source.indexOf('/* ── engine:end ── */');
  const jsonEngine = readFileSync(join(root, 'src/components/tools/json-formatter-engine.js'), 'utf8');
  const rs = source.indexOf('/* ── json-reason:start ── */'), re = source.indexOf('/* ── json-reason:end ── */');
  eq('json-reason block sits outside the engine block', rs > engineEnd && re > rs, true);
  const reasonSrc = rs > 0 ? source.slice(rs, re) : '';
  for (const name of ['lineCol', 'jsonSyntaxError']) eq(name + ' is the same as in json-formatter-engine.js', fnSrc(reasonSrc, name) !== '' && fnSrc(reasonSrc, name) === fnSrc(jsonEngine, name), true);
  const codes = [...new Set([...fnSrc(jsonEngine, 'jsonSyntaxError').matchAll(/fail\('(\w+)'/g)].map((m) => m[1]))];
  const harStrings = stringsOf('HarFileAnalyzerTool.astro');
  const mtgSource = readFileSync(join(root, 'src/components/tools/MarkdownTableGeneratorTool.astro'), 'utf8');
  const mtgStrings = stringsOf('MarkdownTableGeneratorTool.astro', mtgSource.indexOf('strings:start'));
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const L = pageLabels[lang];
    eq(lang + ': jsonParse texts equal HarFileAnalyzerTool.astro', JSON.stringify(L.jsonParse), JSON.stringify(harStrings[lang].jsonParse));
    eq(lang + ': jsonParse texts equal MarkdownTableGeneratorTool.astro', JSON.stringify(L.jsonParse), JSON.stringify(mtgStrings[lang].jsonParse));
    eq(lang + ': a jsonParse text for every jsonSyntaxError code', codes.length > 10 && codes.every((c) => typeof L.jsonParse?.[c] === 'string'), true);
    eq(lang + ': msgInvalidAt starts with msgInvalidJson and has {line}, {col} and {reason}', typeof L.msgInvalidAt === 'string' && L.msgInvalidAt.startsWith(L.msgInvalidJson) && ['{line}', '{col}', '{reason}'].every((k) => L.msgInvalidAt.includes(k)), true);
  }
  const fill = (tpl, v) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : m));
  // [name, input as typed, line, column, cause, character]; positions counted by hand in the input as typed.
  const SAMPLES = [
    ['trailing comma', '{"a":1,}', 1, 7, 'trailingComma'],
    ['leading blank lines and spaces are counted', '\n\n  {"a": 1,\n}', 3, 10, 'trailingComma'],
    ['a byte order mark at the start is invisible and not counted', '\uFEFF{"a":1,}', 1, 7, 'trailingComma'],
    ['full-width colon', '{"a"：1}', 1, 5, 'fullWidth', '：'],
    ['curly quotes', '{“a”:1}', 1, 2, 'smartQuote', '“'],
    ['single quotes', "{'a': 1}", 1, 2, 'singleQuote'],
    ['cut off', '{"a": 1', 1, 8, 'unexpectedEnd'],
    ['Python True', '{"a": True}', 1, 7, 'badLiteral'],
    ['comment', '{"a": 1 // note\n}', 1, 9, 'comment'],
    ['two documents', '{"a":1}\n{"a":2}', 2, 1, 'extraData'],
  ];
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const L = pageLabels[lang];
    const fresh = lifecyclePage(lang);
    eq(lang + ': Copy is disabled before there is output', fresh.get('jgs-output-code').textContent === '' ? fresh.get('jgs-copy').disabled === true : true, true);
    for (const [name, input, line, col, code, ch] of SAMPLES) {
      const p = lifecyclePage(lang); golden(p);
      eq(lang + ': ' + name + ': Copy is enabled with output', p.get('jgs-copy').disabled, false);
      p.input(input); p.advance(300);
      const status = p.get('jgs-status').textContent;
      eq(lang + ': ' + name + ': line, column and cause', status, fill(L.msgInvalidAt, { line, col, reason: fill(L.jsonParse?.[code], { ch: ch ?? '' }) }));
      eq(lang + ': ' + name + ': output cleared, Copy disabled, input marked', p.get('jgs-output-code').textContent === '' && p.get('jgs-copy').disabled === true && p.get('jgs-input').classList.contains('error') && p.get('jgs-status').className.includes('error'), true);
      if (lang !== 'en') eq(lang + ': ' + name + ': no English parser message', /Unexpected|Expected|position|JSON input|token/.test(status), false);
    }
    const c = lifecyclePage(lang); golden(c); c.get('jgs-clear').click();
    eq(lang + ': Clear disables Copy', c.get('jgs-copy').disabled, true);
    // A failure that is not a SyntaxError (a browser limit, for example) keeps the browser's message.
    const fake = { parse: (s, r) => { if (s === '[[[') throw new RangeError('Maximum call stack size exceeded'); return JSON.parse(s, r); }, stringify: JSON.stringify };
    const f = lifecyclePage(lang, false, { JSON: fake }); f.input('[[['); f.advance(300);
    eq(lang + ': a RangeError from JSON.parse keeps the browser message', f.get('jgs-status').textContent, L.msgInvalidJson + 'Maximum call stack size exceeded');
  }
  // {/* jgs-error: {"input": "…"} */}: the status line for that input appears as inline code after it.
  const errorNote = {
    tag: 'jgs-error',
    min: 1,
    verify({ spec, after, lang }) {
      if (!spec || typeof spec.input !== 'string') return 'annotation needs {"input": "<text>"}';
      const p = lifecyclePage(lang); p.input(spec.input); p.advance(300);
      const status = p.get('jgs-status').textContent;
      if (!p.get('jgs-status').className.includes('error')) return 'not an error: ' + status;
      return after.includes('`' + status + '`') ? null : 'status line not shown: ' + status;
    },
  };
  for (const lang of ['en', 'zh', 'ja', 'ko']) eq(lang + ': jgs-error examples show the page status line', contractProblems('json-to-go-struct', lang, { annotations: [errorNote] }), '');
}

console.log(`\n${passes} passed, ${failures} failed` + (skips ? `, ${skips} skipped` : ''));
process.exit(failures ? 1 : 0);
