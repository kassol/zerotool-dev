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
// GA (2026-10-08): the page sends one `generate` event per committed action (input or model-name
// change, Example, an option that changes) and only when a schema is shown; none on page load or
// after each 300 ms typing pause (before: every generation, including the load).
// Run: node scripts/test-json-to-mongoose.mjs

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { annotations, contractProblems } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToMongooseTool.astro'), 'utf8');
const a = source.indexOf('/* ── engine:start ── */');
const b = source.indexOf('/* ── engine:end ── */');
if (a < 0 || b <= a) { console.error('FAIL: engine block not found'); process.exit(1); }
const E = new Function(source.slice(a, b) + '\nreturn { buildRootSchema, renderOutput, toCamelCase, toPascalCase };')();

// JSON syntax errors (S2-10f, 2026-10-09): lineCol and jsonSyntaxError are copied verbatim from
// json-formatter-engine.js, and errJson, errJsonAt and the jsonParse reasons verbatim from
// HarFileAnalyzerTool.astro. A syntax error shows line, column and cause in the page language
// instead of the browser's English message; line and column count from the start of the text box
// (the tool parses the trimmed text, so leading blank lines are added back).
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
  ['{\u201ca\u201d: 1}', 'smartQuote', 1, 2, '\u201c'],
  ['{"name": "Alice",', 'unexpectedEnd', 1, 18],
  // S2-10f review S3: a leading byte order mark (U+FEFF) is invisible in the text box, so it is not counted as a column.
  ['\uFEFF{"a":1,}', 'trailingComma', 1, 7],
];
// S2-10f review S4: valid JSON nested deeper than the call stack allows (Node 22 runs out well below 20,000 levels;
// browsers differ). The page shows a four-language notice instead of leaving the previous schema on screen.
const DEEP_JSON = '{"a":'.repeat(20000) + '1' + '}'.repeat(20000);
const jsonErrorMessage = (lang, code, line, col, ch) => HAR_S[lang].errJsonAt.replace('{line}', line).replace('{col}', col).replace('{reason}', HAR_S[lang].jsonParse[code].replace('{ch}', ch ?? ''));
const FAKE_JSON_DATASET = { errJson: HAR_S.en.errJson, errJsonAt: HAR_S.en.errJsonAt, jsonParse: JSON.stringify(HAR_S.en.jsonParse) };

let passes = 0, failures = 0;
function eq(name, got, want) {
  if (got === want) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + '\n  got:      ' + JSON.stringify(got) + '\n  expected: ' + JSON.stringify(want)); }
}
function gen(json, model, mode, timestamps, required) {
  function element(dataset = {}) {
    return { dataset, value: '', textContent: '', className: '', handlers: {},
      classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {},
      addEventListener(event, fn) { this.handlers[event] = fn; } };
  }
  const elements = Object.fromEntries(['input', 'output-code', 'status', 'model-name', 'convert', 'example', 'clear', 'copy'].map((id) => ['jtm-' + id, element()]));
  elements['jtm-model-name'].value = model;
  const groups = {
    '#jtm-lang-tabs .jtm-tab': ['javascript', 'typescript'].map((lang) => element({ lang })),
    '#jtm-ts-tabs .jtm-tab': [true, false].map((ts) => element({ ts: String(ts) })),
    '#jtm-req-tabs .jtm-tab': [false, true].map((req) => element({ req: String(req) }))
  };
  const wrap = { dataset: { copy: 'Copy', copied: 'Copied', ...FAKE_JSON_DATASET, msgGenOne: 'Generated 1 schema.', msgGenMany: 'Generated {n} schemas.', msgIgnored: 'Mongoose skips schema paths named __proto__, constructor or prototype: {keys}.', msgSkipped: 'Skipped {n} root array values that are not objects ({types}).', msgReserved: '{keys}' }, querySelectorAll: (selector) => groups[selector] };
  const script = source.slice(source.indexOf('(function () {'), source.indexOf('</script>', source.indexOf('(function () {')));
  new Function('document', 'window', 'hljs', 'navigator', 'setTimeout', 'clearTimeout', script)(
    { querySelector: () => wrap, getElementById: (id) => elements[id], addEventListener() {} }, {}, { highlightElement() {} }, {}, () => 0, () => {});
  elements['jtm-input'].value = json;
  groups['#jtm-lang-tabs .jtm-tab'].find((tab) => tab.dataset.lang === mode).handlers.click();
  groups['#jtm-ts-tabs .jtm-tab'].find((tab) => tab.dataset.ts === String(timestamps)).handlers.click();
  groups['#jtm-req-tabs .jtm-tab'].find((tab) => tab.dataset.req === String(required)).handlers.click();
  return elements['jtm-output-code'].textContent;
}
// A page session: the real client script with stubs, driven by input events and buttons.
function session() {
  const docHandlers = {};
  let activeInside = true;
  function element(dataset = {}) {
    return { dataset, value: '', textContent: '', className: '', handlers: {}, disabled: false,
      classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, focus() {},
      addEventListener(event, fn) { this.handlers[event] = fn; } };
  }
  const elements = Object.fromEntries(['input', 'output-code', 'status', 'model-name', 'convert', 'example', 'clear', 'copy'].map((id) => ['jtm-' + id, element()]));
  const groups = {
    '#jtm-lang-tabs .jtm-tab': ['javascript', 'typescript'].map((lang) => element({ lang })),
    '#jtm-ts-tabs .jtm-tab': [true, false].map((ts) => element({ ts: String(ts) })),
    '#jtm-req-tabs .jtm-tab': [false, true].map((req) => element({ req: String(req) }))
  };
  const wrap = { contains: (e) => e === elements['jtm-input'], dataset: { copy: 'Copy', copied: 'Copied', ...FAKE_JSON_DATASET, msgGenOne: 'Generated 1 schema.', msgGenMany: 'Generated {n} schemas.', msgIgnored: 'Mongoose skips schema paths named __proto__, constructor or prototype: {keys}.', msgSkipped: 'Skipped {n} root array values that are not objects ({types}).', msgReserved: '{keys}' }, querySelectorAll: (selector) => groups[selector] };
  const script = source.slice(source.indexOf('(function () {'), source.indexOf('</script>', source.indexOf('(function () {')));
  new Function('document', 'window', 'hljs', 'navigator', 'setTimeout', 'clearTimeout', script)(
    { get activeElement() { return activeInside ? elements['jtm-input'] : null; }, querySelector: () => wrap, getElementById: (id) => elements[id], addEventListener: (t, fn) => (docHandlers[t] = docHandlers[t] || []).push(fn) }, {}, { highlightElement() {} }, {}, (fn) => { fn(); return 0; }, () => {});
  const type = (text) => { elements['jtm-input'].value = text; elements['jtm-input'].handlers.input(); };
  const state = () => ({ code: elements['jtm-output-code'].textContent, status: elements['jtm-status'].textContent, copyDisabled: elements['jtm-copy'].disabled });
  // ToolLayout's Ctrl/Cmd+L (src/layouts/ToolLayout.astro): when focus is inside the tool it sets every
  // textarea and text input to '' without input events, then other keydown listeners run.
  const shortcut = (init, focusInside = true) => {
    activeInside = focusInside;
    if (focusInside) { elements['jtm-input'].value = ''; elements['jtm-model-name'].value = ''; }
    for (const fn of docHandlers.keydown || []) fn({ key: 'l', ctrlKey: false, metaKey: false, preventDefault() {}, ...init });
  };
  return { type, state, shortcut, click: (id) => elements['jtm-' + id].handlers.click() };
}
{
  const s = session();
  eq('stale output: the seeded example renders and Copy is enabled', /new Schema\(/.test(s.state().code) && !s.state().copyDisabled, true);
  s.type('{"name": "Alice",');
  const bad = s.state();
  eq('stale output: invalid JSON clears the output', bad.code, '');
  eq('stale output: invalid JSON shows line, column and cause', bad.status, jsonErrorMessage('en', 'unexpectedEnd', 1, 18));
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
  const labels = new Function(source.slice(source.indexOf('const STRINGS'), source.indexOf('const L = STRINGS')) + '\nreturn STRINGS;')();
  for (const lang of ['en', 'zh', 'ja', 'ko']) for (const key of ['errJson', 'errJsonAt', 'jsonParse']) {
    eq(`JSON errors: ${lang} ${key} is the text of HarFileAnalyzerTool.astro`, JSON.stringify(labels[lang][key]), JSON.stringify(HAR_S[lang][key]));
  }
  const rs = source.indexOf('/* ── json-reason:start ── */'), re = source.indexOf('/* ── json-reason:end ── */');
  eq('JSON errors: the json-reason block sits outside the engine block', rs > b && re > rs, true);
  for (const name of ['lineCol', 'jsonSyntaxError']) {
    const mine = rs > 0 ? fnSrc(source.slice(rs, re), name) : '';
    eq(`JSON errors: ${name} is the same as in json-formatter-engine.js`, mine !== '' && mine === fnSrc(JSON_ENGINE, name), true);
  }
}
{
  // Ctrl/Cmd+L: ToolLayout empties the fields without input events; the output must not stay.
  const s = session();
  s.shortcut({ ctrlKey: true });
  eq('Ctrl+L: the seeded output is cleared', s.state().code, '');
  eq('Ctrl+L: Copy is disabled', s.state().copyDisabled, true);
  eq('Ctrl+L: the status line is cleared', s.state().status, '');
  s.type('{"age": 30}');
  eq('Ctrl+L: the next input renders again and enables Copy', /age: (\{ type: )?Number/.test(s.state().code) && !s.state().copyDisabled, true);
  s.type('{"a":');
  s.shortcut({ metaKey: true, key: 'L' });
  eq('Cmd+L (key "L") after an error clears the error status', s.state().status, '');
  s.type('{"age": 30}');
  s.shortcut({ ctrlKey: true }, false);
  eq('Ctrl+L with focus outside the tool keeps the output', /age: (\{ type: )?Number/.test(s.state().code) && !s.state().copyDisabled, true);
  s.shortcut({ key: 'l' });
  eq('an L keydown without Ctrl/Cmd does not clear the output', /age: (\{ type: )?Number/.test(s.state().code) && !s.state().copyDisabled, true);
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
  "import mongoose, { Schema } from 'mongoose';\n\nexport interface IVariants {\n  color: string;\n  stock: number;\n  size: string;\n}\n\nexport interface IProduct {\n  sku: string;\n  price: number;\n  created_at: Date;\n  \"release-date\": string;\n  variants: IVariants[];\n  meta: any;\n  createdAt: Date;\n  updatedAt: Date;\n}\n\nconst variantsSchema = new Schema({\n  color: { type: String, required: true },\n  stock: { type: Number, required: true },\n  size: { type: String, required: true },\n});\n\nconst productSchema = new Schema<IProduct>({\n  sku: { type: String, required: true },\n  price: { type: Number, required: true },\n  created_at: { type: Date, required: true },\n  \"release-date\": { type: String, required: true },\n  variants: [variantsSchema],\n  meta: { type: mongoose.Schema.Types.Mixed, required: true },\n}, { timestamps: true });\n\nexport default mongoose.model<IProduct>('Product', productSchema);");
eq('page TypeScript example parses', parsesAsTs(tsOut), true);
eq('en page shows the TypeScript example output', readFileSync(join(root, 'src/content/tools/json-to-mongoose/en.mdx'), 'utf8').includes('<pre><code>{`' + tsOut + '`}</code></pre>'), true);

// TypeScript output follows the Mongoose 9 TypeScript guide (mongoosejs.com/docs/typescript.html,
// "Using Generics"): a plain document interface passed as Schema<IUser> and model<IUser>, no
// `extends Document`. With timestamps on, Mongoose adds createdAt and updatedAt of type Date
// (mongoosejs.com/docs/timestamps.html) unless the schema already has that path
// (lib/helpers/timestamps/setupTimestamps.js), so the interface lists them unless the sample has them.
{
  const on = gen('{"label":"sample"}', 'Sample', 'typescript', true, false);
  const off = gen('{"label":"sample"}', 'Sample', 'typescript', false, false);
  eq('TypeScript: no extends Document and no Document import', /extends Document|\bDocument\b/.test(on + off), false);
  eq('TypeScript: timestamps on lists createdAt and updatedAt as Date', on.includes('export interface ISample {\n  label: string;\n  createdAt: Date;\n  updatedAt: Date;\n}'), true);
  eq('TypeScript: timestamps off adds neither', /createdAt|updatedAt/.test(off), false);
  const own = gen('{"createdAt":"yesterday","updatedAt":"2026-10-01T09:30:00Z","n":1}', 'Sample', 'typescript', true, false);
  eq('TypeScript: a sample key named createdAt / updatedAt keeps its own type and is not repeated', (own.match(/createdAt:/g) || []).length === 2 && own.includes('  createdAt: string;\n  updatedAt: Date;\n  n: number;\n}'), true);
  eq('TypeScript: JavaScript output unchanged by the timestamps fields', /createdAt|updatedAt/.test(gen('{"label":"sample"}', 'Sample', 'javascript', true, false)), false);
}

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

// Model name: variable and interface names come from nameStem (ASCII identifier, "_" before a digit);
// the name passed to mongoose.model() is a string literal, so quotes and backslashes are escaped.
const MODEL_NAMES = [["it's", "It's"], ['a\\b', 'A\\b'], ['2fa', '2fa'], ['class', 'Class'], ['用户', '用户'], ['order-item', 'OrderItem'], ['!!!', '!!!']];
for (const [raw, want] of MODEL_NAMES) {
  for (const mode of ['javascript', 'typescript']) {
    const out = gen('{"a":1}', raw, mode, true, false);
    eq(`model name ${raw} (${mode}) parses`, mode === 'javascript' ? parsesAsJs(out) : parsesAsTs(out), true);
  }
  const captured = [];
  new Function('require', 'module', gen('{"a":1}', raw, 'javascript', true, false))(() => ({ Schema: function () {}, model: (name) => captured.push(name) }), { exports: {} });
  eq(`model name ${raw} reaches mongoose.model() as ${want}`, captured[0], want);
}

// ~150,000 root objects with an array field: the arrays of a key are joined with a loop
// (concat.apply spread them as arguments and overflowed the stack, master included).
{
  const many = JSON.stringify(Array.from({ length: 150000 }, (_, i) => ({ id: i, tags: ['a'] })));
  let out; try { out = gen(many, 'Item', 'javascript', false, false); } catch (e) { out = String(e); }
  eq('many root objects with array fields generate', out.includes('  tags: [String],'), true);
}

// Mongoose 9.10.3 Schema.reserved (lib/schema.js), without prototype (skipped as a special property).
const MONGOOSE_RESERVED = ['emit', 'listeners', 'removeListener', 'collection', 'errors', 'get', 'init', 'isModified', 'isNew', 'populated', 'remove', 'save', 'toObject', 'validate'];

// S2-10f (2026-10-09): Mongoose 9.10.3 warns only about Schema.reserved, but a document has many more
// members (a model document, a single nested subdocument and a document array element). DOC_BREAKS: a
// field with this name makes model(), new Model(), validateSync(), toObject() or JSON.stringify() fail or
// change in at least one of seven layouts (the name as a string path, as a nested schema, beside a nested
// schema, beside a document array, inside a nested schema, inside a document array, and with an input key
// that is not in the schema); get and toObject are also reserved. DOC_MEMBERS: the other members outside
// Schema.reserved, where the field value only replaces the member on the document. constructor, _id, __v
// and id are left out (never a path, or a real path: Mongoose skips its id getter when the schema has an
// id path, lib/helpers/schema/idGetter.js). With MONGOOSE_TEST_DIR both lists are rebuilt below.
const DOC_BREAKS = ['$__', '$__buildDoc', '$__getValue', '$__hasOnlyPrimitiveValues', '$__init', '$__middleware', '$__parent', '$__path', '$__pathRelativeToParent', '$__saveInitialState', '$__schema', '$__schemaTypeOptions', '$__set', '$__setSchema', '$__toObjectShallow', '$__validateSync', '$basePath', '$emit', '$get', '$isDefault', '$isModified', '$isSingleNested', '$isValid', '$markValid', '$parent', '$session', '$set', '$setIndex', '$toObject', '__index', '__parentArray', '_doc', 'get', 'isDirectModified', 'markModified', 'modifiedPaths', 'schema', 'toBSON', 'toJSON', 'toObject', 'validateSync'];
const DOC_MEMBERS = ['$__delta', '$__dirty', '$__fullPath', '$__fullPathWithIndexes', '$__getArrayPathsToValidate', '$__handleReject', '$__isSelected', '$__removeFromParent', '$__reset', '$__resetAtomics', '$__save', '$__setParent', '$__setValue', '$__shouldModify', '$__undoReset', '$__version', '$__where', '$addListener', '$assertPopulated', '$clearModifiedPaths', '$clone', '$collection', '$createModifiedPathsSnapshot', '$getAllSubdocs', '$getChanges', '$getPopulatedDocs', '$ignore', '$inc', '$init', '$isDeleted', '$isDocumentArrayElement', '$isEmpty', '$isMongooseDocumentPrototype', '$isMongooseModelPrototype', '$isNew', '$isSubdocument', '$listeners', '$locals', '$model', '$on', '$once', '$op', '$populated', '$removeAllListeners', '$removeListener', '$restoreModifiedPathsSnapshot', '$save', '$setMaxListeners', '$timestamps', '$validate', '$where', '_applyVersionIncrement', '_execDocumentPostHooks', '_execDocumentPreHooks', 'addListener', 'db', 'deleteOne', 'depopulate', 'directModifiedPaths', 'discriminators', 'equals', 'getChanges', 'increment', 'inspect', 'invalidate', 'isDirectSelected', 'isInit', 'isSelected', 'model', 'on', 'once', 'overwrite', 'ownerDocument', 'parent', 'parentArray', 'populate', 'removeAllListeners', 'replaceOne', 'set', 'setMaxListeners', 'toString', 'unmarkModified', 'updateOne'];
{
  const listOf = (name) => { const m = source.match(new RegExp('var ' + name + ' = (\\[[^\\]]*\\]);')); return m ? JSON.parse(m[1].replace(/'/g, '"')) : null; };
  eq('S2-10f: the page lists the Mongoose names that break a document', JSON.stringify(listOf('DOC_BREAKS')), JSON.stringify(DOC_BREAKS));
  eq('S2-10f: the page lists the Mongoose names that only replace a member', JSON.stringify(listOf('DOC_MEMBERS')), JSON.stringify(DOC_MEMBERS));
  eq('S2-10f: list sizes', JSON.stringify([DOC_BREAKS.length, DOC_MEMBERS.length]), JSON.stringify([41, 83]));
  eq('S2-10f: DOC_MEMBERS has no reserved, breaking, skipped or id name', JSON.stringify(DOC_MEMBERS.filter((k) => MONGOOSE_RESERVED.includes(k) || DOC_BREAKS.includes(k) || ['constructor', 'prototype', '_id', '__v', 'id'].includes(k))), '[]');
  eq('S2-10f: DOC_BREAKS overlaps Schema.reserved only in get and toObject', JSON.stringify(DOC_BREAKS.filter((k) => MONGOOSE_RESERVED.includes(k))), JSON.stringify(['get', 'toObject']));
  const labels = new Function(source.slice(source.indexOf('const STRINGS'), source.indexOf('const L = STRINGS')) + '\nreturn STRINGS;')();
  for (const lang of ['en', 'zh', 'ja', 'ko']) for (const key of ['msgBreaks', 'msgMembers']) {
    eq(`S2-10f: ${lang} ${key} names the keys`, typeof labels[lang][key] === 'string' && labels[lang][key].split('{keys}').length === 2, true);
  }
  eq('S2-10f: the breaking-name notice names the Mongoose version', ['en', 'zh', 'ja', 'ko'].every((lang) => String(labels[lang].msgBreaks ?? '').includes('Mongoose 9.10.3')), true);
  // S2-10f review S1: about half of DOC_BREAKS are properties (_doc, $__, schema, $parent, $session, __index), so the
  // notice says document members (methods and properties), not document methods.
  const MEMBER_WORDS = { en: 'document members (methods and properties)', zh: '文档成员（方法或属性）', ja: 'ドキュメントメンバー（メソッドやプロパティ）', ko: '문서 멤버(메서드·속성)' };
  for (const lang of ['en', 'zh', 'ja', 'ko']) eq(`S2-10f review S1: ${lang} msgBreaks says document members, methods and properties`, String(labels[lang].msgBreaks).includes(MEMBER_WORDS[lang]), true);
}

// B1: a "__proto__" key is written as a computed key, so the object literal gets an own property
// (a bare `__proto__:` sets the prototype); the TypeScript interface quotes it.
{
  const json = '{"__proto__":{"x":1},"b":1,"constructor":"c"}';
  const jsOut = gen(json, 'Doc', 'javascript', false, false);
  eq('B1: __proto__ is a computed key in the schema object', jsOut.includes('  ["__proto__"]: '), true);
  const defs = [];
  new Function('require', 'module', jsOut)(() => ({ Schema: function (def) { defs.push(def); }, model: () => null }), { exports: {} });
  eq('B1: the root schema definition has an own __proto__ property', Object.hasOwn(defs.at(-1), '__proto__') && Object.getPrototypeOf(defs.at(-1)) === Object.prototype, true);
  const tsOut = gen(json, 'Doc', 'typescript', false, false);
  eq('B1: TypeScript output parses and quotes __proto__ in the interface', parsesAsTs(tsOut) === true && tsOut.includes('  "__proto__": '), true);
}

eq('null is skipped: null then string → String', gen('[{"v": null}, {"v": "x"}]', 'T', 'javascript', false, false).includes('v: { type: String },'), true);

const nestedRepro = '{"a":{"meta":{"x":1}},"b":{"meta":{"y":2}}}';
const arrayRepro = '[{"value":1,"parts":[{"x":1},"keep",2,null,[3]]},{"value":"two","parts":[{"y":2}]}]';
eq('A-MONGOOSE-ARRAY-INFERENCE: all root samples decide value type', gen(arrayRepro, 'Sample', 'javascript', false, false).includes('value: { type: mongoose.Schema.Types.Mixed },'), true);
eq('A-MONGOOSE-ARRAY-INFERENCE: heterogeneous arrays use Mixed', gen(arrayRepro, 'Sample', 'javascript', false, false).includes('parts: [mongoose.Schema.Types.Mixed],'), true);
eq('A-MONGOOSE-NESTED-NAME: real convert keeps b.meta.y', /const bMetaSchema = new Schema\(\{\n  y:/.test(gen(nestedRepro, 'Sample', 'javascript', false, false)), true);

// {/* jtm-check: {"json", "model", "mode", "timestamps", "required"} */}: the next code block is the
// input JSON and the one after it the full output, both as on the page.
const JTM_DATES = [];
const PAGE_JSON = [];
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, `src/content/tools/json-to-mongoose/${lang}.mdx`), 'utf8');
  let count = 0;
  for (const m of mdx.matchAll(/\{\/\* jtm-check: (\{.*\}) \*\/\}/g)) {
    count++;
    const spec = JSON.parse(m[1]);
    const blocks = [...mdx.slice(m.index).matchAll(/<pre><code>\{`([\s\S]*?)`\}<\/code><\/pre>/g)].map((x) => new Function('return `' + x[1] + '`')());
    eq(`${lang} jtm-check ${count}: input block`, blocks[0], spec.json);
    eq(`${lang} jtm-check ${count}: output block`, blocks[1], gen(spec.json, spec.model, spec.mode, spec.timestamps, spec.required));
    if (!PAGE_JSON.some(([, json]) => json === spec.json)) PAGE_JSON.push([`page ${lang} jtm-check ${count}`, spec.json]);
  }
  eq(`${lang} page has at least 2 jtm-check examples`, count >= 2, true);
  const pageLabels = new Function(source.slice(source.indexOf('const STRINGS'), source.indexOf('const L = STRINGS')) + ';return STRINGS;')();
  eq(`${lang} page quotes the skipped-values status as the page shows it`, mdx.includes(pageLabels[lang].msgSkipped.replace('{n}', '5').replace('{types}', 'number × 2, string, null, array')), true);
  eq(`${lang} page names the three keys Mongoose skips`, ['<code>{"__proto__"}</code>', '<code>constructor</code>', '<code>prototype</code>', `<code>{'["__proto__"]'}</code>`].every((k) => mdx.includes(k)), true);
  eq(`${lang} page no longer says the first value decides`, /first value wins|首个值|最初の値|첫 값/.test(mdx), false);
  // S2-10f: the limits quote the Mongoose 9.10.3 errors for document member names (checked below with MONGOOSE_TEST_DIR).
  // Names with _ are MDX expressions ({"_doc"}): MDX reads _ and __ inside <code> as emphasis.
  eq(`${lang} page quotes the Mongoose errors for document member names`, ['<code>markModified</code>', '<code>this.markModified is not a function</code>', '<code>{"_doc"}</code>', '<code>Maximum call stack size exceeded</code>', '<code>schema</code>', "<code>Cannot read properties of undefined (reading 'discriminatorKey')</code>", '<code>toJSON</code>', '<code>model</code>', '<code>set</code>'].filter((k) => !mdx.includes(k)).join(', '), '');
  {
    // The page names the breaking names that do not start with $, and how many do and how many members only replace a member.
    const plain = DOC_BREAKS.filter((k) => !k.startsWith('$'));
    const bullet = mdx.split('\n').find((l) => l.includes('this.markModified is not a function')) || '';
    const count = (n) => new RegExp('(^|[^0-9])' + n + '([^0-9]|$)').test(bullet);
    eq(`${lang} page lists the breaking names without $ and the counts`, JSON.stringify([plain.filter((k) => !bullet.includes('<code>' + k + '</code>') && !bullet.includes('<code>{"' + k + '"}</code>')), count(DOC_BREAKS.length - plain.length), count(DOC_MEMBERS.length)]), JSON.stringify([[], true, true]));
  }
  // {/* jtm-date: {"in", "iso"} */}: the value a Date path stores for `in`, as toISOString(), must be shown
  // in inline code before the next jtm-date note or heading. Mongoose casts a string with the Date
  // constructor, except numeric strings outside the Date year range, which it reads as milliseconds
  // (lib/cast/date.js; mongoosejs.com/docs/tutorials/dates.html "Casting Edge Cases"). With
  // MONGOOSE_TEST_DIR the real cast is used below as well.
  for (const note of annotations(mdx.slice(mdx.indexOf('\n---\n', 4) + 5), 'jtm-date')) {
    const { in: value, iso } = note.spec;
    const n = Number(value);
    const cast = typeof value === 'string' && value !== '' && !isNaN(n) && (n >= 275761 || n < -271820) ? new Date(n) : new Date(value);
    eq(`${lang} jtm-date ${value}: cast value`, cast.toISOString(), iso);
    eq(`${lang} jtm-date ${value}: shown on the page`, note.after.includes('<code>' + iso + '</code>'), true);
    JTM_DATES.push([lang, value, iso]);
  }
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
// Every jtm-check input on the four pages also runs through Mongoose and tsc below.
const sameJson = (x, y) => JSON.stringify(JSON.parse(x)) === JSON.stringify(JSON.parse(y));
for (const entry of PAGE_JSON) if (!RUNTIME.some(([, r]) => sameJson(r, entry[1]))) RUNTIME.push(entry);
eq('page examples in the Mongoose runtime set', PAGE_JSON.length >= 6 && PAGE_JSON.every(([, json]) => RUNTIME.some(([, r]) => sameJson(r, json))), true);
if (process.env.MONGOOSE_TEST_DIR) {
  const require = createRequire(join(process.env.MONGOOSE_TEST_DIR, 'package.json'));
  const mongoose = require('mongoose');
  eq('fixed Mongoose runtime version', mongoose.version, '9.10.3');
  {
    // Page claims about Mongoose casting, with the real library: the jtm-date values, and strings
    // in a [Number] array (ja: precipitation percentages such as "10").
    const isolated = new mongoose.Mongoose();
    const M = isolated.model('Cast', new isolated.Schema({ at: Date, pops: [Number] }));
    for (const [lang, value, iso] of JTM_DATES) {
      const doc = new M({ at: value });
      eq(`Mongoose casts ${lang} jtm-date ${value}`, JSON.stringify([doc.validateSync()?.message ?? true, doc.at && doc.at.toISOString()]), JSON.stringify([true, iso]));
    }
    // B1: the computed key reaches Mongoose, which skips __proto__ / constructor / prototype paths
    // (lib/schema.js, utils.specialProperties); the page says so on the status line.
    const proto = { exports: {} };
    new Function('require', 'module', gen('{"__proto__":1,"constructor":"c","b":1}', 'Proto', 'javascript', false, false))(() => isolated, proto);
    eq('B1: Mongoose 9.10.3 skips the __proto__ and constructor paths', JSON.stringify(Object.keys(proto.exports.schema.paths).filter((k) => k !== '_id' && k !== '__v')), JSON.stringify(['b']));
    for (const [raw, want] of MODEL_NAMES) {
      const named = { exports: {} };
      new Function('require', 'module', gen('{"a":1}', raw, 'javascript', true, false))(() => new mongoose.Mongoose(), named);
      eq(`Mongoose model name for ${raw}`, named.exports.modelName, want);
    }
    // Reserved path names: kept as paths with a warning, and the field value replaces the document
    // method of the same name (the status line says so).
    for (const k of MONGOOSE_RESERVED) {
      const warnings = [];
      const onWarn = (w) => warnings.push(String(w.message));
      process.on('warning', onWarn);
      const r = new mongoose.Mongoose();
      const R = r.model('R', new r.Schema({ [k]: String }));
      await new Promise(setImmediate);
      process.removeListener('warning', onWarn);
      const d = new R({ [k]: 'v' });
      eq(`reserved ${k}: kept as a path, warned, document property is the value`, JSON.stringify([Object.hasOwn(R.schema.paths, k), warnings.some((w) => w.includes('`' + k + '` is a reserved schema pathname')), d[k]]), JSON.stringify([true, true, 'v']));
    }
    const pops = new M({ pops: ['0', '10'] });
    eq('Mongoose casts ["0","10"] on a [Number] path to [0,10]', JSON.stringify([pops.validateSync()?.message ?? true, [...pops.pops]]), JSON.stringify([true, [0, 10]]));
  }
  {
    // S2-10f: rebuild DOC_BREAKS and DOC_MEMBERS from the members of real Mongoose 9.10.3 documents.
    const warningListeners = process.listeners('warning');
    process.removeAllListeners('warning'); process.on('warning', () => {});
    try {
      const chain = (o) => { const names = new Set(); for (let p = o; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) for (const n of Object.getOwnPropertyNames(p)) names.add(n); return [...names]; };
      const m0 = new mongoose.Mongoose();
      const M0 = m0.model('Probe0', new m0.Schema({ label: String, sub: new m0.Schema({ a: Number }), list: [new m0.Schema({ a: Number })] }));
      const inst = new M0({ label: 'x', sub: { a: 1 }, list: [{ a: 1 }] }); inst.validateSync(); inst.toObject(); JSON.stringify(inst);
      const members = [...new Set([inst, inst.sub, inst.list[0]].flatMap((o) => [...chain(Object.getPrototypeOf(o)), ...Object.getOwnPropertyNames(o)]))].filter((n) => !['label', 'sub', 'list', 'a'].includes(n)).sort();
      const layouts = {
        string: (mg, n) => [{ [n]: { type: String }, label: String }, { [n]: 'v', label: 'x' }],
        object: (mg, n) => [{ [n]: new mg.Schema({ a: Number }), label: String }, { [n]: { a: 1 }, label: 'x' }],
        siblingSub: (mg, n) => [{ [n]: { type: String }, sub: new mg.Schema({ a: Number }) }, { [n]: 'v', sub: { a: 1 } }],
        siblingArr: (mg, n) => [{ [n]: { type: String }, list: [new mg.Schema({ a: Number })] }, { [n]: 'v', list: [{ a: 1 }] }],
        inSub: (mg, n) => [{ sub: new mg.Schema({ [n]: { type: String }, b: Number }) }, { sub: { [n]: 'v', b: 1 } }],
        inArr: (mg, n) => [{ list: [new mg.Schema({ [n]: { type: String }, b: Number })] }, { list: [{ [n]: 'v', b: 1 }] }],
        extraKey: (mg, n) => [{ [n]: { type: String }, label: String }, { [n]: 'v', label: 'x', extra: 1 }],
      };
      const keysDeep = (v) => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, typeof x[key] === 'object' ? x[key] : 0])) : x);
      const fine = (name, layout) => {
        const mg = new mongoose.Mongoose();
        try {
          const [def, sample] = layouts[layout](mg, name);
          const doc = new (mg.model('P', new mg.Schema(def)))(sample);
          if (doc.validateSync()) return false;
          return keysDeep(JSON.parse(JSON.stringify(doc))) === keysDeep(JSON.parse(JSON.stringify(doc.toObject())));
        } catch { return false; }
      };
      const left = members.filter((n) => !['constructor', '_id', '__v', 'id'].includes(n));
      const breaks = left.filter((n) => Object.keys(layouts).some((layout) => !fine(n, layout)));
      const reserved = Object.keys(mongoose.Schema.reserved);
      eq('Mongoose 9.10.3 members rebuild DOC_BREAKS', JSON.stringify(breaks), JSON.stringify(DOC_BREAKS));
      eq('Mongoose 9.10.3 members rebuild DOC_MEMBERS', JSON.stringify(left.filter((n) => !breaks.includes(n) && !reserved.includes(n))), JSON.stringify(DOC_MEMBERS));
      // The limits quote these results; each runs generated code with the real library.
      const run = (json, sample) => { const iso = new mongoose.Mongoose(); const mod = { exports: {} }; new Function('require', 'module', gen(json, 'Sample', 'javascript', false, false))(() => iso, mod); return new mod.exports(sample); };
      const error = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
      eq('page claim: a markModified field breaks new Model()', error(() => run('{"markModified":"x","label":"y"}', { markModified: 'x', label: 'y' })), 'this.markModified is not a function');
      eq('page claim: a _doc field overflows the stack', error(() => run('{"_doc":"x","label":"y"}', { _doc: 'x', label: 'y' })), 'Maximum call stack size exceeded');
      eq('page claim: a schema field works while the input has only schema keys', error(() => { if (run('{"schema":"x","label":"y"}', { schema: 'x', label: 'y' }).validateSync()) throw Error('invalid'); }), '');
      eq('page claim: a schema field breaks on a key outside the schema', error(() => run('{"schema":"x","label":"y"}', { schema: 'x', label: 'y', extra: 1 })), "Cannot read properties of undefined (reading 'discriminatorKey')");
      { const s = JSON.stringify(run('{"toJSON":"x","label":"y"}', { toJSON: 'x', label: 'y' })); eq('page claim: a toJSON field makes JSON.stringify print internals', JSON.stringify([s.includes('"$__"'), s.includes('"_doc"')]), JSON.stringify([true, true])); }
      { const d = run('{"model":"m","set":"s","label":"y"}', { model: 'm', set: 's', label: 'y' }); eq('page claim: doc.model and doc.set are the field values', JSON.stringify([d.model, d.set, d.validateSync() ? 'invalid' : 'valid']), JSON.stringify(['m', 's', 'valid'])); }
      await new Promise(setImmediate);
    } finally {
      process.removeAllListeners('warning');
      for (const listener of warningListeners) process.on('warning', listener);
    }
  }
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

// Strict tsc (repo TypeScript 5.9.3) of every RUNTIME sample's TypeScript output against the
// external Mongoose 9.10.3 types: timestamps on/off × required on/off, one program. With
// timestamps on, a hydrated document (new Model()) and a .lean() result read createdAt and
// updatedAt; they must be Date unless the sample has its own key of that name. Before the fix
// the interface extended Document without these fields: TS2339 on both.
if (process.env.MONGOOSE_TEST_DIR && ts.version === '5.9.3') {
  const dir = mkdtempSync(join(tmpdir(), 'jtm-tsc-'));
  try {
    symlinkSync(join(process.env.MONGOOSE_TEST_DIR, 'node_modules'), join(dir, 'node_modules'));
    const cases = [];
    const extra = [['own timestamps keys', '{"createdAt":"yesterday","updatedAt":"2026-10-01T09:30:00Z","n":1}'], ['label', '{"label":"sample","count":1}']];
    for (const [name, json] of RUNTIME.concat(extra)) {
      for (const timestamps of [true, false]) {
        for (const required of [false, true]) {
          const n = cases.length;
          const roots = JSON.parse(json);
          const keys = new Set((Array.isArray(roots) ? roots : [roots]).filter((o) => o && typeof o === 'object' && !Array.isArray(o)).flatMap((o) => Object.keys(o)));
          const read = (k) => keys.has(k) ? `void doc.${k}; if (lean) void lean.${k};` : `const h_${k}: Date = doc.${k}; if (lean) { const l_${k}: Date = lean.${k}; void l_${k}; } void h_${k};`;
          writeFileSync(join(dir, `model_${n}.ts`), gen(json, 'Sample', 'typescript', timestamps, required));
          writeFileSync(join(dir, `use_${n}.ts`), `import Model from './model_${n}';\nexport async function check() {\n  const doc = new Model();\n  const lean = await Model.findOne().lean();\n  ${timestamps ? read('createdAt') + '\n  ' + read('updatedAt') : 'void doc; void lean;'}\n}\n`);
          cases.push({ n, label: `${name} timestamps=${timestamps} required=${required}` });
        }
      }
    }
    const program = ts.createProgram(cases.flatMap((c) => [join(dir, `model_${c.n}.ts`), join(dir, `use_${c.n}.ts`)]), {
      strict: true, noEmit: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022, skipLibCheck: true, esModuleInterop: true, types: [],
    });
    const diags = ts.getPreEmitDiagnostics(program);
    const msg = (d) => (d.file ? d.file.fileName.slice(dir.length + 1) + ': ' : '') + 'TS' + d.code + ' ' + ts.flattenDiagnosticMessageText(d.messageText, '\n').slice(0, 160);
    const global = diags.filter((d) => !d.file || !/\/(model|use)_\d+\.ts$/.test(d.file.fileName));
    eq('tsc strict: no diagnostics outside the generated files', global.map(msg).join('\n') || true, true);
    for (const c of cases) {
      const mine = diags.filter((d) => d.file && new RegExp(`/(model|use)_${c.n}\\.ts$`).test(d.file.fileName));
      eq(`tsc strict (TypeScript 5.9.3, Mongoose 9.10.3): ${c.label}`, mine.map(msg).join('\n') || true, true);
    }
    if (process.env.AB_TYPES_EVIDENCE) {
      mkdirSync(process.env.AB_TYPES_EVIDENCE, { recursive: true });
      writeFileSync(join(process.env.AB_TYPES_EVIDENCE, 'tsc-diagnostics.txt'), diags.map(msg).join('\n') + '\n');
      writeFileSync(join(process.env.AB_TYPES_EVIDENCE, 'tsc-sample-model.ts'), readFileSync(join(dir, `model_${cases.findIndex((c) => c.label === 'label timestamps=true required=false')}.ts`), 'utf8'));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
} else { console.log('SKIP TypeScript strict compile (set MONGOOSE_TEST_DIR to an external mongoose@9.10.3 install; needs TypeScript 5.9.3, have ' + ts.version + ')'); }

// ---------- real page lifecycle ----------
// Execute the complete production script and actual shared keyboard listener.
// Only DOM, timers, highlighting and clipboard delivery are controlled here.
{
  console.log('Original regression: ' + passes + ' passed, ' + failures + ' failed');
  const cfg = {"slug": "json-to-mongoose", "file": "JsonToMongooseTool.astro", "input": "jtm-input", "output": "jtm-output-code", "status": "jtm-status", "copy": "jtm-copy", "clear": "jtm-clear", "example": "jtm-example", "invalid": "{\"bad\":", "sample": "{\"fresh\": true}", "valueOutput": false};
  const vm = await import('node:vm');
  const tsPage = (await import('typescript')).default;
  const { createRequire: pageRequire } = await import('node:module');
  const requirePage = pageRequire(join(root, 'src/components/tools/' + cfg.file));
  const labels = new Function(source.slice(source.indexOf('const STRINGS'), source.indexOf('const L = STRINGS')) + ';return STRINGS;')();
  const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
  const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
  if (!shortcut.includes("document.addEventListener('keydown'")) throw Error('Shared shortcut not found');
  const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  const js = tsPage.transpileModule(script, { compilerOptions: { target: tsPage.ScriptTarget.ES2022, module: tsPage.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
  const unhandled = [], onUnhandled = error => unhandled.push(String(error));
  process.on('unhandledRejection', onUnhandled);
  const same = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) passes++;
    else { failures++; console.log('FAIL page ' + name + '\n got ' + JSON.stringify(got) + '\n expected ' + JSON.stringify(want)); }
  };
  function page(lang, shellFirst) {
    const copies = [], timers = new Map(), clears = [], tracks = [], blobs = [], highlights = [];
    let now = 0, timerID = 0, document;
    const descendants = e => e.children.flatMap(c => [c, ...descendants(c)]);
    function simple(e, selector) {
      if (e.tagName === '#TEXT') return false;
      const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)], plain = selector.replace(/\[[^\]]+\]/g, '');
      const tag = /^[a-z][\w-]*/i.exec(plain)?.[0], id = /#([\w-]+)/.exec(plain)?.[1];
      return (!tag || e.tagName === tag.toUpperCase()) && (!id || e.id === id)
        && [...plain.matchAll(/\.([\w-]+)/g)].every(m => e.className.split(/\s+/).includes(m[1]))
        && attrs.every(a => a[2] === undefined ? e.getAttribute(a[1]) !== null : e.getAttribute(a[1]) === a[2]);
    }
    function matches(e, selector) {
      return selector.split(',').some(part => {
        const parts = part.trim().split(/\s+(?![^\[]*\])/); if (!simple(e, parts.pop())) return false;
        let parent = e.parentNode;
        while (parts.length) { while (parent && !simple(parent, parts.at(-1))) parent = parent.parentNode; if (!parent) return false; parts.pop(); parent = parent.parentNode; }
        return true;
      });
    }
    class Element {
      constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, dataset: {}, listeners: {}, id: '', className: '', text: '', value: '', hidden: false, disabled: false, checked: false, scrollTop: 0, scrollLeft: 0 }); }
      get parentElement() { return this.parentNode; }
      setAttribute(key, value) { this.attributes[key] = String(value); if (['id','class','type','value'].includes(key)) this[key === 'class' ? 'className' : key] = String(value); if (['hidden','disabled','checked'].includes(key)) this[key] = true; if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())] = String(value); }
      getAttribute(key) { return this.attributes[key] ?? null; }
      removeAttribute(key) { delete this.attributes[key]; if (key.startsWith('data-')) delete this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]; }
      get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
      set textContent(value) { this.text = String(value); this.children = []; }
      get classList() { const el=this; return { add(...names) { el.className=[...new Set([...el.className.split(/\s+/).filter(Boolean),...names])].join(' '); }, remove(...names) { el.className=el.className.split(/\s+/).filter(n=>!names.includes(n)).join(' '); }, contains(name) { return el.className.split(/\s+/).includes(name); } }; }
      appendChild(e) { this.children.push(e); e.parentNode=this; return e; }
      contains(e) { return this === e || descendants(this).includes(e); }
      querySelectorAll(selector) { return descendants(this).filter(e=>matches(e,selector)); }
      querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
      dispatch(type, extra={}) { const event={type,target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra}; for(let e=this;e;e=e.parentNode){event.currentTarget=e; for(const fn of e.listeners[type]||[]) fn.call(e,event); if(event.stopped)break;} return event; }
      click() { if(!this.disabled)return this.dispatch('click'); }
      focus() { document.activeElement=this; }
    }
    document=new Element('#document');document.documentElement={lang}; document.body=document.appendChild(new Element('body'));document.activeElement=document.body;
    const widget=document.body.appendChild(new Element('section'));widget.className='tool-widget';
    const esc=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const decode=value=>value.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
    const markup=source.replace(/^---[\s\S]*?---\s*/,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').split('<style')[0]
      .replace(/<Toggletip id="([^"]+)"[^>]*>[\s\S]*?<\/Toggletip>/g,(_,id)=>'<span class="zt-tip"><button type="button" class="zt-tip-btn" data-zt-tip="'+id+'">?</button></span>')
      .replace(/<!--[\s\S]*?-->/g,'').replace(/placeholder=\{`[\s\S]*?`\}/g,'').replace(/placeholder='[^']*'/g,'')
      .replace(/=\{JSON\.stringify\(L\.(\w+)\)\}/g,(_,key)=>'="'+esc(JSON.stringify(labels[lang][key]))+'"')
      .replace(/=\{L\.(\w+)\}/g,(_,key)=>'="'+esc(labels[lang][key])+'"').replace(/\{L\.(\w+)\}/g,(_,key)=>esc(labels[lang][key])).replace(/=\{lang\}/g,'="'+lang+'"');
    const stack=[widget];
    for(const token of markup.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) { const text=token[0]; if(text.startsWith('</'))stack.pop();else if(text.startsWith('<')){const tag=/^<([\w-]+)/.exec(text)[1],e=new Element(tag);for(const a of text.matchAll(/([\w-]+)="([^"]*)"/g))e.setAttribute(a[1],decode(a[2]));for(const a of ['hidden','disabled','readonly','checked'])if(new RegExp('\\s'+a+'(?=\\s|/?>)').test(text))e.setAttribute(a,'');stack.at(-1).appendChild(e);if(!/\/>$/.test(text)&&!['input','br','hr','img'].includes(tag))stack.push(e);}else{const e=new Element('#text');e.text=decode(text);stack.at(-1).appendChild(e);} }
    if(stack.length!==1)throw Error('Unbalanced source markup');
    document.getElementById=id=>descendants(document).find(e=>e.id===id)??null;document.createElement=tag=>new Element(tag);
    const get=id=>{const e=document.getElementById(id);if(!e)throw Error('Missing actual source ID '+id);return e;};
    const clipboard={writeText(value){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});copies.push({value:String(value),resolve,reject});return promise;}};
    const context={document,console,exports:{},Blob,Error,_slug:cfg.slug,navigator:{clipboard},
      require(name){if(name==='highlight.js/lib/core')return{registerLanguage(){},highlightElement(e){highlights.push(e.id);e.setAttribute('data-highlighted','yes');}};if(name.startsWith('highlight.js/lib/languages/'))return()=>({});return requirePage(name);},
      setTimeout(fn,ms=0){const id=++timerID;timers.set(id,{fn,ms,due:now+ms});return id;},clearTimeout(id){timers.delete(id);},
      URL:{createObjectURL(blob){blobs.push(blob);return 'blob:test';},revokeObjectURL(){}},ztPersist:{clear(slug){clears.push(slug);}},trackTool(...args){tracks.push(args);}};
    context.window=context;vm.createContext(context);const shared=()=>vm.runInContext(shortcut,context);
    if(shellFirst)shared();vm.runInContext(js,context,{filename:cfg.file});if(!shellFirst)shared();
    function advance(ms){const target=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.due<=target).sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];if(!next)break;now=next[1].due;timers.delete(next[0]);next[1].fn();}now=target;}
    const out=()=>cfg.valueOutput?get(cfg.output).value:get(cfg.output).textContent;
    return{get,document,context,copies,timers,clears,tracks,blobs,highlights,advance,out,
      input(value,id=cfg.input){get(id).value=value;get(id).dispatch('input');},
      key(key='l',modifier='ctrlKey',target=cfg.input){(target?get(target):document.body).focus();return document.activeElement.dispatch('keydown',{key,[modifier]:true});},
      example(){get(cfg.example).click();},copy(){get(cfg.copy).click();return copies.at(-1);},
      snapshot(){return{input:get(cfg.input).value,output:out(),status:get(cfg.status).textContent,statusClass:get(cfg.status).className,copy:get(cfg.copy).textContent,copyClass:get(cfg.copy).className};}};
  }
  for(const lang of ['en','zh','ja','ko'])for(const shellFirst of [false,true]){
    const p=page(lang,shellFirst),tag=lang+'/'+shellFirst;
    p.example();same(tag+' actual Example creates output',!!p.out(),true);
    p.input(cfg.invalid);p.advance(300);same(tag+' invalid input clears old output',p.out(),'');same(tag+' invalid input shows error',p.get(cfg.status).classList.contains('error'),true);
    p.input('   ');p.advance(300);same(tag+' empty removes input error',p.get(cfg.input).classList.contains('error'),false);same(tag+' empty clears status/output',[p.out(),p.get(cfg.status).textContent],['','']);
    for(const [key,mod,target]of [['l','ctrlKey',cfg.input],['L','metaKey',cfg.copy]]){
      p.example();p.input(cfg.sample);const event=p.key(key,mod,target);
      same(tag+' shortcut synchronously clears '+key,[p.get(cfg.input).value,p.out(),p.get(cfg.status).textContent,event.defaultPrevented],['','','',true]);
      same(tag+' shortcut returns focus to input '+key,p.document.activeElement.id,cfg.input);p.advance(300);same(tag+' queued debounce stays cancelled '+key,[p.out(),p.get(cfg.status).textContent],['','']);
    }
    same(tag+' shared clear executes in both orders',p.clears,[cfg.slug,cfg.slug]);p.example();const outside=p.snapshot();p.key('l','ctrlKey',null);same(tag+' outside shortcut unchanged',p.snapshot(),outside);
    p.get(cfg.input).focus();p.get(cfg.input).dispatch('keydown',{key:'l'});same(tag+' unmodified key unchanged',p.snapshot(),outside);
    p.input(cfg.sample);p.get(cfg.clear).click();p.advance(300);same(tag+' Clear drops pending work',[p.get(cfg.input).value,p.out(),p.get(cfg.status).textContent],['','','']);
    p.example();const output=p.out(),status=p.get(cfg.status).textContent;
    const rejected=p.copy();same(tag+' exact full copy bytes',rejected.value,output);rejected.reject(Error('denied'));await settle();same(tag+' current rejection is localized',p.get(cfg.copy).textContent,labels[lang].copyFailed);same(tag+' current failure keeps output/status',[p.out(),p.get(cfg.status).textContent],[output,status]);
    const retry=p.copy();retry.resolve();await settle();same(tag+' direct retry success',p.get(cfg.copy).textContent,labels[lang].copied);p.advance(1500);same(tag+' success settles to Copy',p.get(cfg.copy).textContent,labels[lang].copy);
    p.context.navigator.clipboard=undefined;let thrown;try{p.copy();}catch(e){thrown=String(e);}same(tag+' absent Clipboard API is handled',thrown,undefined);same(tag+' absent API localized',p.get(cfg.copy).textContent,labels[lang].copyFailed);
    p.context.navigator.clipboard={writeText(){throw Error('sync failure');}};thrown=undefined;try{p.copy();}catch(e){thrown=String(e);}same(tag+' synchronous clipboard throw handled',thrown,undefined);
    for(const finish of ['resolve','reject'])for(const action of ['clear','shortcut','input','result']){
      const q=page(lang,shellFirst);q.example();const job=q.copy();
      if(action==='clear')q.get(cfg.clear).click();else if(action==='shortcut')q.key('L','metaKey',cfg.copy);else{q.input(cfg.sample);if(action==='result')q.advance(300);}
      const current=q.snapshot();job[finish](finish==='reject'?Error('late'):undefined);await settle();same(tag+' stale completion immediately preserves '+action+'/'+finish,q.snapshot(),current);q.advance(1500);same(tag+' stale '+finish+' after '+action,q.snapshot(),action==='input'?{...current,output:q.out(),status:q.get(cfg.status).textContent,statusClass:q.get(cfg.status).className}:current);same(tag+' stale feedback stays reset '+action+'/'+finish,q.get(cfg.copy).textContent,labels[lang].copy);
    }
    const q=page(lang,shellFirst);q.example();q.copy().resolve();await settle();const old=[...q.timers.values()].filter(t=>t.ms===1500).map(t=>t.fn);same(tag+' real success timer exists',old.length>0,true);q.advance(400);q.copy().resolve();await settle();old.forEach(fn=>fn());same(tag+' old timer cannot reset new Copied',q.get(cfg.copy).textContent,labels[lang].copied);q.advance(1500);same(tag+' latest timer settles',q.get(cfg.copy).textContent,labels[lang].copy);
    const r=page(lang,shellFirst);r.example();const one=r.copy(),two=r.copy();two.resolve();await settle();one.reject(Error('older request'));await settle();same(tag+' older rejection cannot replace new success',r.get(cfg.copy).textContent,labels[lang].copied);
    const queued=page(lang,shellFirst);queued.input(cfg.sample);queued.advance(30);queued.example();const generated=queued.tracks.length;queued.copy().resolve();await settle();queued.advance(300);same(tag+' Example cancels queued conversion before Copy',queued.get(cfg.copy).textContent,labels[lang].copied);same(tag+' Example does not run queued conversion again',queued.tracks.length,generated);
    queued.input('{"ctrlEnter": 1}');const beforeShortcut=queued.tracks.length;queued.key('Enter');same(tag+' no primary means CtrlEnter does not generate',[queued.tracks.length,queued.out().includes('ctrlEnter')],[beforeShortcut,false]);queued.advance(300);same(tag+' CtrlEnter preserves the real input debounce',queued.out().includes('ctrlEnter'),true);
    for(const [id,key]of [['jtm-lang-tabs','lang'],['jtm-ts-tabs','ts'],['jtm-req-tabs','req']]){const tabs=p.get(id).querySelectorAll('.jtm-tab');for(const selected of tabs){const before=p.tracks.length,wasActive=selected.classList.contains('active');p.get(cfg.output).textContent='stale';selected.click();same(tag+' option generates immediately '+id,p.out()!=='stale',true);same(tag+' option sends one GA event only when it changes '+id,p.tracks.length,before+(wasActive?0:1));same(tag+' aria-pressed matches active '+id,tabs.map(t=>[t.classList.contains('active'),t.getAttribute('aria-pressed')]),tabs.map(t=>[t===selected,t===selected?'true':'false']));}}
    // B1: the status line names the keys Mongoose skips as schema paths (lib/schema.js specialProperties).
    {const w=page(lang,shellFirst);w.input('{"__proto__":{"x":1},"constructor":"c","b":{"prototype":1}}');w.advance(300);
      same(tag+' B1: status names the keys Mongoose ignores',w.get(cfg.status).textContent.includes(String(labels[lang].msgIgnored).replace('{keys}','__proto__, constructor, prototype')),true);
      w.input('{"b":1}');w.advance(300);same(tag+' B1: no notice without such keys',w.get(cfg.status).textContent,labels[lang].msgGenOne);}
    // Reserved path names (Mongoose 9.10.3 lib/schema.js Schema.reserved): the status line names them.
    {const w=page(lang,shellFirst);w.input('{"save":"s","errors":["e"],"b":{"isNew":true}}');w.advance(300);
      same(tag+' reserved: status names the reserved path names',w.get(cfg.status).textContent.includes(String(labels[lang].msgReserved).replace('{keys}','errors, isNew, save')),true);}
    // S2-10f: other Mongoose 9.10.3 document members, in nested schemas too; a name that breaks a document turns the status amber.
    {const w=page(lang,shellFirst);w.input('{"markModified":1,"model":"m","b":{"set":true,"_doc":"d"},"label":"x"}');w.advance(300);
      const st=w.get(cfg.status).textContent;
      same(tag+' members: status names the keys that break a document',st.includes(String(labels[lang].msgBreaks).replace('{keys}','_doc, markModified')),true);
      same(tag+' members: status names the keys that only replace a member',st.includes(String(labels[lang].msgMembers).replace('{keys}','model, set')),true);
      same(tag+' members: a breaking key turns the status amber',w.get(cfg.status).className,'jtm-status warn');
      w.input('{"get":"g"}');w.advance(300);
      // S2-10f review S2: get and toObject are reserved and also break a document; the status names them once, in the
      // breaking group (before, both notices named them with different consequences).
      same(tag+' members: a reserved name that breaks a document is named once, in the breaking notice',[w.get(cfg.status).textContent,w.get(cfg.status).className],[labels[lang].msgGenOne+' '+String(labels[lang].msgBreaks).replace('{keys}','get'),'jtm-status warn']);
      w.input('{"get":1,"save":2,"toObject":3}');w.advance(300);
      same(tag+' members: other reserved names stay in the reserved notice',[w.get(cfg.status).textContent,w.get(cfg.status).className],[labels[lang].msgGenOne+' '+String(labels[lang].msgReserved).replace('{keys}','save')+' '+String(labels[lang].msgBreaks).replace('{keys}','get, toObject'),'jtm-status warn']);
      w.input('{"model":"m"}');w.advance(300);
      same(tag+' members: a member name alone keeps the success colour',[w.get(cfg.status).textContent,w.get(cfg.status).className],[labels[lang].msgGenOne+' '+String(labels[lang].msgMembers).replace('{keys}','model'),'jtm-status success']);
      w.input('{"b":1}');w.advance(300);same(tag+' members: no notice without such keys',[w.get(cfg.status).textContent,w.get(cfg.status).className],[labels[lang].msgGenOne,'jtm-status success']);}
    // S2-10f: a JSON syntax error names line, column and cause in the page language, clears the output
    // and disables Copy; before, the status was the prefix plus the browser's English message.
    {const w=page(lang,shellFirst);w.example();
      for(const [input,code,line,col,ch] of JSON_ERRORS){w.input(input);w.advance(300);
        same(tag+' JSON error '+code+' in the page language',[w.get(cfg.status).textContent,w.get(cfg.status).classList.contains('error'),w.out(),w.get('jtm-copy').disabled],[jsonErrorMessage(lang,code,line,col,ch),true,'',true]);}}
    // S2-10f review S4: too deep for the call stack. Before, the exception escaped the timer and the old schema and status stayed.
    {const w=page(lang,shellFirst);w.example();w.input(DEEP_JSON);let thrown;try{w.advance(300);}catch(e){thrown=e.name;}
      same(tag+' too deep: no uncaught error',thrown,undefined);
      same(tag+' too deep: notice in the page language, old schema cleared, Copy off',[w.get(cfg.status).textContent,w.get(cfg.status).classList.contains('error'),w.out(),w.get('jtm-copy').disabled,w.get(cfg.input).classList.contains('error')],[labels[lang].msgTooDeep,true,'',true,false]);
      w.get(cfg.input).dispatch('change');same(tag+' too deep: no usage event',w.tracks.length,1);
      w.input('{"b":1}');w.advance(300);same(tag+' too deep: the next input generates again',[w.get(cfg.status).textContent,w.get('jtm-copy').disabled],[labels[lang].msgGenOne,false]);}
    // B2: values beside the objects of a root array are reported, with their count and JSON types.
    {const w=page(lang,shellFirst);w.input('[{"a":1},2,"x",null,[1],3]');w.advance(300);
      same(tag+' B2: status reports the skipped root array values',w.get(cfg.status).textContent.includes(String(labels[lang].msgSkipped).replace('{n}','5').replace('{types}','number × 2, string, null, array')),true);}
    // GA: one generate event per committed action (change, Example, a new option), none on page load or typing pauses.
    {const g=page(lang,shellFirst);same(tag+' GA: page load sends no event',g.tracks.length,0);
      g.input(cfg.sample);g.advance(300);same(tag+' GA: a typing pause regenerates without an event',[g.out().includes('fresh'),g.tracks.length],[true,0]);
      g.get(cfg.input).dispatch('change');same(tag+' GA: change sends one event',g.tracks,[['json-to-mongoose','generate']]);
      g.input('{"pending": true}');g.get(cfg.input).dispatch('change');same(tag+' GA: change flushes the pending edit first',[g.out().includes('pending'),g.tracks.length],[true,2]);g.advance(300);same(tag+' GA: the flushed edit sends nothing more',g.tracks.length,2);
      g.input(cfg.invalid);g.advance(300);g.get(cfg.input).dispatch('change');same(tag+' GA: invalid JSON sends no event',g.tracks.length,2);
      g.input('');g.get(cfg.input).dispatch('change');same(tag+' GA: empty input sends no event',g.tracks.length,2);
      g.example();same(tag+' GA: Example sends one event',g.tracks.length,3);
      g.input('Order','jtm-model-name');g.get('jtm-model-name').dispatch('change');same(tag+' GA: model name change sends one event',[g.out().includes("'Order'"),g.tracks.length],[true,4]);
      // S2-10f: an event that repeats the previous JSON, model name and options is skipped; Clear and Ctrl/⌘+L start over.
      g.example();same(tag+' GA: Example again with nothing changed sends nothing',g.tracks.length,4);
      g.get(cfg.input).dispatch('change');same(tag+' GA: a change with the sent JSON, model name and options sends nothing',g.tracks.length,4);
      g.get('jtm-ts-tabs').querySelectorAll('.jtm-tab').find(t=>!t.classList.contains('active')).click();same(tag+' GA: a new option still sends one',g.tracks.length,5);
      // S2-10f review M1: only a repeat of the previous event is skipped, so switching back to the earlier option sends again.
      g.get('jtm-ts-tabs').querySelectorAll('.jtm-tab').find(t=>!t.classList.contains('active')).click();same(tag+' GA: switching back to the earlier option sends again',g.tracks.length,6);
      g.get(cfg.clear).click();g.example();same(tag+' GA: after Clear the same Example sends again',g.tracks.length,7);
      g.key('l','ctrlKey',cfg.input);g.get('jtm-model-name').value='Order';g.example();same(tag+' GA: after Ctrl+L the same Example sends again',g.tracks.length,8);}
    for(const focus of [p.get('jtm-output'),p.document.querySelector('[data-zt-tip="jtm-tip-copy"]')]){p.example();focus.focus();focus.dispatch('keydown',{key:'L',metaKey:true});same(tag+' output CtrlL returns to input',[p.document.activeElement.id,p.out(),p.get(cfg.input).value],[cfg.input,'','']);}
    p.get('jtm-lang-tabs').querySelector('[data-lang="javascript"]').click();p.example();p.input('Renamed','jtm-model-name');p.advance(300);same(tag+' model name re-generates',p.out().includes("mongoose.model('Renamed'"),true);p.get(cfg.clear).click();same(tag+' explicit Clear retains model option',p.get('jtm-model-name').value,'Renamed');
  }
  await settle();same('no unhandled copy rejection',unhandled,[]);process.removeListener('unhandledRejection',onUnhandled);
}

// ---------- v2 page layout ----------
{
  const equalLayout = (name, got, want) => eq(name, JSON.stringify(got), JSON.stringify(want));
  const check = (name, passed) => equalLayout('v2 ' + name, !!passed, true);
  const strings = new Function(source.slice(source.indexOf('const STRINGS'), source.indexOf('const L = STRINGS')) + ';return STRINGS;')();
  const markup = source.split('\n---')[1].split('<script')[0], css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
  const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  check('registered convert', /'json-to-mongoose':\s*'convert'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
  check('direct flex root', /^\s*<div\s+class="jtm-wrap"/.test(markup) && /\.jtm-wrap\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;/.test(css));
  check('actions then reserved status then panels', markup.indexOf('class="jtm-actions"') < markup.indexOf('id="jtm-status"') && markup.indexOf('id="jtm-status"') < markup.indexOf('class="jtm-panels zt-io"') && /\.jtm-status\s*\{[^}]*height:\s*2\.4rem/.test(css));
  equalLayout('v2 two shared panes', (markup.match(/\bzt-io-pane\b/g)||[]).length, 2);
  check('input and output fill panes', markup.includes('id="jtm-input" class="zt-io-fill"') && markup.includes('class="jtm-output zt-io-fill"'));
  check('accessible output scroller', /id="jtm-output"[^>]*tabindex="0"[^>]*aria-labelledby="jtm-output-label"/.test(markup) && /\.jtm-output\s*\{[^}]*overflow:\s*auto/.test(css));
  check('segmented option groups', (markup.match(/zt-segmented/g)||[]).length===3 && (markup.match(/role="group"/g)||[]).length===3 && (markup.match(/aria-pressed="(?:true|false)"/g)||[]).length===6);
  const mobile=css.slice(css.indexOf('@media (max-width: 860px)'));
  check('mobile input144 and output22rem', /\.jtm-panel textarea\s*\{[^}]*height:\s*144px/.test(mobile) && /\.jtm-output\s*\{[^}]*height:\s*22rem/.test(mobile));
  check('empty output follows actual text and hides on mobile', css.includes('.jtm-output-pane:has(#jtm-output-code:empty) .jtm-empty { display: flex; }') && mobile.includes('.jtm-output-pane:has(#jtm-output-code:empty) { display: none; }'));
  check('phone touch sizing and global dark ancestors', css.includes('@media (max-width: 640px)') && css.includes('min-height: 44px') && css.includes(':global([data-theme="dark"])') && css.includes(':global(:root:not([data-theme="light"]))'));
  check('no automatic Generate control, binding or label', !source.includes('jtm-convert') && !Object.values(strings).some(v=>'generate' in v));
  equalLayout('v2 retained actual operation IDs', [...markup.matchAll(/<button\b[^>]*id="([^"]+)"/g)].map(m=>m[1]).sort(), ['jtm-clear','jtm-copy','jtm-example']);
  check('build-time strings and tips excluded from script data', source.includes("import Toggletip from '../Toggletip.astro'") && !/data-i18n|define:vars|JSON\.stringify\(STRINGS/.test(source) && !/STRINGS|L\.tips/.test(script));
  const map=[['input','jsonInput'],['model','modelName'],['language','language'],['timestamps','timestamps'],['required','required'],['example','example'],['clear','clear'],['copy','copy']];
  equalLayout('v2 eight tips', (markup.match(/<Toggletip\b/g)||[]).length, map.length);
  for(const lang of ['en','zh','ja','ko']){
    const L=strings[lang];equalLayout(lang+' v2 same tip keys',Object.keys(L.tips).sort(),map.map(x=>x[0]).sort());
    check(lang+' localized empty text',typeof L.empty==='string'&&!!L.empty.trim());
    for(const [key,about]of map){check(lang+' localized '+key,typeof L.tips[key]==='string'&&!!L.tips[key].trim()&&typeof L[about]==='string'&&!!L[about].trim());equalLayout(lang+' placeholder parity '+key,[...L.tips[key].matchAll(/\{\w+\}/g)].map(m=>m[0]),[...strings.en.tips[key].matchAll(/\{\w+\}/g)].map(m=>m[0]));check(lang+' binding '+key,markup.includes('<Toggletip id="jtm-tip-'+key+'" lang={lang} about={L.'+about+'}>{L.tips.'+key+'}</Toggletip>'));}
    const mdx=readFileSync(join(root,'src/content/tools/json-to-mongoose/'+lang+'.mdx'),'utf8'),[,fm,body]=mdx.match(/^---\n([\s\S]*?\n)---\n([\s\S]*)$/);
    const stepBlock=fm.match(/^steps:\n((?:  - .*\n)+)/m),steps=stepBlock[1].trimEnd().split('\n').map(line=>JSON.parse(line.slice(4)));
    check(lang+' step limits and before FAQ',steps.length>0&&steps.length<=8&&steps.every(v=>[...v].length<=280)&&steps.reduce((n,v)=>n+[...v].length,0)<=1200&&fm.indexOf('steps:')<fm.indexOf('faqItems:'));
    equalLayout(lang+' MDX content contract', contractProblems('json-to-mongoose', lang), '');
    check(lang+' Usage removed',!/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body));
  }
}


// ja page sample: 気象庁 130000.json, reportDatetime 2026-10-08T17:00:00+09:00 (fetched 2026-10-08), 東京地方 only,
// the weather series with all 3 points and the precipitation series with its first 2 points, values unchanged.
const JMA_20261008_1700 = '[{"publishingOffice":"気象庁","reportDatetime":"2026-10-08T17:00:00+09:00","timeSeries":[{"timeDefines":["2026-10-08T17:00:00+09:00","2026-10-09T00:00:00+09:00","2026-10-10T00:00:00+09:00"],"areas":[{"area":{"name":"東京地方","code":"130010"},"weatherCodes":["100","100","101"],"weathers":["晴れ","晴れ","晴れ\u3000時々\u3000くもり"]}]},{"timeDefines":["2026-10-08T18:00:00+09:00","2026-10-09T00:00:00+09:00"],"areas":[{"area":{"name":"東京地方","code":"130010"},"pops":["0","0"]}]}]}]';
{ const t = readFileSync(join(root, 'src/content/tools/json-to-mongoose/ja.mdx'), 'utf8'); if (!t.includes('<pre><code>{`' + JMA_20261008_1700 + '`}</code></pre>')) { failures++; console.log('FAIL ja page uses the recorded 気象庁 17:00 sample'); } else passes++; }
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
