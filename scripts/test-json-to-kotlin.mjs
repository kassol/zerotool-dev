// JSON to Kotlin — generated kotlinx.serialization classes compile and decode the sample
//
// Read:  src/components/tools/JsonToKotlinTool.astro (extracts the real engine block between the
//        src/layouts/ToolLayout.astro (the real shared keyboard listener in the page VM);
//        `engine:start` / `engine:end` markers, so this test cannot drift from the shipped source);
//        src/content/tools/json-to-kotlin/*.mdx (the input / output <pre> pair after each {/* kt: … */} marker)
// Write: a temporary directory under os.tmpdir() (Kotlin sources, sample JSON, compiled classes;
//        removed afterwards) when a Kotlin compiler is available; stdout (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers the reported defects: null, empty arrays and mixed types produced `Any` / `Any?`, which
// have no serializer, so `@Serializable` classes failed to compile; integers above Int.MAX_VALUE
// stayed `Int`; `Int` and `Double` together became `Any`; nested objects with the same key name
// shared the first object's class. Now: JsonElement for unknown types (kotlinx.serialization
// "Json elements" guide), Int / Long / Double by range, numbers widen, `19.0` is Double (JSON.parse
// source text access), PaymentMeta-style names, imports, keywords in backticks, @SerialName with
// Kotlin string escapes, empty objects as `class X`, names that would hide List / String,
// root arrays and scalars.
//
// Compile check: when KOTLINC points at a kotlinc binary (or `kotlinc` is on PATH) and
// KOTLINX_SERIALIZATION_CLASSPATH lists the kotlinx-serialization-core-jvm and -json-jvm jars, every
// generated file is compiled with the serialization plugin from the same Kotlin distribution, then
// run: each sample is decoded with the default `Json` (unknown keys are errors) and encoded again;
// for single-object samples the re-encoded JSON must equal the input. Otherwise SKIP (CI has no
// Kotlin toolchain).
//
// Run: node scripts/test-json-to-kotlin.mjs

import vm from 'node:vm';
import { createHash } from 'node:crypto';

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToKotlinTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JsonToKotlinTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { generateKotlin, parseJson };')();

let failures = 0;
let passes = 0;
let skips = 0;
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
const gen = (json, rootName) => E.generateKotlin(E.parseJson(json), rootName || 'RootObject');
const has = (name, code, line) => check(name, code.split('\n').includes(line), 'missing line ' + JSON.stringify(line) + ' in\n' + code);
const lacks = (name, code, re) => check(name, !re.test(code), 'unexpected ' + re + ' in\n' + code);

const cases = []; // [name, json, rootName, roundTrip]
function add(name, json, rootName, roundTrip) { cases.push({ name, json, rootName: rootName || 'RootObject', roundTrip }); return gen(json, rootName); }

// ---------- the tool's example ----------
const EXAMPLE = JSON.stringify({
  id: 1, name: 'Alice', isActive: true, score: 9.5, tags: ['kotlin', 'json'],
  address: { city: 'London', zip: 'EC1A 1BB' },
  friends: [{ id: 2, name: 'Bob' }, { id: 3, name: 'Carol' }],
  metadata: null,
}, null, 2);
{
  const r = add('example', EXAMPLE, null, true);
  eq('example: exact output', r.code.split('\n'), [
    'import kotlinx.serialization.Serializable',
    'import kotlinx.serialization.json.JsonElement',
    '',
    '@Serializable',
    'data class RootObject(',
    '    val id: Int = 0,',
    '    val name: String = "",',
    '    val isActive: Boolean = false,',
    '    val score: Double = 0.0,',
    '    val tags: List<String> = emptyList(),',
    '    val address: Address = Address(),',
    '    val friends: List<FriendsItem> = emptyList(),',
    '    val metadata: JsonElement? = null',
    ')',
    '',
    '@Serializable',
    'data class Address(',
    '    val city: String = "",',
    '    val zip: String = ""',
    ')',
    '',
    '@Serializable',
    'data class FriendsItem(',
    '    val id: Int = 0,',
    '    val name: String = ""',
    ')',
  ]);
  eq('example: 3 classes', r.count, 3);
  lacks('example: no Any', r.code, /\bAny\b/);
}

// ---------- null, empty arrays, mixed types ----------
{
  const r = add('unknown types', '{"a": null, "b": [], "c": [1, "x"], "d": [null], "e": [1, null]}', null, true);
  has('null → JsonElement?', r.code, '    val a: JsonElement? = null,');
  has('[] → List<JsonElement>', r.code, '    val b: List<JsonElement> = emptyList(),');
  has('mixed array → List<JsonElement>', r.code, '    val c: List<JsonElement> = emptyList(),');
  has('[null] → List<JsonElement?>', r.code, '    val d: List<JsonElement?> = emptyList(),');
  has('[1, null] → List<Int?>', r.code, '    val e: List<Int?> = emptyList()');
  has('JsonElement import', r.code, 'import kotlinx.serialization.json.JsonElement');
  lacks('no Any', r.code, /\bAny\b/);
}
{
  const r = add('mixed field across items', '[{"v": 1}, {"v": "x"}, {"v": true}]', 'Row', false);
  has('mixed field → JsonElement with JsonNull default', r.code, '    val v: JsonElement = JsonNull');
  has('JsonNull import', r.code, 'import kotlinx.serialization.json.JsonNull');
  eq('root array type', r.rootType, 'List<Row>');
}

// ---------- numbers ----------
{
  const r = add('numbers', '{"small": 2147483647, "neg": -2147483648, "big": 3000000000, "huge": 1e20, "flt": 19.0, "exp": 1E3, "mix": [1, 2.5], "wide": [1, 3000000000]}', null, true);
  has('Int.MAX_VALUE stays Int', r.code, '    val small: Int = 0,');
  has('Int.MIN_VALUE stays Int', r.code, '    val neg: Int = 0,');
  has('3000000000 → Long', r.code, '    val big: Long = 0L,');
  has('1e20 → Double', r.code, '    val huge: Double = 0.0,');
  has('19.0 → Double', r.code, '    val flt: Double = 0.0,');
  has('1E3 → Double', r.code, '    val exp: Double = 0.0,');
  has('[1, 2.5] → List<Double>', r.code, '    val mix: List<Double> = emptyList(),');
  has('[1, 3000000000] → List<Long>', r.code, '    val wide: List<Long> = emptyList()');
}
{
  const r = add('Int and Double across items', '[{"price": 20}, {"price": 9.5}, {"price": null}]', 'Item', false);
  has('Int + Double + null → Double?', r.code, '    val price: Double? = null');
}

// ---------- names ----------
{
  const r = add('same key, different fields', '{"order": {"meta": {"id": 1}}, "payment": {"meta": {"method": "card"}}, "refund": {"meta": {"id": 7}}}', null, true);
  has('first meta → Meta', r.code, 'data class Meta(');
  has('second meta → PaymentMeta', r.code, 'data class PaymentMeta(');
  has('Payment uses PaymentMeta', r.code, '    val meta: PaymentMeta = PaymentMeta()');
  check('third meta with the same fields reuses Meta', (r.code.match(/data class Meta\(/g) || []).length === 1 && !/RefundMeta/.test(r.code), r.code);
}
{
  const r = add('keys', '{"user_name": "a", "2fa": true, "名前": "x", "a-b": 1, "$ref": "#", "class": 1, "in": 2, "fun": 3, "a_b": 4, "aB": 5, "q\\"x\\\\y\\f": 6}', null, true);
  has('snake_case → camelCase', r.code, '    @SerialName("user_name")');
  has('camelCase field', r.code, '    val userName: String = "",');
  has('leading digit gets _', r.code, '    val _2fa: Boolean = false,');
  has('non-ASCII name kept', r.code, '    val 名前: String = "",');
  has('$ escaped in SerialName', r.code, '    @SerialName("\\$ref")');
  has('keyword in backticks', r.code, '    val `class`: Int = 0,');
  has('keyword in backticks (in)', r.code, '    val `in`: Int = 0,');
  has('duplicate after conversion gets a number', r.code, '    val aB2: Int = 0,');
  has('quote, backslash and form feed escaped', r.code, '    @SerialName("q\\"x\\\\y\\u000c")');
}
{
  const r = add('reserved class names', '{"list": {"a": 1}, "string": {"b": 2}, "json_element": {"c": 3}}', null, true);
  has('list → ListValue', r.code, '    val list: ListValue = ListValue(),');
  has('string → StringValue', r.code, '    val string: StringValue = StringValue(),');
  has('json_element → JsonElementValue', r.code, '    val jsonElement: JsonElementValue = JsonElementValue()');
}
{
  const r = add('empty object', '{"settings": {}, "items": [[1, 2], [3]]}', null, true);
  has('empty object → plain class', r.code, 'class Settings');
  lacks('no empty data class', r.code, /data class Settings\(\)/);
  has('nested arrays', r.code, '    val items: List<List<Int>> = emptyList()');
}
{
  const r = add('root name sanitised', '{"a": 1}', 'my root', true);
  has('root name PascalCase', r.code, 'data class MyRoot(');
}

// ---------- roots ----------
{
  const r = add('root array mixed', '[{"a": 1}, 2]', 'Mixed', false);
  eq('array with objects and scalars decodes as List<JsonElement>', r.rootType, 'List<JsonElement>');
  const s = add('root scalar', '42', 'Answer', true);
  eq('scalar root → typealias', s.code, 'typealias Answer = Int');
  eq('typealias count 0', s.count, 0);
  const n = add('root null', 'null', 'Nothing2', true);
  eq('null root → JsonElement?', n.code, 'import kotlinx.serialization.json.JsonElement\n\ntypealias Nothing2 = JsonElement?');
  const l = add('root string array', '["a", "b"]', 'Tags', true);
  eq('string array root', l.code, 'typealias Tags = List<String>');
}

// ---------- examples on the tool pages ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/json-to-kotlin', lang + '.mdx'), 'utf8');
  const re = /\{\/\* kt: (\{.*?\}) \*\/\}\s*<pre><code>\{`([\s\S]*?)`\}<\/code><\/pre>[\s\S]*?<pre><code>\{`([\s\S]*?)`\}<\/code><\/pre>/g;
  const tpl = (t) => new Function('return `' + t + '`')();
  let m, n = 0;
  while ((m = re.exec(mdx))) {
    n++;
    const opt = JSON.parse(m[1]);
    const json = tpl(m[2]);
    const out = gen(json, opt.root).code;
    eq(lang + ' page example ' + n + ' matches the engine', tpl(m[3]), out);
    if (lang === 'en') cases.push({ name: 'page example ' + n, json, rootName: opt.root || 'RootObject', roundTrip: !!opt.roundTrip });
  }
  check(lang + ' page has at least 2 checked examples', n >= 2, n);
}

// ---------- 4-language labels ----------
{
  const keysOf = (l) => {
    const m = source.match(new RegExp('\\n  ' + l + ': \\{([\\s\\S]*?)\\n  \\}'));
    return m ? [...m[1].matchAll(/\n\s+(\w+):/g)].map((x) => x[1]).sort() : null;
  };
  const en = keysOf('en');
  for (const l of ['zh', 'ja', 'ko']) eq('label keys ' + l, keysOf(l), en);
}

// ---------- compile and run with kotlinc ----------
function findKotlinc() {
  if (process.env.KOTLINC && existsSync(process.env.KOTLINC)) return process.env.KOTLINC;
  const r = spawnSync('sh', ['-c', 'command -v kotlinc'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}
const kotlinc = findKotlinc();
const cpJars = (process.env.KOTLINX_SERIALIZATION_CLASSPATH || '').split(':').filter((p) => p && existsSync(p));
if (!kotlinc || cpJars.length < 2) {
  skips++;
  console.log('SKIP: kotlinc or kotlinx-serialization jars not available (set KOTLINC and KOTLINX_SERIALIZATION_CLASSPATH)');
} else {
  const home = dirname(dirname(execFileSync('sh', ['-c', 'readlink -f "$0" 2>/dev/null || python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$0"', kotlinc], { encoding: 'utf8' }).trim()));
  const plugin = ['kotlinx-serialization-compiler-plugin.jar', 'kotlin-serialization-compiler-plugin.jar']
    .map((f) => join(home, 'lib', f)).find(existsSync);
  const stdlib = join(home, 'lib', 'kotlin-stdlib.jar');
  const dir = mkdtempSync(join(tmpdir(), 'json-to-kotlin-'));
  try {
    const mainLines = ['import java.io.File', '', 'fun main(args: Array<String>) {', '    val dir = args[0]'];
    cases.forEach((c, i) => {
      const pkg = 'c' + i;
      const r = gen(c.json, c.rootName);
      const decodeFn = [
        '',
        'fun roundTrip(s: String): String {',
        '    val out = kotlinx.serialization.json.Json { encodeDefaults = true; explicitNulls = true }',
        '    val v = kotlinx.serialization.json.Json.decodeFromString(kotlinx.serialization.serializer<' + r.rootType + '>(), s)',
        '    return out.encodeToString(kotlinx.serialization.serializer<' + r.rootType + '>(), v)',
        '}',
      ].join('\n');
      writeFileSync(join(dir, pkg + '.kt'), 'package ' + pkg + '\n\n' + r.code + '\n' + decodeFn + '\n');
      writeFileSync(join(dir, pkg + '.json'), c.json);
      mainLines.push('    try { File("$dir/' + pkg + '.out").writeText(' + pkg + '.roundTrip(File("$dir/' + pkg + '.json").readText())) }');
      mainLines.push('    catch (e: Exception) { File("$dir/' + pkg + '.err").writeText(e.toString()) }');
    });
    mainLines.push('}');
    writeFileSync(join(dir, 'Main.kt'), mainLines.join('\n') + '\n');
    const kt = readdirSync(dir).filter((f) => f.endsWith('.kt')).map((f) => join(dir, f));
    const comp = spawnSync(kotlinc, ['-Xplugin=' + plugin, '-cp', cpJars.join(':'), '-d', join(dir, 'out'), ...kt],
      { encoding: 'utf8', maxBuffer: 1 << 26 });
    check('kotlinc compiles all ' + cases.length + ' generated files', comp.status === 0, (comp.stderr || '').split('\n').filter((l) => /error:/.test(l)).slice(0, 8).join('\n'));
    if (comp.status === 0) {
      const run = spawnSync('java', ['-cp', [join(dir, 'out'), stdlib, ...cpJars].join(':'), 'MainKt', dir], { encoding: 'utf8' });
      check('generated program runs', run.status === 0, run.stderr);
      cases.forEach((c, i) => {
        const err = join(dir, 'c' + i + '.err');
        check('decode ' + c.name, !existsSync(err), existsSync(err) ? readFileSync(err, 'utf8') : '');
        const out = join(dir, 'c' + i + '.out');
        if (c.roundTrip && existsSync(out)) {
          const back = JSON.parse(readFileSync(out, 'utf8'));
          check('round trip ' + c.name, isDeepStrictEqual(back, JSON.parse(c.json)), readFileSync(out, 'utf8'));
        }
      });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Complete page lifecycle plus actual ToolLayout keyboard handler; DOM/clipboard/timers are boundary doubles.
const pageScript = source.slice(source.indexOf('(function () {'), source.indexOf('</script>', source.indexOf('(function () {')));
const pageLabels = vm.runInNewContext('(' + source.match(/const labels = (\{[\s\S]*?\n\});/)[1] + ')');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes("document.addEventListener('keydown'")) throw Error('Shared shortcut not found');
const engineLines = source.slice(source.lastIndexOf('\n', startIndex) + 1, endIndex + END_MARK.length);
eq('page engine bytes including marker indentation', Buffer.byteLength(engineLines), 12253);
eq('page immutable engine SHA256', createHash('sha256').update(engineLines).digest('hex'), 'c9f8a7e4a45531a3206bc69e9bcbce3c5bfc87a2be08db5093a1fe35e4d34106');
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
  const context = { document: doc, _slug: 'json-to-kotlin', console, Blob, hljs: { highlightElement() {} },
    URL: { createObjectURL(blob) { const id = 'blob:' + blobs.size; blobs.set(id, blob); return id; }, revokeObjectURL() {} },
    trackTool: (...args) => tracks.push(args), ztPersist: { clear: slug => clears.push(slug) },
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); copies.push({ value, resolve, reject }); return promise; } } },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, due: now + ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
  };
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(pageScript, context, { filename: 'JsonToKotlinTool.astro' });
  if (!shellFirst) vm.runInContext(shortcut, context);
  return { get, context, copies, tracks, clears, downloads, timers, doc,
    input(value) { get('jkt-input').value = value; get('jkt-input').dispatch('input'); },
    key(id = 'jkt-input', key = 'l', modifier = 'ctrlKey') { (typeof id === 'string' ? get(id) : id || body).focus(); const e = { key, [modifier]: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; for (const fn of docEvents.keydown || []) fn(e); return e; },
    advance(ms) { const end = now + ms; for (;;) { const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0]; if (!next) break; timers.delete(next[0]); now = next[1].due; next[1].fn(); } now = end; },
  };
}

const snapshot = p => JSON.stringify(['jkt-input', 'jkt-root-name', 'jkt-output-code', 'jkt-status', 'jkt-copy'].map(id => { const e = p.get(id); return [e.value, e.textContent, e.className, !!e.disabled]; }));
const golden = p => { p.input('{}'); p.advance(300); };
const goldenCode = "import kotlinx.serialization.Serializable\n\n@Serializable\nclass RootObject";
const copy = p => { p.get('jkt-copy').click(); return p.copies.at(-1); };
const copyFailure = { en: 'Copy failed. Please copy the output manually.', zh: '复制失败，请手动复制输出。', ja: 'コピーに失敗しました。出力を手動でコピーしてください。', ko: '복사하지 못했습니다. 출력을 직접 복사하세요.' };
try {
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const L = pageLabels[lang], p = lifecyclePage(lang); golden(p);
    eq(lang + ': page golden complete bytes', p.get('jkt-output-code').textContent, goldenCode);
    eq(lang + ': localized current result', p.get('jkt-status').textContent, L.msgGenOne);
    p.get('jkt-root-name').value = 'Api'; p.get('jkt-root-name').dispatch('input'); p.advance(300);
    eq(lang + ': root still awaits Generate', p.get('jkt-output-code').textContent, goldenCode);
    p.get('jkt-convert').click();
    eq(lang + ': Generate applies root name', p.get('jkt-output-code').textContent.includes('Api'), true);
    p.get('jkt-clear').click();
    eq(lang + ': Clear preserves root name', p.get('jkt-root-name').value, 'Api');
    eq(lang + ': Clear removes derived state', !p.get('jkt-input').value && !p.get('jkt-output-code').textContent && !p.get('jkt-status').textContent, true);
    for (const shellFirst of [false, true]) for (const modifier of ['ctrlKey', 'metaKey']) {
      const q = lifecyclePage(lang, shellFirst); golden(q); q.input('{');
      q.key('jkt-copy', 'L', modifier);
      eq(lang + ': shared clear immediate ' + shellFirst + modifier, !q.get('jkt-input').value && !q.get('jkt-root-name').value && !q.get('jkt-output-code').textContent && !q.get('jkt-status').textContent, true);
      eq(lang + ': clear focuses input ' + shellFirst + modifier, q.doc.activeElement === q.get('jkt-input'), true);
      eq(lang + ': queued work cancelled ' + shellFirst + modifier, q.timers.size, 0);
      eq(lang + ': shared storage clear ' + shellFirst + modifier, q.clears.join(','), 'json-to-kotlin');
      q.advance(1);
      eq(lang + ': shared clear remains empty after deferred callbacks ' + shellFirst + modifier, !q.get('jkt-output-code').textContent && !q.get('jkt-status').textContent, true);
    }
    const outside = lifecyclePage(lang); golden(outside); const beforeOutside = snapshot(outside); outside.key(null); outside.advance(1); eq(lang + ': outside shortcut unchanged', snapshot(outside), beforeOutside);
    const invalid = lifecyclePage(lang); golden(invalid); invalid.input('{'); invalid.advance(300);
    eq(lang + ': error removes old result', invalid.get('jkt-output-code').textContent, '');
    eq(lang + ': invalid input is visibly marked', invalid.get('jkt-input').classList.contains('error'), true);

    invalid.input(''); invalid.advance(300);
    eq(lang + ': empty input removes error and status', !invalid.get('jkt-input').classList.contains('error') && !invalid.get('jkt-status').textContent && !invalid.get('jkt-output-code').textContent, true);
    const q = lifecyclePage(lang); golden(q);
    const good = copy(q); eq(lang + ': clipboard complete output bytes', good.value, goldenCode); good.resolve(); await settle(); eq(lang + ': copy success', q.get('jkt-copy').textContent, L.copied); q.advance(1500); eq(lang + ': current timer restores Copy', q.get('jkt-copy').textContent, L.copy);
    for (const failure of ['reject', 'missing']) {
      const beforeUnhandled = unhandled.length, clipboard = q.context.navigator.clipboard; let thrown = null;
      try { if (failure === 'missing') { q.context.navigator.clipboard = undefined; copy(q); } else copy(q).reject(Error('denied')); } catch (e) { thrown = e; }
      await settle(); eq(lang + ': copy ' + failure + ' does not throw', thrown, null); eq(lang + ': copy ' + failure + ' has translated failure', q.get('jkt-status').textContent, copyFailure[lang]); eq(lang + ': copy ' + failure + ' handled', unhandled.length, beforeUnhandled);
      q.context.navigator.clipboard = clipboard; const retry = copy(q); eq(lang + ': retry preserves bytes ' + failure, retry.value, goldenCode); retry.resolve(); await settle(); eq(lang + ': retry succeeds ' + failure, q.get('jkt-copy').textContent, L.copied); eq(lang + ': retry clears owned error ' + failure, q.get('jkt-status').textContent === copyFailure[lang], false);
    }
    for (const action of ["input", "clear", "shortcut", "result", "error", "example"]) for (const outcome of ['resolve', 'reject', 'timer']) {
      const r = lifecyclePage(lang); golden(r); const old = copy(r);
      if (outcome === 'timer') { old.resolve(); await settle(); }
      if (action === 'input') r.input('{"next":true}');
      if (action === 'root') { r.get('jkt-root-name').value = 'NewRoot'; r.get('jkt-root-name').dispatch('input'); }
      if (action === 'tab') r.doc.querySelector("[data-mode=\"typeddict\"]").click();
      if (action === 'clear') r.get('jkt-clear').click();
      if (action === 'shortcut') r.key();
      if (action === 'result') { r.input('{"next":true}'); r.get('jkt-convert').click(); }
      if (action === 'error') { r.input('{'); r.get('jkt-convert').click(); }
      if (action === 'example') r.get('jkt-example').click();
      const before = snapshot(r), rejectedBefore = unhandled.length;
      if (outcome === 'timer') r.advance(1500); else { old[outcome](Error('late')); await settle(); }
      if (outcome !== 'timer' || !['input', 'root'].includes(action)) eq(lang + ': stale ' + action + '/' + outcome, snapshot(r), before);
      else eq(lang + ': expired feedback after edit ' + action, r.get('jkt-copy').textContent, L.copy);
      eq(lang + ': stale rejection handled ' + action + '/' + outcome, unhandled.length, rejectedBefore);
    }
    const t = lifecyclePage(lang); golden(t); copy(t).resolve(); await settle(); t.advance(1000); copy(t).resolve(); await settle(); t.advance(500); eq(lang + ': old timer leaves newer feedback', t.get('jkt-copy').textContent, L.copied); t.advance(1000); eq(lang + ': new timer expires', t.get('jkt-copy').textContent, L.copy);
    const order = lifecyclePage(lang); golden(order); const first = copy(order), second = copy(order); second.reject(Error('current')); await settle(); first.resolve(); await settle(); eq(lang + ': older success keeps current copy failure', order.get('jkt-status').textContent, copyFailure[lang]); eq(lang + ': older success cannot claim copied', order.get('jkt-copy').textContent, L.copy);

  }
} finally { await settle(); process.removeListener('unhandledRejection', onUnhandled); }
eq('no unhandled clipboard rejections', unhandled.length, 0);

console.log(`\n${passes} passed, ${failures} failed${skips ? ', ' + skips + ' skipped' : ''}`);
process.exit(failures ? 1 : 0);
