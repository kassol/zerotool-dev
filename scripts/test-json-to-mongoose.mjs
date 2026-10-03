// JSON to Mongoose Schema — generated code parses, page examples
//
// Read:  src/components/tools/JsonToMongooseTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers); node_modules/typescript
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: before the fix keys that are not JavaScript identifiers ("release-date", "a b", "2fa")
// were written bare into the schema object and the TypeScript interface, so the output did not
// parse. They are now quoted (JSON.stringify). JavaScript output is parsed with `new Function`,
// TypeScript output with the TypeScript compiler's syntactic diagnostics (transpileModule).
// Also the two examples on the en tool page (JavaScript with timestamps; TypeScript with
// required on), ISO date-time strings → Date, plain dates → String.
//
// Inference (A-MONGOOSE-ARRAY-INFERENCE): every sample of a field decides its type; null is
// skipped (all null → Mixed); different types → Mixed, ISO date-time + other string → String;
// arrays mixing objects and scalars → [Mixed]. Naming (A-MONGOOSE-NESTED-NAME): same key with
// another shape gets the parent key as prefix (bMetaSchema), same shape shares one schema, the
// root name is reserved. The {/* jtm-check */} examples on the 4 tool pages are recomputed.
// With MONGOOSE_TEST_DIR pointing at a directory where require('mongoose') gives 9.10.3, each
// RUNTIME sample is run through the generated JavaScript: validateSync() passes and every field
// and value comes back (keys compared sorted, generated _id dropped only where the sample has
// none, ISO strings on Date paths compared as toISOString()). Otherwise SKIP; no database.
// AB_TYPES_EVIDENCE=<dir> writes generated files there.
// Run: node scripts/test-json-to-mongoose.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToMongooseTool.astro'), 'utf8');
const a = source.indexOf('/* ── engine:start ── */');
const b = source.indexOf('/* ── engine:end ── */');
if (a < 0 || b <= a) { console.error('FAIL: engine block not found'); process.exit(1); }
const E = new Function(source.slice(a, b) + '\nreturn { buildRootSchema, renderOutput, toCamelCase, toPascalCase };')();

let passes = 0, failures = 0;
function eq(name, got, want) {
  if (got === want) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + '\n  got:      ' + JSON.stringify(got) + '\n  expected: ' + JSON.stringify(want)); }
}
function gen(json, model, mode, timestamps, required) {
  function element(dataset = {}) {
    return { dataset, value: '', textContent: '', className: '', handlers: {},
      classList: { add() {}, remove() {} }, removeAttribute() {},
      addEventListener(event, fn) { this.handlers[event] = fn; } };
  }
  const elements = Object.fromEntries(['input', 'output-code', 'status', 'model-name', 'convert', 'example', 'clear', 'copy'].map((id) => ['jtm-' + id, element()]));
  elements['jtm-model-name'].value = model;
  const groups = {
    '#jtm-lang-tabs .jtm-tab': ['javascript', 'typescript'].map((lang) => element({ lang })),
    '#jtm-ts-tabs .jtm-tab': [true, false].map((ts) => element({ ts: String(ts) })),
    '#jtm-req-tabs .jtm-tab': [false, true].map((req) => element({ req: String(req) }))
  };
  const wrap = { dataset: { copy: 'Copy', copied: 'Copied', msgInvalidJson: 'Invalid JSON: ', msgGenOne: 'Generated 1 schema.', msgGenMany: 'Generated {n} schemas.' }, querySelectorAll: (selector) => groups[selector] };
  const script = source.slice(source.indexOf('(function () {'), source.indexOf('</script>', source.indexOf('(function () {')));
  new Function('document', 'window', 'hljs', 'navigator', 'setTimeout', 'clearTimeout', script)(
    { querySelector: () => wrap, getElementById: (id) => elements[id] }, {}, { highlightElement() {} }, {}, () => 0, () => {});
  elements['jtm-input'].value = json;
  groups['#jtm-lang-tabs .jtm-tab'].find((tab) => tab.dataset.lang === mode).handlers.click();
  groups['#jtm-ts-tabs .jtm-tab'].find((tab) => tab.dataset.ts === String(timestamps)).handlers.click();
  groups['#jtm-req-tabs .jtm-tab'].find((tab) => tab.dataset.req === String(required)).handlers.click();
  elements['jtm-convert'].handlers.click();
  return elements['jtm-output-code'].textContent;
}
// A page session: the real client script with stubs, driven by input events and buttons.
function session() {
  function element(dataset = {}) {
    return { dataset, value: '', textContent: '', className: '', handlers: {}, disabled: false,
      classList: { add() {}, remove() {} }, removeAttribute() {},
      addEventListener(event, fn) { this.handlers[event] = fn; } };
  }
  const elements = Object.fromEntries(['input', 'output-code', 'status', 'model-name', 'convert', 'example', 'clear', 'copy'].map((id) => ['jtm-' + id, element()]));
  const groups = {
    '#jtm-lang-tabs .jtm-tab': ['javascript', 'typescript'].map((lang) => element({ lang })),
    '#jtm-ts-tabs .jtm-tab': [true, false].map((ts) => element({ ts: String(ts) })),
    '#jtm-req-tabs .jtm-tab': [false, true].map((req) => element({ req: String(req) }))
  };
  const wrap = { dataset: { copy: 'Copy', copied: 'Copied', msgInvalidJson: 'Invalid JSON: ', msgGenOne: 'Generated 1 schema.', msgGenMany: 'Generated {n} schemas.' }, querySelectorAll: (selector) => groups[selector] };
  const script = source.slice(source.indexOf('(function () {'), source.indexOf('</script>', source.indexOf('(function () {')));
  new Function('document', 'window', 'hljs', 'navigator', 'setTimeout', 'clearTimeout', script)(
    { querySelector: () => wrap, getElementById: (id) => elements[id] }, {}, { highlightElement() {} }, {}, (fn) => { fn(); return 0; }, () => {});
  const type = (text) => { elements['jtm-input'].value = text; elements['jtm-input'].handlers.input(); };
  const state = () => ({ code: elements['jtm-output-code'].textContent, status: elements['jtm-status'].textContent, copyDisabled: elements['jtm-copy'].disabled });
  return { type, state, click: (id) => elements['jtm-' + id].handlers.click() };
}
{
  const s = session();
  eq('stale output: the seeded example renders and Copy is enabled', /new Schema\(/.test(s.state().code) && !s.state().copyDisabled, true);
  s.type('{"name": "Alice",');
  const bad = s.state();
  eq('stale output: invalid JSON clears the output', bad.code, '');
  eq('stale output: invalid JSON shows the error', bad.status.startsWith('Invalid JSON: '), true);
  eq('stale output: invalid JSON disables Copy', bad.copyDisabled, true);
  s.type('{"age": 30}');
  eq('stale output: the next valid input renders again', /age: (\{ type: )?Number/.test(s.state().code), true);
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
function parsesAsJs(code) { try { new Function(code); return true; } catch (e) { return e.message; } }
function parsesAsTs(code) {
  const r = ts.transpileModule(code, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext } });
  return r.diagnostics.length === 0 ? true : r.diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ');
}

const PAGE_JS = '{"username": "alice", "age": 28, "tags": ["admin"], "address": {"city": "London"}}';
eq('page example (JavaScript, timestamps on)', gen(PAGE_JS, 'User', 'javascript', true, false),
  "const mongoose = require('mongoose');\nconst { Schema } = mongoose;\n\nconst addressSchema = new Schema({\n  city: { type: String },\n});\n\nconst userSchema = new Schema({\n  username: { type: String },\n  age: { type: Number },\n  tags: [String],\n  address: addressSchema,\n}, { timestamps: true });\n\nmodule.exports = mongoose.model('User', userSchema);");

const PAGE_TS = '{"sku":"A-1","price":9.5,"created_at":"2026-10-01T09:30:00Z","release-date":"2026-10-01","variants":[{"color":"red","stock":3},{"color":"blue","size":"M"}],"meta":null}';
const tsOut = gen(PAGE_TS, 'product', 'typescript', true, true);
eq('page example (TypeScript, required on)', tsOut,
  "import mongoose, { Document, Schema } from 'mongoose';\n\nexport interface IVariants {\n  color: string;\n  stock: number;\n  size: string;\n}\n\nexport interface IProduct extends Document {\n  sku: string;\n  price: number;\n  created_at: Date;\n  \"release-date\": string;\n  variants: IVariants[];\n  meta: any;\n}\n\nconst variantsSchema = new Schema({\n  color: { type: String, required: true },\n  stock: { type: Number, required: true },\n  size: { type: String, required: true },\n});\n\nconst productSchema = new Schema<IProduct>({\n  sku: { type: String, required: true },\n  price: { type: Number, required: true },\n  created_at: { type: Date, required: true },\n  \"release-date\": { type: String, required: true },\n  variants: [variantsSchema],\n  meta: { type: mongoose.Schema.Types.Mixed, required: true },\n}, { timestamps: true });\n\nexport default mongoose.model<IProduct>('Product', productSchema);");
eq('page TypeScript example parses', parsesAsTs(tsOut), true);

const awkward = '{"release-date": "x", "a b": 1, "2fa": true, "$ok": 1, "_id2": 2, "nested": {"x-y": [1, 2]}, "list": [{"k-1": null}]}';
for (const mode of ['javascript', 'typescript']) {
  for (const req of [false, true]) {
    const out = gen(awkward, 'Doc', mode, false, req);
    eq(`${mode} required=${req}: non-identifier keys are quoted and the output parses`, mode === 'javascript' ? parsesAsJs(out) : parsesAsTs(out), true);
  }
}
const js = gen(awkward, 'Doc', 'javascript', false, false);
eq('"release-date" quoted', js.includes('  "release-date": { type: String },'), true);
eq('$ok and _id2 stay bare', js.includes('  $ok: { type: Number },') && js.includes('  _id2: { type: Number },'), true);
eq('"2fa" quoted', js.includes('  "2fa": { type: Boolean },'), true);

eq('null is skipped: null then string → String', gen('[{"v": null}, {"v": "x"}]', 'T', 'javascript', false, false).includes('v: { type: String },'), true);

const nestedRepro = '{"a":{"meta":{"x":1}},"b":{"meta":{"y":2}}}';
const arrayRepro = '[{"value":1,"parts":[{"x":1},"keep",2,null,[3]]},{"value":"two","parts":[{"y":2}]}]';
eq('A-MONGOOSE-ARRAY-INFERENCE: all root samples decide value type', gen(arrayRepro, 'Sample', 'javascript', false, false).includes('value: { type: mongoose.Schema.Types.Mixed },'), true);
eq('A-MONGOOSE-ARRAY-INFERENCE: heterogeneous arrays use Mixed', gen(arrayRepro, 'Sample', 'javascript', false, false).includes('parts: [mongoose.Schema.Types.Mixed],'), true);
eq('A-MONGOOSE-NESTED-NAME: real convert keeps b.meta.y', /const bMetaSchema = new Schema\(\{\n  y:/.test(gen(nestedRepro, 'Sample', 'javascript', false, false)), true);

// {/* jtm-check: {"json", "model", "mode", "timestamps", "required"} */}: the next code block is the
// input JSON and the one after it the full output, both as on the page.
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, `src/content/tools/json-to-mongoose/${lang}.mdx`), 'utf8');
  let count = 0;
  for (const m of mdx.matchAll(/\{\/\* jtm-check: (\{.*\}) \*\/\}/g)) {
    count++;
    const spec = JSON.parse(m[1]);
    const blocks = [...mdx.slice(m.index).matchAll(/<pre><code>\{`([\s\S]*?)`\}<\/code><\/pre>/g)].map((x) => new Function('return `' + x[1] + '`')());
    eq(`${lang} jtm-check ${count}: input block`, blocks[0], spec.json);
    eq(`${lang} jtm-check ${count}: output block`, blocks[1], gen(spec.json, spec.model, spec.mode, spec.timestamps, spec.required));
  }
  eq(`${lang} page has the inference example`, count >= 1, true);
  eq(`${lang} page no longer says the first value decides`, /first value wins|首个值|最初の値|첫 값/.test(mdx), false);
}

if (process.env.AB_TYPES_EVIDENCE) {
  mkdirSync(process.env.AB_TYPES_EVIDENCE, { recursive: true });
  for (const [name, json] of [['nested', nestedRepro], ['array', arrayRepro]]) {
    writeFileSync(join(process.env.AB_TYPES_EVIDENCE, name + '.cjs'), gen(json, 'Sample', 'javascript', false, false));
  }
  writeFileSync(join(process.env.AB_TYPES_EVIDENCE, 'ts-contract.ts'), gen('{"label":"sample"}', 'Sample', 'typescript', true, false) + '\nimport Model from "./ts-contract";\nconst doc = new Model({ label: "sample" });\ndoc.createdAt.toISOString();\ndoc.updatedAt.toISOString();\n');
}

// Key order is not data: compare with keys sorted at every level.
const canon = (v) => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const RUNTIME = [
  ['nested', nestedRepro],
  ['array', arrayRepro],
  ['page js', PAGE_JS],
  ['page ts', PAGE_TS],
  ['awkward keys', awkward],
  ['dates and strings', '[{"at":"2026-10-01T09:30:00Z","note":"2026-10-01T09:30:00Z"},{"at":"2026-10-02T00:00:00.000Z","note":"later"},{"at":null}]'],
  ['three shapes', '{"a":{"meta":{"x":1}},"b":{"meta":{"y":"2"}},"c":{"meta":{"x":3}},"d":{"meta":{"z":true}}}'],
  ['object arrays', '[{"items":[{"sku":"A","qty":1}]},{"items":[{"sku":"B","note":"gift"}]},{"items":[]}]'],
  ['object array with null', '{"items":[{"sku":"A"},null]}'],
  ['scalars and objects', '[{"v":1},{"v":"x"},{"v":{"deep":1}},{"v":[1]},{"v":true}]'],
  ['root name clash', '{"sample":{"x":1},"meta":{"sample":{"y":2}}}'],
  ['empty and digit keys', '{"":{"a":1},"2fa":{"b":2}}'],
  ['own _id', '{"_id":"abc","child":{"_id":7,"n":1}}'],
  ['page order example', '[{"code":1,"note":null,"seller":{"meta":{"x":1}},"buyer":{"meta":{"y":"2"}}},{"code":"A-2","note":"gift","tags":["a",1]}]']
];
if (process.env.MONGOOSE_TEST_DIR) {
  const require = createRequire(join(process.env.MONGOOSE_TEST_DIR, 'package.json'));
  const mongoose = require('mongoose');
  eq('fixed Mongoose runtime version', mongoose.version, '9.10.3');
  for (const [name, json] of RUNTIME) {
    try {
      const isolated = new mongoose.Mongoose();
      const module = { exports: {} };
      new Function('require', 'module', gen(json, 'Sample', 'javascript', false, false))(() => isolated, module);
      const samples = JSON.parse(json);
      for (const [i, sample] of (Array.isArray(samples) ? samples : [samples]).entries()) {
        const doc = new module.exports(sample);
        eq(`${name}[${i}] validateSync`, doc.validateSync()?.message || true, true);
        // Ignore only Mongoose's generated IDs, never sample fields or scalar values.
        const actual = JSON.parse(JSON.stringify(doc.toObject({ versionKey: false })));
        // A Date path casts an ISO string to a Date; it then serializes as toISOString().
        function alignDates(want, got) {
          if (typeof want === 'string' && typeof got === 'string' && ISO.test(want) && !isNaN(Date.parse(want)) && got === new Date(want).toISOString()) return got;
          if (Array.isArray(want)) return want.map((v, k) => alignDates(v, Array.isArray(got) ? got[k] : undefined));
          if (want && typeof want === 'object') return Object.fromEntries(Object.entries(want).map(([key, v]) => [key, alignDates(v, got && typeof got === 'object' ? got[key] : undefined)]));
          return want;
        }
        const expected = alignDates(sample, actual);
        // A generated _id is dropped only where the sample has no _id at that position.
        function stripIds(value, want) {
          if (Array.isArray(value)) return value.map((v, k) => stripIds(v, Array.isArray(want) ? want[k] : undefined));
          if (value && typeof value === 'object') {
            const has = (key) => want && typeof want === 'object' && !Array.isArray(want) && Object.hasOwn(want, key);
            // Mongoose gives array paths a default [] (docs: SchemaTypes, Arrays); drop it only where the sample has no such key.
            return Object.fromEntries(Object.entries(value).filter(([key, v]) => (key !== '_id' || has(key)) && !(Array.isArray(v) && v.length === 0 && !has(key))).map(([key, v]) => [key, stripIds(v, want && typeof want === 'object' ? want[key] : undefined)]));
          }
          return value;
        }
        eq(`${name}[${i}] retains every field and value`, canon(stripIds(actual, expected)), canon(expected));
      }
    } catch (e) { eq(name + ' runtime execution', e.message, true); }
  }
} else { console.log('SKIP Mongoose runtime (set MONGOOSE_TEST_DIR to an external mongoose@9.10.3 install)'); }

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
