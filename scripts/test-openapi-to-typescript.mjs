// OpenAPI to TypeScript — generated TypeScript compiles and the Zod module loads and validates
//
// Read:  src/components/tools/OpenapiToTypescriptTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers and transpiles it with the
//        TypeScript compiler; also reads the built-in EXAMPLE spec), node_modules/typescript,
//        node_modules/zod, src/content/tools/openapi-to-typescript/{en,zh,ja,ko}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Every fixture is generated with path types and Zod schemas on, then:
//   - type-checked with the TypeScript compiler API (strict, lib es2022 + dom, `zod` resolved
//     from node_modules), so the output must compile with zero diagnostics;
//   - transpiled to CommonJS and executed with the real zod 3.25, then sample values are
//     parsed with the generated schemas.
// Defects covered (before the fix): an external $ref became a type named `unknown` and the
// invalid line `export type unknown = unknown;`; a schema named `pet-status` was renamed to
// `pet_status` and then looked up under the new name, so its enum became `unknown`; `const`
// was ignored (`Record<string, unknown>`); Zod schemas were emitted in declaration order
// without z.lazy, so a forward reference or recursion threw ReferenceError on load.
// Also: names that are TypeScript keywords / start with a digit, JSON Pointer escapes in
// refs (~1), unresolved refs are reported, the tool page examples match the engine output.
//
// Run: node scripts/test-openapi-to-typescript.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import jsyaml from 'js-yaml';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = process.env.OPENAPI_TS_SOURCE || join(root, 'src/components/tools/OpenapiToTypescriptTool.astro');
const source = readFileSync(sourcePath, 'utf8');
const require = createRequire(join(root, 'package.json'));
const { z } = require('zod');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in OpenapiToTypescriptTool.astro');
  process.exit(1);
}
const engineJs = ts.transpileModule(source.slice(startIndex, endIndex), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const E = new Function(engineJs + '\nreturn { generateAll };')();
const EXAMPLE = /const EXAMPLE = `([\s\S]*?)`;/.exec(source)[1];

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}

const OPTIONS = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [], skipLibCheck: true };
function compile(code) {
  const fileName = join(root, '__openapi_to_ts_check__.ts');
  const host = ts.createCompilerHost(OPTIONS);
  const origGet = host.getSourceFile;
  const origExists = host.fileExists;
  const origRead = host.readFile;
  host.getSourceFile = (name, lang) => (name === fileName ? ts.createSourceFile(name, code, lang) : origGet.call(host, name, lang));
  host.fileExists = (name) => name === fileName || origExists.call(host, name);
  host.readFile = (name) => (name === fileName ? code : origRead.call(host, name));
  const program = ts.createProgram([fileName], OPTIONS, host);
  return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}
function load(code) {
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((n) => (n === 'zod' ? { z } : require(n)), module, module.exports);
  return module.exports;
}
function gen(yaml, extra) {
  const doc = jsyaml.load(yaml, { schema: jsyaml.JSON_SCHEMA });
  return E.generateAll(doc, Object.assign({ optional: false, includePaths: true, includeZod: true, namespace: 'Components' }, extra || {}));
}
function run(label, yaml, assertions) {
  let r;
  try { r = gen(yaml); } catch (e) { check(label + ': generates', false, e.message); return; }
  const code = r.sections.join('\n\n');
  const diags = compile(code);
  check(label + ': output compiles with TypeScript (strict)', diags.length === 0, diags.join(' | ') + '\n' + code);
  let mod = null;
  try { mod = load(code); } catch (e) { check(label + ': Zod module loads', false, e.message + '\n' + code); }
  if (mod) passes++;
  if (assertions) assertions(code, mod, r);
}
function accepts(schema, value) { return schema.safeParse(value).success; }

// ── 1. built-in example ──
run('built-in example', EXAMPLE, (code, m) => {
  if (!m) return;
  check('example: PetSchema rejects status "lost"', !accepts(m.PetSchema, { id: 1, name: 'a', status: 'lost' }));
  check('example: PetSchema accepts tag null', accepts(m.PetSchema, { id: 1, name: 'a', status: 'sold', tag: null }));
});

// ── 2. external $ref and const (3.1) ──
const EVENT = `openapi: 3.1.0
info: { title: Events, version: 1.0.0 }
paths: {}
components:
  schemas:
    Event:
      type: object
      required: [id, kind, createdAt]
      properties:
        id: { type: integer, format: int64 }
        kind: { const: order.created }
        createdAt: { type: string, format: date-time }
        note: { type: [string, 'null'] }
        owner: { $ref: 'https://example.com/schemas/user.yaml#/User' }`;
run('3.1 const + external ref', EVENT, (code, m, r) => {
  check('no `export type unknown`', !/export type unknown\b/.test(code), code);
  check('const becomes a literal type', code.includes('kind: "order.created";'), code);
  check('external ref reported as unresolved', r.unsupportedRefs.includes('https://example.com/schemas/user.yaml#/User'), JSON.stringify(r.unsupportedRefs));
  check('external ref typed as unknown with a comment', /owner\?: unknown \/\* unresolved \$ref: https:\/\/example\.com\/schemas\/user\.yaml#\/User \*\/;/.test(code), code);
  if (!m) return;
  check('const: Zod accepts order.created', accepts(m.EventSchema, { id: 1, kind: 'order.created', createdAt: '2026-10-01T00:00:00Z' }));
  check('const: Zod rejects other kind', !accepts(m.EventSchema, { id: 1, kind: 'order.deleted', createdAt: '2026-10-01T00:00:00Z' }));
});

// ── 3. names that are not identifiers ──
const NAMES = `openapi: 3.0.3
info: { title: N, version: 1.0.0 }
paths: {}
components:
  schemas:
    Pet:
      type: object
      required: [status]
      properties:
        status: { $ref: '#/components/schemas/pet-status' }
        slashed: { $ref: '#/components/schemas/a~1b' }
    pet-status:
      type: string
      enum: [available, sold]
    a/b:
      type: integer
    unknown:
      type: string
    class:
      type: boolean
    1st:
      type: number`;
run('non-identifier schema names', NAMES, (code, m, r) => {
  check('pet-status enum keeps its values', /export type pet_status = "available" \| "sold";/.test(code), code);
  check('Pet.status refers to pet_status', code.includes('status: pet_status;'), code);
  check('~1 in a ref resolves to a/b', code.includes('slashed?: a_b;'), code);
  check('keyword names are renamed', code.includes('export type unknown_ = string;') && code.includes('export type class_ = boolean;') && code.includes('export type _1st = number;'), code);
  check('no unresolved refs', r.unsupportedRefs.length === 0, JSON.stringify(r.unsupportedRefs));
  if (!m) return;
  check('Zod: pet status enum enforced', !accepts(m.PetSchema, { status: 'lost' }) && accepts(m.PetSchema, { status: 'sold' }));
});

// ── 4. forward reference and recursion ──
const RECUR = `openapi: 3.0.3
info: { title: R, version: 1.0.0 }
paths:
  /tree:
    get:
      operationId: getTree
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Node' }
components:
  schemas:
    Order:
      type: object
      required: [customer]
      properties:
        customer: { $ref: '#/components/schemas/Customer' }
    Customer:
      type: object
      required: [name]
      properties:
        name: { type: string }
    Node:
      type: object
      required: [value]
      properties:
        value: { type: string }
        children:
          type: array
          items: { $ref: '#/components/schemas/Node' }
    A:
      type: object
      properties:
        b: { $ref: '#/components/schemas/B' }
    B:
      type: object
      properties:
        a: { $ref: '#/components/schemas/A' }
        n: { type: integer, nullable: true }`;
run('forward ref and recursion', RECUR, (code, m) => {
  check('forward ref uses z.lazy', code.includes('customer: z.lazy(() => CustomerSchema)'), code);
  check('self recursion is annotated', code.includes('export const NodeSchema: z.ZodType<Node> ='), code);
  check('mutual recursion is annotated', code.includes('export const ASchema: z.ZodType<A> =') && code.includes('export const BSchema: z.ZodType<B> ='), code);
  check('non-recursive schema is not annotated', code.includes('export const CustomerSchema = '), code);
  if (!m) return;
  check('forward ref: Order accepts', accepts(m.OrderSchema, { customer: { name: 'x' } }));
  check('forward ref: Order rejects bad customer', !accepts(m.OrderSchema, { customer: {} }));
  const tree = { value: 'root', children: [{ value: 'a', children: [{ value: 'b' }] }] };
  check('recursion: Node accepts a tree', accepts(m.NodeSchema, tree));
  check('recursion: Node rejects a bad grandchild', !accepts(m.NodeSchema, { value: 'r', children: [{ value: 'a', children: [{ value: 1 }] }] }));
  check('mutual recursion: A accepts', accepts(m.ASchema, { b: { a: { b: { n: null } } } }));
  check('mutual recursion: A rejects', !accepts(m.ASchema, { b: { n: 'x' } }));
});

// ── 5. other unresolved refs ──
run('unresolved local refs', `openapi: 3.0.3
info: { title: U, version: 1.0.0 }
paths:
  /x:
    get:
      responses:
        '200': { $ref: '#/components/responses/Ok' }
components:
  schemas:
    X:
      type: object
      properties:
        missing: { $ref: '#/components/schemas/Missing' }
        file: { $ref: './common.yaml#/Thing' }`, (code, m, r) => {
  for (const ref of ['#/components/schemas/Missing', './common.yaml#/Thing', '#/components/responses/Ok']) {
    check('reported: ' + ref, r.unsupportedRefs.includes(ref), JSON.stringify(r.unsupportedRefs));
  }
});

// ── 6. tool pages ──
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/openapi-to-typescript', lang + '.mdx'), 'utf8');
  check(lang + ': page no longer shows `export type unknown = unknown`', !mdx.includes('export type unknown = unknown'), lang);
  const blocks = [...mdx.matchAll(/\{\/\* o2t: (\w+) \*\/\}\s*<pre><code>\{`([\s\S]*?)`\}<\/code><\/pre>/g)];
  check(lang + ': page has annotated examples', blocks.length >= 2, String(blocks.length));
  for (const [, which, text] of blocks) {
    const r = which === 'event' ? gen(EVENT, { includePaths: false, includeZod: false }) : gen(RECUR, { includePaths: false, includeZod: true });
    const full = r.sections.join('\n\n');
    const want = text.trim();
    check(lang + ': example ' + which + ' is the engine output', full.includes(want), '\n--- page ---\n' + want + '\n--- engine ---\n' + full);
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
