// TypeScript to Zod — generated schemas run under Zod 3 and Zod 4
//
// Read:  src/components/tools/TypescriptToZodTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers), src/content/tools/typescript-to-zod/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: Record<K, V> becomes z.record(K, V) (the single-argument z.record(V) parses as before in
// Zod 3 but rejects every object in Zod 4, which needs the key schema); the generated code is
// evaluated with the project's zod (3.25) and its `zod/v4` entry, and sample payloads are parsed;
// the limitations the English page states (extends and index signatures dropped, enum declarations
// and undeclared types become z.unknown(), a schema that uses a later declaration throws a
// ReferenceError, recursion too); the outputs and messages quoted on the English page.
//
// Run: node scripts/test-typescript-to-zod.mjs

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

// ---------- limitations stated on the page ----------
const ext = convert('interface Base { id: string }\ninterface Admin extends Base { level: number; [key: string]: unknown }');
eq('extends: base fields not copied', ext.includes('export const AdminSchema = z.object({\n  level: z.number(),\n});'), true);
const unk = convert('enum Role { Admin, User }\ninterface Member { role: Role; joined: Date }');
eq('enum declaration skipped', unk.includes('RoleSchema'), false);
eq('enum reference', unk.includes('role: z.unknown() /* Role */,'), true);
eq('Date reference', unk.includes('joined: z.unknown() /* Date */,'), true);
const order = convert('interface Order { customer: Customer }\ninterface Customer { name: string }');
for (const [v, z] of Object.entries(zods)) {
  let err = '';
  try { load(order, z); } catch (e) { err = e.name; }
  eq(v + ': later declaration throws', err, 'ReferenceError');
  let rerr = '';
  try { load(convert('interface Category { name: string; children: Category[] }'), z); } catch (e) { rerr = e.name; }
  eq(v + ': recursive type throws', rerr, 'ReferenceError');
}
eq('page mentions the ReferenceError', page.includes('ReferenceError'), true);
let noDecl = '';
try { convert('const x = 1;'); } catch (e) { noDecl = e.message; }
eq("no declarations message", noDecl, "No interface or type declarations found.");

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
