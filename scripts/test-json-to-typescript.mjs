// JSON to TypeScript — every object keeps its own fields; the output compiles and accepts the sample
//
// Read:  src/components/tools/JsonToTypescriptTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); node_modules/typescript (the compiler);
//        src/content/tools/json-to-typescript/{en,zh,ja,ko}.mdx (the examples)
// Write: stdout only (the compiler runs on in-memory files)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Each generated declaration set is compiled with the TypeScript compiler API (strict) together
// with `const sample: Root = <the JSON>;`. An object literal with a property that its type does
// not declare is an error (excess property check), so a field that was lost from a type fails
// the compile. Cases: two nested objects with the same key name and different fields (before
// the fix the second one reused the first type and lost its fields), the same shape twice (one
// shared type), keys that are not identifiers or that produce invalid type names (2fa, "",
// non-ASCII), keys named constructor / toString / hasOwnProperty, arrays of objects, the root
// name kept even when a nested key has the same name, and the examples on the tool pages.
//
// Run: node scripts/test-json-to-typescript.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToTypescriptTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JsonToTypescriptTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { generateTypeScript };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}

function compile(code) {
  const fileName = 'gen.ts';
  const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts'], types: [] };
  const host = ts.createCompilerHost(options);
  const orig = host.getSourceFile;
  host.getSourceFile = (name, lang) => name === fileName ? ts.createSourceFile(name, code, lang) : orig.call(host, name, lang);
  const program = ts.createProgram([fileName], options, host);
  return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}
function accepts(name, json, opts = {}) {
  const rootName = opts.root || 'RootObject';
  const r = E.generateTypeScript(JSON.parse(json), rootName, !!opts.optional, !!opts.useType);
  const isArray = Array.isArray(JSON.parse(json));
  const errors = compile(r.code + '\n\nexport const sample: ' + rootName + (isArray ? '[]' : '') + ' = ' + json + ';\n');
  check(name + ': compiles and accepts the sample', errors.length === 0, errors.join('; ') + '\n' + r.code);
  return r.code;
}

// ---------- the reported defect: two nested objects with the same key ----------
{
  const code = accepts('a.meta and b.meta differ', '{"a":{"meta":{"x":1}},"b":{"meta":{"y":"s"}}}');
  check('a.meta keeps x', /interface Meta \{\n  x: number;\n\}/.test(code), code);
  check('b.meta gets its own type with y', /interface BMeta \{\n  y: string;\n\}/.test(code), code);
  check('B refers to BMeta', /interface B \{\n  meta: BMeta;\n\}/.test(code), code);
}
{
  const code = accepts('same shape twice', '{"a":{"meta":{"x":1}},"b":{"meta":{"x":2}}}');
  eq('identical shapes share one type', (code.match(/interface \w*Meta /g) || []).length, 1);
}
accepts('three different meta objects', '{"a":{"meta":{"x":1}},"b":{"meta":{"y":1}},"c":{"meta":{"z":1}},"d":{"meta":{"y":2}}}');
accepts('same key at different depths', '{"node":{"id":1,"node":{"name":"n","node":{"leaf":true}}}}');
accepts('array items with the same name', '{"a":{"items":[{"p":1}]},"b":{"items":[{"q":"x"}]}}');
{
  const code = accepts('nested key equal to the root name', '{"rootObject":{"z":1},"k":2}');
  check('the root keeps its name', /^interface RootObject \{/.test(code), code);
}

// ---------- names and keys ----------
accepts('keys that are not identifiers', '{"user-name":"a","2fa":{"on":true},"":{"e":1},"名前":{"姓":"山田"},"a b":{"c":1}}');
{
  const r = E.generateTypeScript(JSON.parse('{"2fa":{"on":true},"":{"e":1}}'), 'RootObject', false, false);
  check('type names are identifiers', !/interface (\d|\s)/.test(r.code), r.code);
}
accepts('prototype key names', '{"constructor":{"a":1},"toString":"x","hasOwnProperty":1,"items":[{"constructor":1,"valueOf":2},{"constructor":3,"valueOf":4}]}');
accepts('array of objects merged', '{"items":[{"id":1,"name":"a","tags":[]},{"id":2,"price":9.5,"tags":["x",1]}]}');
accepts('root array of objects', '[{"id":1},{"id":2,"extra":{"deep":[1,2]}}]');
accepts('optional and type alias', '{"a":{"meta":{"x":1}},"b":{"meta":{"y":"s"}}}', { optional: true, useType: true });
accepts('null values', '{"a":null,"b":{"c":null}}');
eq('primitive root', E.generateTypeScript(5, 'Root', false, false).code, 'type Root = number;');
eq('array of primitives root', E.generateTypeScript([1, 'a'], 'Root', false, false).code, 'type Root = (number | string)[];');
eq('count of declarations', E.generateTypeScript(JSON.parse('{"a":{"meta":{"x":1}},"b":{"meta":{"y":"s"}}}'), 'R', false, false).count, 5);

// ---------- tool page examples ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/json-to-typescript/' + lang + '.mdx'), 'utf8');
  const re = /```json\n([\s\S]*?)\n```\s*\n[^`]*```typescript\n([\s\S]*?)\n```/g;
  let m;
  let count = 0;
  while ((m = re.exec(mdx))) {
    count++;
    let parsed;
    try { parsed = JSON.parse(m[1]); } catch { continue; }
    eq(lang + ': example ' + count + ' output', E.generateTypeScript(parsed, 'RootObject', false, false).code, m[2]);
  }
  check(lang + ': page has at least three examples', count >= 3, String(count));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
