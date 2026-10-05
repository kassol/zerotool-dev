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

rmSync(tmp, { recursive: true, force: true });
// Complete page lifecycle plus actual ToolLayout keyboard handler; DOM/clipboard/timers are boundary doubles.
const pageScript = source.slice(source.indexOf('(function () {'), source.indexOf('</script>', source.indexOf('(function () {')));
const pageLabels = vm.runInNewContext('(' + source.match(/const labels = (\{[\s\S]*?\n\});/)[1] + ')');
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
function lifecyclePage(lang, shellFirst = false) {
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

console.log(`\n${passes} passed, ${failures} failed` + (skips ? `, ${skips} skipped` : ''));
process.exit(failures ? 1 : 0);
