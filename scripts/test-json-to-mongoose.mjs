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
// required on), ISO date-time strings → Date, plain dates → String, null → Mixed, array of
// objects → sub-schema with the keys of all elements (first value of each key decides its type).
//
// Run: node scripts/test-json-to-mongoose.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToMongooseTool.astro'), 'utf8');
const a = source.indexOf('/* ── engine:start ── */');
const b = source.indexOf('/* ── engine:end ── */');
if (a < 0 || b <= a) { console.error('FAIL: engine block not found'); process.exit(1); }
const E = new Function(source.slice(a, b) + '\nreturn { buildSchemaFromObj, renderOutput, toCamelCase, toPascalCase, mergeObjects };')();

let passes = 0, failures = 0;
function eq(name, got, want) {
  if (got === want) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + '\n  got:      ' + JSON.stringify(got) + '\n  expected: ' + JSON.stringify(want)); }
}
function gen(json, model, mode, timestamps, required) {
  const p = JSON.parse(json);
  const obj = Array.isArray(p) ? E.mergeObjects(p.filter((x) => x && typeof x === 'object' && !Array.isArray(x))) : p;
  const schemas = [];
  E.buildSchemaFromObj(obj, E.toCamelCase(model) + 'Schema', 'I' + E.toPascalCase(model), schemas);
  return E.renderOutput(schemas, model, mode, timestamps, required);
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

eq('first value decides the type (null then string → Mixed)', gen('[{"v": null}, {"v": "x"}]', 'T', 'javascript', false, false).includes('v: { type: mongoose.Schema.Types.Mixed },'), true);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
