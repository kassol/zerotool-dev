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
// S2: ttz-check examples in every language (engine output, tsc strict for zod 3.25 and zod/v4, accepts /
// rejects / drops under both), ttz-error parse messages, prose facts (nullish, ASCII-only names, Box<T>),
// and analytics sent once per committed change.
// Run: node scripts/test-typescript-to-zod.mjs

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { annotations, contractProblems, examplePairs, fencedBlocks } from './lib/tool-mdx-contract.mjs';

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
const engineFor = (noDecl, noColon) => new Function('var MSG_NO_DECL = ' + JSON.stringify(noDecl) + ';\nvar MSG_NO_COLON = ' + JSON.stringify(noColon) + ';\n' + source.slice(startIndex, endIndex) + '\nreturn { tokenize, parse, generate };')();
const E = engineFor('No interface or type declarations found.', 'Line {line}, column {col}: "{name}" needs ":" before its type.');
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
  let out;
  try { out = convert(input); } catch (e) { eq(label + ': converts', e.message, 'no error'); return ''; }
  for (const entry of ['zod', 'zod/v4']) eq(label + ': tsc strict (' + entry + ')', tsErrors(out, entry), []);
  for (const [v, z] of Object.entries(zods)) {
    let S;
    try { S = loadTs(out, z); } catch (e) { eq(label + ' ' + v + ': loads', e.name + ': ' + e.message, 'no error'); continue; }
    for (const [schema, value, ok] of samples) {
      let got;
      try { got = S[schema].safeParse(value).success; } catch (e) { got = 'throws ' + e.message; }
      eq(label + ' ' + v + ': ' + schema + ' ' + JSON.stringify(value), got, ok);
    }
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

// ---------- facts stated in the page prose and FAQ (S2) ----------
const nullish = convert('interface A { p?: string | null }');
eq('prose: prop?: T | null → union with null, optional', nullish.includes('  p: z.union([z.string(), z.null()]).optional(),'), true);
for (const [v, z] of Object.entries(zods)) {
  const { ASchema } = load(nullish, z);
  eq(v + ': prop?: T | null accepts a missing key, null and a value', [{}, { p: null }, { p: 'x' }].map((x) => ASchema.safeParse(x).success), [true, true, true]);
}
// ---------- engine fix 3 (S2-6b): Unicode names, full-width colon, missing colon ----------
// Names were read as A–Z, a–z, digits, _ and $ only, and other characters were skipped without an error
// (名前 dropped, prénom → nom, Café → Caf). Names now follow Unicode ID_Start / ID_Continue (plus $ and _,
// as in TypeScript). A full-width colon U+FF1A outside string literals is read as ":" (the whole input is
// not NFKC-normalised, because that would change string literal types). A property without ":" is a
// parse error with its line and column.
{
  const uni = checkCase('Unicode names', 'interface Café { prénom: string; 名前: string; "닉네임": string; id: string }\ninterface 会員 { 氏名: string; café: Café }', [
    ['会員Schema', { 氏名: '山田', café: { prénom: 'Ana', 名前: '名', 닉네임: '닉', id: '1' } }, true],
    ['会員Schema', { 氏名: '山田', café: { prénom: 'Ana', id: '1', 닉네임: '닉' } }, false],
  ]);
  eq('Unicode: Café keeps its name', uni.includes('export const CaféSchema = z.object({'), true);
  eq('Unicode: prénom and 名前 are properties', ['  prénom: z.string(),', '  名前: z.string(),', '  "닉네임": z.string(),'].map((l) => uni.includes(l)), [true, true, true]);
  eq('Unicode: 会員 is a declaration', uni.includes('export const 会員Schema = z.object({'), true);
  const fw = checkCase('full-width colon', 'interface U { id: string; age：number; label: "a：b" }', [
    ['USchema', { id: '1', age: 3, label: 'a：b' }, true],
    ['USchema', { id: '1', label: 'a：b' }, false],
  ]);
  eq('full-width colon is read as ":"', fw.includes('  age: z.number(),'), true);
  eq('full-width colon inside a string literal type is kept', fw.includes('  label: z.literal("a：b"),'), true);
}
// Members that are not properties are skipped, never reported as a missing colon (review s2-6 must-fix 1):
// methods (plain, optional, generic), get / set accessors, call and construct signatures (plain and
// generic), index signatures.
{
  const skip = checkCase('non-property members are skipped', [
    'interface Api {',
    '  get<T>(url: string): T;',
    '  find?<K extends string>(key: K): number;',
    '  get size(): number;',
    '  set size(v: number);',
    '  get [k](): string;',
    '  (x: number): string;',
    '  <T>(x: T): T;',
    '  new (x: string): Api;',
    '  new <T>(x: T): Api;',
    '  readonly [key: string]: unknown;',
    '  id: number;',
    '  get: string;',
    '  set?: boolean;',
    '  log(msg: string): void;',
    '}',
  ].join('\n'), [
    ['ApiSchema', { id: 1, get: 'g', extra: true }, true],
    ['ApiSchema', { id: 1 }, false],
  ]);
  for (const member of ['get<T>(url: string): T;', 'find?<K extends string>(key: K): number;', 'get size(): number;', 'set size(v: number);', 'get [k](): string;', '(x: number): string;', '<T>(x: T): T;', 'new (x: string): Api;', 'new <T>(x: T): Api;']) {
    let out = '';
    try { out = convert('interface Api { ' + member + ' id: number }'); } catch (e) { out = e.message; }
    eq('skipped member: ' + member, out.split('\n').filter((l) => /^  \S/.test(l)), ['  id: z.number(),']);
  }
  eq('non-property members: only the properties remain', skip.split('\n').filter((l) => /^  \S/.test(l)), ['  id: z.number(),', '  get: z.string(),', '  set: z.boolean().optional(),']);
}
const parseError = (src) => { try { convert(src); return null; } catch (e) { return e.message; } };
eq('missing colon: error with line and column', parseError('interface U {\n  id: string;\n  age number;\n}'), 'Line 3, column 3: "age" needs ":" before its type.');
eq('missing colon: a property with no type', parseError('interface U { a; }'), 'Line 1, column 15: "a" needs ":" before its type.');
eq('missing colon: column counts code points', parseError('type T = { "😀": string; 名前 }'), 'Line 1, column 25: "名前" needs ":" before its type.');
eq('missing colon: quoted key is quoted in the message', parseError('interface U { "収货 人" string }'), 'Line 1, column 15: "収货 人" needs ":" before its type.');
eq('FAQ: Box<T> value → z.unknown() /* T */', convert('interface Box<T> { value: T }').includes('  value: z.unknown() /* T */,'), true);
let classOnly = '';
try { convert('class User { name: string }'); } catch (e) { classOnly = e.message; }
eq('FAQ: classes only → no declarations message', classOnly, 'No interface or type declarations found.');
eq('prose: missing brace message', (() => { try { convert('interface A { a: string'); } catch (e) { return e.message; } })(), 'Expected "}" got ""');

// ---------- engine fix 1 (S2-6b): names that are Object.prototype members ----------
// The keyword, primitive-type and generator tables were plain objects, so a type named constructor or
// toString was read as a primitive and printed as native function source, and cycle detection treated
// it as visited.
{
  const out = checkCase('prototype member type names', 'interface constructor { a: string }\ninterface toString { b: number }\ninterface hasOwnProperty { c: boolean }\ninterface User { x: constructor; y: toString[]; z: hasOwnProperty }', [
    ['UserSchema', { x: { a: '1' }, y: [{ b: 1 }], z: { c: true } }, true],
    ['UserSchema', { x: { a: 1 }, y: [], z: { c: true } }, false],
    ['UserSchema', { x: { a: '1' }, y: [{ b: '1' }], z: { c: true } }, false],
  ]);
  eq('prototype names: no native code in the output', /native code/.test(out), false);
  eq('prototype names: references use the schemas', ['  x: constructorSchema,', '  y: z.array(toStringSchema),', '  z: hasOwnPropertySchema,'].map((l) => out.includes(l)), [true, true, true]);
  eq('prototype names: no false cycles', /z\.ZodType</.test(out), false);
  const cyc = checkCase('prototype member names in a cycle', 'interface toString { n: valueOf }\ninterface valueOf { t?: toString }', [
    ['toStringSchema', { n: { t: { n: {} } } }, true],
    ['toStringSchema', { n: { t: { n: { t: 1 } } } }, false],
  ]);
  eq('prototype names: the real cycle is annotated', (cyc.match(/: z\.ZodType</g) || []).length, 2);
}

// ---------- engine fix 2 (S2-6b): a property named __proto__ ----------
// `{ __proto__: z.string() }` in an object literal sets the prototype of the shape, so the key was never
// checked. A computed key `["__proto__"]` defines an own property. Both Zod versions then require and check
// the key, but leave it out of the parsed result (zod/v3/helpers/parseUtil.js and zod/v4/core/schemas.js
// skip "__proto__" on purpose).
for (const decl of ['interface T { __proto__: string; id: string }', 'interface T { "__proto__": string; id: string }']) {
  const out = checkCase('__proto__ key ' + decl, decl, [
    ['TSchema', JSON.parse('{"__proto__": "x", "id": "1"}'), true],
    ['TSchema', { id: '1' }, false],
    ['TSchema', JSON.parse('{"__proto__": 1, "id": "1"}'), false],
  ]);
  eq('__proto__ key is written as a computed key: ' + decl, out.includes('  ["__proto__"]: z.string(),'), true);
  for (const [v, z] of Object.entries(zods)) {
    const S = loadTs(out, z).TSchema;
    eq(v + ': __proto__ is an own key of the shape: ' + decl, Object.keys(S.shape), ['__proto__', 'id']);
    eq(v + ': Zod leaves __proto__ out of the parsed result: ' + decl, Object.keys(S.parse(JSON.parse('{"__proto__": "x", "id": "1"}'))), ['id']);
  }
}

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

// ---------- real page lifecycle ----------
// Execute the complete production script and actual shared keyboard listener.
// Only DOM, timers, highlighting and clipboard delivery are controlled here.
{
  console.log('Original regression: ' + passes + ' passed, ' + failures + ' failed');
  const cfg = {"slug": "typescript-to-zod", "file": "TypescriptToZodTool.astro", "input": "ttz-input", "output": "ttz-output-code", "status": "ttz-status", "copy": "ttz-copy", "clear": "ttz-clear", "example": "ttz-example", "invalid": "const x = 1;", "sample": "interface Fresh { active: boolean; }", "valueOutput": false};
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
    const runs=q=>q.highlights.filter(id=>id==='ttz-output-code').length;
    const queued=page(lang,shellFirst);queued.input(cfg.sample);queued.advance(30);queued.example();const highlighted=queued.highlights.filter(id=>id==='ttz-input-hl-code').length,generated=runs(queued);queued.copy().resolve();await settle();queued.advance(300);same(tag+' Example cancels queued conversion before Copy',queued.get(cfg.copy).textContent,labels[lang].copied);same(tag+' Example does not run queued conversion again',runs(queued),generated);same(tag+' Example cancels obsolete highlighting',queued.highlights.filter(id=>id==='ttz-input-hl-code').length,highlighted);
    queued.input(cfg.sample);const beforeShortcut=runs(queued);queued.key('Enter');same(tag+' no primary button means CtrlEnter does not generate',runs(queued),beforeShortcut);queued.advance(300);same(tag+' CtrlEnter leaves the real debounce intact',runs(queued),beforeShortcut+1);same(tag+' input highlighting remains queued',queued.get('ttz-input-hl-code').textContent,cfg.sample+'\n');
    // Analytics: one event per committed change (textarea change, Example), not on load or per typing pause; the same input once.
    const ga=page(lang,shellFirst),gaEvent=['typescript-to-zod','generate'];same(tag+' GA: page load sends nothing',ga.tracks.length,0);
    ga.input(cfg.sample);ga.advance(300);same(tag+' GA: typing pause sends nothing',ga.tracks.length,0);
    ga.get(cfg.input).dispatch('change');same(tag+' GA: committed change sends one event',ga.tracks,[gaEvent]);
    ga.get(cfg.input).dispatch('change');same(tag+' GA: the same input again sends nothing',ga.tracks.length,1);
    ga.input('interface Next { n: number }');ga.get(cfg.input).dispatch('change');same(tag+' GA: change before the debounce generates the new input first',[ga.out().includes('NextSchema'),ga.tracks.length],[true,2]);ga.advance(300);same(tag+' GA: no event after the debounce',ga.tracks.length,2);
    ga.input(cfg.invalid);ga.get(cfg.input).dispatch('change');same(tag+' GA: invalid input sends nothing',ga.tracks.length,2);
    ga.example();same(tag+' GA: Example sends one event',ga.tracks.length,3);ga.get(cfg.input).dispatch('change');same(tag+' GA: change on the unchanged example sends nothing',ga.tracks.length,3);
    ga.get(cfg.clear).click();ga.example();same(tag+' GA: the same example after Clear is sent again',ga.tracks.length,4);
    for(const focus of [p.get('ttz-output'),p.document.querySelector('[data-zt-tip="ttz-tip-copy"]')]){p.example();focus.focus();focus.dispatch('keydown',{key:'L',metaKey:true});same(tag+' output area CtrlL returns to editable input',[p.document.activeElement.id,p.out(),p.get(cfg.input).value,p.get(cfg.status).textContent],[cfg.input,'','','']);}
    // Error positions count the original input, including leading blank lines and spaces (review s2-6 must-fix 2)
    const at=(line,col,name)=>labels[lang].msgError+labels[lang].msgNoColon.replace('{line}',line).replace('{col}',col).replace('{name}',name);
    const lc=page(lang,shellFirst);lc.input('\n\n\n  interface U {\n    name string;\n  }\n\n');lc.advance(300);same(tag+' error position after leading blank lines',lc.get(cfg.status).textContent,at(5,5,'name'));
    lc.input('   interface U { a b }');lc.advance(300);same(tag+' error column after leading spaces',lc.get(cfg.status).textContent,at(1,18,'a'));
    lc.input('  \n  ');lc.advance(300);same(tag+' whitespace-only input stays empty',[lc.out(),lc.get(cfg.status).textContent],['','']);
    p.input('interface T { x: string; }');p.advance(79);const beforeHL=p.get('ttz-input-hl-code').textContent;p.advance(1);same(tag+' 80ms highlighting reads current input',p.get('ttz-input-hl-code').textContent,'interface T { x: string; }\n');p.get(cfg.input).scrollTop=21;p.get(cfg.input).scrollLeft=17;p.get(cfg.input).dispatch('scroll');same(tag+' input scroll is mirrored',[p.get('ttz-input-hl-code').parentElement.scrollTop,p.get('ttz-input-hl-code').parentElement.scrollLeft],[21,17]);p.get(cfg.clear).click();p.advance(300);same(tag+' Clear also clears input highlighting',p.get('ttz-input-hl-code').textContent,'');
  }
  await settle();same('no unhandled copy rejection',unhandled,[]);process.removeListener('unhandledRejection',onUnhandled);
}

// ---------- v2 page layout ----------
{
  const check = (name, passed) => eq('v2 ' + name, !!passed, true);
  const strings = new Function(source.slice(source.indexOf('const STRINGS'), source.indexOf('const L = STRINGS')) + ';return STRINGS;')();
  const markup = source.split('\n---')[1].split('<script')[0], css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
  const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  check('registered convert', /'typescript-to-zod':\s*'convert'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
  check('direct flex root', /^\s*<div\s+class="ttz-wrap"/.test(markup) && /\.ttz-wrap\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;/.test(css));
  check('actions then reserved status then panels', markup.indexOf('class="ttz-actions"') < markup.indexOf('id="ttz-status"') && markup.indexOf('id="ttz-status"') < markup.indexOf('class="ttz-panels zt-io"') && /\.ttz-status\s*\{[^}]*height:\s*2\.4rem/.test(css));
  eq('v2 two shared panes', (markup.match(/\bzt-io-pane\b/g)||[]).length, 2);
  check('overlay and output fill panes', markup.includes('class="ttz-input-wrap zt-io-fill"') && markup.includes('class="ttz-output zt-io-fill"'));
  check('accessible output scroller', /id="ttz-output"[^>]*tabindex="0"[^>]*aria-labelledby="ttz-output-label"/.test(markup) && /\.ttz-output\s*\{[^}]*overflow:\s*auto/.test(css));
  check('overlay still shares text metrics and scroll is mirrored', css.includes('white-space: pre-wrap') && css.includes('pointer-events: none') && script.includes('pre.scrollTop = inputEl.scrollTop') && script.includes('pre.scrollLeft = inputEl.scrollLeft'));
  const mobile=css.slice(css.indexOf('@media (max-width: 860px)'));
  check('mobile input144 and output22rem', /\.ttz-input-wrap\s*\{[^}]*height:\s*144px/.test(mobile) && /\.ttz-output\s*\{[^}]*height:\s*22rem/.test(mobile));
  check('empty output follows actual text and hides on mobile', css.includes('.ttz-output-pane:has(#ttz-output-code:empty) .ttz-empty { display: flex; }') && mobile.includes('.ttz-output-pane:has(#ttz-output-code:empty) { display: none; }'));
  check('phone touch sizing and global dark ancestors', css.includes('@media (max-width: 640px)') && css.includes('min-height: 44px') && css.includes(':global([data-theme="dark"])') && css.includes(':global(:root:not([data-theme="light"]))'));
  check('no automatic Generate control, binding or label', !source.includes('ttz-convert') && !Object.values(strings).some(v=>'generate' in v));
  eq('v2 retained actual operation IDs', [...markup.matchAll(/<button\b[^>]*id="([^"]+)"/g)].map(m=>m[1]).sort(), ['ttz-clear','ttz-copy','ttz-example']);
  check('build-time strings and tips excluded from script data', source.includes("import Toggletip from '../Toggletip.astro'") && !/data-i18n|define:vars|JSON\.stringify\(STRINGS/.test(source) && !/STRINGS|L\.tips/.test(script));
  const map=[['input','tsInput'],['example','example'],['clear','clear'],['copy','copy']];
  eq('v2 four tips', (markup.match(/<Toggletip\b/g)||[]).length, map.length);
  for(const lang of ['en','zh','ja','ko']){
    const L=strings[lang];eq(lang+' v2 same tip keys',Object.keys(L.tips).sort(),map.map(x=>x[0]).sort());
    check(lang+' localized empty text',typeof L.empty==='string'&&!!L.empty.trim());
    for(const [key,about]of map){check(lang+' localized '+key,typeof L.tips[key]==='string'&&!!L.tips[key].trim()&&typeof L[about]==='string'&&!!L[about].trim());eq(lang+' placeholder parity '+key,[...L.tips[key].matchAll(/\{\w+\}/g)].map(m=>m[0]),[...strings.en.tips[key].matchAll(/\{\w+\}/g)].map(m=>m[0]));check(lang+' binding '+key,markup.includes('<Toggletip id="ttz-tip-'+key+'" lang={lang} about={L.'+about+'}>{L.tips.'+key+'}</Toggletip>'));}
    const mdx=readFileSync(join(root,'src/content/tools/typescript-to-zod/'+lang+'.mdx'),'utf8'),[,fm,body]=mdx.match(/^---\n([\s\S]*?\n)---\n([\s\S]*)$/);
    const stepBlock=fm.match(/^steps:\n((?:  - .*\n)+)/m),steps=stepBlock[1].trimEnd().split('\n').map(line=>JSON.parse(line.slice(4)));
    check(lang+' step limits and before FAQ',steps.length>0&&steps.length<=8&&steps.every(v=>[...v].length<=280)&&steps.reduce((n,v)=>n+[...v].length,0)<=1200&&fm.indexOf('steps:')<fm.indexOf('faqItems:'));
    eq(lang+' MDX content contract', contractProblems('typescript-to-zod', lang), '');
    // TypeScript → Zod examples, recomputed.
    const zodPairs=examplePairs(body,b=>b.lang==='pre'&&/^(?:interface|type|enum|export (?:interface|type))\b/.test(b.text),b=>b.lang==='pre'&&/^import \{ z \}/.test(b.text));
    eq(lang+' has TypeScript → Zod examples',zodPairs.length>0,true);
    eq(lang+' each Zod example equals the engine output',zodPairs.filter(([a,b])=>convert(a.text)!==b.text).map(([,b])=>b.text),[]);
    // {/* ttz-check: {"schema": "NameSchema", "accepts": [...], "rejects": [...], "drops": [...]} */}: the first two <pre>
    // blocks after the marker are the TypeScript input and the engine output. The output must equal the engine, pass
    // tsc strict against zod 3.25 and zod/v4, and load under both; "accepts" must parse, "rejects" must fail, and the
    // parsed result of the first accepted value must not contain the keys in "drops" (Zod strips unknown keys).
    // {/* ttz-error: {"message": "..."} */}: the first <pre> block after the marker gives the page language's
    // "Parse error: " + message (the engine runs with that language's messages).
    const notes=annotations(body,'ttz-check');
    eq(lang+' has at least 2 ttz-check examples',notes.length>=2,true);
    notes.forEach((note,i)=>{
      const tag=lang+' ttz-check #'+(i+1),blocks=fencedBlocks(note.after).filter(b=>b.lang==='pre');
      if(blocks.length<2){eq(tag+' has input and output blocks',blocks.length,2);return;}
      const out=convert(blocks[0].text);eq(tag+' output equals the engine',blocks[1].text,out);
      for(const entry of ['zod','zod/v4'])eq(tag+' tsc strict ('+entry+')',tsErrors(out,entry),[]);
      for(const [v,z] of Object.entries(zods)){
        let S;try{S=loadTs(out,z);}catch(e){eq(tag+' '+v+' loads',e.message,'no error');continue;}
        const schema=S[note.spec?.schema];if(note.spec?.schema&&!schema){eq(tag+' names an exported schema',note.spec.schema,'');continue;}
        for(const value of note.spec?.accepts??[])eq(tag+' '+v+' accepts '+JSON.stringify(value),schema.safeParse(value).success,true);
        for(const value of note.spec?.rejects??[])eq(tag+' '+v+' rejects '+JSON.stringify(value),schema.safeParse(value).success,false);
        // drops: a key ("a") or a dotted path ("message.markAsReadToken") present in accepts[0] and absent after parsing
        if(note.spec?.drops){
          const parsed=schema.parse(note.spec.accepts[0]),at=(o,path)=>path.split('.').reduce((x,k)=>x==null?undefined:x[k],o);
          const owns=(o,path)=>{const parts=path.split('.'),parent=at(o,parts.slice(0,-1).join('.')||'');const obj=parts.length>1?parent:o;return obj!=null&&Object.prototype.hasOwnProperty.call(obj,parts.at(-1));};
          eq(tag+' '+v+' drops '+note.spec.drops.join(','),note.spec.drops.filter(k=>!owns(note.spec.accepts[0],k)||owns(parsed,k)),[]);
        }
      }
    });
    for(const note of annotations(body,'ttz-error')){
      const block=fencedBlocks(note.after).find(b=>b.lang==='pre');let message='';
      const LE=engineFor(strings[lang].msgNoDecl,strings[lang].msgNoColon);
      try{LE.generate(LE.parse(LE.tokenize(block.text)));}catch(e){message=e.message;}
      eq(lang+' ttz-error example gives '+note.spec?.message,message,note.spec?.message);
      eq(lang+' ttz-error message is quoted on the page',note.after.includes(strings[lang].msgError+note.spec?.message),true);
    }
    check(lang+' Usage removed',!/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body));
  }
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
