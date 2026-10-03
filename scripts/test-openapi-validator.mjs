// OpenAPI Validator — official JSON Schemas per version (Swagger 2.0, OpenAPI 3.0 / 3.1 / 3.2),
// $ref across files, line and column mapping, and the rules the schemas cannot express
//
// Read:  src/components/tools/openapi-validator-engine.js (the engine the page runs, imported
//        directly); src/components/tools/OpenapiValidatorTool.astro (the STRINGS table between
//        `// strings:start` and `// strings:end`, and the wiring checks);
//        src/components/tools/openapi-validator-run.js, openapi-validator.worker.js;
//        src/data/openapi-schemas/*.json (official schemas the page loads);
//        scripts/test-openapi-validator.fixtures.json (OAI learn.openapis.org examples, CC BY 4.0;
//        Swagger Petstore v2 / v3, Apache 2.0); node_modules/js-yaml/lib/loader.js (parser
//        error texts); src/content/tools/openapi-validator/*.mdx (examples marked {/* ov … */})
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers the defects found on 2026-10-02: unquoted dates such as `version: 2024-01-15` were read
// as YAML timestamps and reported as "Must be string" (Redocly, Spectral and swagger-parser read
// them as strings); `$ref` under a `default:` response was never checked (treated as example
// data); no line or column for any problem; Swagger 2.0 was refused; references to other files
// could not be checked; 3.1 / 3.2 Schema Objects were not checked against JSON Schema 2020-12
// (`required: true`, `type: int`, boolean `exclusiveMinimum` passed); "example" and "examples"
// together produced three unrelated messages; equivalent path templates, duplicate parameters,
// undeclared security schemes, server variables, duplicate tags, examples that do not match
// their schema and unused components were not reported; all messages were English only.
// 2026-10-03: boolean exclusiveMinimum / exclusiveMaximum without minimum / maximum passed in
// 2.0 and 3.0 (the official schemas drop the draft-04 `dependencies`); the real run and worker
// bundles are exercised for it.
//
// Run: node scripts/test-openapi-validator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const jsyaml = require('js-yaml');
const Ajv = require('ajv').default;
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default;

const E = {
  ...(await import(pathToFileURL(join(root, 'src/components/tools/openapi-validator-engine.js')).href)),
  ...(await import(pathToFileURL(join(root, 'src/components/tools/openapi-validator-format.js')).href)),
};
const component = readFileSync(join(root, 'src/components/tools/OpenapiValidatorTool.astro'), 'utf8');
const runSrc = readFileSync(join(root, 'src/components/tools/openapi-validator-run.js'), 'utf8');
const workerSrc = readFileSync(join(root, 'src/components/tools/openapi-validator.worker.js'), 'utf8');
const engineSrc = readFileSync(join(root, 'src/components/tools/openapi-validator-engine.js'), 'utf8');

const sd = join(root, 'src/data/openapi-schemas');
const load = (f) => JSON.parse(readFileSync(join(sd, f), 'utf8'));
const schemas = {
  '2.0': load('swagger-2.0.json'),
  'draft-04': load('json-schema-draft-04.json'),
  '3.0': load('oas-3.0-2024-10-18.json'),
  '3.1': load('oas-3.1-2026-08-03.json'),
  '3.2': load('oas-3.2-2026-08-30.json'),
};
const lib = { jsyaml, Ajv, Ajv2020, addFormats, schemas };

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

// STRINGS from the component frontmatter
const sm = /\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/.exec(component);
const STRINGS = new Function(sm[1] + '\nreturn STRINGS;')();
const T = STRINGS.en;

const runFiles = (files, rootName) => E.validateProject({ root: rootName || Object.keys(files)[0], files }, lib);
const run = (text) => runFiles({ 'openapi.yaml': text });
// "level code line:col pointer" for each problem
const brief = (r) => r.problems.map((p) => `${p.level} ${p.code} ${p.line}:${p.col} ${p.path}`);
const codes = (r) => r.problems.map((p) => p.level + ' ' + p.code);
const msgs = (r, t = T) => r.problems.map((p) => E.formatMessage(p, t));
const errors = (r) => r.problems.filter((p) => p.level === 'error');
const stableResult = ({ ms, ...result }) => result;

// Exercise the same bundled run/worker entry as the page, without injected validators.
const bundled = async (entry, globalName) => (await build({
  entryPoints: [join(root, 'src/components/tools/' + entry)], bundle: true,
  write: false, platform: 'browser', format: 'iife', globalName,
})).outputFiles[0].text;
const runtime = vm.createContext({ console, performance, TextEncoder, TextDecoder, URL });
vm.runInContext(await bundled('openapi-validator-run.js', 'OAV'), runtime);
const actualRun = (files, rootName = Object.keys(files)[0]) => {
  const out = runtime.OAV.runValidation({ root: rootName, files });
  check('real run entry returns a result', !out.error, out.error);
  return out.result;
};
const replies = [];
const workerContext = vm.createContext({ console, performance, TextEncoder, TextDecoder, URL,
  self: { postMessage: (out) => replies.push(structuredClone(out)) } });
vm.runInContext(await bundled('openapi-validator.worker.js', 'OAVWorker'), workerContext);
for (const version of ['2.0', '3.0.4']) {
  for (const key of ['exclusiveMinimum', 'exclusiveMaximum']) {
    for (const value of [true, false]) {
      const text = (version === '2.0' ? 'swagger: "2.0"' : 'openapi: ' + version) +
        '\ninfo: {title: Fixture, version: "1"}\npaths: {}\n' +
        (version === '2.0' ? 'definitions:\n' : 'components:\n  schemas:\n') +
        (version === '2.0' ? '  N:\n    ' : '    N:\n      ') +
        'type: number\n' + (version === '2.0' ? '    ' : '      ') + key + ': ' + value + '\n';
      const r = actualRun({ 'fixture.yaml': text });
      const pointer = version === '2.0' ? '#/definitions/N/' : '#/components/schemas/N/';
      // Swagger 2.0: draft-04 §5.1.2.1 / §5.1.3.1 MUST → error. OpenAPI 3.0: Wright-00 §5.3 / §5.5
      // drops that MUST; without the limit the keyword has no effect → warning.
      const want = version === '2.0' ? 'error schema.boundaryMissing' : 'warning schema.boundaryNoEffect';
      check(`real run ${version} ${key}=${value} requires its boundary`, r.problems.some((p) =>
        p.level + ' ' + p.code === want && p.path === pointer + key && p.file === 'fixture.yaml' &&
        p.line === (version === '2.0' ? 7 : 8) && p.col === (version === '2.0' ? 5 : 7)));
      if (version !== '2.0') check(`real run ${version} ${key}=${value} is not an error`, !errors(r).length, brief(r).join(' | '));
      workerContext.self.onmessage({ data: { id: 42, input: { root: 'fixture.yaml', files: { 'fixture.yaml': text } } } });
      const reply = replies.pop();
      eq('real worker and run agree', [reply.id, stableResult(reply.result)], [42, stableResult(r)]);
    }
  }
}

// ---------- wiring ----------
for (const f of ['swagger-2.0.json', 'json-schema-draft-04.json', 'oas-3.0-2024-10-18.json', 'oas-3.1-2026-08-03.json', 'oas-3.2-2026-08-30.json']) {
  check('run module imports ' + f, runSrc.includes('openapi-schemas/' + f));
}
check('worker uses runValidation', /import \{ runValidation \} from '\.\/openapi-validator-run\.js'/.test(workerSrc));
check('component starts the worker', component.includes("import ValidatorWorker from './openapi-validator.worker.js?worker'"));
check('component falls back to the run module', component.includes("import('./openapi-validator-run.js')"));
for (const [name, src] of [['component', component.slice(component.indexOf('<script>'))], ['engine', engineSrc], ['worker', workerSrc], ['run', runSrc]]) {
  check(name + ' sends nothing over the network and stores nothing',
    !/\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie|ztPersist|innerHTML/.test(src));
}
eq('2.0 schema is the official file', schemas['2.0'].id, 'http://swagger.io/v2/schema.json#');
eq('draft-04 meta-schema id', schemas['draft-04'].id, 'http://json-schema.org/draft-04/schema#');
eq('3.0 schema is the official draft-04 file', schemas['3.0'].id, 'https://spec.openapis.org/oas/3.0/schema/2024-10-18');
eq('3.1 schema id', schemas['3.1'].$id, 'https://spec.openapis.org/oas/3.1/schema/2026-08-03');
eq('3.2 schema id', schemas['3.2'].$id, 'https://spec.openapis.org/oas/3.2/schema/2026-08-30');

// ---------- draft-04 conversion and $dynamicRef ----------
{
  const c = E.fromDraft04({ id: 'x', $schema: 'http://json-schema.org/draft-04/schema#',
    properties: { exclusiveMinimum: { type: 'boolean' }, n: { type: 'number', minimum: 0, exclusiveMinimum: true } } });
  eq('id → $id', c.$id, 'x');
  eq('$schema → draft-07', c.$schema, 'http://json-schema.org/draft-07/schema#');
  eq('property named exclusiveMinimum kept', c.properties.exclusiveMinimum, { type: 'boolean' });
  eq('boolean exclusiveMinimum → numeric', c.properties.n, { type: 'number', exclusiveMinimum: 0 });
  const s = E.staticDynamicRefs(schemas['3.1']);
  check('3.1: no $dynamicRef left after conversion', !JSON.stringify(s).includes('$dynamicRef'));
  eq('3.1: media type schema points at $defs/schema', s.$defs['media-type'].properties.schema, { $ref: '#/$defs/schema' });
}

// ---------- official example documents ----------
const FIX = JSON.parse(readFileSync(join(root, 'scripts/test-openapi-validator.fixtures.json'), 'utf8'));
const officialWarnings = {
  'v3.1/tictactoe.yaml': ['warning component.unused 197:5 #/components/securitySchemes/basicHttpAuthentication'],
};
for (const [name, text] of Object.entries(FIX.files)) {
  const r = run(text);
  eq('official example ' + name + ' has no errors', errors(r).map((p) => p.code), []);
  eq('official example ' + name + ' warnings and notes', brief(r), officialWarnings[name] || []);
}
{
  const v2 = run(FIX.swagger['petstore-v2.json']);
  eq('Swagger Petstore v2: Swagger 2.0, no errors', [v2.kind, v2.version, errors(v2).length], ['swagger', '2.0', 0]);
  eq('Swagger Petstore v2: only the conversion note', codes(v2), ['info swagger.convert']);
  eq('Swagger Petstore v2 summary', [v2.summary.paths, v2.summary.operations, v2.summary.servers[0]], [14, 20, 'https://petstore.swagger.io/v2']);
  const v3 = run(FIX.swagger['petstore-v3.json']);
  eq('Swagger Petstore v3: unused request bodies (as Redocly and Spectral report)', brief(v3), [
    'warning component.unused 1:16452 #/components/requestBodies/Pet',
    'warning component.unused 1:16666 #/components/requestBodies/UserArray',
  ]);
}
eq('petstore has 3 operations', run(FIX.files['v3.0/petstore.yaml']).summary.operations, 3);
check('3.2 query method counted', run(FIX.files['v3.2/3.2-query-example.yaml']).summary.operations === 1);

// ---------- version and structure rules (official schemas) ----------
const INFO = 'info:\n  title: T\n  version: "1"\n';
eq('3.1 with only webhooks is valid', codes(run('openapi: 3.1.0\n' + INFO + 'webhooks:\n  ping:\n    post:\n      responses:\n        "200":\n          description: OK\n')), []);
check('3.1 with no paths, components or webhooks is invalid', errors(run('openapi: 3.1.0\n' + INFO)).length > 0);
eq('3.0 without paths', msgs(run('openapi: 3.0.3\n' + INFO)), ['Missing required field "paths".']);
eq('3.1 operation without responses is valid', codes(run('openapi: 3.1.0\n' + INFO + 'paths:\n  /a:\n    get: {}\n')), []);
eq('3.0 operation without responses', brief(run('openapi: 3.0.3\n' + INFO + 'paths:\n  /a:\n    get: {}\n')),
  ['error schema.required 7:5 #/paths/~1a/get']);
eq('response without description, no $ref noise',
  msgs(run('openapi: 3.0.3\n' + INFO + 'paths:\n  /users:\n    get:\n      responses:\n        "200":\n          content: {}\n')),
  ['Missing required field "description".']);
eq('info.version missing', brief(run('openapi: 3.0.3\ninfo:\n  title: T\npaths: {}\n')), ['error schema.required 2:1 #/info']);
eq('unknown root field (3.0)', msgs(run('openapi: 3.0.3\n' + INFO + 'paths: {}\nfoo: 1\n')), ['Field "foo" is not allowed here.']);
eq('unknown root field (3.1)', brief(run('openapi: 3.1.0\n' + INFO + 'paths: {}\nfoo: 1\n')), ['error schema.unknown 1:1 #']);
eq('x- extension allowed', codes(run('openapi: 3.0.3\n' + INFO + 'paths: {}\nx-foo: 1\n')), []);
eq('path key must start with / (3.0)', msgs(run('openapi: 3.0.3\n' + INFO + 'paths:\n  users: {}\n')), ['Path "users" must start with "/".']);
eq('path key must start with / (3.1)', msgs(run('openapi: 3.1.0\n' + INFO + 'paths:\n  users: {}\n')), ['Path "users" must start with "/".']);
check('3.0 multipleOf: 0 rejected (exclusiveMinimum converted)',
  run('openapi: 3.0.3\n' + INFO + 'paths: {}\ncomponents:\n  schemas:\n    N:\n      type: number\n      multipleOf: 0\n').problems.some((p) => p.path === '#/components/schemas/N/multipleOf'));
eq('parameter without schema or content: one message', msgs(run('openapi: 3.1.0\n' + INFO + 'paths:\n  /a:\n    get:\n      parameters:\n        - {name: q, in: query}\n')), ['Needs one of these fields: "schema", "content".']);
check('3.0 path parameter must be required', errors(run('openapi: 3.0.3\n' + INFO + 'paths:\n  /u/{id}:\n    get:\n      parameters:\n        - name: id\n          in: path\n          schema: {type: string}\n      responses:\n        "200": {description: OK}\n')).length > 0);
check('3.1 Schema Object must be an object or boolean ($dynamicRef #meta resolved)',
  run('openapi: 3.1.0\n' + INFO + 'paths: {}\ncomponents:\n  schemas:\n    N: 5\n').problems.some((p) => p.path === '#/components/schemas/N' && p.level === 'error'));

// ---------- version field ----------
eq('swagger "3.0" is not a Swagger version', brief(run('swagger: "3.0"\ninfo: {title: T, version: "1"}\npaths: {}\n')), ['error doc.swaggerVersion 1:1 #/swagger']);
eq('openapi as a YAML number', brief(run('openapi: 3.0\n' + INFO + 'paths: {}\n')), ['error doc.badOpenapi 1:1 #/openapi']);
eq('openapi 3.3.0 not supported', codes(run('openapi: 3.3.0\n' + INFO + 'paths: {}\n')), ['error doc.badOpenapi']);
eq('missing openapi', msgs(run(INFO + 'paths: {}\n')), ['No "openapi" field (OpenAPI 3) or "swagger" field (Swagger 2.0) at the top level.']);
eq('non-object document', codes(run('- a')), ['error doc.notObject']);

// ---------- parsing: YAML 1.2 core, merge keys, positions ----------
eq('unquoted date stays a string (YAML 1.2 core schema)', codes(run('openapi: 3.1.0\ninfo:\n  title: T\n  version: 2024-01-15\npaths: {}\n')), []);
eq('merge key with an anchor', codes(run('openapi: 3.1.0\n' + INFO + 'x-ok: &ok\n  description: OK\npaths:\n  /a:\n    get:\n      responses:\n        "200":\n          <<: *ok\n')), []);
eq('duplicate key: line and column', brief(run('openapi: 3.1.0\n' + INFO + 'paths:\n  /a: {}\n  /a: {}\n')), ['error parse.yaml 7:3 #']);
eq('duplicate key message', msgs(run('openapi: 3.1.0\n' + INFO + 'paths:\n  /a: {}\n  /a: {}\n')), ['YAML / JSON syntax error: the same key appears twice in one mapping.']);
eq('duplicate key in JSON is reported too', codes(run('{"openapi": "3.1.0", "openapi": "3.1.0"}')), ['error parse.yaml']);
eq('bad indentation', brief(run('openapi: 3.1.0\n' + INFO + 'paths:\n  /a:\n    get:\n      responses: {}\n     tags: []\n')), ['error parse.yaml 9:6 #']);
eq('tab indentation', msgs(run('openapi: 3.1.0\ninfo:\n\ttitle: T\n')), ['YAML / JSON syntax error: tabs are not allowed in indentation.']);
eq('several documents', msgs(run('openapi: 3.1.0\n---\nopenapi: 3.1.0\n')), ['YAML / JSON syntax error: more than one document (---) in the input.']);
eq('JSON indented with tabs parses', codes(run('{\n\t"openapi": "3.1.0",\n\t"info": {"title": "T", "version": "1"},\n\t"paths": {}\n}')), []);
eq('BOM is ignored', codes(run('\uFEFFopenapi: 3.1.0\n' + INFO + 'paths: {}\n')), []);
{
  const r = run('openapi: 3.1.0\n' + INFO + 'paths: {}\ncomponents:\n  schemas:\n    Id:\n      type: integer\n      maximum: 9223372036854775807\n');
  eq('integer above 2^53 is noted with its position', brief(r).filter((s) => s.includes('number.big')), ['info number.big 10:16 #']);
  eq('big integer message', msgs(r).filter((m) => m.startsWith('Integer')), ['Integer 9223372036854775807 is larger than 2^53. JavaScript tools, this one included, read it as an approximate value.']);
}
// positions in flow style, quoted keys, minified JSON and through a merge
{
  const flow = run('openapi: 3.1.0\ninfo: {title: T, version: "1"}\npaths: {"/a": {get: {parameters: [{name: x, in: path, required: true, schema: {type: string}}]}}}\n');
  eq('flow mapping position', brief(flow), ['error path.extra 3:16 #/paths/~1a/get']);
  const json = run('{"openapi":"3.0.3","info":{"title":"T"},"paths":{}}');
  eq('minified JSON position', brief(json), ['error schema.required 1:20 #/info']);
  const quoted = run('"openapi": "3.0.3"\n"info":\n  "title": T\n"paths": {}\n');
  eq('quoted key position', brief(quoted), ['error schema.required 2:1 #/info']);
  const merged = run('openapi: 3.0.3\n' + INFO + 'x-r: &r\n  content: {}\npaths:\n  /a:\n    get:\n      responses:\n        "200":\n          <<: *r\n');
  eq('position of a field that comes from a merge', brief(merged), ['error schema.required 11:9 #/paths/~1a/get/responses/200']);
  const seq = run('openapi: 3.1.0\n' + INFO + 'tags:\n  - name: a\n  -   name: a\npaths: {}\n');
  eq('sequence item position', brief(seq), ['error tag.duplicate 7:7 #/tags/1/name']);
}

// ---------- $ref (one file) ----------
const REFDOC = (ref) => 'openapi: 3.0.3\n' + INFO + 'paths:\n  /pets:\n    get:\n      responses:\n        "200":\n          description: OK\n          content:\n            application/json:\n              schema:\n                $ref: "' + ref + '"\ncomponents:\n  schemas:\n    Pet:\n      type: object\n    "a/b":\n      type: string\n';
eq('internal $ref resolves', errors(run(REFDOC('#/components/schemas/Pet'))), []);
eq('broken internal $ref', brief(run(REFDOC('#/components/schemas/Pett'))).filter((s) => s.startsWith('error')),
  ['error ref.missing 14:17 #/paths/~1pets/get/responses/200/content/application~1json/schema/$ref']);
eq('broken $ref message', msgs(run(REFDOC('#/components/schemas/Pett')))[0], 'Reference "#/components/schemas/Pett" does not point to anything in this document.');
eq('~1 in a $ref pointer', errors(run(REFDOC('#/components/schemas/a~1b'))), []);
eq('percent-encoded $ref pointer', errors(run(REFDOC('#/components/schemas/a%7E1b'))), []);
check('invalid percent-encoding', codes(run(REFDOC('#/components/schemas/%E0%A4%A'))).includes('error ref.bad'));
eq('broken $ref under the default response is checked (was skipped as example data)',
  codes(run('openapi: 3.0.3\n' + INFO + 'paths:\n  /a:\n    get:\n      responses:\n        default:\n          $ref: "#/components/responses/Nope"\n')), ['error ref.missing']);
eq('$ref inside an example value is data', codes(run('openapi: 3.0.3\n' + INFO + 'paths: {}\ncomponents:\n  schemas:\n    S:\n      type: object\n      example:\n        $ref: "#/nowhere"\n')), ['warning component.unused']);
eq('$ref in an Example Object is checked', codes(run('openapi: 3.1.0\n' + INFO + 'paths: {}\ncomponents:\n  parameters:\n    P:\n      name: q\n      in: query\n      schema: {type: string}\n      examples:\n        one:\n          $ref: "#/components/examples/missing"\n')),
  ['warning component.unused', 'error ref.missing']);
eq('$ref inside an extension is checked', codes(run('openapi: 3.0.3\n' + INFO + 'paths: {}\nx-webhooks:\n  ping:\n    $ref: "#/components/pathItems/nope"\n')), ['error ref.missing']);
{
  const r = run(REFDOC('common.yaml#/components/schemas/Pet'));
  eq('reference to a file that is not provided', codes(r), ['info component.unusedMaybe', 'info ref.missingFile', 'warning component.unused', 'warning component.unused']);
  eq('missing file message names the file', msgs(r)[1], 'Reference "common.yaml#/components/schemas/Pet" needs the file common.yaml. Add it under Other files to check it.');
  eq('URL reference is noted, not fetched', codes(run(REFDOC('https://example.com/pet.yaml'))).filter((c) => c.includes('ref.')), ['info ref.url']);
  eq('anchor reference is noted', codes(run(REFDOC('#Pet'))).filter((c) => c.includes('ref.')), ['info ref.anchor']);
}

// ---------- several files ----------
{
  const files = {
    'openapi.yaml': 'openapi: 3.1.0\n' + INFO + 'paths:\n  /pets:\n    $ref: "./paths/pets.yaml"\ncomponents:\n  schemas:\n    Pet:\n      $ref: "./schemas/pet.yaml#/Pet"\n    Error:\n      type: object\n',
    'paths/pets.yaml': 'get:\n  responses:\n    "200":\n      content:\n        application/json:\n          schema:\n            $ref: "../schemas/pet.yaml#/Pet"\n    default:\n      description: Error\n      content:\n        application/json:\n          schema:\n            $ref: "../openapi.yaml#/components/schemas/Error"\n',
    'schemas/pet.yaml': 'Pet:\n  type: object\n  properties:\n    owner:\n      $ref: "#/Owner"\n    tag:\n      $ref: "#/Tagg"\nOwner:\n  type: string\n',
    'notes.yaml': 'a: 1\n',
  };
  const r = runFiles(files, 'openapi.yaml');
  eq('multi-file: problems are reported in the file where the text is', brief(r).map((s) => s.replace(/ #.*$/, '')).sort(), [
    'error ref.missing 7:7',
    'error schema.required 3:5',
    'info file.unused 1:1',
    'warning component.unused 10:5',
  ]);
  eq('multi-file: files of each problem', r.problems.map((p) => p.file + ' ' + p.code).sort(), [
    'notes.yaml file.unused', 'openapi.yaml component.unused', 'paths/pets.yaml schema.required', 'schemas/pet.yaml ref.missing',
  ]);
  eq('multi-file: missing description found inside the referenced path item', r.problems.find((p) => p.code === 'schema.required').path, '#/get/responses/200');
  eq('multi-file summary counts the files and operations', [r.summary.operations, r.files.length], [1, 4]);
  // basename fallback and a reference cycle between files
  const r2 = runFiles({
    'openapi.yaml': 'openapi: 3.1.0\n' + INFO + 'paths: {}\ncomponents:\n  schemas:\n    A:\n      $ref: "./models/a.yaml"\n',
    'a.yaml': 'type: object\nproperties:\n  b:\n    $ref: "./b.yaml"\n',
    'b.yaml': 'type: object\nproperties:\n  a:\n    $ref: "./a.yaml"\n',
  }, 'openapi.yaml');
  eq('multi-file: unique file name found without its folder; cycles stop', codes(r2), ['warning component.unused']);
  const r3 = runFiles({ 'openapi.yaml': REFDOC('pet.yaml'), 'pet.yaml': 'type: object\n  bad: [\n' }, 'openapi.yaml');
  check('multi-file: syntax error in a referenced file has its own line', r3.problems.some((p) => p.file === 'pet.yaml' && p.code === 'parse.yaml' && p.line === 2));
  const r4 = runFiles({ 'openapi.yaml': REFDOC('pet.yaml#/Nope'), 'pet.yaml': 'type: object\n' }, 'openapi.yaml');
  eq('multi-file: missing target in another file', msgs(r4).filter((m) => m.startsWith('Reference')), ['Reference "pet.yaml#/Nope" does not point to anything in pet.yaml.']);
  eq('pickRoot prefers the file with an openapi field', E.pickRoot({ 'a.yaml': 'type: object\n', 'api/openapi.yaml': 'openapi: 3.1.0\n', 'x/y/z.yaml': 'swagger: "2.0"\n' }), 'api/openapi.yaml');
}

// ---------- rules the schemas cannot express ----------
const H31 = 'openapi: 3.1.0\n' + INFO;
const H30 = 'openapi: 3.0.3\n' + INFO;
const OK = '      responses:\n        "200": {description: OK}\n';
eq('undeclared path parameter', brief(run(H30 + 'paths:\n  /users/{id}:\n    get:\n' + OK)), ['error path.undeclared 7:5 #/paths/~1users~1{id}/get']);
eq('undeclared path parameter message', msgs(run(H30 + 'paths:\n  /users/{id}:\n    get:\n' + OK)), ['GET /users/{id}: path parameter "id" is not declared. Add a parameter with in: path and name: id.']);
eq('path-level parameter covers all operations', codes(run(H30 + 'paths:\n  /users/{id}:\n    parameters:\n      - {name: id, in: path, required: true, schema: {type: string}}\n    get:\n' + OK + '    delete:\n' + OK)), []);
eq('declared but not in the path', msgs(run(H30 + 'paths:\n  /users:\n    get:\n      parameters:\n        - {name: id, in: path, required: true, schema: {type: string}}\n' + OK)),
  ['GET /users: parameter "id" has in: path, but the path has no {id}.']);
eq('parameter via $ref counts', codes(run(H30 + 'paths:\n  /users/{id}:\n    get:\n      parameters:\n        - $ref: "#/components/parameters/Id"\n' + OK + 'components:\n  parameters:\n    Id: {name: id, in: path, required: true, schema: {type: string}}\n')), []);
eq('external parameter $ref skips the check', codes(run(H30 + 'paths:\n  /users/{id}:\n    get:\n      parameters:\n        - $ref: "common.yaml#/Id"\n' + OK)), ['info ref.missingFile']);
eq('query parameter with the same name does not count', codes(run(H30 + 'paths:\n  /users/{id}:\n    get:\n      parameters:\n        - {name: id, in: query, schema: {type: string}}\n' + OK)), ['error path.undeclared']);
eq('duplicate operationId', msgs(run(H30 + 'paths:\n  /a:\n    get:\n      operationId: list\n' + OK + '  /b:\n    get:\n      operationId: list\n' + OK)),
  ['operationId "list" is already used at #/paths/~1a/get/operationId; it must be unique.']);
eq('equivalent path templates', brief(run(H31 + 'paths:\n  /users/{id}:\n    get:\n      parameters: [{name: id, in: path, required: true, schema: {type: string}}]\n  /users/{userId}:\n    get:\n      parameters: [{name: userId, in: path, required: true, schema: {type: string}}]\n')),
  ['error path.equivalent 9:3 #/paths/~1users~1{userId}']);
eq('query string in a path key', brief(run(H31 + 'paths:\n  /users?active=true:\n    get: {}\n')), ['warning path.query 6:3 #/paths/~1users?active=true']);
eq('duplicate parameter', brief(run(H31 + 'paths:\n  /pets:\n    get:\n      parameters:\n        - {name: limit, in: query, schema: {type: integer}}\n        - {name: limit, in: query, schema: {type: integer}}\n')),
  ['error param.duplicate 10:11 #/paths/~1pets/get/parameters/1']);
eq('same name in another location is fine', codes(run(H31 + 'paths:\n  /pets:\n    get:\n      parameters:\n        - {name: limit, in: query, schema: {type: integer}}\n        - {name: limit, in: header, schema: {type: integer}}\n')), []);
eq('duplicate tag', msgs(run(H31 + 'tags:\n  - name: pets\n  - name: pets\npaths: {}\n')), ['Tag "pets" is already item 1 of tags; tag names must be unique.']);
eq('undeclared security schemes (root and operation)', brief(run(H31 + 'security:\n  - api_key: []\npaths:\n  /pets:\n    get:\n      security:\n        - oauth: [read]\ncomponents:\n  securitySchemes:\n    apiKey: {type: apiKey, name: X-Key, in: header}\n')), [
  'error security.undefined 6:5 #/security/0/api_key',
  'error security.undefined 11:11 #/paths/~1pets/get/security/0/oauth',
  'warning component.unused 14:5 #/components/securitySchemes/apiKey',
]);
eq('3.2 allows a URI reference as a security requirement name', codes(run('openapi: 3.2.0\n' + INFO + 'security:\n  - "#/components/securitySchemes/k": []\npaths: {}\ncomponents:\n  securitySchemes:\n    k: {type: apiKey, name: X, in: header}\n')).filter((c) => c.startsWith('error')), []);
{
  const doc = (v) => 'openapi: ' + v + '\n' + INFO + 'servers:\n  - url: https://{env}.example.com/{version}\n    variables:\n      env:\n        default: prod\n        enum: [staging, production]\n      region:\n        default: eu\npaths: {}\n';
  eq('server variables (3.1: default outside enum is an error)', brief(run(doc('3.1.0'))), [
    'warning server.varUndefined 6:5 #/servers/0/url',
    'error server.defaultNotInEnum 9:9 #/servers/0/variables/env/default',
    'warning server.varUnused 11:7 #/servers/0/variables/region',
  ]);
  eq('server variables (3.0: default outside enum is a warning)', codes(run(doc('3.0.3'))), ['warning server.varUndefined', 'warning server.defaultNotInEnum', 'warning server.varUnused']);
  eq('3.2: a variable used twice', codes(run('openapi: 3.2.0\n' + INFO + 'servers:\n  - url: https://{h}/{h}\n    variables:\n      h: {default: a}\npaths: {}\n')), ['error server.varRepeated']);
  eq('3.0: empty enum', codes(run(H30 + 'servers:\n  - url: https://{h}\n    variables:\n      h: {default: a, enum: []}\npaths: {}\n')), ['warning server.enumEmpty']);
}

// ---------- Schema Objects in 3.1 / 3.2 (JSON Schema 2020-12) and type lists in 3.0 ----------
{
  const S = (h) => h + 'paths: {}\ncomponents:\n  schemas:\n    Pet:\n      type: object\n      properties:\n        id:\n          type: integer\n          required: true\n        name:\n          type: string\n          nullable: true\n        age:\n          type: int\n        weight:\n          type: number\n          minimum: 0\n          exclusiveMinimum: true\n';
  eq('3.1 Schema Object checked against the 2020-12 meta-schema', brief(run(S(H31))), [
    'warning component.unused 8:5 #/components/schemas/Pet',
    'error schema.fieldType 13:11 #/components/schemas/Pet/properties/id/required',
    'warning schema.nullable31 16:11 #/components/schemas/Pet/properties/name/nullable',
    'error schema.fieldEnum 18:11 #/components/schemas/Pet/properties/age/type',
    'error schema.fieldType 22:11 #/components/schemas/Pet/properties/weight/exclusiveMinimum',
  ]);
  eq('3.0 Schema Object rules from the 3.0 schema', codes(run(S(H30))), ['warning component.unused', 'error schema.fieldType', 'error schema.fieldEnum']);
  eq('3.0 type list explained once', msgs(run(H30 + 'paths: {}\ncomponents:\n  schemas:\n    N:\n      type: [string, "null"]\n')).filter((m) => m.startsWith('OpenAPI 3.0')),
    ['OpenAPI 3.0 does not allow a list of types. Use one type with nullable: true; type lists such as [string, "null"] need OpenAPI 3.1.']);
  eq('3.1 type list is fine', codes(run(H31 + 'paths: {}\ncomponents:\n  schemas:\n    N:\n      type: [string, "null"]\n')), ['warning component.unused']);
}

// ---------- examples against their schema ----------
{
  const doc = 'openapi: 3.0.3\n' + INFO + 'paths:\n  /pets/{id}:\n    get:\n      parameters:\n        - name: id\n          in: path\n          required: true\n          schema: {type: integer, format: int64}\n          example: abc\n      responses:\n        "200":\n          description: OK\n          content:\n            application/json:\n              schema: {$ref: "#/components/schemas/Pet"}\n              example:\n                name: Rex\n              examples:\n                cat:\n                  value: {id: "7", name: Tom}\ncomponents:\n  schemas:\n    Pet:\n      type: object\n      required: [id, name]\n      properties:\n        id: {type: integer, format: int64}\n        name: {type: string, maxLength: 3}\n        tag: {type: string, nullable: true}\n      example:\n        id: 1\n        name: Rex\n        tag: null\n';
  const r = run(doc);
  eq('examples: parameter, media type, Example Object; nullable honoured', brief(r), [
    'warning example.mismatch 13:11 #/paths/~1pets~1{id}/get/parameters/0/example',
    'error schema.exampleBoth 18:13 #/paths/~1pets~1{id}/get/responses/200/content/application~1json',
    'warning example.mismatch 20:15 #/paths/~1pets~1{id}/get/responses/200/content/application~1json/example',
    'warning example.mismatch 24:27 #/paths/~1pets~1{id}/get/responses/200/content/application~1json/examples/cat/value/id',
  ]);
  eq('example messages', msgs(r), [
    'Example does not match the schema: Must be integer.',
    '"example" and "examples" cannot be used together.',
    'Example does not match the schema: Missing required field "id".',
    'Example does not match the schema at /id: Must be integer.',
  ]);
  const ro = H31 + 'paths:\n  /pets:\n    post:\n      requestBody:\n        content:\n          application/json:\n            schema: {$ref: "#/components/schemas/Pet"}\n            example: {name: Rex}\n      responses:\n        "200":\n          description: OK\n          content:\n            application/json:\n              schema: {$ref: "#/components/schemas/Pet"}\n              example: {id: 1}\ncomponents:\n  schemas:\n    Pet:\n      type: object\n      required: [id, name]\n      properties:\n        id: {type: integer, readOnly: true}\n        name: {type: string}\n        password: {type: string, writeOnly: true}\n';
  eq('readOnly not required in requests; required in responses', msgs(run(ro)), ['Example does not match the schema: Missing required field "name".']);
  eq('3.1 examples array and int32 range', msgs(run(H31 + 'paths: {}\ncomponents:\n  schemas:\n    N:\n      type: integer\n      format: int32\n      examples: [1, 4294967296]\n')).filter((m) => m.startsWith('Example')),
    ['Example does not match the schema: Not a valid int32.']);
  eq('example via a component Example Object', codes(run(H31 + 'paths:\n  /a:\n    get:\n      responses:\n        "200":\n          description: OK\n          content:\n            application/json:\n              schema: {type: integer}\n              examples:\n                one: {$ref: "#/components/examples/One"}\ncomponents:\n  examples:\n    One: {value: "x"}\n')), ['warning example.mismatch']);
  eq('Swagger 2.0 response examples and schema example', codes(run('swagger: "2.0"\ninfo: {title: T, version: "1"}\npaths:\n  /a:\n    get:\n      responses:\n        "200":\n          description: OK\n          schema: {$ref: "#/definitions/N"}\n          examples:\n            application/json: "x"\ndefinitions:\n  N:\n    type: integer\n    example: 1.5\n')),
    ['info swagger.convert', 'warning example.mismatch', 'warning example.mismatch']);
}

// ---------- unused components ----------
{
  const r = run(H31 + 'paths:\n  /pets:\n    get:\n      responses:\n        "200":\n          description: OK\n          content:\n            application/json:\n              schema: {$ref: "#/components/schemas/Pet"}\ncomponents:\n  schemas:\n    Pet: {type: object}\n    Owner: {type: object}\n    Loop:\n      type: object\n      properties:\n        next: {$ref: "#/components/schemas/Loop"}\n    Cat: {type: object}\n    Base:\n      discriminator:\n        propertyName: kind\n        mapping:\n          cat: "#/components/schemas/Cat"\n  parameters:\n    Limit: {name: limit, in: query, schema: {type: integer}}\n');
  eq('unused components; self reference does not count; discriminator mapping does', r.problems.map((p) => p.args.name), ['Owner', 'Loop', 'Base', 'Limit']);
  eq('unused component message', msgs(r)[0], 'Schema "Owner" is not referenced anywhere.');
}

// ---------- Swagger 2.0 ----------
{
  const r = run('swagger: "2.0"\ninfo:\n  title: T\n  version: "1.0"\npaths:\n  /pets/{petId}:\n    get:\n      security:\n        - key: []\n      responses:\n        "200":\n          description: OK\n          schema: {$ref: "#/definitions/Pett"}\ndefinitions:\n  Pet: {type: object}\n');
  eq('Swagger 2.0 rules', brief(r), [
    'info swagger.convert 1:1 #/swagger',
    'error path.undeclared 7:5 #/paths/~1pets~1{petId}/get',
    'error security.undefined 9:11 #/paths/~1pets~1{petId}/get/security/0/key',
    'error ref.missing 13:20 #/paths/~1pets~1{petId}/get/responses/200/schema/$ref',
    'warning component.unused 15:3 #/definitions/Pet',
  ]);
  eq('Swagger 2.0 schema errors', brief(run('swagger: "2.0"\ninfo: {title: T}\npaths:\n  /a:\n    get:\n      responses: {}\n')), ['info swagger.convert 1:1 #/swagger', 'error schema.required 2:1 #/info', 'error schema.limit 6:7 #/paths/~1a/get/responses']);
  eq('Swagger 2.0 security message', msgs(r)[2], 'Security scheme "key" is not declared in securityDefinitions.');
}

// ---------- exclusiveMinimum / exclusiveMaximum without their limit ----------
{
  const bnd = (r) => brief(r).filter((s) => /boundary/.test(s));
  const r2 = run('swagger: "2.0"\ninfo: {title: T, version: "1"}\npaths:\n  /a:\n    get:\n      parameters:\n' +
    '        - {name: q, in: query, type: integer, exclusiveMaximum: true}\n' +
    '        - {name: ids, in: query, type: array, items: {type: integer, exclusiveMinimum: true, items: {type: integer}}}\n' +
    '        - {name: ok, in: query, type: integer, minimum: 1, exclusiveMinimum: true}\n' +
    '        - {name: b, in: body, schema: {type: object, properties: {n: {type: number, exclusiveMinimum: true}}}}\n' +
    '      responses:\n        "200":\n          description: ok\n          headers:\n' +
    '            X-R: {type: integer, exclusiveMinimum: false}\n' +
    '            X-L: {type: array, items: {type: integer, exclusiveMaximum: true}}\n' +
    'definitions:\n  N: {type: number, maximum: 5, exclusiveMaximum: true, x-exclusiveMinimum: true}\n' +
    '  R: {$ref: "#/definitions/N", exclusiveMinimum: true}\n' +
    '  P: {type: object, properties: {exclusiveMinimum: {type: boolean}}}\n');
  eq('2.0 boundary: parameters, items, body schema, headers', bnd(r2), [
    'error schema.boundaryMissing 7:47 #/paths/~1a/get/parameters/0/exclusiveMaximum',
    'error schema.boundaryMissing 8:70 #/paths/~1a/get/parameters/1/items/exclusiveMinimum',
    'error schema.boundaryMissing 10:85 #/paths/~1a/get/parameters/3/schema/properties/n/exclusiveMinimum',
    'error schema.boundaryMissing 15:34 #/paths/~1a/get/responses/200/headers/X-R/exclusiveMinimum',
    'error schema.boundaryMissing 16:55 #/paths/~1a/get/responses/200/headers/X-L/items/exclusiveMaximum',
  ]);
  eq('2.0 boundary message', E.formatMessage(r2.problems.find((p) => p.code === 'schema.boundaryMissing'), T),
    'exclusiveMaximum: true needs "maximum" in the same object. Swagger 2.0 uses JSON Schema draft 4, where exclusiveMaximum MUST come with maximum.');
  const r3 = run('openapi: 3.0.4\ninfo: {title: T, version: "1"}\npaths:\n  /a:\n    get:\n      parameters:\n' +
    '        - {name: q, in: query, schema: {type: integer, nullable: true, exclusiveMaximum: true}}\n' +
    '      responses:\n        "200":\n          description: ok\n' +
    'components:\n  schemas:\n    N: {type: number, nullable: true, minimum: 0, exclusiveMinimum: true}\n' +
    '    L: {type: array, items: {allOf: [{type: integer, exclusiveMinimum: false}]}}\n' +
    '    R: {$ref: "#/components/schemas/N", exclusiveMaximum: true}\n');
  eq('3.0 boundary: warnings only, nullable and legal pairs kept', brief(r3).filter((s) => !/component\.unused/.test(s)), [
    'warning schema.boundaryNoEffect 7:72 #/paths/~1a/get/parameters/0/schema/exclusiveMaximum',
    'warning schema.boundaryNoEffect 14:54 #/components/schemas/L/items/allOf/0/exclusiveMinimum',
  ]);
  const r31 = run('openapi: 3.1.1\ninfo: {title: T, version: "1"}\ncomponents:\n  schemas:\n    N: {type: number, exclusiveMinimum: 0}\n');
  eq('3.1 numeric exclusiveMinimum is not a boundary problem', bnd(r31), []);
  const rf = runFiles({ 'api.yaml': 'swagger: "2.0"\ninfo: {title: T, version: "1"}\npaths: {}\ndefinitions:\n  N: {$ref: "defs.yaml#/N"}\n',
    'defs.yaml': 'N:\n  type: integer\n  exclusiveMinimum: true\n' }, 'api.yaml');
  eq('2.0 boundary located in the referenced file', bnd(rf).concat(rf.problems.filter((p) => p.code === 'schema.boundaryMissing').map((p) => p.file)),
    ['error schema.boundaryMissing 3:3 #/N/exclusiveMinimum', 'defs.yaml']);
  for (const lang of ['zh', 'ja', 'ko']) check(lang + ' boundary messages are translated', STRINGS[lang].msg['schema.boundaryMissing'] !== T.msg['schema.boundaryMissing'] && STRINGS[lang].msg['schema.boundaryNoEffect'] !== T.msg['schema.boundaryNoEffect']);
}

// ---------- large files: read-only window instead of the whole text in the textarea ----------
{
  const script = component.slice(component.indexOf('<script>'));
  const vm1 = /\/\/ view:start[^\n]*\n([\s\S]*?)\/\/ view:end/.exec(script);
  check('component has the window helpers', !!vm1);
  const limits = /var VIEW_LIMIT = (\d+) \* (\d+), WIN_LINES = (\d+), WIN_CHARS = (\d+) \* (\d+);/.exec(script);
  check('view limits declared', !!limits);
  eq('view limits', limits && [limits[1] * limits[2], +limits[3], limits[4] * limits[5]], [524288, 300, 49152]);
  const H = new Function('WIN_LINES', 'WIN_CHARS', vm1[1] + '\nreturn { countNl, winFrom, winAround, winBefore, lineAt };');
  const lineOf = (t, o) => t.slice(0, o).split('\n').length;
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (const [WL, WC] of [[300, 49152], [5, 64]]) {
    const V = H(WL, WC);
    for (let k = 0; k < 40; k++) {
      let t = '';
      const lines = 1 + rnd(400);
      for (let i = 0; i < lines; i++) t += 'x'.repeat(rnd(k % 5 === 0 ? 300 : 30)) + (rnd(10) ? '\n' : '');
      if (!t.length) t = 'a';
      // walking forward from the start covers the text exactly once, with the right line numbers
      let w = V.winFrom(t, 0, 1), seen = '', ok = true, steps = 0;
      while (true) {
        ok = ok && w.line === lineOf(t, w.start) && w.end > w.start && w.end - w.start <= WC && V.countNl(t, w.start, w.end) <= WL;
        seen += t.slice(w.start, w.end);
        if (w.end >= t.length || ++steps > 100000) break;
        const n = V.winFrom(t, w.end, w.line + V.countNl(t, w.start, w.end));
        // and walking back from the next window returns to a window that ends at or after this start
        const b = V.winBefore(t, n);
        ok = ok && b.line === lineOf(t, b.start) && b.start <= w.end && b.end > b.start && b.start < n.start;
        w = n;
      }
      check(`window walk covers the text (${WL}/${WC}, #${k})`, ok && seen === t);
      for (let q = 0; q < 10; q++) {
        const o = rnd(t.length);
        const a = V.winAround(t, o, lineOf(t, o));
        check(`window around offset contains it (${WL}/${WC}, #${k}.${q})`, a.start <= o && o < Math.max(a.end, a.start + 1) && a.line === lineOf(t, a.start), JSON.stringify([o, a]));
        const ls = t.lastIndexOf('\n', o - 1) + 1, le = t.indexOf('\n', o);
        eq('lineAt', V.lineAt(t, o), t.slice(o > 0 ? ls : 0, le < 0 ? t.length : le));
      }
    }
    // a single very long line: the window starts inside the line near the offset
    const long = 'a'.repeat(3 * WC) + '\nend';
    const a = V.winAround(long, 2 * WC, 1);
    check(`long line window (${WL}/${WC})`, a.start > 0 && a.start <= 2 * WC && a.end > 2 * WC && a.line === 1, JSON.stringify(a));
  }
  check('large roots are not put in the textarea in full', /function setRoot\(text\) \{\s*if \(text\.length > VIEW_LIMIT\)/.test(script) &&
    !/input\.value = files\[/.test(script) && !/\.split\('\\n'\)/.test(script));
  check('a newer file load wins over an older one', /if \(myLoad !== loadSeq\) return;/.test(script));
}

// ---------- messages in every language ----------
const allCodes = new Set();
const codeRe = /(?:add|push|addB)\((?:'(?:error|warning|info)'|level), '([a-z0-9]+\.[a-zA-Z0-9]+)'/g;
let cm;
while ((cm = codeRe.exec(engineSrc))) allCodes.add(cm[1]);
for (const c of ['parse.yaml', 'schema.typeList30', 'example.mismatch']) allCodes.add(c);
for (const m of engineSrc.matchAll(/code: '([a-z]+\.[a-zA-Z0-9]+)'/g)) allCodes.add(m[1]);
check('engine emits at least 40 message codes', allCodes.size >= 40, allCodes.size);
const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const L = STRINGS[lang];
  for (const c of allCodes) check(lang + ' has a message for ' + c, typeof L.msg[c] === 'string', c);
  check(lang + ' has the same keys as en', JSON.stringify(Object.keys(L).sort()) === JSON.stringify(Object.keys(T).sort()));
  for (const k of Object.keys(T.msg)) check(lang + ' msg ' + k + ' placeholders', ph(L.msg[k]) === ph(T.msg[k]), L.msg[k]);
  for (const k of Object.keys(T)) if (typeof T[k] === 'string') check(lang + ' ' + k + ' placeholders', ph(L[k]) === ph(T[k]), L[k]);
  for (const k of Object.keys(T.kinds)) check(lang + ' kind ' + k, typeof L.kinds[k] === 'string');
  eq(lang + ' yamlReasons keys', Object.keys(L.yamlReasons).sort(), Object.keys(T.yamlReasons).sort());
}
{
  const loader = readFileSync(join(root, 'node_modules/js-yaml/lib/loader.js'), 'utf8');
  // keys with {n} are the work limits; js-yaml builds them as 'text (' + number + ')'
  for (const k of Object.keys(T.yamlReasons)) check('js-yaml reports "' + k + '"', k.includes('{n}') ? loader.includes("'" + k.split('{n}')[0]) : loader.includes("'" + k + "'"), k);
}
check('every engine code is used with the English table', [...allCodes].every((c) => T.msg[c]));
eq('nested detail is formatted in the page language', E.formatMessage({ code: 'example.mismatch', args: { where: '/id', detail: { code: 'schema.type', args: { type: 'integer' } }, more: '2' } }, STRINGS.zh),
  '示例与 schema 不符（位置 /id）：类型应为 integer。（另有 2 处）');

// ---------- examples on the tool pages ----------
// {/* ov */} before an input block; the next {/* ov-out */} block lists "line:col  Level  message"
// as the page renders them.
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/openapi-validator', lang + '.mdx'), 'utf8');
  const L = STRINGS[lang];
  const level = (l) => (l === 'error' ? L.levelError : l === 'warning' ? L.levelWarning : L.levelInfo);
  const re = /\{\/\* ov \*\/\}\s*<pre><code>\{`([\s\S]*?)`\}<\/code><\/pre>\s*\{\/\* ov-out \*\/\}\s*<pre><code>\{`([\s\S]*?)`\}<\/code><\/pre>/g;
  let m, n = 0;
  while ((m = re.exec(mdx))) {
    n++;
    const text = new Function('return `' + m[1] + '`')();
    const shown = new Function('return `' + m[2] + '`')();
    const r = run(text);
    const lines = r.problems.map((p) => `${p.line}:${p.col}  ${level(p.level)}  ${E.formatMessage(p, L)}`);
    eq(lang + ' page example ' + n, lines.join('\n'), shown.trim());
  }
  check(lang + ' page has at least 3 checked examples', n >= 3, n);
  check(lang + ' page links to an official source', /spec\.openapis\.org/.test(mdx));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
