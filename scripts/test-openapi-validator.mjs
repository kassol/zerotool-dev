// OpenAPI Validator — official JSON Schemas per version, internal $ref, path parameters, operationId
//
// Read:  src/components/tools/OpenapiValidatorTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers, so this test cannot drift from the shipped
//        source); src/data/openapi-schemas/*.json (official schemas the page loads);
//        scripts/test-openapi-validator.fixtures.json (OAI learn.openapis.org example documents,
//        CC BY 4.0); src/content/tools/openapi-validator/*.mdx (examples marked {/* ov: … */})
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers the reported defects: a 3.1 document with only `webhooks` was rejected for missing
// `paths` (OAS 3.1.0 §4.8.1 needs one of paths / components / webhooks); 3.1 operations without
// `responses` were rejected (optional since 3.1); `$ref` was never resolved, so a reference to a
// missing component passed; path parameters were not checked. Now each version is validated
// against its official JSON Schema with Ajv (3.0 converted from draft-04), internal references
// are resolved, external ones are listed, path template names are matched against `in: path`
// parameters, and duplicate operationId values are reported. All 11 official example documents
// are valid; error messages name the field and its JSON Pointer.
//
// Run: node scripts/test-openapi-validator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const Ajv = require('ajv').default;
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default;

const source = readFileSync(join(root, 'src/components/tools/OpenapiValidatorTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in OpenapiValidatorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { fromDraft04, staticDynamicRefs, createValidators, validateOpenApi, countOps };')();

const schemaDir = join(root, 'src/data/openapi-schemas');
const SCHEMAS = {
  '3.0': JSON.parse(readFileSync(join(schemaDir, 'oas-3.0-2024-10-18.json'), 'utf8')),
  '3.1': JSON.parse(readFileSync(join(schemaDir, 'oas-3.1-2026-08-03.json'), 'utf8')),
  '3.2': JSON.parse(readFileSync(join(schemaDir, 'oas-3.2-2026-08-30.json'), 'utf8')),
};
const getValidator = E.createValidators({ Ajv, Ajv2020, addFormats }, SCHEMAS);

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
const run = (text) => E.validateOpenApi(yaml.load(text), getValidator);
const msgs = (r) => r.errors.map((e) => e.path + ' ' + e.message);

// ---------- schemas wired as the page wires them ----------
check('component imports the three schema files',
  ['oas-3.0-2024-10-18.json', 'oas-3.1-2026-08-03.json', 'oas-3.2-2026-08-30.json'].every((f) => source.includes(f)));
eq('3.0 schema is the official draft-04 file', SCHEMAS['3.0'].id, 'https://spec.openapis.org/oas/3.0/schema/2024-10-18');
eq('3.1 schema id', SCHEMAS['3.1'].$id, 'https://spec.openapis.org/oas/3.1/schema/2026-08-03');
eq('3.2 schema id', SCHEMAS['3.2'].$id, 'https://spec.openapis.org/oas/3.2/schema/2026-08-30');

// ---------- draft-04 conversion ----------
{
  const c = E.fromDraft04({ id: 'x', $schema: 'http://json-schema.org/draft-04/schema#',
    properties: { exclusiveMinimum: { type: 'boolean' }, n: { type: 'number', minimum: 0, exclusiveMinimum: true } } });
  eq('id → $id', c.$id, 'x');
  eq('$schema → draft-07', c.$schema, 'http://json-schema.org/draft-07/schema#');
  eq('property named exclusiveMinimum kept', c.properties.exclusiveMinimum, { type: 'boolean' });
  eq('boolean exclusiveMinimum → numeric', c.properties.n, { type: 'number', exclusiveMinimum: 0 });
}

// ---------- official example documents ----------
const FIX = JSON.parse(readFileSync(join(root, 'scripts/test-openapi-validator.fixtures.json'), 'utf8'));
for (const [name, text] of Object.entries(FIX.files)) {
  const r = run(text);
  eq('official example ' + name + ' has no errors', msgs(r), []);
  eq('official example ' + name + ' has no notices', r.notices.map((n) => n.message), []);
}
eq('petstore has 3 operations', E.countOps(yaml.load(FIX.files['v3.0/petstore.yaml']), '3.0'), 3);
{
  const doc = yaml.load(FIX.files['v3.2/3.2-query-example.yaml']);
  check('3.2 query method counted', E.countOps(doc, '3.2') >= 1, E.countOps(doc, '3.2'));
}

// ---------- version rules from the schemas ----------
const INFO = 'info:\n  title: T\n  version: "1"\n';
eq('3.1 with only webhooks is valid', msgs(run('openapi: 3.1.0\n' + INFO + 'webhooks:\n  ping:\n    post:\n      responses:\n        "200":\n          description: OK\n')), []);
check('3.1 with no paths, components or webhooks is invalid', run('openapi: 3.1.0\n' + INFO).errors.length > 0);
eq('3.0 without paths', msgs(run('openapi: 3.0.3\n' + INFO)), ['# Missing required field "paths".']);
eq('3.1 operation without responses is valid', msgs(run('openapi: 3.1.0\n' + INFO + 'paths:\n  /a:\n    get: {}\n')), []);
eq('3.0 operation without responses', msgs(run('openapi: 3.0.3\n' + INFO + 'paths:\n  /a:\n    get: {}\n')),
  ['#/paths/~1a/get Missing required field "responses".']);
eq('response without description, no $ref noise',
  msgs(run('openapi: 3.0.3\n' + INFO + 'paths:\n  /users:\n    get:\n      responses:\n        "200":\n          content: {}\n')),
  ['#/paths/~1users/get/responses/200 Missing required field "description".']);
eq('info.version missing', msgs(run('openapi: 3.0.3\ninfo:\n  title: T\npaths: {}\n')), ['#/info Missing required field "version".']);
eq('unknown root field (3.0)', msgs(run('openapi: 3.0.3\n' + INFO + 'paths: {}\nfoo: 1\n')), ['# Unknown field "foo".']);
eq('unknown root field (3.1)', msgs(run('openapi: 3.1.0\n' + INFO + 'paths: {}\nfoo: 1\n')), ['# Unknown field "foo".']);
eq('x- extension allowed', msgs(run('openapi: 3.0.3\n' + INFO + 'paths: {}\nx-foo: 1\n')), []);
eq('path key must start with / (3.0)', msgs(run('openapi: 3.0.3\n' + INFO + 'paths:\n  users: {}\n')), ['#/paths Path "users" must start with "/".']);
eq('path key must start with / (3.1)', msgs(run('openapi: 3.1.0\n' + INFO + 'paths:\n  users: {}\n')), ['#/paths Path "users" must start with "/".']);
check('3.0 multipleOf: 0 rejected (exclusiveMinimum converted)',
  run('openapi: 3.0.3\n' + INFO + 'paths: {}\ncomponents:\n  schemas:\n    N:\n      type: number\n      multipleOf: 0\n').errors.some((e) => e.path === '#/components/schemas/N/multipleOf'),
  JSON.stringify(run('openapi: 3.0.3\n' + INFO + 'paths: {}\ncomponents:\n  schemas:\n    N:\n      type: number\n      multipleOf: 0\n').errors));
eq('3.0 path parameter must be required', msgs(run('openapi: 3.0.3\n' + INFO + 'paths:\n  /u/{id}:\n    get:\n      parameters:\n        - name: id\n          in: path\n          schema: {type: string}\n      responses:\n        "200": {description: OK}\n')).length > 0, true);

check('3.1 Schema Object must be an object or boolean ($dynamicRef #meta resolved)',
  run('openapi: 3.1.0\n' + INFO + 'paths: {}\ncomponents:\n  schemas:\n    N: 5\n').errors.some((e) => e.path === '#/components/schemas/N'));
{
  const c = E.staticDynamicRefs(SCHEMAS['3.1']);
  check('3.1: no $dynamicRef left after conversion', !JSON.stringify(c).includes('$dynamicRef'));
  eq('3.1: media type schema points at $defs/schema', c.$defs['media-type'].properties.schema, { $ref: '#/$defs/schema' });
}

// ---------- version field ----------
eq('swagger 2.0', run('swagger: "2.0"\ninfo: {title: T, version: "1"}\npaths: {}\n').errors[0].path, '#/swagger');
eq('openapi as a YAML number', run('openapi: 3.0\n' + INFO + 'paths: {}\n').errors[0].path, '#/openapi');
eq('openapi 3.3.0 not supported', run('openapi: 3.3.0\n' + INFO + 'paths: {}\n').errors[0].path, '#/openapi');
eq('missing openapi', msgs(run(INFO + 'paths: {}\n')), ['# Missing required field "openapi".']);
eq('non-object document', run('- a').errors[0].path, '#');

// ---------- $ref ----------
const REFDOC = (ref) => 'openapi: 3.0.3\n' + INFO + 'paths:\n  /pets:\n    get:\n      responses:\n        "200":\n          description: OK\n          content:\n            application/json:\n              schema:\n                $ref: "' + ref + '"\ncomponents:\n  schemas:\n    Pet:\n      type: object\n    "a/b":\n      type: string\n';
eq('internal $ref resolves', msgs(run(REFDOC('#/components/schemas/Pet'))), []);
eq('broken internal $ref', msgs(run(REFDOC('#/components/schemas/Pett'))),
  ['#/paths/~1pets/get/responses/200/content/application~1json/schema/$ref Reference "#/components/schemas/Pett" does not point to anything in this document.']);
eq('~1 in a $ref pointer', msgs(run(REFDOC('#/components/schemas/a~1b'))), []);
eq('percent-encoded $ref pointer', msgs(run(REFDOC('#/components/schemas/a~1b'.replace('~1', '%7E1')))), []);
{
  const r = run(REFDOC('common.yaml#/components/schemas/Pet'));
  eq('external $ref is not an error', msgs(r), []);
  eq('external $ref is listed', r.notices.length, 1);
  check('external notice names the reference', r.notices[0] && r.notices[0].message.includes('common.yaml#/components/schemas/Pet'));
}
eq('$ref inside an example value is data', msgs(run('openapi: 3.0.3\n' + INFO + 'paths: {}\ncomponents:\n  schemas:\n    S:\n      type: object\n      example:\n        $ref: "#/nowhere"\n')), []);
eq('$ref in an Example Object is checked', msgs(run('openapi: 3.1.0\n' + INFO + 'paths: {}\ncomponents:\n  parameters:\n    P:\n      name: q\n      in: query\n      schema: {type: string}\n      examples:\n        one:\n          $ref: "#/components/examples/missing"\n')).length, 1);
eq('referenced parameter that is missing', msgs(run('openapi: 3.0.3\n' + INFO + 'paths:\n  /a:\n    get:\n      parameters:\n        - $ref: "#/components/parameters/Nope"\n      responses:\n        "200": {description: OK}\n')),
  ['#/paths/~1a/get/parameters/0/$ref Reference "#/components/parameters/Nope" does not point to anything in this document.']);

// ---------- path parameters ----------
const P = 'openapi: 3.0.3\n' + INFO + 'paths:\n';
const OK = '      responses:\n        "200": {description: OK}\n';
eq('undeclared path parameter', msgs(run(P + '  /users/{id}:\n    get:\n' + OK)),
  ['#/paths/~1users~1{id}/get GET /users/{id}: path parameter "id" is not declared (add a parameter with in: path, name: id).']);
eq('path-level parameter covers all operations', msgs(run(P + '  /users/{id}:\n    parameters:\n      - {name: id, in: path, required: true, schema: {type: string}}\n    get:\n' + OK + '    delete:\n' + OK)), []);
eq('declared but not in the path', msgs(run(P + '  /users:\n    get:\n      parameters:\n        - {name: id, in: path, required: true, schema: {type: string}}\n' + OK)),
  ['#/paths/~1users/get GET /users: parameter "id" is declared with in: path but the path has no {id}.']);
eq('parameter via $ref counts', msgs(run(P + '  /users/{id}:\n    get:\n      parameters:\n        - $ref: "#/components/parameters/Id"\n' + OK + 'components:\n  parameters:\n    Id: {name: id, in: path, required: true, schema: {type: string}}\n')), []);
eq('external parameter $ref skips the check', msgs(run(P + '  /users/{id}:\n    get:\n      parameters:\n        - $ref: "common.yaml#/Id"\n' + OK)), []);
eq('query parameter with the same name does not count', msgs(run(P + '  /users/{id}:\n    get:\n      parameters:\n        - {name: id, in: query, schema: {type: string}}\n' + OK)).length, 1);

// ---------- operationId ----------
eq('duplicate operationId', msgs(run(P + '  /a:\n    get:\n      operationId: list\n' + OK + '  /b:\n    get:\n      operationId: list\n' + OK)),
  ['#/paths/~1b/get/operationId operationId "list" is already used at #/paths/~1a/get/operationId; it must be unique.']);

// ---------- examples on the tool pages ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/openapi-validator', lang + '.mdx'), 'utf8');
  const re = /\{\/\* ov: (\{.*?\}) \*\/\}\s*<pre><code>\{`([\s\S]*?)`\}<\/code><\/pre>/g;
  let m, n = 0;
  while ((m = re.exec(mdx))) {
    n++;
    const opt = JSON.parse(m[1]);
    const text = new Function('return `' + m[2] + '`')();
    eq(lang + ' page example ' + n, msgs(run(text)), opt.errors);
  }
  check(lang + ' page has at least 3 checked examples', n >= 3, n);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
