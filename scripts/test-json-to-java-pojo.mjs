// JSON to Java POJO — type inference, number widening, page examples
//
// Read:  src/components/tools/JsonToJavaTool.astro (extracts the real engine block
//        src/layouts/ToolLayout.astro (the real shared keyboard listener in the page VM);
//        between the `engine:start` / `engine:end` markers)
// Write: a temporary directory under os.tmpdir() when javac is available (removed); stdout
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: before the fix a field whose samples were 9.5 and 20 became Object, and whole numbers
// above 2,147,483,647 became int (javac rejects such a literal and Jackson fails on the value).
// Now int/long/double samples widen to the widest of them, integers outside the int range give
// long (boxed Long in lists), and other mixes stay Object. Also the Lombok example (root class
// first) and the Jackson order example on the tool pages. When javac is installed, the None-mode
// output of the order example and of the long/double sample is split into one file per class
// and compiled; otherwise SKIP.
//
// Naming (A-JAVA-NESTED-NAME, A-JAVA-IDENTIFIERS): the full client script runs with DOM stubs.
// Same key with another shape gets the parent prefix; keywords, digit-first names and names that
// collide compile. With JAVA_TEST_JARS pointing at a directory that holds jackson-core /
// -annotations / -databind 2.17.2, gson 2.11.0 and lombok 1.18.34, each mapping sample is
// compiled with javac; Jackson and Gson read the sample and write it back to equal JSON (Jackson
// writes the empty key under the field name, as the generated comment says); Lombok output
// compiles. Missing jars → SKIP. AB_TYPES_EVIDENCE=<dir> writes the generated sources there.
// The {/* jjp-check */} examples on the 4 tool pages are recomputed by the engine.
// Run: node scripts/test-json-to-java-pojo.mjs

import vm from 'node:vm';
import { createHash } from 'node:crypto';

import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, delimiter } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToJavaTool.astro'), 'utf8');
const a = source.indexOf('/* ── engine:start ── */');
const b = source.indexOf('/* ── engine:end ── */');
if (a < 0 || b <= a) { console.error('FAIL: engine block not found'); process.exit(1); }
const E = new Function(source.slice(a, b) + '\nreturn { buildClass, renderClasses, mergeTypes };')();

let passes = 0, failures = 0;
function eq(name, got, want) {
  if (got === want) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + '\n  got:      ' + JSON.stringify(got) + '\n  expected: ' + JSON.stringify(want)); }
}
function classes(json, rootName = 'RootObject') { const c = {}; E.buildClass(JSON.parse(json), rootName, c); return c; }
function gen(json, mode) { return E.renderClasses(classes(json), mode); }
function field(c, cls, name) { return (c[cls] || []).find((f) => f.fieldName === name)?.type; }

// Run the complete client IIFE, including the real convert() and tab handlers.
function page(json, mode = 'none', rootName = 'RootObject') {
  function element(dataset = {}) {
    return { dataset, value: '', textContent: '', className: '', handlers: {},
      classList: { add() {}, remove() {} }, removeAttribute() {}, focus() {}, click() { this.handlers.click?.(); },
      addEventListener(event, fn) { this.handlers[event] = fn; } };
  }
  const elements = Object.fromEntries(['input', 'output-code', 'status', 'root-name', 'convert', 'example', 'clear', 'copy'].map((id) => ['jjp-' + id, element()]));
  elements['jjp-root-name'].value = rootName;
  const tabs = ['none', 'jackson', 'gson', 'lombok'].map((ann) => element({ ann }));
  const wrap = { contains: el => !!el?.inside, dataset: { copy: 'Copy', copied: 'Copied', msgInvalidJson: 'Invalid JSON: ', msgGenerated: 'Generated.', msgGenOne: 'Generated 1 class.', msgGenMany: 'Generated {n} classes.' }, querySelectorAll: () => tabs };
  const script = source.slice(source.indexOf('(function () {'), source.indexOf('</script>', source.indexOf('(function () {')));
  new Function('document', 'window', 'hljs', 'navigator', 'setTimeout', 'clearTimeout', script)(
    { querySelector: () => wrap, getElementById: (id) => elements[id], addEventListener() {} }, {}, { highlightElement() {} }, {}, () => 0, () => {});
  elements['jjp-input'].value = json;
  tabs.find((tab) => tab.dataset.ann === mode).handlers.click();
  elements['jjp-convert'].handlers.click();
  return { code: elements['jjp-output-code'].textContent, status: elements['jjp-status'].textContent };
}

// A page session: the real client script with stubs, driven by input events and buttons.
function session() {
  const docHandlers = {};
  function element(dataset = {}) {
    return { dataset, value: '', textContent: '', className: '', handlers: {}, disabled: false,
      classList: { add() {}, remove() {} }, removeAttribute() {}, focus() {}, click() { this.handlers.click?.(); },
      addEventListener(event, fn) { this.handlers[event] = fn; } };
  }
  const elements = Object.fromEntries(['input', 'output-code', 'status', 'root-name', 'convert', 'example', 'clear', 'copy'].map((id) => ['jjp-' + id, element()]));
  const tabs = ['none', 'jackson', 'gson', 'lombok'].map((ann) => element({ ann }));
  const wrap = { contains: el => !!el?.inside, dataset: { copy: 'Copy', copied: 'Copied', msgInvalidJson: 'Invalid JSON: ', msgGenerated: 'Generated.', msgGenOne: 'Generated 1 class.', msgGenMany: 'Generated {n} classes.' }, querySelectorAll: () => tabs };
  const script = source.slice(source.indexOf('(function () {'), source.indexOf('</script>', source.indexOf('(function () {')));
  new Function('document', 'window', 'hljs', 'navigator', 'setTimeout', 'clearTimeout', script)(
    { activeElement: { inside: true }, querySelector: () => wrap, getElementById: (id) => elements[id], addEventListener: (t, fn) => (docHandlers[t] = docHandlers[t] || []).push(fn) }, {}, { highlightElement() {} }, {}, (fn) => { fn(); return 0; }, () => {});
  const type = (text) => { elements['jjp-input'].value = text; elements['jjp-input'].handlers.input(); };
  const state = () => ({ code: elements['jjp-output-code'].textContent, status: elements['jjp-status'].textContent, copyDisabled: elements['jjp-copy'].disabled });
  // ToolLayout's Ctrl/Cmd+L (src/layouts/ToolLayout.astro): when focus is inside the tool it sets every
  // textarea and text input to '' without input events, then other keydown listeners run.
  const shortcut = (init, focusInside = true) => {
    if (focusInside) { elements['jjp-input'].value = ''; elements['jjp-root-name'].value = ''; }
    wrap.contains = () => focusInside;
    for (const fn of docHandlers.keydown || []) fn({ key: 'l', ctrlKey: false, metaKey: false, preventDefault() {}, ...init });
  };
  return { type, state, shortcut, click: (id) => elements['jjp-' + id].handlers.click() };
}
{
  const s = session();
  eq('stale output: the seeded example renders and Copy is enabled', /public class RootObject/.test(s.state().code) && !s.state().copyDisabled, true);
  s.type('{"name": "Alice",');
  const bad = s.state();
  eq('stale output: invalid JSON clears the output', bad.code, '');
  eq('stale output: invalid JSON shows the error', bad.status.startsWith('Invalid JSON: '), true);
  eq('stale output: invalid JSON disables Copy', bad.copyDisabled, true);
  s.type('{"age": 30}');
  eq('stale output: the next valid input renders again', /private int age;/.test(s.state().code), true);
  eq('stale output: the next valid input enables Copy', s.state().copyDisabled, false);
  s.click('clear');
  eq('stale output: Clear empties the output and disables Copy', s.state().code === '' && s.state().copyDisabled, true);
  s.click('example');
  eq('stale output: Example enables Copy', s.state().copyDisabled, false);
  s.type('   ');
  eq('stale output: empty input disables Copy', s.state().code === '' && s.state().copyDisabled, true);
  const labels = new Function(source.slice(source.indexOf('const labels'), source.indexOf('const L = labels')) + '\nreturn labels;')();
  eq('stale output: the error prefix exists in 4 languages', ['en', 'zh', 'ja', 'ko'].every((l) => labels[l] && labels[l].msgInvalidJson && labels[l].msgInvalidJson.trim()), true);
}
{
  // Ctrl/Cmd+L: ToolLayout empties the fields without input events; the output must not stay.
  const s = session();
  s.shortcut({ ctrlKey: true });
  eq('Ctrl+L: the seeded output is cleared', s.state().code, '');
  eq('Ctrl+L: Copy is disabled', s.state().copyDisabled, true);
  eq('Ctrl+L: the status line is cleared', s.state().status, '');
  s.type('{"age": 30}');
  eq('Ctrl+L: the next input renders again and enables Copy', /private int age;/.test(s.state().code) && !s.state().copyDisabled, true);
  s.type('{"a":');
  s.shortcut({ metaKey: true, key: 'L' });
  eq('Cmd+L (key "L") after an error clears the error status', s.state().status, '');
  s.type('{"age": 30}');
  s.shortcut({ ctrlKey: true }, false);
  eq('Ctrl+L with focus outside the tool keeps the output', /private int age;/.test(s.state().code) && !s.state().copyDisabled, true);
  s.shortcut({ key: 'l' });
  eq('an L keydown without Ctrl/Cmd does not clear the output', /private int age;/.test(s.state().code) && !s.state().copyDisabled, true);
}

function compile(code, extraFiles = {}, classpath = '') {
  const dir = mkdtempSync(join(tmpdir(), 'pojo-test-'));
  try {
    const imports = code.match(/^import .*;$/gm) || [];
    const blocks = [...code.matchAll(/(?:@Data\n)?public class ([^\n{]+) \{[\s\S]*?^\}/gm)];
    if (!blocks.length) throw new Error('No classes were generated');
    const files = [];
    for (const block of blocks) {
      const name = /^[A-Za-z_$][\w$]*$/.test(block[1]) ? block[1] : 'Invalid' + files.length;
      const path = join(dir, name + '.java');
      writeFileSync(path, imports.join('\n') + '\n\n' + block[0]); files.push(path);
    }
    for (const [name, text] of Object.entries(extraFiles)) {
      const path = join(dir, name); writeFileSync(path, text); files.push(path);
    }
    execFileSync('javac', [...(classpath ? ['-cp', classpath] : []), '-d', dir, ...files], { encoding: 'utf8', timeout: 30000 });
    return extraFiles['RoundTrip.java'] ? execFileSync('java', ['-cp', dir + (classpath ? ':' + classpath : ''), 'RoundTrip'], { encoding: 'utf8', timeout: 30000 }).trim() : true;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const nestedRepro = '{"a":{"meta":{"x":1}},"b":{"meta":{"y":2}}}';
const identifierRepro = '{"class":1,"2fa":true,"first-name":"a","first_name":"b","a\\\"b":"c","":4}';
const minimalRepro = '{"a":{"m":{}},"b":{"m":{"x":1}}}';
eq('minimal nested regression keeps second shape', /private BM m;/.test(page(minimalRepro).code) && /private int x;/.test(page(minimalRepro).code), true);
eq('same nested shape reuses Meta', (page('{"a":{"meta":{"x":1}},"b":{"meta":{"x":2}}}').code.match(/public class Meta /g) || []).length, 1);
const nestedPage = page(nestedRepro);
eq('A-JAVA-NESTED-NAME: real convert keeps b.meta.y', /private BMeta meta;/.test(nestedPage.code) && /public class BMeta \{\n    private int y;/.test(nestedPage.code), true);
try { eq('A-JAVA-IDENTIFIERS: real convert output compiles', compile(page(identifierRepro, 'none', '2 root').code), true); }
catch (e) { eq('A-JAVA-IDENTIFIERS: real convert output compiles', String(e.stderr || e.message), true); }
if (process.env.AB_TYPES_EVIDENCE) {
  mkdirSync(process.env.AB_TYPES_EVIDENCE, { recursive: true });
  writeFileSync(join(process.env.AB_TYPES_EVIDENCE, 'nested.java.txt'), nestedPage.code);
  writeFileSync(join(process.env.AB_TYPES_EVIDENCE, 'identifiers.java.txt'), page(identifierRepro, 'jackson', '2 root').code);
}

const mappingSamples = [
  ['identifiers', identifierRepro, '2 root'],
  ['accessors', '{"uRL":"a","URL":"b","isActive":true,"active":false,"getClass":1}', 'RootObject'],
  ['escaping', JSON.stringify({ 'a\\b': 1, 'a\nb': 2, 'a\u0000b': 3, 'a\\u000ab': 4 }), 'RootObject'],
  ['type names', '{"string":{"value":1},"list":{"value":true},"rootObject":{"value":"x"},"constructor":{"meta":{"x":1}},"toString":{"meta":{"y":2}}}', 'RootObject'],
  ['three shapes', '{"a":{"meta":{"x":1}},"b":{"meta":{"y":2}},"c":{"meta":{"z":3}}}', 'RootObject'],
  ['deep duplicate', '{"meta":{"meta":{"x":1}}}', 'Meta'],
  ['reordered shapes', '{"a":{"meta":{"x":1,"y":2}},"b":{"meta":{"y":3,"x":4}}}', 'RootObject'],
  ['symbols', JSON.stringify({ 'ü': 1, _: 2, $x: 3, aBC: 4, Ab: 5, 'données': { x: [1.5, 2.5] }, list: [{ v: 1, w: 'a' }, { w: 'b', v: 2 }], 'Class': true }), 'RootObject']
];
const JAR_FILES = ['jackson-core-2.17.2.jar', 'jackson-annotations-2.17.2.jar', 'jackson-databind-2.17.2.jar', 'gson-2.11.0.jar', 'lombok-1.18.34.jar'];
const missingJars = process.env.JAVA_TEST_JARS ? JAR_FILES.filter((f) => !existsSync(join(process.env.JAVA_TEST_JARS, f))) : JAR_FILES;
if (process.env.JAVA_TEST_JARS && missingJars.length) console.log('SKIP fixed Jackson/Gson/Lombok (JAVA_TEST_JARS lacks ' + missingJars.join(', ') + ')');
else if (process.env.JAVA_TEST_JARS) {
  const jars = process.env.JAVA_TEST_JARS;
  const jacksonCp = ['core', 'annotations', 'databind'].map((part) => join(jars, `jackson-${part}-2.17.2.jar`)).join(delimiter);
  const gsonCp = join(jars, 'gson-2.11.0.jar');
  for (const [name, json, rootName] of mappingSamples) {
    for (const [mode, cp] of [['jackson', jacksonCp], ['gson', gsonCp]]) {
      const code = page(json, mode, rootName).code;
      const actualRoot = code.match(/public class (\w+)/)[1];
      // Jackson cannot write an empty property name (@JsonProperty("") means the default name):
      // the generator reads "" through @JsonAlias and states that it is written under the field name.
      let expected = json;
      const emptyNote = code.match(/\/\/ Jackson reads the empty key "" but writes this field as "(\w+)"/);
      if (mode === 'jackson' && emptyNote) {
        const obj = JSON.parse(json);
        expected = JSON.stringify(Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === '' ? emptyNote[1] : k, v])));
      }
      const roundTrip = mode === 'jackson'
        ? `String expected = ${JSON.stringify(expected)};\ncom.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();\nObject value = mapper.readValue(input, ${actualRoot}.class);\nSystem.out.print(mapper.readTree(expected).equals(mapper.readTree(mapper.writeValueAsString(value))));`
        : `com.google.gson.Gson gson = new com.google.gson.Gson();\nObject value = gson.fromJson(input, ${actualRoot}.class);\nSystem.out.print(com.google.gson.JsonParser.parseString(input).equals(com.google.gson.JsonParser.parseString(gson.toJson(value))));`;
      try {
        if (mode === 'jackson' && json.includes('"":')) eq('jackson empty key is read via @JsonAlias and the limit is stated', Boolean(emptyNote) && /@JsonAlias\(""\)/.test(code), true);
        eq(`${mode} ${name}: original keys and values round-trip`, compile(code, {
          'RoundTrip.java': `public class RoundTrip { public static void main(String[] args) throws Exception { String input = ${JSON.stringify(json)}; ${roundTrip} } }`
        }, cp), 'true');
      } catch (e) { eq(`${mode} ${name}: original keys and values round-trip`, String(e.stderr || e.message), 'true'); }
      if (process.env.AB_TYPES_EVIDENCE) writeFileSync(join(process.env.AB_TYPES_EVIDENCE, `${mode}-${name.replaceAll(' ', '-')}.java.txt`), code);
    }
    try { eq(`Lombok ${name}: generated code compiles`, compile(page(json, 'lombok', rootName).code, {}, join(jars, 'lombok-1.18.34.jar')), true); }
    catch (e) { eq(`Lombok ${name}: generated code compiles`, String(e.stderr || e.message), true); }
  }
} else { console.log('SKIP fixed Jackson/Gson/Lombok (set JAVA_TEST_JARS to the external fixed jars directory)'); }

eq('mergeTypes int+double', E.mergeTypes(['int', 'double']), 'double');
eq('mergeTypes int+long', E.mergeTypes(['int', 'long']), 'long');
eq('mergeTypes int+String', E.mergeTypes(['int', 'String']), 'Object');
eq('mergeTypes single', E.mergeTypes(['boolean']), 'boolean');

const order = '{"order_id": 9007, "customer": {"name": "Alice", "vip": true}, "items": [{"sku": "A-1", "qty": 2, "price": 9.5}, {"sku": "B-2", "qty": 1, "price": 20}], "note": null}';
const oc = classes(order);
eq('price 9.5 and 20 → double', field(oc, 'ItemsItem', 'price'), 'double');
eq('qty stays int', field(oc, 'ItemsItem', 'qty'), 'int');
eq('null → Object', field(oc, 'RootObject', 'note'), 'Object');
eq('class order', Object.keys(oc).join(','), 'RootObject,Customer,ItemsItem');
eq('jackson annotation for order_id', /@JsonProperty\("order_id"\)\n    private int orderId;/.test(gen(order, 'jackson')), true);

const big = classes('{"id": 1730000000000, "small": 7, "neg": -2147483649, "edge": 2147483647, "scores": [1, 2.5], "ids": [1, 1730000000000], "mixed": [1, "a"]}');
eq('millisecond timestamp → long', field(big, 'RootObject', 'id'), 'long');
eq('small → int', field(big, 'RootObject', 'small'), 'int');
eq('below int range → long', field(big, 'RootObject', 'neg'), 'long');
eq('2147483647 → int', field(big, 'RootObject', 'edge'), 'int');
eq('[1, 2.5] → List<Double>', field(big, 'RootObject', 'scores'), 'List<Double>');
eq('[1, 1730000000000] → List<Long>', field(big, 'RootObject', 'ids'), 'List<Long>');
eq('[1, "a"] → List<Object>', field(big, 'RootObject', 'mixed'), 'List<Object>');

eq('Lombok page example', gen('{"user": {"first_name": "Alice", "age": 30}, "tags": ["admin"]}', 'lombok'),
  'import java.util.List;\nimport lombok.Data;\n\n@Data\npublic class RootObject {\n    private User user;\n    private List<String> tags;\n}\n\n@Data\npublic class User {\n    private String firstName;\n    private int age;\n}');

// Tool pages show the same examples
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, `src/content/tools/json-to-java-pojo/${lang}.mdx`), 'utf8');
  eq(lang + ' page shows price as double', mdx.includes('    private double price;') && !mdx.includes('private Object price'), true);
  eq(lang + ' page Lombok example starts with RootObject', /@Data\\npublic class RootObject[\s\S]*@Data\\npublic class User/.test(mdx), true);
}

// {/* jjp-check: {"json": …, "mode": …} */}: the next code block is the input JSON and the first
// later block with a class is the shown output. Shown lines (minus blank and // comment lines)
// must appear in that order in the generated output.
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, `src/content/tools/json-to-java-pojo/${lang}.mdx`), 'utf8');
  let count = 0;
  for (const m of mdx.matchAll(/\{\/\* jjp-check: (\{.*\}) \*\/\}/g)) {
    count++;
    const spec = JSON.parse(m[1]);
    const blocks = [...mdx.slice(m.index).matchAll(/<pre><code>\{`([\s\S]*?)`\}<\/code><\/pre>/g)].map((x) => x[1]);
    eq(`${lang} jjp-check ${count}: input block`, JSON.stringify(JSON.parse(blocks[0])), JSON.stringify(JSON.parse(spec.json)));
    const shown = blocks.find((x) => x.includes('public class')).split('\n').filter((l) => l.trim() && !l.trim().startsWith('//'));
    const out = gen(spec.json, spec.mode).split('\n');
    let at = 0, missing = null;
    for (const line of shown) { while (at < out.length && out[at] !== line) at++; if (at === out.length) { missing = line; break; } at++; }
    eq(`${lang} jjp-check ${count}: shown output is the generated output`, missing, null);
  }
  eq(`${lang} page has the naming example`, count >= 1, true);
}

let hasJavac = true;
try { execFileSync('javac', ['-version'], { stdio: 'ignore' }); } catch { hasJavac = false; }
if (!hasJavac) {
  console.log('SKIP javac compile (javac not installed)');
} else {
  for (const [name, json] of [['order', order], ['numbers', '{"id": 1730000000000, "scores": [1, 2.5], "price": [{"v": 1}, {"v": 2.5}]}']]) {
    const dir = mkdtempSync(join(tmpdir(), 'pojo-test-'));
    try {
      const out = gen(json, 'none');
      const imports = out.match(/^import .*;$/gm) || [];
      const blocks = out.split(/\n\n(?=public class )/).filter((x) => /^public class /.test(x));
      const files = [];
      for (const blk of blocks) {
        const cls = blk.match(/^public class (\w+)/)[1];
        const f = join(dir, cls + '.java');
        writeFileSync(f, imports.join('\n') + '\n\n' + blk + '\n');
        files.push(f);
      }
      let ok = true;
      try { execFileSync('javac', ['-d', dir, ...files], { stdio: 'pipe' }); } catch (e) { ok = false; console.log(String(e.stderr)); }
      eq('javac compiles the ' + name + ' example (' + files.length + ' files)', ok, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// Complete page lifecycle plus actual ToolLayout keyboard handler; DOM/clipboard/timers are boundary doubles.
const pageScript = source.slice(source.indexOf('(function () {'), source.indexOf('</script>', source.indexOf('(function () {')));
const pageLabels = vm.runInNewContext('(' + source.match(/const labels = (\{[\s\S]*?\n\});/)[1] + ')');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes("document.addEventListener('keydown'")) throw Error('Shared shortcut not found');
const engineLines = source.slice(source.lastIndexOf('\n', a) + 1, b + '/* ── engine:end ── */'.length);
eq('page engine bytes including marker indentation', Buffer.byteLength(engineLines), 12872);
eq('page immutable engine SHA256', createHash('sha256').update(engineLines).digest('hex'), '512bd7dfbd595e60277c2769afb69d6c923cc646b75757691797ab9975b1c02f');
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
  const context = { document: doc, _slug: 'json-to-java-pojo', console, Blob, hljs: { highlightElement() {} },
    URL: { createObjectURL(blob) { const id = 'blob:' + blobs.size; blobs.set(id, blob); return id; }, revokeObjectURL() {} },
    trackTool: (...args) => tracks.push(args), ztPersist: { clear: slug => clears.push(slug) },
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); copies.push({ value, resolve, reject }); return promise; } } },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, due: now + ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
  };
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(pageScript, context, { filename: 'JsonToJavaTool.astro' });
  if (!shellFirst) vm.runInContext(shortcut, context);
  return { get, context, copies, tracks, clears, downloads, timers, doc,
    input(value) { get('jjp-input').value = value; get('jjp-input').dispatch('input'); },
    key(id = 'jjp-input', key = 'l', modifier = 'ctrlKey') { (typeof id === 'string' ? get(id) : id || body).focus(); const e = { key, [modifier]: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; for (const fn of docEvents.keydown || []) fn(e); return e; },
    advance(ms) { const end = now + ms; for (;;) { const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0]; if (!next) break; timers.delete(next[0]); now = next[1].due; next[1].fn(); } now = end; },
  };
}

const snapshot = p => JSON.stringify(['jjp-input', 'jjp-root-name', 'jjp-output-code', 'jjp-status', 'jjp-copy'].map(id => { const e = p.get(id); return [e.value, e.textContent, e.className, !!e.disabled]; }));
const golden = p => { p.input('{}'); p.advance(300); };
const goldenCode = "public class RootObject {\n}";
const copy = p => { p.get('jjp-copy').click(); return p.copies.at(-1); };
const copyFailure = { en: 'Copy failed. Please copy the output manually.', zh: '复制失败，请手动复制输出。', ja: 'コピーに失敗しました。出力を手動でコピーしてください。', ko: '복사하지 못했습니다. 출력을 직접 복사하세요.' };
try {
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const L = pageLabels[lang], p = lifecyclePage(lang); golden(p);
    eq(lang + ': page golden complete bytes', p.get('jjp-output-code').textContent, goldenCode);
    eq(lang + ': localized current result', p.get('jjp-status').textContent, L.msgGenOne);
    p.get('jjp-root-name').value = 'Api'; p.get('jjp-root-name').dispatch('input'); p.advance(300);
    eq(lang + ': root changes automatically convert', p.get('jjp-output-code').textContent.includes('Api'), true);
    p.get('jjp-convert').click();
    eq(lang + ': Generate applies root name', p.get('jjp-output-code').textContent.includes('Api'), true);
    p.get('jjp-clear').click();
    eq(lang + ': Clear preserves root name', p.get('jjp-root-name').value, 'Api');
    eq(lang + ': Clear removes derived state', !p.get('jjp-input').value && !p.get('jjp-output-code').textContent && !p.get('jjp-status').textContent, true);
    for (const shellFirst of [false, true]) for (const modifier of ['ctrlKey', 'metaKey']) {
      const q = lifecyclePage(lang, shellFirst); golden(q); q.input('{');
      q.key('jjp-copy', 'L', modifier);
      eq(lang + ': shared clear immediate ' + shellFirst + modifier, !q.get('jjp-input').value && !q.get('jjp-root-name').value && !q.get('jjp-output-code').textContent && !q.get('jjp-status').textContent, true);
      eq(lang + ': clear focuses input ' + shellFirst + modifier, q.doc.activeElement === q.get('jjp-input'), true);
      eq(lang + ': queued work cancelled ' + shellFirst + modifier, q.timers.size, 0);
      eq(lang + ': shared storage clear ' + shellFirst + modifier, q.clears.join(','), 'json-to-java-pojo');
      q.advance(1);
      eq(lang + ': shared clear remains empty after deferred callbacks ' + shellFirst + modifier, !q.get('jjp-output-code').textContent && !q.get('jjp-status').textContent, true);
    }
    const outside = lifecyclePage(lang); golden(outside); const beforeOutside = snapshot(outside); outside.key(null); outside.advance(1); eq(lang + ': outside shortcut unchanged', snapshot(outside), beforeOutside);
    const invalid = lifecyclePage(lang); golden(invalid); invalid.input('{'); invalid.advance(300);
    eq(lang + ': error removes old result', invalid.get('jjp-output-code').textContent, '');
    eq(lang + ': invalid input is visibly marked', invalid.get('jjp-input').classList.contains('error'), true);

    invalid.input(''); invalid.advance(300);
    eq(lang + ': empty input removes error and status', !invalid.get('jjp-input').classList.contains('error') && !invalid.get('jjp-status').textContent && !invalid.get('jjp-output-code').textContent, true);
    const q = lifecyclePage(lang); golden(q);
    const good = copy(q); eq(lang + ': clipboard complete output bytes', good.value, goldenCode); good.resolve(); await settle(); eq(lang + ': copy success', q.get('jjp-copy').textContent, L.copied); q.advance(1500); eq(lang + ': current timer restores Copy', q.get('jjp-copy').textContent, L.copy);
    for (const failure of ['reject', 'missing']) {
      const beforeUnhandled = unhandled.length, clipboard = q.context.navigator.clipboard; let thrown = null;
      try { if (failure === 'missing') { q.context.navigator.clipboard = undefined; copy(q); } else copy(q).reject(Error('denied')); } catch (e) { thrown = e; }
      await settle(); eq(lang + ': copy ' + failure + ' does not throw', thrown, null); eq(lang + ': copy ' + failure + ' has translated failure', q.get('jjp-status').textContent, copyFailure[lang]); eq(lang + ': copy ' + failure + ' handled', unhandled.length, beforeUnhandled);
      q.context.navigator.clipboard = clipboard; const retry = copy(q); eq(lang + ': retry preserves bytes ' + failure, retry.value, goldenCode); retry.resolve(); await settle(); eq(lang + ': retry succeeds ' + failure, q.get('jjp-copy').textContent, L.copied); eq(lang + ': retry clears owned error ' + failure, q.get('jjp-status').textContent === copyFailure[lang], false);
    }
    for (const action of ["input", "clear", "shortcut", "result", "error", "example", "root", "tab"]) for (const outcome of ['resolve', 'reject', 'timer']) {
      const r = lifecyclePage(lang); golden(r); const old = copy(r);
      if (outcome === 'timer') { old.resolve(); await settle(); }
      if (action === 'input') r.input('{"next":true}');
      if (action === 'root') { r.get('jjp-root-name').value = 'NewRoot'; r.get('jjp-root-name').dispatch('input'); }
      if (action === 'tab') r.doc.querySelector("[data-ann=\"lombok\"]").click();
      if (action === 'clear') r.get('jjp-clear').click();
      if (action === 'shortcut') r.key();
      if (action === 'result') { r.input('{"next":true}'); r.get('jjp-convert').click(); }
      if (action === 'error') { r.input('{'); r.get('jjp-convert').click(); }
      if (action === 'example') r.get('jjp-example').click();
      const before = snapshot(r), rejectedBefore = unhandled.length;
      if (outcome === 'timer') r.advance(1500); else { old[outcome](Error('late')); await settle(); }
      if (outcome !== 'timer' || !['input', 'root'].includes(action)) eq(lang + ': stale ' + action + '/' + outcome, snapshot(r), before);
      else eq(lang + ': expired feedback after edit ' + action, r.get('jjp-copy').textContent, L.copy);
      eq(lang + ': stale rejection handled ' + action + '/' + outcome, unhandled.length, rejectedBefore);
    }
    const t = lifecyclePage(lang); golden(t); copy(t).resolve(); await settle(); t.advance(1000); copy(t).resolve(); await settle(); t.advance(500); eq(lang + ': old timer leaves newer feedback', t.get('jjp-copy').textContent, L.copied); t.advance(1000); eq(lang + ': new timer expires', t.get('jjp-copy').textContent, L.copy);
    const order = lifecyclePage(lang); golden(order); const first = copy(order), second = copy(order); second.reject(Error('current')); await settle(); first.resolve(); await settle(); eq(lang + ': older success keeps current copy failure', order.get('jjp-status').textContent, copyFailure[lang]); eq(lang + ': older success cannot claim copied', order.get('jjp-copy').textContent, L.copy);
    const d = lifecyclePage(lang); eq(lang + ': original initial sample remains', d.get('jjp-input').value.includes('Alice') && d.get('jjp-output-code').textContent.includes('public class RootObject'), true); golden(d); d.doc.querySelector('[data-ann="lombok"]').click(); eq(lang + ': annotation click converts immediately', d.get('jjp-output-code').textContent, 'import lombok.Data;\n\n@Data\npublic class RootObject {\n}');
  }
} finally { await settle(); process.removeListener('unhandledRejection', onUnhandled); }
eq('no unhandled clipboard rejections', unhandled.length, 0);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
