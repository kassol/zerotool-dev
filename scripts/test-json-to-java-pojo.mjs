// JSON to Java POJO — type inference, number widening, page examples
//
// Read:  src/components/tools/JsonToJavaTool.astro (extracts the real engine block
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
      classList: { add() {}, remove() {} }, removeAttribute() {},
      addEventListener(event, fn) { this.handlers[event] = fn; } };
  }
  const elements = Object.fromEntries(['input', 'output-code', 'status', 'root-name', 'convert', 'example', 'clear', 'copy'].map((id) => ['jjp-' + id, element()]));
  elements['jjp-root-name'].value = rootName;
  const tabs = ['none', 'jackson', 'gson', 'lombok'].map((ann) => element({ ann }));
  const wrap = { dataset: { copy: 'Copy', copied: 'Copied', msgInvalidJson: 'Invalid JSON: ', msgGenerated: 'Generated.', msgGenOne: 'Generated 1 class.', msgGenMany: 'Generated {n} classes.' }, querySelectorAll: () => tabs };
  const script = source.slice(source.indexOf('(function () {'), source.indexOf('</script>', source.indexOf('(function () {')));
  new Function('document', 'window', 'hljs', 'navigator', 'setTimeout', 'clearTimeout', script)(
    { querySelector: () => wrap, getElementById: (id) => elements[id] }, {}, { highlightElement() {} }, {}, () => 0, () => {});
  elements['jjp-input'].value = json;
  tabs.find((tab) => tab.dataset.ann === mode).handlers.click();
  elements['jjp-convert'].handlers.click();
  return { code: elements['jjp-output-code'].textContent, status: elements['jjp-status'].textContent };
}

// A page session: the real client script with stubs, driven by input events and buttons.
function session() {
  function element(dataset = {}) {
    return { dataset, value: '', textContent: '', className: '', handlers: {}, disabled: false,
      classList: { add() {}, remove() {} }, removeAttribute() {},
      addEventListener(event, fn) { this.handlers[event] = fn; } };
  }
  const elements = Object.fromEntries(['input', 'output-code', 'status', 'root-name', 'convert', 'example', 'clear', 'copy'].map((id) => ['jjp-' + id, element()]));
  const tabs = ['none', 'jackson', 'gson', 'lombok'].map((ann) => element({ ann }));
  const wrap = { dataset: { copy: 'Copy', copied: 'Copied', msgInvalidJson: 'Invalid JSON: ', msgGenerated: 'Generated.', msgGenOne: 'Generated 1 class.', msgGenMany: 'Generated {n} classes.' }, querySelectorAll: () => tabs };
  const script = source.slice(source.indexOf('(function () {'), source.indexOf('</script>', source.indexOf('(function () {')));
  new Function('document', 'window', 'hljs', 'navigator', 'setTimeout', 'clearTimeout', script)(
    { querySelector: () => wrap, getElementById: (id) => elements[id] }, {}, { highlightElement() {} }, {}, (fn) => { fn(); return 0; }, () => {});
  const type = (text) => { elements['jjp-input'].value = text; elements['jjp-input'].handlers.input(); };
  const state = () => ({ code: elements['jjp-output-code'].textContent, status: elements['jjp-status'].textContent, copyDisabled: elements['jjp-copy'].disabled });
  return { type, state, click: (id) => elements['jjp-' + id].handlers.click() };
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

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
