// JSON Schema Validator — "format" is checked for the standard formats
//
// Read:  src/components/tools/JsonSchemaValidatorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); ajv, ajv/dist/2020 and ajv-formats from node_modules
//        (the same packages the component bundles)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: before the fix Ajv ran without ajv-formats and strict: false, so every "format" was
// ignored ("not-an-email" passed "format": "email"). Now the JSON Schema formats that
// ajv-formats implements are asserted in both Draft-07 and Draft 2020-12: email, uri,
// uri-reference, uri-template, date, time, date-time, duration, hostname, ipv4, ipv6, uuid,
// json-pointer, relative-json-pointer, regex. Formats outside that list (idn-email, iri,
// custom names) stay annotations and do not fail. Format applies to strings only. The tool's
// example data and invalid example.
//
// Run: node scripts/test-json-schema-validator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonSchemaValidatorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JsonSchemaValidatorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { createAjv };')();
const lib = { Ajv: Ajv.default || Ajv, Ajv2020: Ajv2020.default || Ajv2020, addFormats: addFormats.default || addFormats };

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}

// keep Ajv's "unknown format ignored" warnings out of the test output
const warn = console.warn;
console.warn = () => {};

function valid(draft, schema, data) {
  const ajv = E.createAjv(draft, lib);
  const fn = ajv.compile(schema);
  return { ok: fn(data), errors: fn.errors || [] };
}
function fmt(draft, format, value, expected) {
  const r = valid(draft, { type: 'string', format }, value);
  check('[' + draft + '] ' + format + ' ' + JSON.stringify(value) + ' → ' + (expected ? 'valid' : 'invalid'), r.ok === expected,
    r.ok ? 'passed' : JSON.stringify(r.errors.map((e) => e.message)));
}

for (const draft of ['07', '2020']) {
  // ---------- the reported defect ----------
  fmt(draft, 'email', 'alice@example.com', true);
  fmt(draft, 'email', 'not-an-email', false);
  fmt(draft, 'uri', 'https://example.com/a?b=1', true);
  fmt(draft, 'uri', 'example.com/path', false);
  fmt(draft, 'date', '2026-09-30', true);
  fmt(draft, 'date', '2026-02-30', false);
  fmt(draft, 'date', '2026-9-30', false);
  fmt(draft, 'date-time', '2026-09-30T12:00:00Z', true);
  fmt(draft, 'date-time', '2026-09-30T12:00:00+09:00', true);
  fmt(draft, 'date-time', '2026-09-30T12:00:00', false);
  fmt(draft, 'uuid', '123e4567-e89b-12d3-a456-426614174000', true);
  fmt(draft, 'uuid', '123e4567e89b12d3a456426614174000', false);
  fmt(draft, 'ipv4', '192.168.0.1', true);
  fmt(draft, 'ipv4', '256.1.1.1', false);
  fmt(draft, 'ipv6', '2001:db8::1', true);
  fmt(draft, 'ipv6', '::ffff:192.0.2.1', true);
  fmt(draft, 'ipv6', '2001:db8:::1', false);

  // ---------- other standard formats in the list ----------
  fmt(draft, 'uri-reference', '/relative/path', true);
  fmt(draft, 'time', '12:00:00Z', true);
  fmt(draft, 'time', '25:00:00Z', false);
  fmt(draft, 'duration', 'P1D', true);
  fmt(draft, 'duration', '1D', false);
  fmt(draft, 'hostname', 'example.com', true);
  fmt(draft, 'hostname', '-bad-.example.com', false);
  fmt(draft, 'json-pointer', '/a/b', true);
  fmt(draft, 'json-pointer', 'a/b', false);
  fmt(draft, 'relative-json-pointer', '1/a', true);
  fmt(draft, 'regex', '^[a-z]+$', true);
  fmt(draft, 'regex', '[', false);
  fmt(draft, 'uri-template', 'https://example.com/{id}', true);

  // ---------- formats outside the list stay annotations ----------
  fmt(draft, 'idn-email', 'anything', true);
  fmt(draft, 'iri', 'anything', true);
  fmt(draft, 'x-custom', 'anything', true);
  // format applies to strings only
  check('[' + draft + '] email format on a number is ignored', valid(draft, { format: 'email' }, 5).ok === true);
}

// ---------- tool example ----------
{
  const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'User',
    type: 'object',
    required: ['name', 'age', 'email'],
    properties: {
      name: { type: 'string', minLength: 1 },
      age: { type: 'integer', minimum: 0, maximum: 120 },
      email: { type: 'string', format: 'email' },
      role: { type: 'string', enum: ['admin', 'user', 'guest'] },
    },
    additionalProperties: false,
  };
  check('example data is valid', valid('07', schema, { name: 'Alice', age: 30, email: 'alice@example.com', role: 'admin' }).ok);
  const r = valid('07', schema, { name: '', age: -5, email: 'not-an-email', role: 'superuser', extra: 'not allowed' });
  const found = r.errors.map((e) => (e.instancePath || '(root)') + ' ' + e.keyword).sort();
  check('invalid example reports 5 errors including /email format',
    JSON.stringify(found) === JSON.stringify(['(root) additionalProperties', '/age minimum', '/email format', '/name minLength', '/role enum']),
    JSON.stringify(found));
}

console.warn = warn;
console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
