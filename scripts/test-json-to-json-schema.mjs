// JSON to JSON Schema — every generated schema must accept the sample it was generated from
//
// Read:  src/components/tools/JsonToJsonSchemaTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: array items are merged across all elements (this project's ajv validates the sample
// against its own generated schema, draft-07): objects with different keys (properties are the
// union, required is the intersection), integer + number → number, mixed scalar types, objects
// mixed with null / scalars / arrays in one array (object and array keywords sit next to a type
// list; they only apply to instances of that type), nested arrays of objects, empty arrays,
// null-valued keys not required, root-level arrays; exact output for single objects is unchanged.
//
// Run: node scripts/test-json-to-json-schema.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv from 'ajv';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToJsonSchemaTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JsonToJsonSchemaTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { inferSchema };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}

const ajv = new Ajv({ allowUnionTypes: true });
function acceptsOwnSample(name, sample) {
  const schema = E.inferSchema(sample);
  let validate;
  try { validate = ajv.compile(schema); }
  catch (e) { check(name + ' (schema compiles)', false, e.message); return schema; }
  const ok = validate(sample);
  check(name + ' (sample passes its schema)', ok, JSON.stringify(validate.errors) + ' schema ' + JSON.stringify(schema));
  return schema;
}
function rejects(name, schema, value) {
  const validate = ajv.compile(schema);
  check(name, !validate(value), 'accepted ' + JSON.stringify(value));
}

// ---------- the reported defect: array of objects inferred from the first one only ----------
{
  const s = acceptsOwnSample('objects with different keys', [{ id: 1, name: 'a' }, { id: 2, email: 'b@example.com' }]);
  eq('properties are the union, required the intersection', s, {
    type: 'array',
    items: {
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' }, email: { type: 'string' } },
      required: ['id'],
    },
  });
  rejects('still rejects an item without the shared key', s, [{ name: 'x' }]);
  rejects('still rejects a wrong property type', s, [{ id: 'x' }]);
}
{
  const s = acceptsOwnSample('same key, different types', [{ v: 1 }, { v: 'one' }, { v: true }]);
  eq('type list for the key', s.items.properties.v, { type: ['integer', 'string', 'boolean'] });
}
{
  const s = acceptsOwnSample('integer then number', [1, 2.5, 3]);
  eq('integer + number → number', s, { type: 'array', items: { type: 'number' } });
  rejects('number items still reject strings', s, ['1']);
}
eq('number then integer keeps first position', E.inferSchema(['a', 2.5, 1]).items, { type: ['string', 'number'] });
eq('only integers stay integer', E.inferSchema([1, 2]).items, { type: 'integer' });
{
  const s = acceptsOwnSample('objects mixed with null', [{ a: 1 }, null, { a: 2, b: 'x' }]);
  eq('type list plus object keywords', s.items, {
    type: ['object', 'null'],
    properties: { a: { type: 'integer' }, b: { type: 'string' } },
    required: ['a'],
  });
  rejects('object keywords still apply to objects', s, [{ b: 'x' }]);
}
acceptsOwnSample('objects mixed with scalars and arrays', [{ a: 1 }, 'x', 3, [1, 'y'], [], false]);
{
  const s = acceptsOwnSample('null in one object is not required', [{ a: 1, b: 2 }, { a: null, b: 3 }]);
  eq('a is nullable and optional', s.items.properties.a, { type: ['integer', 'null'] });
  eq('b required', s.items.required, ['b']);
}
{
  const s = acceptsOwnSample('nested arrays of objects', {
    users: [
      { name: 'a', tags: [{ k: 1 }] },
      { name: 'b', tags: [{ k: 2, v: 'x' }, { v: 'y' }], admin: true },
    ],
  });
  eq('nested items merged', s.properties.users.items.properties.tags.items, {
    type: 'object',
    properties: { k: { type: 'integer' }, v: { type: 'string' } },
  });
}
acceptsOwnSample('nested objects with different shapes', [{ meta: { a: 1 } }, { meta: { b: [1] } }, { meta: 'none' }]);
acceptsOwnSample('arrays of arrays', [[1, 2], ['a'], [[{ x: 1 }], [null]]]);
{
  const s = acceptsOwnSample('empty and non-empty arrays', { rows: [[], [1]] });
  eq('items from the non-empty array', s.properties.rows.items, { type: 'array', items: { type: 'integer' } });
}
eq('empty array', E.inferSchema([]), { type: 'array', items: {} });
eq('only empty arrays inside', E.inferSchema([[], []]), { type: 'array', items: { type: 'array', items: {} } });
acceptsOwnSample('root scalar', 42);
acceptsOwnSample('root null', null);
acceptsOwnSample('__proto__ key kept as a property', JSON.parse('[{"__proto__": 1}, {"__proto__": "x"}]'));
check('__proto__ is an own property', Object.prototype.hasOwnProperty.call(
  E.inferSchema(JSON.parse('{"__proto__": 1}')).properties, '__proto__'));

// ---------- single values keep their earlier output ----------
eq('seed example', E.inferSchema({
  name: 'Alice', age: 30, active: true, scores: [95, 87, 92],
  address: { street: '123 Main St', city: 'Wonderland' },
}), {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'integer' },
    active: { type: 'boolean' },
    scores: { type: 'array', items: { type: 'integer' } },
    address: {
      type: 'object',
      properties: { street: { type: 'string' }, city: { type: 'string' } },
      required: ['street', 'city'],
    },
  },
  required: ['name', 'age', 'active', 'scores', 'address'],
});
eq('empty object', E.inferSchema({}), { type: 'object', properties: {} });
eq('null value not required', E.inferSchema({ a: null }), { type: 'object', properties: { a: { type: 'null' } } });

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
