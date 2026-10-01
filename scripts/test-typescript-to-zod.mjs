// TypeScript to Zod — generated schemas run under Zod 3 and Zod 4
//
// Read:  src/components/tools/TypescriptToZodTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers), src/content/tools/typescript-to-zod/en.mdx,
//        node_modules/typescript, node_modules/zod (type-checks in memory, writes no files)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: Record<K, V> becomes z.record(K, V) (the single-argument z.record(V) parses as before in
// Zod 3 but rejects every object in Zod 4, which needs the key schema); every generated module is
// type-checked with the TypeScript compiler API (strict, against the types of `zod` 3.25 and
// `zod/v4`) and evaluated with both, and sample payloads are parsed. extends → .extend() (two
// bases, generic base, base declared later, non-object base → z.intersection, undeclared base →
// note); index signatures → .catchall(V) next to properties (extra keys kept and checked) or
// z.record(z.string(), V) alone; a property named readonly; schemas written dependencies first
// (they used to follow the input and threw ReferenceError); self and mutual recursion with
// z.lazy() and a written-out TS type with z.ZodType<T>; enum declarations (string, numeric with
// auto-increment, mixed, const / declare, computed → note); the page examples and messages.
// Run: node scripts/test-typescript-to-zod.mjs

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const source = readFileSync(join(root, 'src/components/tools/TypescriptToZodTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/typescript-to-zod/en.mdx'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in TypescriptToZodTool.astro');
  process.exit(1);
}
const E = new Function('var MSG_NO_DECL = "No interface or type declarations found.";\n' + source.slice(startIndex, endIndex) + '\nreturn { tokenize, parse, generate };')();
const convert = (src) => E.generate(E.parse(E.tokenize(src)));
const zods = { v3: require('zod').z, v4: require('zod/v4').z };

// Turn the generated module into a function that returns its schemas
function load(code, z) {
  const names = [...code.matchAll(/^export const (\w+) =/gm)].map((m) => m[1]);
  const body = code
    .replace(/^import .*$/m, '')
    .replace(/^export type .*$/gm, '')
    .replace(/^export const /gm, 'const ');
  return new Function('z', body + '\nreturn { ' + names.join(', ') + ' };')(z);
}

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + e + '\n  actual   ' + a);
}

// ---------- Record ----------
const rec = convert('interface Scores { byUser: Record<string, number>; perms: Record<"read" | "write", boolean>; }');
eq('Record with string keys', rec.includes('byUser: z.record(z.string(), z.number()),'), true);
eq('Record with literal keys', rec.includes('perms: z.record(z.enum(["read", "write"]), z.boolean()),'), true);
for (const [v, z] of Object.entries(zods)) {
  const { ScoresSchema } = load(rec, z);
  eq(v + ': full payload', ScoresSchema.safeParse({ byUser: { ann: 3 }, perms: { read: true, write: false } }).success, true);
  eq(v + ': wrong value type', ScoresSchema.safeParse({ byUser: { ann: '3' }, perms: { read: true, write: false } }).success, false);
}
// Zod 4 checks every key of a literal-key record (as TypeScript does); Zod 3 does not
eq('v4: missing literal key fails', load(rec, zods.v4).ScoresSchema.safeParse({ byUser: {}, perms: { read: true } }).success, false);
eq('v3: missing literal key passes', load(rec, zods.v3).ScoresSchema.safeParse({ byUser: {}, perms: { read: true } }).success, true);

// ---------- page examples ----------
const USER_INPUT = `interface Address {
  street: string;
  city: string;
  zipCode?: string;
}

export interface User {
  id: number;
  name: string;
  role: "admin" | "user" | "guest";
  age?: number;
  isActive: boolean;
  tags: string[];
  address: Address;
}

export type Status = "active" | "inactive" | "pending";`;
const SIGNUP_INPUT = `interface SignupForm {
  email: string;
  password: string;
  nickname?: string;
  referrer: string | null;
  age?: number | undefined;
  plan: "free" | "pro";
}`;
for (const [label, input] of [['User example', USER_INPUT], ['Signup example', SIGNUP_INPUT]]) {
  const out = convert(input);
  eq('page shows input for ' + label, page.includes(input), true);
  eq('page shows output for ' + label, page.includes(out), true);
  for (const [v, z] of Object.entries(zods)) eq(v + ': ' + label + ' loads', typeof load(out, z), 'object');
}
for (const [v, z] of Object.entries(zods)) {
  const { SignupFormSchema } = load(convert(SIGNUP_INPUT), z);
  eq(v + ': signup without format rules passes', SignupFormSchema.safeParse({ email: 'not-an-email', password: '1', referrer: null, plan: 'pro' }).success, true);
  eq(v + ': signup without referrer fails', SignupFormSchema.safeParse({ email: 'a@example.com', password: 'x', plan: 'free' }).success, false);
  eq(v + ': signup with unknown plan fails', SignupFormSchema.safeParse({ email: 'a@example.com', password: 'x', referrer: 'ad', plan: 'team' }).success, false);
}

// ---------- TypeScript compiler check (strict) against zod 3 and zod/v4 types ----------
const TS_OPTIONS = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts'], types: [], skipLibCheck: true };
function tsErrors(code, entry) {
  const text = code.replace('from "zod";', 'from "' + entry + '";');
  const fileName = join(root, '__typescript_to_zod_check__.ts');
  const host = ts.createCompilerHost(TS_OPTIONS);
  const origGet = host.getSourceFile;
  const origExists = host.fileExists;
  const origRead = host.readFile;
  host.getSourceFile = (name, lang) => (name === fileName ? ts.createSourceFile(name, text, lang) : origGet.call(host, name, lang));
  host.fileExists = (name) => name === fileName || origExists.call(host, name);
  host.readFile = (name) => (name === fileName ? text : origRead.call(host, name));
  const program = ts.createProgram([fileName], TS_OPTIONS, host);
  return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
}
// load() for code that may contain TypeScript-only syntax (type annotations, interfaces)
function loadTs(code, z) {
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(() => ({ z }), module, module.exports);
  return module.exports;
}
function checkCase(label, input, samples) {
  const out = convert(input);
  for (const entry of ['zod', 'zod/v4']) eq(label + ': tsc strict (' + entry + ')', tsErrors(out, entry), []);
  for (const [v, z] of Object.entries(zods)) {
    let S;
    try { S = loadTs(out, z); } catch (e) { eq(label + ' ' + v + ': loads', e.name + ': ' + e.message, 'no error'); continue; }
    for (const [schema, value, ok] of samples) eq(label + ' ' + v + ': ' + schema + ' ' + JSON.stringify(value), S[schema].safeParse(value).success, ok);
  }
  return out;
}

// ---------- extends ----------
const ext = checkCase('extends', 'interface Base { id: string }\ninterface Admin extends Base { level: number }', [
  ['AdminSchema', { id: 'a', level: 2 }, true],
  ['AdminSchema', { level: 2 }, false],
]);
eq('extends uses .extend()', ext.includes('export const AdminSchema = BaseSchema.extend({\n  level: z.number(),\n});'), true);
const ext2 = checkCase('two bases, generic base', 'interface Named { name: string }\ninterface Stamped<T> { at: T }\ninterface Doc extends Named, Stamped<number> { body: string }', [
  ['DocSchema', { name: 'n', at: 'x', body: 'b' }, true],
  ['DocSchema', { at: 1, body: 'b' }, false],
]);
eq('two bases: .extend(Other.shape)', ext2.includes('NamedSchema.extend(StampedSchema.shape).extend({'), true);
const ext3 = checkCase('base declared later', 'interface Admin extends Base { level: number }\ninterface Base { id: string }', [
  ['AdminSchema', { id: 'a', level: 1 }, true],
  ['AdminSchema', { level: 1 }, false],
]);
eq('base is written first', ext3.indexOf('BaseSchema =') < ext3.indexOf('AdminSchema ='), true);
const ext4 = checkCase('base is an intersection alias', 'type Base = { id: string } & { v: number }\ninterface Admin extends Base { level: number }', [
  ['AdminSchema', { id: 'a', v: 1, level: 1 }, true],
  ['AdminSchema', { id: 'a', level: 1 }, false],
]);
eq('non-object base uses z.intersection', ext4.includes('export const AdminSchema = z.intersection(BaseSchema, z.object({'), true);
const ext5 = convert('interface Admin extends Imported { level: number }');
eq('undeclared base keeps a note', ext5.includes('export const AdminSchema = z.object({\n  level: z.number(),\n}) /* extends Imported: not declared in the input */;'), true);

// ---------- index signatures ----------
const idx = checkCase('index signature with properties', 'interface Env { NODE_ENV: string; [key: string]: string }', [
  ['EnvSchema', { NODE_ENV: 'prod', PORT: '80' }, true],
  ['EnvSchema', { NODE_ENV: 'prod', PORT: 80 }, false],
  ['EnvSchema', { PORT: '80' }, false],
]);
eq('catchall', idx.includes('}).catchall(z.string());'), true);
for (const [v, z] of Object.entries(zods)) eq(v + ': catchall keeps the extra key', loadTs(idx, z).EnvSchema.parse({ NODE_ENV: 'x', PORT: '80' }).PORT, '80');
const rec2 = checkCase('index signature only', 'interface Dict { readonly [key: string]: number }\ntype Flags = { [name: string]: boolean }', [
  ['DictSchema', { a: 1 }, true],
  ['DictSchema', { a: '1' }, false],
  ['FlagsSchema', { x: true }, true],
]);
eq('only an index signature → z.record', rec2.includes('export const DictSchema = z.record(z.string(), z.number());'), true);
const rp = convert('interface T { readonly: boolean; readonly id: string }');
eq('a property named readonly', rp.includes('  readonly: z.boolean(),\n  id: z.string(),'), true);

// ---------- declaration order ----------
const order = checkCase('later declaration', 'interface Order { customer: Customer; items: Item[] }\ninterface Customer { name: string }\ntype Item = { sku: string }', [
  ['OrderSchema', { customer: { name: 'a' }, items: [{ sku: 'x' }] }, true],
  ['OrderSchema', { customer: {}, items: [] }, false],
]);
eq('dependencies first, input order otherwise', [...order.matchAll(/^export const (\w+)/gm)].map((m) => m[1]), ['CustomerSchema', 'ItemSchema', 'OrderSchema']);

// ---------- recursion ----------
const cat = checkCase('recursive type', 'interface Category { name: string; children: Category[] }', [
  ['CategorySchema', { name: 'a', children: [{ name: 'b', children: [] }] }, true],
  ['CategorySchema', { name: 'a', children: [{ name: 'b' }] }, false],
]);
eq('recursive: z.lazy', cat.includes('children: z.array(z.lazy(() => CategorySchema)),'), true);
eq('recursive: annotated with the TS type', cat.includes('export const CategorySchema: z.ZodType<Category> = z.object({'), true);
eq('recursive: TS type written out', cat.includes('export interface Category { name: string; children: Category[] }'), true);
const mut = checkCase('mutual recursion', 'type Expr = Num | Add;\ninterface Num { kind: "num"; value: number }\ninterface Add { kind: "add"; left: Expr; right: Expr }', [
  ['ExprSchema', { kind: 'add', left: { kind: 'num', value: 1 }, right: { kind: 'num', value: 2 } }, true],
  ['ExprSchema', { kind: 'add', left: { kind: 'num' }, right: { kind: 'num', value: 2 } }, false],
]);
eq('mutual recursion: only cycle members (Expr, Add) annotated', (mut.match(/: z\.ZodType</g) || []).length, 2);

// ---------- enums ----------
const en = checkCase('enums', 'enum Color { Red = "RED", Green = "GREEN" }\nexport const enum Level { Low, Mid = 5, High }\ndeclare enum Mixed { A = "a", B = 2 }\ninterface Pixel { color: Color; level: Level; m: Mixed }', [
  ['PixelSchema', { color: 'RED', level: 6, m: 'a' }, true],
  ['PixelSchema', { color: 'red', level: 6, m: 'a' }, false],
  ['PixelSchema', { color: 'RED', level: 1, m: 'a' }, false],
  ['PixelSchema', { color: 'RED', level: 0, m: 2 }, true],
]);
eq('string enum → z.enum', en.includes('export const ColorSchema = z.enum(["RED", "GREEN"]);'), true);
eq('numeric enum → literal union with auto-increment', en.includes('export const LevelSchema = z.union([z.literal(0), z.literal(5), z.literal(6)]);'), true);
eq('mixed enum', en.includes('export const MixedSchema = z.union([z.literal("a"), z.literal(2)]);'), true);
const comp = convert('enum E { A = 1 << 2, B }');
eq('computed member → unknown with a note', comp.includes('export const ESchema = z.unknown() /* enum E: computed member A */;'), true);
const unk = convert('interface Member { joined: Date }');
eq('Date reference', unk.includes('joined: z.unknown() /* Date */,'), true);

// ---------- page ----------
eq('page no longer says extends is skipped', page.includes('</code> is skipped.'), false);
const MENU = 'interface Menu extends Base { root: Category; [key: string]: unknown }\ninterface Base { id: string }\ninterface Category { name: string; children: Category[] }';
eq('page shows the recursion example input', page.includes(MENU), true);
const menuOut = checkCase('page recursion example', MENU, [
  ['MenuSchema', { id: 'm', root: { name: 'r', children: [] }, extra: 1 }, true],
  ['MenuSchema', { root: { name: 'r', children: [] } }, false],
]);
eq('page shows the recursion example output', page.includes(menuOut), true);
eq('page no longer says index signatures are skipped', /Index signatures are skipped/.test(page), false);
let noDecl = '';
try { convert('const x = 1;'); } catch (e) { noDecl = e.message; }
eq("no declarations message", noDecl, "No interface or type declarations found.");

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
