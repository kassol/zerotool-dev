// JSON to Zod — generated schemas must keep every element of a root-level array
//
// Read:  src/components/tools/JsonToZodTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
//        node_modules/zod (evaluates the generated schema and parses the sample with it)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: a root array that mixes objects with strings / numbers / null / arrays gives a
// z.union of all element types (non-object elements were dropped before, so the schema rejected
// its own sample), root arrays of objects only keep their earlier output, nested mixed arrays,
// objects with different keys (.optional()), strict mode, root scalars, empty arrays; every
// generated schema is evaluated with zod and must parse the sample it came from.
//
// Run: node scripts/test-json-to-zod.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToZodTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JsonToZodTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { buildRootZod };')();

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
function toSchema(expr) {
  return new Function('z', 'return ' + expr + ';')(z);
}
function parsesOwnSample(name, sample, strict) {
  const expr = E.buildRootZod(sample, 'Root', !!strict);
  let schema;
  try { schema = toSchema(expr); }
  catch (e) { check(name + ' (schema evaluates)', false, e.message + '\n' + expr); return expr; }
  const result = schema.safeParse(sample);
  check(name + ' (sample parses)', result.success,
    (result.error ? JSON.stringify(result.error.issues) : '') + '\n' + expr);
  return expr;
}

// ---------- the reported defect: non-object elements of a root array dropped ----------
eq('mixed root array → union of all element types',
  parsesOwnSample('root array of objects and strings', [{ id: 1 }, 'two', 3]),
  'z.array(z.union([z.string(), z.number().int(), z.object({\n    id: z.number().int(),\n  })]))');
{
  const expr = parsesOwnSample('root array with null', [{ id: 1 }, null]);
  eq('null joins the union', expr, 'z.array(z.union([z.null(), z.object({\n    id: z.number().int(),\n  })]))');
  check('union rejects a boolean', !toSchema(expr).safeParse([true]).success);
}
parsesOwnSample('root array with nested arrays', [{ a: 1 }, [1, 2], ['x']]);
parsesOwnSample('root array with integers and decimals', [{ a: 1 }, 1, 1.5]);
parsesOwnSample('root array, strict mode', [{ a: 1 }, 'x', { a: 2, b: 3 }], true);

// ---------- earlier output kept ----------
eq('root array of objects only (unchanged)',
  parsesOwnSample('objects with different keys', [{ id: 1, name: 'a' }, { id: 2 }]),
  'z.array(z.object({\n    id: z.number().int(),\n    name: z.string().optional(),\n  }))');
eq('root array of objects, strict (unchanged)',
  E.buildRootZod([{ id: 1 }], 'Root', true),
  'z.array(z.object({\n    id: z.number().int(),\n  }).strict())');
eq('root array of scalars', parsesOwnSample('scalars', [1, 'a', 1]), 'z.array(z.union([z.number().int(), z.string()]))');
eq('empty root array', E.buildRootZod([], 'Root', false), 'z.array(z.unknown())');
eq('root string', E.buildRootZod('x', 'Root', false), 'z.string()');
eq('root null', E.buildRootZod(null, 'Root', false), 'z.null()');
eq('root object', parsesOwnSample('object', { a: 1, b: [{ c: 'x' }, 2] }),
  'z.object({\n  a: z.number().int(),\n  b: z.array(z.union([z.number().int(), z.object({\n    c: z.string(),\n  })])),\n})');
parsesOwnSample('page example', {
  id: 1, name: 'Alice', isActive: true, score: 9.5, tags: ['typescript', 'json'],
  address: { city: 'London', zip: 'EC1A 1BB' },
  friends: [{ id: 2, name: 'Bob' }, { id: 3, name: 'Carol' }], metadata: null,
});
parsesOwnSample('nested mixed array in merged objects', [{ v: [{ a: 1 }, 'x'] }, { v: [null] }]);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
