// JSON Schema Validator — engine, official test suite, messages, page examples
//
// Read:  src/components/tools/JsonSchemaValidatorTool.astro (the `engine:start` / `engine:end`
//        block, the frontmatter STRINGS and the script's EXAMPLES, so the test cannot drift from
//        the shipped source); ajv, ajv/dist/2019, ajv/dist/2020, ajv-draft-04, ajv-formats,
//        js-yaml from node_modules (the packages the component bundles);
//        scripts/test-json-schema-validator.suite.json.gz (a subset of the official JSON Schema
//        Test Suite, MIT, commit in its `source` field); the 4 tool pages and the en guide.
// Write: stdout only. With --regenerate <JSON-Schema-Test-Suite checkout> it rewrites the .gz.
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: every required test of draft-04, -06, -07, 2019-09 and 2020-12 (and the 2020-12
// optional/format tests with "Check format" on) against the expected results, except a fixed
// list of Ajv limitations that must still fail (so an Ajv upgrade that fixes or breaks one is
// noticed); the spec-alignment fixes over plain Ajv ($ref siblings ignored in draft 4–7,
// ownProperties for "required", nullable / id / dependencies / const removed where the draft
// lacks them, empty enum, unknown formats); $schema detection and the menu; JSON syntax errors
// (codes, positions, JSON.parse agreement on 3,000 mutated texts), JSON Lines, YAML (core schema),
// BOM; the position scanner (spans re-parse to the same value, duplicate keys, integers beyond
// 2^53); oneOf / anyOf branch folding and closest branch, if / then folding; messages in 4
// languages with every placeholder filled; notices; referenced schemas and missing $ref; the
// tool examples; the static rules (no storage, network or innerHTML; persistence 'preference');
// a corpus compared with Python jsonschema (when installed: JSV_PYTHON or python3, SKIP
// otherwise); performance bounds; the {/* jsv-ex */} examples in the 4 tool pages; the en guide's
// executable blocks and tool claims.
//
// Run: node scripts/test-json-schema-validator.mjs
//      JSON_SCHEMA_TEST_SUITE_DIR=<checkout> also runs the full suite from that checkout.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import Ajv from 'ajv';
import Ajv2019 from 'ajv/dist/2019.js';
import Ajv2020 from 'ajv/dist/2020.js';
import AjvDraft04 from 'ajv-draft-04';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';
import { createRequire } from 'node:module';
// Timing limits catch order-of-magnitude regressions; CI runners are several times slower than a dev machine.
const PERF_SLACK = process.env.CI ? 4 : 1;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const FIXTURE = join(root, 'scripts/test-json-schema-validator.suite.json.gz');
const DIRS = { draft4: '4', draft6: '6', draft7: '7', 'draft2019-09': '2019-09', 'draft2020-12': '2020-12' };

// ---------- --regenerate ----------
if (process.argv[2] === '--regenerate') {
  const suite = process.argv[3];
  if (!suite || !existsSync(join(suite, 'tests'))) { console.error('usage: --regenerate <JSON-Schema-Test-Suite checkout>'); process.exit(1); }
  const commit = execFileSync('git', ['-C', suite, 'rev-parse', 'HEAD']).toString().trim();
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : f.endsWith('.json') ? [p] : []; });
  const out = { source: { repo: 'https://github.com/json-schema-org/JSON-Schema-Test-Suite', commit, license: 'MIT', note: 'tests/<draft>/*.json (required), tests/draft2020-12/optional/format/*.json, remotes/ (except draft3 and v1)' }, tests: {}, remotes: {} };
  for (const dir of Object.keys(DIRS)) {
    out.tests[dir] = readdirSync(join(suite, 'tests', dir)).filter((f) => f.endsWith('.json')).sort().map((f) => [f, JSON.parse(readFileSync(join(suite, 'tests', dir, f), 'utf8'))]);
  }
  out.tests['draft2020-12-format'] = readdirSync(join(suite, 'tests/draft2020-12/optional/format')).sort().map((f) => [f, JSON.parse(readFileSync(join(suite, 'tests/draft2020-12/optional/format', f), 'utf8'))]);
  for (const p of walk(join(suite, 'remotes'))) {
    const rel = relative(join(suite, 'remotes'), p);
    if (rel.startsWith('draft3/') || rel.startsWith('v1/')) continue;
    out.remotes[rel] = JSON.parse(readFileSync(p, 'utf8'));
  }
  writeFileSync(FIXTURE, gzipSync(Buffer.from(JSON.stringify(out)), { level: 9 }));
  console.log('wrote ' + relative(root, FIXTURE) + ' from ' + commit);
  process.exit(0);
}

// ---------- engine, strings, examples ----------
const source = readFileSync(join(root, 'src/components/tools/JsonSchemaValidatorTool.astro'), 'utf8');
const block = source.slice(source.indexOf('/* ── engine:start ── */'), source.indexOf('/* ── engine:end ── */'));
if (!block) { console.error('FAIL: engine block not found'); process.exit(1); }
const E = new Function(block + '\nreturn { DRAFTS, META_URIS, DRAFT_NAMES, ASSERTED_FORMATS, draftOfUri, detectDraft, createAjv, knownKeywords, prepareSchema, nestErrors, describe, jsonSyntaxError, scanJson, parseDocs, parseExtras, buildValidator, runValidation, noticeText, schemaErrorText, parseErrorText, statusText, reportText, reportJson, lineCol, getAt, codePoints };')();
const STRINGS = new Function(source.slice(source.indexOf('const STRINGS = '), source.indexOf('const S = STRINGS')) + '\nreturn STRINGS;')();
const exStart = source.indexOf('const EXAMPLES');
const exEnd = source.indexOf('EXAMPLES.userErrors.schema = EXAMPLES.user.schema;');
const EXAMPLES = new Function(source.slice(exStart, exEnd).replace(/const EXAMPLES: [^=]+=/, 'var EXAMPLES =') + 'EXAMPLES.userErrors.schema = EXAMPLES.user.schema;\nreturn EXAMPLES;')();
const lib = {
  Ajv: Ajv.default || Ajv, Ajv2019: Ajv2019.default || Ajv2019, Ajv2020: Ajv2020.default || Ajv2020,
  AjvDraft04: AjvDraft04.default || AjvDraft04, addFormats: addFormats.default || addFormats,
  draft06Meta: require('ajv/dist/refs/json-schema-draft-06.json'), yaml,
};
const T = STRINGS.en;

if (process.argv[2] === '--fill') {
  // rewrites the output blocks of the 4 tool pages with the engine's output (review the diff)
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const file = join(root, 'src/content/tools/json-schema-validator/' + lang + '.mdx');
    let text = readFileSync(file, 'utf8');
    for (const ex of examplesOf(text).reverse()) {
      if (ex.broken) continue;
      const o = ex.outBlock;
      text = text.slice(0, o.start) + '```text\n' + exampleOutput(ex, STRINGS[lang]) + '\n```' + text.slice(o.end);
    }
    writeFileSync(file, text);
  }
  console.log('filled');
  process.exit(0);
}

let failures = 0, passes = 0, skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
function skip(name) { skips++; console.log('SKIP: ' + name); }
function run(schemaText, dataText, opts = {}) {
  return E.runValidation(lib, { schemaText, dataText, extrasText: opts.extras || '', menu: opts.menu || 'auto', formats: opts.formats !== false }, opts.T || T, null);
}
function build(schema, draft, formats, extras) {
  return E.buildValidator(lib, { schema, menu: draft, formats, extras: extras || [] });
}
function valid(schema, data, draft = '2020-12', formats = true) {
  const b = build(schema, draft, formats);
  if (!b.ok) return 'error:' + b.errors.map((e) => e.code).join(',');
  return b.validate(data);
}
const codes = (res) => res.notices.map((n) => n.code);

// ---------- 1. official JSON Schema Test Suite ----------
// Each entry: '<draft dir>|<file>|<group>|<test>' that still fails, with the reason.
const KNOWN_FAILURES = {
  // Ajv skips properties named "__proto__" (prototype pollution guard), so the schema for it is never applied.
  proto: ['properties.json|properties whose names are Javascript object property names|__proto__ not valid'],
  // Ajv: $recursiveRef without $recursiveAnchor in the target resource.
  recursive: ['recursiveRef.json|$recursiveRef with no $recursiveAnchor in the initial target schema resource|leaf node matches: recursion uses the inner schema', 'recursiveRef.json|$recursiveRef with no $recursiveAnchor in the initial target schema resource|leaf node does not match: recursion uses the inner schema'],
  // Ajv overflows the stack on nested $id with relative refs into $defs (compile error shown).
  relRefs: ['ref.json|refs with relative uris and defs|invalid on inner field', 'ref.json|refs with relative uris and defs|invalid on outer field', 'ref.json|refs with relative uris and defs|valid on both fields', 'ref.json|relative refs with absolute uris and defs|invalid on inner field', 'ref.json|relative refs with absolute uris and defs|invalid on outer field', 'ref.json|relative refs with absolute uris and defs|valid on both fields', 'ref.json|URN ref with nested pointer ref|a string is valid', 'ref.json|URN ref with nested pointer ref|a non-string is invalid'],
  // Ajv: unevaluatedItems / unevaluatedProperties with nested items, contains and if-without-then.
  uneval2019: ['unevaluatedItems.json|unevaluatedItems with nested items|with no additional items', 'unevaluatedItems.json|unevaluatedItems with nested items|with invalid additional item', 'unevaluatedItems.json|unevaluatedItems can see annotations from if without then and else|valid in case if is evaluated', 'unevaluatedProperties.json|unevaluatedProperties with if/then/else, then not defined|when if is true and has no unevaluated properties', 'unevaluatedProperties.json|unevaluatedProperties with if/then/else, then not defined|when if is false and has unevaluated properties', 'unevaluatedProperties.json|unevaluatedProperties can see annotations from if without then and else|valid in case if is evaluated'],
  uneval2020extra: ['unevaluatedItems.json|unevaluatedItems with $dynamicRef|with no unevaluated items', 'unevaluatedItems.json|unevaluatedItems with $dynamicRef|with unevaluated items', 'unevaluatedItems.json|unevaluatedItems depends on adjacent contains|contains passes, second item is not evaluated', 'unevaluatedItems.json|unevaluatedItems depends on multiple nested contains|7 not evaluated, fails unevaluatedItems', "unevaluatedItems.json|unevaluatedItems and contains interact to control item dependency relationship|only b's are invalid", "unevaluatedItems.json|unevaluatedItems and contains interact to control item dependency relationship|only c's are invalid", "unevaluatedItems.json|unevaluatedItems and contains interact to control item dependency relationship|only b's and c's are invalid", "unevaluatedItems.json|unevaluatedItems and contains interact to control item dependency relationship|only a's and c's are invalid", 'unevaluatedItems.json|unevaluatedItems with minContains = 0|all items evaluated by contains', 'unevaluatedProperties.json|unevaluatedProperties with $dynamicRef|with no unevaluated properties', 'unevaluatedProperties.json|unevaluatedProperties with $dynamicRef|with unevaluated properties'],
  // Ajv does not honour a custom meta-schema's $vocabulary.
  vocabulary: ['vocabulary.json|schema that uses custom metaschema with with no validation vocabulary|no validation: invalid number, but it still validates'],
};
const DYNAMIC_REF_FAILS = 25; // dynamicRef.json in 2020-12: Ajv supports $dynamicRef only in part
const EXPECTED_FAILS = {
  draft4: [...KNOWN_FAILURES.proto],
  draft6: [...KNOWN_FAILURES.proto],
  draft7: [...KNOWN_FAILURES.proto],
  'draft2019-09': [...KNOWN_FAILURES.proto, ...KNOWN_FAILURES.recursive, ...KNOWN_FAILURES.relRefs, ...KNOWN_FAILURES.uneval2019, ...KNOWN_FAILURES.vocabulary],
  'draft2020-12': [...KNOWN_FAILURES.proto, ...KNOWN_FAILURES.relRefs, ...KNOWN_FAILURES.uneval2019, ...KNOWN_FAILURES.uneval2020extra, ...KNOWN_FAILURES.vocabulary],
};
function runSuite(tests, remotes, dir, formats) {
  const draft = DIRS[dir];
  const rem = Object.entries(remotes).filter(([rel]) => !rel.startsWith('draft') || rel.startsWith(dir + '/'));
  let pass = 0, total = 0; const fails = [];
  for (const [file, groups] of tests) {
    for (const g of groups) {
      const needs = JSON.stringify(g.schema).includes('localhost:1234');
      const built = E.buildValidator(lib, { schema: g.schema, menu: draft, formats, extras: needs ? rem.map((r) => r[1]) : [], extraUris: needs ? rem.map((r) => 'http://localhost:1234/' + r[0]) : [] });
      for (const t of g.tests) {
        total++;
        let got;
        if (!built.ok) got = 'error';
        else { try { got = built.validate(t.data); } catch { got = 'throw'; } }
        if (got === t.valid) pass++; else fails.push(file + '|' + g.description + '|' + t.description);
      }
    }
  }
  return { pass, total, fails };
}
const fixture = JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString());
// Fast red/green loop through the shipped compilation and text entry points. Fixed official
// cases select the regression corpus; production detection must never inspect their names.
if (process.argv[2] === '--reliability') {
  for (const dir of ['draft4', 'draft6', 'draft7', 'draft2019-09', 'draft2020-12']) {
    const rem = Object.entries(fixture.remotes).filter(([p]) => !p.startsWith('draft') || p.startsWith(dir + '/'));
    for (const [file, groups] of fixture.tests[dir]) for (const g of groups) {
      const keys = EXPECTED_FAILS[dir];
      if (file !== 'dynamicRef.json' && !g.tests.some(t => keys.includes(file + '|' + g.description + '|' + t.description))) continue;
      const needs = JSON.stringify(g.schema).includes('localhost:1234');
      const b = E.buildValidator(lib, { schema: g.schema, menu: DIRS[dir], formats: false, extras: needs ? rem.map(r => r[1]) : [], extraUris: needs ? rem.map(r => 'http://localhost:1234/' + r[0]) : [] });
      for (const t of g.tests) {
        let got;
        try { got = b.stage === 'unknown' ? 'unknown' : !b.ok ? 'schema-error' : b.validate(t.data); }
        catch (error) { got = 'throw:' + error.message; }
        check(dir + '|' + file + '|' + g.description + '|' + t.description, got === 'unknown' || got === t.valid, { expected: t.valid, got });
      }
    }
  }
  const inputs = [
    ['proto', '{"properties":{"__proto__":{"type":"number"}}}', '{"__proto__":"wrong"}', {}],
    ['data integer', '{"maximum":9007199254740992}', '9007199254740993', {}],
    ['negative integer', '{"minimum":-9007199254740992}', '-9007199254740993', {}],
    ['fraction', '{"type":"integer"}', '1.0000000000000001', {}],
    ['exponent', '{"maximum":9007199254740992}', '9.007199254740993e15', {}],
    ['underflow', '{"const":0}', '1e-400', {}],
    ['schema integer', '{"maximum":9007199254740993}', '9007199254740992', {}],
    ['schema fraction', '{"multipleOf":1.0000000000000001}', '1', {}],
    ['extra integer', '{"$ref":"https://fixture.example/number"}', '1', { extras: '{"$id":"https://fixture.example/number","enum":[9007199254740993]}' }],
    ['JSON Lines', '{"properties":{"n":{"maximum":9007199254740992}}}', '{"n":1}\n{"n":9007199254740993}', {}],
    ['YAML data', '{"properties":{"n":{"maximum":9007199254740992}}}', 'n: 9007199254740993', {}],
    ['YAML schema', 'maximum: 9007199254740993', '1', {}],
    ['required vocabulary', '{"$vocabulary":{"https://fixture.example/vocab":true},"type":"string"}', '"x"', {}],
  ];
  for (const [name, schema, data, opts] of inputs) {
    const r = run(schema, data, opts);
    check(name + ': unknown main state', r.state === 'unknown', r.state);
    check(name + ': unknown documents have null validity and no asserted errors', r.docs.length > 0 && r.docs.some(d => d.state === 'unknown' && d.valid === null && d.raw.length === 0));
    check(name + ': copies retain unknown', E.reportText(r, T).includes(T.unknown) && JSON.parse(E.reportJson(r)).some(d => d.state === 'unknown' && d.valid === null));
  }
  check('ordinary numbers retain verdicts', run('{"maximum":3}', '2').state === 'valid' && run('{"maximum":3}', '4').state === 'invalid');
  console.log('reliability: ' + passes + ' PASS, ' + failures + ' FAIL');
  process.exit(failures ? 1 : 0);
}
check('suite fixture names its source commit and MIT license', /^[0-9a-f]{40}$/.test(fixture.source.commit) && fixture.source.license === 'MIT');
const suiteCounts = {};
for (const dir of Object.keys(DIRS)) {
  // Draft 4–7 may check formats; 2019-09 / 2020-12 tests expect format as an annotation (the
  // tool's "Check format" off).
  const formats = !(dir === 'draft2019-09' || dir === 'draft2020-12');
  const r = runSuite(fixture.tests[dir], fixture.remotes, dir, formats);
  suiteCounts[dir] = r;
  let fails = r.fails;
  if (dir === 'draft2020-12') {
    const dyn = fails.filter((f) => f.startsWith('dynamicRef.json|'));
    check('2020-12 dynamicRef.json: Ajv still fails ' + DYNAMIC_REF_FAILS + ' tests', dyn.length === DYNAMIC_REF_FAILS, dyn.length);
    fails = fails.filter((f) => !f.startsWith('dynamicRef.json|'));
  }
  const exp = EXPECTED_FAILS[dir];
  const unexpected = fails.filter((f) => !exp.includes(f));
  const fixed = exp.filter((f) => !fails.includes(f));
  check(dir + ': no failures outside the known Ajv limitations', unexpected.length === 0, unexpected.slice(0, 8));
  check(dir + ': every known limitation still fails (update the list after an Ajv upgrade)', fixed.length === 0, fixed);
}
// recorded totals (used in the tool pages)
const TOTALS = { draft4: [617, 618], draft6: [840, 841], draft7: [928, 929], 'draft2019-09': [1243, 1261], 'draft2020-12': [1249, 1301] };
for (const [dir, [p, t]] of Object.entries(TOTALS)) check(dir + ' suite total ' + p + '/' + t, suiteCounts[dir].pass === p && suiteCounts[dir].total === t, suiteCounts[dir].pass + '/' + suiteCounts[dir].total);
{
  // With "Check format" on (the default), the 2020-12 required tests that expect format to be
  // only an annotation fail, and nothing else changes.
  const on = runSuite(fixture.tests['draft2020-12'], fixture.remotes, 'draft2020-12', true);
  const extra = on.fails.filter((f) => !suiteCounts['draft2020-12'].fails.includes(f));
  check('2020-12 with formats on: only "…is only an annotation by default" tests change', extra.length > 0 && extra.every((f) => f.startsWith('format.json|') && / annotation by default$/.test(f)), extra);
  const fmt = runSuite(fixture.tests['draft2020-12-format'], fixture.remotes, 'draft2020-12', true);
  check('2020-12 optional/format with formats on: 733/874 (ajv-formats; idn-*, iri* not checked)', fmt.pass === 733 && fmt.total === 874, fmt.pass + '/' + fmt.total);
}
if (process.env.JSON_SCHEMA_TEST_SUITE_DIR) {
  const dirRoot = process.env.JSON_SCHEMA_TEST_SUITE_DIR;
  for (const dir of Object.keys(DIRS)) {
    const files = readdirSync(join(dirRoot, 'tests', dir)).filter((f) => f.endsWith('.json')).sort();
    const tests = files.map((f) => [f, JSON.parse(readFileSync(join(dirRoot, 'tests', dir, f), 'utf8'))]);
    const r = runSuite(tests, fixture.remotes, dir, !(dir === 'draft2019-09' || dir === 'draft2020-12'));
    console.log('suite checkout ' + dir + ': ' + r.pass + '/' + r.total);
  }
}

// ---------- 2. behaviour that plain Ajv gets wrong ----------
check('draft-07: keywords next to $ref are ignored', valid({ definitions: { s: { type: 'string' } }, properties: { a: { $ref: '#/definitions/s', maxLength: 3 } } }, { a: 'abcdef' }, '7') === true);
check('2020-12: keywords next to $ref apply', valid({ $defs: { s: { type: 'string' } }, properties: { a: { $ref: '#/$defs/s', maxLength: 3 } } }, { a: 'abcdef' }) === false);
check('draft-07: $ref sibling notice names the keyword', codes(run('{"$schema":"http://json-schema.org/draft-07/schema#","definitions":{"s":{}},"properties":{"a":{"$ref":"#/definitions/s","maxLength":3,"description":"x"}}}', '{}')).includes('refSiblings'));
check('required ["constructor"] rejects {}', valid({ required: ['constructor'] }, {}) === false);
check('required ["toString"] rejects {}', valid({ required: ['toString'] }, {}, '7') === false);
check('nullable is ignored (null fails type string)', valid({ type: 'string', nullable: true }, null) === false);
check('nullable notice suggests a type array', /"type": \["string", "null"\]/.test(E.noticeText(run('{"properties":{"a":{"type":"string","nullable":true}}}', '{}').notices.find((n) => n.code === 'nullable'), T)));
check('2020-12: dependencies is ignored', valid({ dependencies: { a: ['b'] } }, { a: 1 }) === true);
check('draft-07: dependencies applies', valid({ dependencies: { a: ['b'] } }, { a: 1 }, '7') === false);
check('draft-04: const is ignored', valid({ const: 3 }, 5, '4') === true);
check('draft-06: if / then are ignored', valid({ if: { const: 1 }, then: { const: 2 } }, 1, '6') === true);
check('draft-07: if / then apply', valid({ if: { const: 1 }, then: { const: 2 } }, 1, '7') === false);
check('draft-07: "id" is ignored, not a compile error', valid({ id: 'x', type: 'string' }, 'a', '7') === true);
check('draft-04: boolean exclusiveMinimum', valid({ minimum: 5, exclusiveMinimum: true }, 5, '4') === false);
check('2020-12: empty enum rejects everything', valid({ enum: [] }, 1) === false && valid({ enum: [] }, null) === false);
check('draft-04: empty enum is an invalid schema', valid({ enum: [] }, 1, '4') === 'error:meta');
check('integer accepts 1.0', valid({ type: 'integer' }, JSON.parse('1.0')) === true);
check('uniqueItems: 1 and 1.0 are equal', valid({ uniqueItems: true }, JSON.parse('[1, 1.0]')) === false);
check('maxLength counts code points: 👨‍👩‍👧 is 5', valid({ maxLength: 5 }, '👨‍👩‍👧') === true && valid({ maxLength: 4 }, '👨‍👩‍👧') === false);
check('maxLength counts code points: 東京都港区 is 5', valid({ maxLength: 5 }, '東京都港区') === true && valid({ maxLength: 4 }, '東京都港区') === false);
check('pattern uses the u flag (\\p{L})', valid({ pattern: '^\\p{L}+$' }, 'été') === true && valid({ pattern: '^\\p{L}+$' }, 'a1') === false);
check('unknown format is accepted and listed', (() => { const r = run('{"type":"string","format":"idn-email"}', '"x"'); return r.state === 'valid' && codes(r).includes('formatUnchecked'); })());
check('formats off: email is an annotation', valid({ format: 'email' }, 'x', '2020-12', false) === true);
check('formats on: email is checked in draft-04 too', valid({ format: 'email' }, 'x', '4') === false);
check('formats off adds a note', codes(run('{"type":"string"}', '"a"', { formats: false })).includes('formatOff'));
check('15 asserted formats (2026-09-30 fix)', E.ASSERTED_FORMATS.length === 15);
// existing format checks (2026-09-30 fix: ajv-formats in both drafts)
for (const draft of ['7', '2020-12']) {
  const F = [['email', 'alice@example.com', true], ['email', 'not-an-email', false], ['uri', 'https://example.com/a?b=1', true], ['uri', 'example.com/path', false], ['date', '2026-09-30', true], ['date', '2026-02-30', false], ['date', '2026-9-30', false], ['date-time', '2026-09-30T12:00:00Z', true], ['date-time', '2026-09-30T12:00:00+09:00', true], ['date-time', '2026-09-30T12:00:00', false], ['uuid', '123e4567-e89b-12d3-a456-426614174000', true], ['uuid', '123e4567e89b12d3a456426614174000', false], ['ipv4', '192.168.0.1', true], ['ipv4', '256.1.1.1', false], ['ipv6', '2001:db8::1', true], ['ipv6', '2001:db8:::1', false], ['time', '25:00:00Z', false], ['duration', 'P1D', true], ['duration', '1D', false], ['hostname', '-bad-.example.com', false], ['json-pointer', 'a/b', false], ['regex', '[', false], ['idn-email', 'anything', true], ['iri', 'anything', true], ['x-custom', 'anything', true]];
  for (const [f, v, exp] of F) check('[' + draft + '] format ' + f + ' ' + JSON.stringify(v), valid({ type: 'string', format: f }, v, draft) === exp);
  check('[' + draft + '] format applies to strings only', valid({ format: 'email' }, 5, draft) === true);
}

// ---------- 3. $schema detection and the menu ----------
check('draftOfUri: official forms', ['4', '6', '7', '2019-09', '2020-12'].every((d) => { const r = E.draftOfUri(E.META_URIS[d]); return r && r.draft === d && r.canonical; }));
check('draftOfUri: without "#" is still official', E.draftOfUri('http://json-schema.org/draft-07/schema').canonical === true);
check('draftOfUri: https draft-07 is read but not official', (() => { const r = E.draftOfUri('https://json-schema.org/draft-07/schema'); return r.draft === '7' && !r.canonical; })());
check('draftOfUri: unknown', E.draftOfUri('https://spec.openapis.org/oas/3.1/dialect/base') === null && E.draftOfUri('http://json-schema.org/schema#') === null);
check('no $schema → 2020-12 with a note', (() => { const d = E.detectDraft({ type: 'string' }, 'auto'); return d.draft === '2020-12' && d.notices[0].code === 'noSchema'; })());
check('$schema decides in auto mode', ['4', '6', '7', '2019-09', '2020-12'].every((d) => E.detectDraft({ $schema: E.META_URIS[d] }, 'auto').draft === d));
check('menu overrides $schema with a note, no compile error', (() => { const r = run('{"$schema":"http://json-schema.org/draft-07/schema#","type":"string"}', '"x"', { menu: '2020-12' }); return r.state === 'valid' && r.draft === '2020-12' && codes(r).includes('schemaMismatch'); })());
check('unknown $schema → 2020-12 with a note', (() => { const r = run('{"$schema":"https://spec.openapis.org/oas/3.1/dialect/base","type":"string"}', '1'); return r.state === 'invalid' && r.draft === '2020-12' && codes(r).includes('schemaUnknown'); })());
check('draft-07 array items without $schema: invalid schema with the prefixItems hint and older-syntax note', (() => { const r = run('{"type":"array","items":[{"type":"integer"}]}', '[1]'); return r.state === 'schemaInvalid' && r.schemaErrors[0].itemsArray && codes(r).includes('olderSyntax'); })());
check('a draft-07 schema in Draft 7 mode accepts array items', run('{"type":"array","items":[{"type":"integer"}]}', '[1]', { menu: '7' }).state === 'valid');
check('a 2020-12 schema no longer fails in Draft-07 mode (old: "no schema with key or ref")', run('{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string"}', '"a"', { menu: '7' }).state === 'valid');

// ---------- 4. text parsing ----------
const SYN = [
  ['{\n  "a": 1,\n}', 'trailingComma', 2, 9], ['[1,2,]', 'trailingComma', 1, 5], ['{"a": 1 // c\n}', 'comment', 1, 9], ['# c\n{}', 'comment', 1, 1],
  ["{'a': 1}", 'singleQuote', 1, 2], ['{“a”: 1}', 'smartQuote', 1, 2], ['{"a"：1}', 'fullWidth', 1, 5], ['{"a":\u30001}', 'fullWidth', 1, 6],
  ['{a: 1}', 'unquotedKey', 1, 2], ['{"a": 1 "b": 2}', 'missingComma', 1, 9], ['[1 2]', 'missingComma', 1, 4], ['{"a" 1}', 'missingColon', 1, 6],
  ['"abc', 'unterminatedString', 1, 1], ['"a\nb"', 'controlChar', 1, 3], ['"\\x41"', 'badEscape', 1, 2], ['01', 'badNumber', 1, 2], ['+1', 'badNumber', 1, 1],
  ['.5', 'badNumber', 1, 1], ['1.', 'badNumber', 1, 2], ['NaN', 'badNumber', 1, 1], ['True', 'badLiteral', 1, 1], ['undefined', 'badLiteral', 1, 1],
  ['{"a": [1, 2}', 'unexpectedChar', 1, 12], ['{"a": ', 'unexpectedEnd', 1, 7], ['{} {}', 'extraData', 1, 4], ['', 'empty', 1, 1],
];
for (const [text, code, line, col] of SYN) {
  const r = E.jsonSyntaxError(text);
  const lc = r ? E.lineCol(text, r.offset) : null;
  check('jsonSyntaxError ' + JSON.stringify(text) + ' → ' + code + ' at ' + line + ':' + col, r && r.code === code && lc.line === line && lc.col === col, r && [r.code, lc.line, lc.col]);
}
{
  // agreement with JSON.parse on mutated documents
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const base = ['{"a":[1,2.5,-3e2,{"b":null}],"c":"x\\n\\u00e9","d":true}', '[{"k":"v"},[],{}]', '"str"', '0', '{"nested":{"deep":[[[1]]]}}', '[1e5, -0.5, 0, 10]'];
  const pieces = [',', '}', ']', '{', '[', '"', ':', ' ', '\\', 'a', '1', '0', '-', '.', 'e', 'n', 't', '\n', '\u3000', '“', "'"];
  let agree = 0, total = 0, bad = null;
  for (let k = 0; k < 3000; k++) {
    let s = base[k % base.length];
    const ops = 1 + Math.floor(rnd() * 3);
    for (let o = 0; o < ops; o++) {
      const at = Math.floor(rnd() * (s.length + 1)), op = rnd();
      if (op < 0.4) s = s.slice(0, at) + s.slice(at + 1);
      else s = s.slice(0, at) + pieces[Math.floor(rnd() * pieces.length)] + s.slice(at);
    }
    let parsed = true; try { JSON.parse(s); } catch { parsed = false; }
    const syn = E.jsonSyntaxError(s);
    total++;
    if (parsed === (syn === null)) agree++; else if (!bad) bad = s;
  }
  check('jsonSyntaxError agrees with JSON.parse on 3,000 mutated texts', agree === total, bad);
}
{
  const r = E.parseDocs('\ufeff{"a":1}', 'data', lib);
  check('BOM is removed with a note, offsets keep the BOM', r.format === 'json' && r.notices[0].code === 'bom' && r.docs[0].base === 1);
  const l = E.parseDocs('{"id":1}\n{"id":2}\r\n\n{"id":3}', 'data', lib);
  check('JSON Lines: 3 documents with their lines', l.format === 'jsonl' && l.docs.map((d) => d.line).join() === '1,2,4' && l.docs[2].value.id === 3);
  check('JSON Lines only for data', E.parseDocs('{"id":1}\n{"id":2}', 'schema', lib).format === 'error');
  const y = E.parseDocs('d: 2026-10-02\nok: yes\nn: 0o17\nnull_: ~', 'data', lib);
  check('YAML core schema: dates and yes stay strings, 0o17 is 15', y.format === 'yaml' && y.docs[0].value.d === '2026-10-02' && y.docs[0].value.ok === 'yes' && y.docs[0].value.n === 15 && y.docs[0].value.null_ === null);
  check('YAML multi-document data', E.parseDocs('a: 1\n---\nb: 2\n', 'data', lib).docs.length === 2);
  check('YAML multi-document schema is an error', E.parseDocs('type: object\n---\ntype: string\n', 'schema', lib).error.code === 'multiDocSchema');
  check('plain words are a JSON error, not a YAML string', E.parseDocs('hello world', 'data', lib).error.code === 'badLiteral');
  const ye = E.parseDocs('a: 1\n  b: 2\n', 'data', lib);
  check('YAML errors carry line and column', ye.format === 'error' && ye.error.code === 'yaml' && ye.error.line === 2, ye.error);
  check('duplicate YAML keys are an error', E.parseDocs('a: 1\na: 2\n', 'data', lib).error.code === 'yaml');
  check('{ … } must be JSON (no YAML fallback)', E.parseDocs('{a: 1}', 'data', lib).error.code === 'unquotedKey');
  const ex = E.parseExtras('{"$id":"a.json"}\n---\n$id: b.json\ntype: string\n', lib);
  check('referenced schemas split on ---', ex.docs.length === 2 && ex.docs[1].$id === 'b.json');
  check('referenced schemas: a JSON array of schemas', E.parseExtras('[{"$id":"a"},{"$id":"b"}]', lib).docs.length === 2);
  const exErr = E.parseExtras('{"$id":"a"}\n---\n{"$id": }', lib);
  check('referenced schema error has the line in the whole box', exErr.error && exErr.error.line === 3, exErr.error);
}

// ---------- 5. position scanner ----------
{
  let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const gen = (d) => { const r = rnd(); if (d > 3 || r < 0.3) return [1, -2.5, 'x"/~y', true, null, 'é😀'][Math.floor(rnd() * 6)]; if (r < 0.65) { const a = []; for (let i = Math.floor(rnd() * 4); i > 0; i--) a.push(gen(d + 1)); return a; } const o = {}; for (let i = Math.floor(rnd() * 4); i > 0; i--) o[['a', 'b/c', 'd~e', '', 'ü'][Math.floor(rnd() * 5)] + i] = gen(d + 1); return o; };
  const ptrs = (v, p, out) => { out.push(p); if (v && typeof v === 'object') for (const k of Object.keys(v)) ptrs(v[k], p + '/' + String(k).replace(/~/g, '~0').replace(/\//g, '~1'), out); return out; };
  let ok = 0, total = 0, bad = null;
  for (let k = 0; k < 300; k++) {
    const v = gen(0);
    const text = JSON.stringify(v, null, k % 3);
    const all = ptrs(v, '', []);
    const want = {}; all.forEach((p) => { want[p] = 0; });
    const sc = E.scanJson(text, want, null);
    for (const p of all) {
      total++;
      const sp = sc.spans[p];
      if (sp && JSON.stringify(JSON.parse(text.slice(sp[0], sp[1]))) === JSON.stringify(E.getAt(v, p))) ok++; else if (!bad) bad = [text, p, sp];
    }
  }
  check('scanJson spans re-parse to the value at every pointer (300 documents)', ok === total, bad);
  const d = E.scanJson('{"id": 1, "x": {"id": 2}, "id": 3}', {}, null);
  check('scanJson duplicate keys', d.dups.length === 1 && d.dups[0].key === 'id' && d.dups[0].path === '');
  const u = E.scanJson('{"a": 9007199254740993, "b": 9007199254740991, "c": -9007199254740993, "d": 1e400, "e": 12345678901234567890.5}', {}, null);
  check('scanJson integers beyond 2^53 and overflow', u.unsafe.map((x) => x.raw).join() === '9007199254740993,-9007199254740993,1e400', u.unsafe);
  const keys = E.scanJson('{"a": {"extra": 1}}', { '/a': 0 }, { '/a/extra': 1 });
  check('scanJson key spans', JSON.stringify(keys.keys['/a/extra']) === '[7,14]');
  const r = run('{"type":"object","properties":{"id":{"type":"integer","maximum":9007199254740991}}}', '{"id": 1, "id": 9007199254740993}');
  check('data notes: duplicate key and unsafe integer with lines', codes(r).includes('dupKey') && codes(r).includes('unsafeInt') && r.docs[0].groups[0].items[0].message === 'must be ≤ 9007199254740991, but is 9007199254740992');
}

// ---------- 6. error tree, messages ----------
{
  const r = run(EXAMPLES.oneOf.schema, EXAMPLES.oneOf.data);
  const it = r.docs[0].groups[0].items[0];
  check('oneOf example: one error at /payment with 2 branches', r.errorCount === 1 && it.keyword === 'oneOf' && it.branches.length === 2);
  check('oneOf example: closest branch is the card ($ref branch, const discriminator)', it.closest === 0 && it.branches[0].items.map((x) => x.path).join() === '/payment/last4,/payment/expires');
  check('oneOf example: bank branch errors are attributed through $ref', it.branches[1].items.length === 4 && it.branches[1].items.every((x) => x.schemaPath.startsWith('#/$defs/bank/')));
  const inline = run('{"oneOf":[{"type":"string","minLength":5},{"type":"integer","minimum":10}]}', '"ab"');
  const ii = inline.docs[0].groups[0].items[0];
  check('inline oneOf: branch 1 closest (1 error vs 1 error → first), both kept', ii.branches.length === 2 && ii.closest === 0 && ii.branches[1].items[0].keyword === 'type');
  const many = run('{"oneOf":[{"type":"integer"},{"minimum":0}]}', '5');
  check('oneOf matching two branches', many.docs[0].groups[0].items[0].message === 'matches more than one oneOf branch (0, 1)');
  const any = run('{"anyOf":[{"type":"string"},{"type":"null"}]}', '1');
  check('anyOf folds its branches', any.errorCount === 1 && any.docs[0].groups[0].items[0].branches.length === 2);
  const nested = run('{"properties":{"a":{"oneOf":[{"type":"string"},{"properties":{"b":{"anyOf":[{"type":"string"},{"type":"null"}]}}}]}}}', '{"a":{"b":1}}');
  const n0 = nested.docs[0].groups[0].items[0];
  check('nested anyOf inside a oneOf branch', n0.keyword === 'oneOf' && n0.branches[1].items[0].keyword === 'anyOf' && n0.branches[1].items[0].branches.length === 2);
  const ifr = run('{"if":{"properties":{"country":{"const":"JP"}},"required":["country"]},"then":{"required":["postalCode"]}}', '{"country":"JP"}');
  const ifi = ifr.docs[0].groups[0].items;
  check('if / then: the then error is shown with "via then", the if summary is folded', ifr.errorCount === 1 && ifi[0].keyword === 'required' && ifi[0].via === 'then');
  const sib = run('{"required":["a"],"oneOf":[{"required":["b"]},{"required":["c"]}]}', '{}');
  check('errors from sibling keywords are not pulled into a branch', sib.errorCount === 2 && sib.docs[0].groups[0].items.some((x) => x.keyword === 'required' && !x.branches));
  const ue = run(EXAMPLES.yaml.schema, EXAMPLES.yaml.data);
  check('YAML example: replicas minimum and unevaluated "replica"', ue.state === 'invalid' && ue.errorCount === 2 && ue.docs[0].groups.some((g) => g.items.some((x) => x.keyword === 'unevaluatedProperties' && /replica/.test(x.message))));
  const ex = run(EXAMPLES.userErrors.schema, EXAMPLES.userErrors.data);
  check('user errors: 5 errors sorted by position, key of "extra" located', ex.errorCount === 5 && ex.docs[0].groups[0].path === '' && ex.docs[0].groups[0].items[0].line === 6 && ex.docs[0].groups[1].path === '/name');
  check('user example is valid', run(EXAMPLES.user.schema, EXAMPLES.user.data).state === 'valid');
  // describe(): every keyword in 4 languages, no placeholder left
  const cases = [
    ['{"type":"string"}', '1'], ['{"required":["a"]}', '{}'], ['{"additionalProperties":false}', '{"x":1}'], ['{"unevaluatedProperties":false}', '{"x":1}'],
    ['{"prefixItems":[{}],"unevaluatedItems":false}', '[1,2]'], ['{"prefixItems":[{}],"items":false}', '[1,2]'], ['{"dependentRequired":{"a":["b","c"]}}', '{"a":1}'],
    ['{"minimum":5}', '1'], ['{"exclusiveMaximum":5}', '5'], ['{"multipleOf":3}', '4'], ['{"minLength":3}', '"ab"'], ['{"maxLength":1}', '"ab"'], ['{"pattern":"^a$"}', '"b"'],
    ['{"format":"email"}', '"x"'], ['{"enum":[1,"a"]}', '2'], ['{"const":{"a":1}}', '2'], ['{"minItems":2}', '[]'], ['{"maxItems":0}', '[1]'], ['{"minProperties":1}', '{}'],
    ['{"maxProperties":0}', '{"a":1}'], ['{"uniqueItems":true}', '[1,1]'], ['{"contains":{"type":"string"}}', '[1]'], ['{"contains":{"type":"string"},"maxContains":1}', '["a","b"]'],
    ['{"propertyNames":{"pattern":"^[a-z]+$"}}', '{"A":1}'], ['{"oneOf":[{"type":"string"},{"type":"null"}]}', '1'], ['{"not":{"type":"integer"}}', '1'], ['{"properties":{"a":false}}', '{"a":1}'],
    ['{"$schema":"http://json-schema.org/draft-07/schema#","dependencies":{"a":["b"]}}', '{"a":1}'], ['{"$schema":"http://json-schema.org/draft-07/schema#","items":[{}],"additionalItems":false}', '[1,2]'],
  ];
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    for (const [s, d] of cases) {
      const r = run(s, d, { T: STRINGS[lang] });
      const msgs = [];
      const walk = (it) => { msgs.push(it.message); (it.branches || []).forEach((b) => b.items.forEach(walk)); };
      (r.docs[0] ? r.docs[0].groups : []).forEach((g) => g.items.forEach(walk));
      const raw = r.docs[0] ? r.docs[0].raw : [];
      check('[' + lang + '] ' + s + ' gives a localized message', r.state === 'invalid' && msgs.length && msgs.every((m) => m && !/\{\w+\}/.test(m)) && msgs.every((m, i) => lang === 'en' || i >= raw.length || m !== raw[i].message), msgs);
    }
  }
  check('minLength reports code points', run('{"minLength":3}', '"😀😀"').docs[0].groups[0].items[0].message === 'must have at least 3 character(s); has 2');
}

// ---------- 7. notices and schema errors ----------
{
  const r = run('{"type":"object","requried":["a"],"properties":{"a":{"type":"string","minlength":2,"x-internal":true},"b":{"x-internal":true}}}', '{}');
  const t = r.notices.map((n) => E.noticeText(n, T));
  check('unknown keywords with suggestions and grouping', t.includes('Unknown keyword "requried" at # is ignored. Did you mean "required"?') && t.includes('Unknown keyword "minlength" at #/properties/a is ignored. Did you mean "minLength"?') && t.includes('Unknown keyword "x-internal" is ignored (2 places, first at #/properties/a).'), t);
  check('unknown keywords: Ajv strict mode finds the same names (suite schemas)', (() => {
    let same = 0, total = 0;
    for (const dir of ['draft7', 'draft2020-12']) for (const [, groups] of fixture.tests[dir]) for (const g of groups) {
      if (typeof g.schema !== 'object' || JSON.stringify(g.schema).includes('localhost')) continue;
      const draft = DIRS[dir];
      const logged = new Set();
      const ajv = E.createAjv(draft, lib, false);
      ajv.logger = { log() {}, error() {}, warn(m) { const x = /unknown keyword: "(.+)"/.exec(m); if (x) logged.add(x[1]); } };
      ajv.opts.logger = ajv.logger;
      const prep = E.prepareSchema(g.schema, draft, E.knownKeywords(ajv, draft), {});
      const mine = new Set(prep.notices.filter((n) => /^unknownKeyword|^nullable|^idKeyword|^dependencies|^additionalItems/.test(n.code)).map((n) => n.keyword || { nullable: 'nullable', idKeyword: 'id', dependencies: 'dependencies', additionalItems: 'additionalItems' }[n.code]));
      try { ajv.compile(prep.schema); } catch { continue; }
      total++;
      // Ajv logs $anchor as unknown in strict mode although it resolves it; the tool does not report it
      logged.delete('$anchor');
      if ([...logged].every((k) => mine.has(k)) && [...mine].every((k) => logged.has(k))) same++;
    }
    return total > 500 && same === total;
  })());
  const miss = run('{"properties":{"addr":{"$ref":"https://example.com/address.json"}}}', '{"addr":{}}');
  check('external $ref: error names the URI and the place, nothing is fetched', miss.state === 'schemaFail' && miss.schemaErrors[0].code === 'missingRef' && miss.schemaErrors[0].path === '#/properties/addr/$ref' && miss.schemaErrors[0].id === 'https://example.com/address.json');
  const local = run('{"properties":{"a":{"$ref":"#/$defs/nope"}}}', '{}');
  check('missing local $ref', local.schemaErrors[0].code === 'missingLocal' && local.schemaErrors[0].line === 1);
  const withExtra = run('{"properties":{"addr":{"$ref":"https://example.com/address.json"}}}', '{"addr":{"city":1}}', { extras: '{"$id":"https://example.com/address.json","type":"object","properties":{"city":{"type":"string"}}}' });
  check('referenced schema resolves the $ref', withExtra.state === 'invalid' && withExtra.docs[0].groups[0].path === '/addr/city');
  check('referenced schema without $id', run('{}', '1', { extras: '{"type":"string"}' }).schemaErrors[0].code === 'extraNoId');
  check('referenced schema with another draft', run('{}', '1', { extras: '{"$id":"a","$schema":"http://json-schema.org/draft-07/schema#"}' }).schemaErrors[0].code === 'extraDraft');
  check('referenced schemas with the same $id', run('{}', '1', { extras: '{"$id":"a"}\n---\n{"$id":"a"}' }).schemaErrors[0].code === 'extraDup');
  check('referenced schema parse error', run('{}', '1', { extras: '{"$id":' }).state === 'extrasParse');
  const bp = run('{"type":"string","pattern":"[a-"}', '"x"');
  check('invalid regex: path and pattern', bp.schemaErrors[0].code === 'badPattern' && bp.schemaErrors[0].path === '#/pattern');
  const bpp = run('{"patternProperties":{"(":{}}}', '{}');
  check('invalid patternProperties key', bpp.schemaErrors[0].code === 'badPattern' && bpp.schemaErrors[0].path === '#/patternProperties/(');
  const meta = run('{"type":"strng"}', '1');
  check('meta error: localized, with path and line', meta.state === 'schemaInvalid' && E.schemaErrorText(meta.schemaErrors[0], T) === '#/type: must be one of "array", "boolean", "integer", "null", "number", "object", "string"' && meta.schemaErrors[0].line === 1);
  check('dynamicRef note', codes(run('{"$dynamicAnchor":"n","properties":{"c":{"$dynamicRef":"#n"}}}', '{}')).includes('dynamicRef'));
  check('https draft-07 $schema: note, validated as Draft 7', (() => { const r2 = run('{"$schema":"https://json-schema.org/draft-07/schema","type":"string"}', '1'); return r2.draft === '7' && codes(r2).includes('schemaNonCanonical'); })());
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const L = STRINGS[lang];
    const all = [
      ...run('{"type":"object","requried":["a"],"nullable":true,"dependencies":{},"additionalItems":false,"id":"x","properties":{"a":{"x":1},"b":{"x":1}},"format":"iri"}', '\ufeff{"a":1,"a":9007199254740993}', { T: L }).notices,
      ...run('{"$dynamicAnchor":"n","properties":{"c":{"$dynamicRef":"#n"}}}', '{}', { T: L }).notices,
      ...run('{"$schema":"https://json-schema.org/draft-07/schema","definitions":{"a":{}},"properties":{"b":{"$ref":"#/definitions/a","type":"string"}}}', 'a: 1\n---\nb: 2', { T: L }).notices,
      ...run('{"$schema":"http://json-schema.org/draft-07/schema#"}', '{"a":1}\n{"b":2}', { T: L, menu: '2020-12', formats: false }).notices,
      ...run('{"$schema":"https://example.com/s"}', '1', { T: L }).notices,
    ];
    const got = new Set(all.map((n) => n.code));
    const want = Object.keys(STRINGS.en.notice).filter((k) => !/^side|^suggestion$/.test(k));
    check('[' + lang + '] every notice code is produced and rendered without placeholders', want.every((k) => got.has(k)) && all.every((n) => !/\{\w+\}/.test(E.noticeText(n, L))), want.filter((k) => !got.has(k)));
    const errs = [
      run('{"properties":{"a":{"$ref":"https://x/a.json"}}}', '{}', { T: L }), run('{"$ref":"#/nope"}', '{}', { T: L }), run('{"pattern":"("}', '1', { T: L }),
      run('{}', '1', { T: L, extras: '{}' }), run('{}', '1', { T: L, extras: '{"$id":"a","$schema":"http://json-schema.org/draft-07/schema#"}' }), run('{}', '1', { T: L, extras: '{"$id":"a"}\n---\n{"$id":"a"}' }),
      run('{"items":[{}]}', '1', { T: L, menu: '2020-12' }),
    ];
    const ecodes = new Set(errs.flatMap((r) => (r.schemaErrors || []).map((e) => e.code)));
    check('[' + lang + '] schema error texts', ['missingRef', 'missingLocal', 'badPattern', 'extraNoId', 'extraDraft', 'extraDup', 'meta'].every((c) => ecodes.has(c)) && errs.every((r) => (r.schemaErrors || []).every((e) => !/\{\w+\}/.test(E.schemaErrorText(e, L)))), [...ecodes]);
    for (const [text] of SYN) {
      const r = E.parseDocs(text, 'data', lib);
      if (r.format !== 'error') continue;
      const s = E.parseErrorText(r.error, L);
      check('[' + lang + '] parse error text ' + JSON.stringify(text), s && !/\{\w+\}/.test(s) && !s.includes('undefined'), s);
    }
  }
}

// ---------- 8. strings ----------
{
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => typeof v === 'object' ? flat(v, p + k + '.') : [[p + k, v]]);
  const en = new Map(flat(STRINGS.en));
  for (const lang of ['zh', 'ja', 'ko']) {
    const m = new Map(flat(STRINGS[lang]));
    check('[' + lang + '] STRINGS has the same keys as en', [...en.keys()].every((k) => m.has(k)) && m.size === en.size, [...en.keys()].filter((k) => !m.has(k)));
    for (const [k, v] of en) {
      const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
      if (m.has(k)) check('[' + lang + '] ' + k + ' placeholders', ph(v) === ph(m.get(k)), [v, m.get(k)]);
    }
  }
  const used = [...source.slice(source.indexOf('<script>')).matchAll(/\bT\.(\w+)/g)].map((x) => x[1]);
  check('every T.key used in the script exists', used.every((k) => k in STRINGS.en), used.filter((k) => !(k in STRINGS.en)));
}

// ---------- 9. static rules ----------
{
  const script = source.slice(source.indexOf('<script>'), source.indexOf('</script>', source.indexOf('<script>')));
  check('script does not touch storage directly (ztPersist only)', !/localStorage|sessionStorage|document\.cookie|indexedDB/.test(script));
  check('script does not use the network', !/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/.test(script));
  check('script does not write HTML', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(script));
  check('persistence policy is preference', /'json-schema-validator': 'preference'/.test(readFileSync(join(root, 'src/data/persistence.ts'), 'utf8')));
  check('only the draft menu and the format switch are saved', /ztPersist\?\.save\(SLUG, \{ draft: draftSel\.value, formats: formatsEl\.checked \}\)/.test(script) && (script.match(/ztPersist\?\.save/g) || []).length === 1);
}

// ---------- 10. Python jsonschema ----------
{
  const py = process.env.JSV_PYTHON || 'python3';
  let ver = null;
  try { ver = execFileSync(py, ['-c', 'import importlib.metadata as m;print(m.version("jsonschema"))'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { ver = null; }
  // [draft, schema, data]; formats off on both sides (Python's default)
  const CORPUS = [
    ['7', { definitions: { s: { type: 'string' } }, properties: { a: { $ref: '#/definitions/s', maxLength: 3 } } }, { a: 'abcdef' }],
    ['2020-12', { $defs: { s: { type: 'string' } }, properties: { a: { $ref: '#/$defs/s', maxLength: 3 } } }, { a: 'abcdef' }],
    ['2020-12', { type: 'string', nullable: true }, null], ['7', { required: ['constructor'] }, {}], ['2020-12', { dependencies: { a: ['b'] } }, { a: 1 }],
    ['7', { dependencies: { a: ['b'] } }, { a: 1 }], ['4', { const: 3 }, 5], ['6', { if: { const: 1 }, then: { const: 2 } }, 1], ['7', { if: { const: 1 }, then: { const: 2 } }, 1],
    ['2020-12', { enum: [] }, 1], ['2020-12', { type: 'integer' }, 1.0], ['2020-12', { uniqueItems: true }, [1, 1.0]], ['2020-12', { maxLength: 4 }, '東京都港区'],
    ['2020-12', { maxLength: 5 }, '👨‍👩‍👧'], ['2020-12', { maxLength: 4 }, '👨‍👩‍👧'], ['2019-09', { allOf: [{ properties: { a: {} } }], unevaluatedProperties: false }, { a: 1, b: 2 }],
    ['2019-09', { allOf: [{ properties: { a: {} } }], unevaluatedProperties: false }, { a: 1 }], ['2020-12', { prefixItems: [{ type: 'integer' }], items: false }, [1, 2]],
    ['2020-12', { dependentSchemas: { card: { required: ['cvv'] } } }, { card: 1 }], ['2020-12', { $defs: { a: { $anchor: 'x', type: 'string' } }, $ref: '#x' }, 1],
    ['7', { id: 'x', type: 'string' }, 'a'], ['2020-12', { format: 'email' }, 'x'], ['4', { minimum: 5, exclusiveMinimum: true }, 5], ['2020-12', { contains: { type: 'integer' }, minContains: 2 }, [1, 'a']],
    ['2020-12', { additionalItems: false, prefixItems: [{}] }, [1, 2]], ['6', { $comment: 'x', propertyNames: { maxLength: 2 } }, { abc: 1 }], ['4', { propertyNames: { maxLength: 2 } }, { abc: 1 }],
    ['2020-12', { allOf: [{ properties: { a: { type: 'string' } } }], additionalProperties: false }, { a: 'x' }], ['2020-12', { allOf: [{ properties: { a: { type: 'string' } } }], unevaluatedProperties: false }, { a: 'x' }],
    ['2019-09', { $recursiveAnchor: true, properties: { c: { $recursiveRef: '#' } }, type: 'object' }, { c: 1 }], ['2020-12', { required: ['__proto__'] }, {}],
    ['7', { items: [{ type: 'integer' }], additionalItems: false }, [1, 2]], ['2019-09', { items: [{ type: 'integer' }], additionalItems: false }, [1, 2]],
    ['2020-12', { multipleOf: 0.01 }, 0.075], ['2020-12', { multipleOf: 0.01 }, 19.99], ['2020-12', { type: 'number', maximum: 1e308 }, 1e308],
  ];
  // documented differences: Ajv skips "__proto__" in properties (Python applies it); \d is ASCII
  // in ECMA-262 but matches full-width digits in Python re (ja tool page)
  const KNOWN_DIFF = [['2020-12', { properties: { ['__proto__']: { type: 'number' } } }, JSON.parse('{"__proto__":"foo"}')]];
  const DIGIT = ['2020-12', { type: 'string', pattern: '^\\d{3}-\\d{4}$' }, '１０５-００１１'];
  CORPUS.push(['4', { type: 'object', required: ['score'], properties: { score: { type: 'number', minimum: 0, maximum: 100, exclusiveMaximum: true }, rank: { const: 'A' } } }, { score: 99, rank: 'B' }]);
  // The corpus was checked against 4.26.0; other 4.x releases differ (4.10.3 on Ubuntu runners gets
  // $recursiveRef wrong), so only that version is compared.
  if (ver !== '4.26.0') skip('Python jsonschema comparison (' + py + ': ' + (ver || 'not installed') + ', corpus checked against 4.26.0)');
  else {
    const script = 'import json,sys\nfrom jsonschema import Draft4Validator as V4, Draft6Validator as V6, Draft7Validator as V7, Draft201909Validator as V19, Draft202012Validator as V20\nM={"4":V4,"6":V6,"7":V7,"2019-09":V19,"2020-12":V20}\nprint(json.dumps([M[d](s).is_valid(x) for d,s,x in json.load(sys.stdin)]))';
    const enc = (list) => JSON.stringify(list.map(([d, s, x]) => [d, s, x]));
    const pyRes = JSON.parse(execFileSync(py, ['-c', script], { input: enc(CORPUS) }).toString());
    CORPUS.forEach(([d, s, x], i) => check('Python jsonschema ' + ver + ' agrees: [' + d + '] ' + JSON.stringify(s) + ' ' + JSON.stringify(x), valid(s, x, d, false) === pyRes[i], [valid(s, x, d, false), pyRes[i]]));
    const diffPy = JSON.parse(execFileSync(py, ['-c', script], { input: JSON.stringify(KNOWN_DIFF.map(([d, s, x]) => [d, s, x])).replace('{}', '{"__proto__":{"type":"number"}}') }).toString());
    check('known difference: Ajv skips properties named __proto__, Python does not', diffPy[0] === false && valid(KNOWN_DIFF[0][1], KNOWN_DIFF[0][2]) === true);
    const dPy = JSON.parse(execFileSync(py, ['-c', script], { input: JSON.stringify([DIGIT]) }).toString());
    check('known difference (ja page): \\d matches full-width digits in Python, not in ECMA-262', dPy[0] === true && valid(DIGIT[1], DIGIT[2]) === false);
    // tool-page examples: the errors Python reports (paths and keywords) are the tool's, except the documented \d case
    const pagePy = 'import json,sys\nfrom jsonschema import validators\nout=[]\nfor s,d in json.load(sys.stdin):\n    V=validators.validator_for(s)\n    out.append(sorted("/"+"/".join(str(x) for x in e.absolute_path)+" "+e.validator for e in V(s).iter_errors(d)))\nprint(json.dumps(out))';
    const pageCases = [];
    for (const lang of ['en', 'ja', 'ko']) {
      for (const ex of examplesOf(readFileSync(join(root, 'src/content/tools/json-schema-validator/' + lang + '.mdx'), 'utf8'))) {
        if (ex.broken || ex.extras || ex.opts.menu) continue;
        let sc, da; try { sc = JSON.parse(ex.schema); da = JSON.parse(ex.data); } catch { continue; }
        if (sc.$schema === undefined || /"\$ref":\s*"(?!#)/.test(JSON.stringify(sc))) continue; // no external $ref: Python would fetch it
        pageCases.push([lang, sc, da]);
      }
    }
    check('page examples compared with Python: at least 4', pageCases.length >= 4, pageCases.length);
    const pyErr = JSON.parse(execFileSync(py, ['-c', pagePy], { input: JSON.stringify(pageCases.map((c) => [c[1], c[2]])) }).toString());
    pageCases.forEach(([lang, sc, da], i) => {
      const r = run(JSON.stringify(sc), JSON.stringify(da), { formats: false });
      const mine = [];
      const walk = (it) => { if (!it.branches) mine.push((it.keyPath && it.keyword !== 'additionalProperties' && it.keyword !== 'unevaluatedProperties' ? it.path : it.path || '/') .replace(/^$/, '/') + ' ' + it.keyword); };
      (r.docs[0] ? r.docs[0].groups : []).forEach((g) => g.items.forEach(walk));
      const want = pyErr[i].filter((x) => x !== '/postalCode pattern');
      const got = mine.map((x) => x.replace(/^\/ /, '/ ')).filter((x) => x !== '/postalCode pattern').sort();
      check('[' + lang + '] page example ' + (sc.title || Object.keys(sc.properties || {}).join(',')) + ': Python jsonschema reports the same errors', JSON.stringify(got) === JSON.stringify(want.sort()), [got, want]);
    });
  }
}

// ---------- 11. performance ----------
{
  const items = []; for (let i = 0; i < 40000; i++) items.push({ id: i, name: 'user' + i, email: i % 997 === 0 ? 'bad' : 'u' + i + '@example.com', tags: ['a', 'b'], score: i / 3 });
  const dataText = JSON.stringify(items, null, 2);
  const schemaText = JSON.stringify({ type: 'array', items: { type: 'object', required: ['id', 'name', 'email'], properties: { id: { type: 'integer' }, name: { type: 'string' }, email: { type: 'string', format: 'email' }, tags: { type: 'array', items: { type: 'string' } }, score: { type: 'number' } }, additionalProperties: false } });
  const t0 = performance.now();
  const r = run(schemaText, dataText);
  const ms = performance.now() - t0;
  check('perf: ' + (dataText.length / 1e6).toFixed(1) + ' MB, 40,000 items with 41 errors in under 3 s', r.state === 'invalid' && r.errorCount === 41 && ms < 3000 * PERF_SLACK, Math.round(ms) + ' ms');
  console.log('  perf: ' + (dataText.length / 1e6).toFixed(1) + ' MB validated in ' + Math.round(ms) + ' ms');
}

// ---------- 12. tool pages: {/* jsv-ex: {...} */} + schema, data and output blocks ----------
// {"same": true} reuses the previous example's schema and data (only the output block follows);
// {"extras": true} uses the nearest {/* jsv-extra */} block above as a referenced schema.
// `node scripts/test-json-schema-validator.mjs --fill` rewrites the output blocks from the engine.
function examplesOf(text) {
  const fence = /```[a-z]*\n([\s\S]*?)```/y;
  const blocks = (from, n) => {
    const out = []; let i = from;
    while (out.length < n) {
      const ws = /\s*/y; ws.lastIndex = i; ws.exec(text); i = ws.lastIndex;
      fence.lastIndex = i; const m = fence.exec(text);
      if (!m) return null;
      out.push({ body: m[1], start: i, end: fence.lastIndex }); i = fence.lastIndex;
    }
    return out;
  };
  const list = []; let prev = null;
  for (const m of text.matchAll(/\{\/\* jsv-ex: (\{.*?\}) \*\/\}/g)) {
    const opts = JSON.parse(m[1]);
    const b = blocks(m.index + m[0].length, opts.same ? 1 : 3);
    if (!b) { list.push({ opts, broken: true }); continue; }
    const ex = { opts, schema: opts.same && prev ? prev.schema : b[0].body, data: opts.same && prev ? prev.data : b[1].body, outBlock: b[b.length - 1] };
    if (opts.extras) {
      const k = text.lastIndexOf('{/* jsv-extra */}', m.index);
      const eb = k >= 0 ? blocks(k + '{/* jsv-extra */}'.length, 1) : null;
      ex.extras = eb ? eb[0].body : '';
    }
    list.push(ex); prev = ex;
  }
  return list;
}
function exampleOutput(ex, L) {
  const res = E.runValidation(lib, { schemaText: ex.schema, dataText: ex.data, extrasText: ex.extras || '', menu: ex.opts.menu || 'auto', formats: ex.opts.formats !== false }, L, null);
  const lines = [E.statusText(res, L)];
  const rep = E.reportText(res, L);
  if (rep) lines.push(rep);
  res.notices.forEach((x) => lines.push('* ' + E.noticeText(x, L)));
  return lines.join('\n');
}
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const rel = 'src/content/tools/json-schema-validator/' + lang + '.mdx';
  const text = readFileSync(join(root, rel), 'utf8');
  const list = examplesOf(text);
  list.forEach((ex, i) => {
    if (ex.broken) { check(rel + ' example ' + (i + 1) + ' has its blocks', false); return; }
    const got = exampleOutput(ex, STRINGS[lang]);
    check(rel + ' example ' + (i + 1) + ' output matches the engine', ex.outBlock.body.trim() === got, got);
  });
  check(rel + ' has at least 3 jsv-ex examples', list.length >= 3, list.length);
  for (const m of text.matchAll(/\{\/\* jsv-check: (\{.*?\}) \*\/\}/g)) {
    const c = JSON.parse(m[1]);
    const got = valid(c.schema, c.data, c.draft || '2020-12', c.formats !== false);
    check(rel + ' jsv-check ' + m[1], got === c.valid, got);
  }
}

// ---------- 13. guide (src/content/blog/json-schema-validator-guide/en.mdx) ----------
// js-run blocks are executed (Node always, from .generated/ so ajv resolves; Python when
// jsonschema 4.26.0 is installed, SKIP otherwise) and must print their "# …" / "// …" comments.
// The js-formats table: the Ajv column is recomputed with the tool's engine (2020 mode, formats
// on), the jsonschema column with Draft202012Validator.FORMAT_CHECKER when jsonschema 4.26.0 is
// installed. The js-tool block is the tool's copy-errors output for its invalid example.
{
  const { mkdtempSync, rmSync, mkdirSync } = await import('node:fs');
  const rel = 'src/content/blog/json-schema-validator-guide/en.mdx';
  const text = readFileSync(join(root, rel), 'utf8');
  const py = process.env.JSV_PYTHON || 'python3';
  let pyVersion = null;
  try { pyVersion = execFileSync(py, ['-c', 'import importlib.metadata as m;print(m.version("jsonschema"))'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { pyVersion = null; }
  const pyOk = pyVersion === '4.26.0';
  if (!pyOk) skip('guide python jsonschema checks (installed: ' + (pyVersion || 'none') + ', guide measured 4.26.0)');
  mkdirSync(join(root, '.generated'), { recursive: true });
  const dir = mkdtempSync(join(root, '.generated', 'jsv-run-'));
  try {
    let runs = 0;
    for (const m of text.matchAll(/\{\/\* js-run: (\{.*?\}) \*\/\}\s*```(?:js|python)\n([\s\S]*?)```/g)) {
      const spec = JSON.parse(m[1]);
      const comment = spec.lang === 'python' ? /^# (?!check_user)(.+)$/gm : /^\/\/ (?!check-user)(.+)$/gm;
      const shown = [...m[2].matchAll(comment)].map((x) => x[1]).join('\n');
      runs++;
      if (spec.lang === 'python' && !pyOk) continue;
      const file = join(dir, spec.lang === 'python' ? 'check_user.py' : 'check-user.mjs');
      writeFileSync(file, m[2]);
      const out = execFileSync(spec.lang === 'python' ? py : process.execPath, [file]).toString().trim();
      check('guide ' + spec.lang + ' block output matches its comments', out === shown, out + ' ≠ ' + shown);
    }
    check('guide has a Node and a Python block', runs === 2, runs);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const lines = text.slice(text.indexOf('{/* js-formats */}')).split('\n').filter((l) => /^\| `/.test(l));
  check('guide format table has 7 rows', lines.length === 7, lines.length);
  const pyRows = [];
  for (const line of lines) {
    const c = line.slice(2, -2).split(' | ').map((s) => s.trim());
    const value = c[0].replace(/`/g, ''), format = c[1].replace(/`/g, '');
    const ajvOk = valid({ type: 'string', format }, value, '2020-12', true);
    check('guide format table Ajv ' + format + ' ' + value, (ajvOk ? 'valid' : 'invalid') === c[2], c[2]);
    pyRows.push([format, value, c[3].startsWith('valid')]);
  }
  if (pyOk) {
    const out = execFileSync(py, ['-c', 'import json,sys\nfrom jsonschema import Draft202012Validator as V\nrows=json.load(sys.stdin)\nprint(json.dumps([V({"type":"string","format":f},format_checker=V.FORMAT_CHECKER).is_valid(v) for f,v,_ in rows]))'], { input: JSON.stringify(pyRows) }).toString();
    const got = JSON.parse(out);
    pyRows.forEach((r, i) => check('guide format table jsonschema ' + r[0] + ' ' + r[1], got[i] === r[2], got[i]));
  }
  const toolBlock = text.match(/\{\/\* js-tool \*\/\}\s*```text\n([\s\S]*?)```/);
  const r = run(EXAMPLES.userErrors.schema, EXAMPLES.userErrors.data);
  check('guide js-tool block equals the tool\'s copied errors', !!toolBlock && toolBlock[1].trim() === E.reportText(r, T), E.reportText(r, T));
  check('guide: 1.0 is an integer', valid({ type: 'integer' }, JSON.parse('1.0')) === true);
  check('guide: 9007199254740993 fails maximum 9007199254740991 in Ajv', valid({ type: 'integer', maximum: 9007199254740991 }, JSON.parse('9007199254740993')) === false);
  check('guide: additionalProperties next to allOf rejects allOf properties', valid({ allOf: [{ properties: { a: { type: 'string' } } }], additionalProperties: false }, { a: 'x' }) === false);
  check('guide: unevaluatedProperties accepts them', valid({ allOf: [{ properties: { a: { type: 'string' } } }], unevaluatedProperties: false }, { a: 'x' }) === true);
  let strictErr = '';
  try { new lib.Ajv().compile({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'array', prefixItems: [{ type: 'integer' }] }); } catch (e) { strictErr = e.message; }
  check('guide quotes Ajv strict prefixItems error', text.includes(strictErr) && strictErr !== '', strictErr);
  const pf = run('{"$schema":"http://json-schema.org/draft-07/schema#","type":"array","prefixItems":[{"type":"integer"}]}', '["x"]');
  check('guide: the tool ignores prefixItems in Draft 7 and says so', pf.state === 'valid' && codes(pf).includes('unknownKeyword'));
  check('guide quotes the tool\'s unknown-keyword note', text.includes(E.noticeText(pf.notices.find((n) => n.code === 'unknownKeyword'), T)));
  const tpl = [/^## What (is|are) /mi, /^## .*Online/mi, /^## .* in Code$/mi, /^## (Summary|Conclusion)/mi].filter((re) => re.test(text));
  check(rel + ' has no template headings', tpl.length === 0, tpl.map(String));
}

console.log(passes + ' passed, ' + failures + ' failed' + (skips ? ', ' + skips + ' skipped' : ''));
process.exit(failures ? 1 : 0);
