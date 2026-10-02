// Generate scripts/test-json-formatter.fixtures.json for test-json-formatter.mjs.
//
// Read:  <JSONTestSuite checkout>/test_parsing/*.json (github.com/nst/JSONTestSuite, MIT);
//        the json5 package (2.2.3) from <json5 dir>/node_modules/json5.
// Write: scripts/test-json-formatter.fixtures.json
// Exit:  0 on success, 1 on bad arguments or an unexpected json5 version.
//
// Not part of the build and not run by CI (the name does not start with test-). Run it by hand
// when the corpus changes:
//   git clone --depth 1 https://github.com/nst/JSONTestSuite /tmp/JSONTestSuite
//   mkdir /tmp/j5 && cd /tmp/j5 && npm i json5@2.2.3
//   node scripts/gen-json-formatter-fixtures.mjs /tmp/JSONTestSuite /tmp/j5

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const [suiteDir, json5Dir] = process.argv.slice(2);
if (!suiteDir || !json5Dir) { console.error('usage: node scripts/gen-json-formatter-fixtures.mjs <JSONTestSuite dir> <dir with node_modules/json5>'); process.exit(1); }
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(json5Dir, 'package.json'));
const JSON5 = require('json5');
const version = require('json5/package.json').version;
if (version !== '2.2.3') { console.error('json5 ' + version + ' found; the fixture records 2.2.3'); process.exit(1); }

// Two n_ files are large and regular; the test rebuilds them from these descriptions.
const GENERATED = {
  'n_structure_100000_opening_arrays.json': { repeat: '[', times: 100000, tail: '' },
  'n_structure_open_array_object.json': { repeat: '[{"":', times: 50000, tail: '\n' },
};
const dir = join(suiteDir, 'test_parsing');
const files = {};
for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const bytes = readFileSync(join(dir, name));
  const g = GENERATED[name];
  if (g) {
    if (!bytes.equals(Buffer.from(g.repeat.repeat(g.times) + g.tail))) { console.error(name + ' does not match its description'); process.exit(1); }
    files[name] = { generated: g };
  } else files[name] = { base64: bytes.toString('base64') };
}
let commit = 'unknown';
try { commit = execFileSync('git', ['-C', suiteDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch (e) { /* not a git checkout */ }

// JSON5 corpus: spec.json5.org examples and edge cases of each grammar rule.
const corpus = [
  '{a:1}', "{'a':'b'}", '{a:1,}', '[1,2,]', '[1,,]', '{,}', '[,]', '// c\n{"a":1}', '/* c */ [1]', '/* open', '{"a":1 // trailing\n}',
  '{"a":1 /* x */ , /* y */ "b":2}', '[1, // one\n2]',
  '0x1F', '-0xff', '+1', '.5', '5.', '-.5e3', '+Infinity', 'NaN', '-Infinity', 'Infinity', '1e', '0x', '00', '01', '0.e1', '5.e-2', '0X1f', '+0x10', '-0', '+.5', '0x0', '-0x0',
  '0xFFFFFFFFFFFFFFFFF', '12345678901234567890', '1e400',
  "'it\\'s'", '"\\x41"', '"\\v\\0"', "'a\\\nb'", "'a\\\r\nb'", "'a\\\rb'", '"\\u2028"', "'\u2028\u2029'", '"line\nbreak"', '"tab\there"',
  '"\\1"', '"\\0"', '"\\01"', '"\\a"', '"\\😀"', '"\\x4"', '"\\xZZ"', '"\\u12"', "'\"'", '"\'"', '"\\/"', "'\\\u2028x'",
  '{$a:1}', '{_b:1}', '{ünïcödé:1}', '{名前:1}', '{a1:1}', '{1a:1}', '{\\u0061b:1}', '{a\\u0062:1}', '{"a b":1}', '{true:1}', '{null:1}', '{a-b:1}',
  '{\u200cx:1}', '{x\u200cy:1}', '{ℵ:1}', '{Ⅻ:1}', '{a\u0301:1}', '{\u0301a:1}', '{\\u0031:1}',
  '\u00a0[1]', '[\u3000 1]', '\ufeff{}', '[1\u2028]', '\u000b[1]', '\u000c[1]', '[1\u2029,2]',
  '{a:1,a:2}', '{a:1 b:2}', '[1 2]', '', '   ', '{}', '[]', 'null', 'true', '"x"', "{'a': True}", '{a: undefined}',
  '{a:[1,2,{b:"c",},],}', "{\n  // config\n  name: 'api',\n  port: 0x1F90,\n  ratio: .75,\n  tags: ['a', 'b',],\n  nested: { deep: [+1, -2,], },\n}",
  '{"a":1}', '[1e2, 1.0, -0.0]', '{"a":"\\ud800"}',
];
const json5 = corpus.map((text) => {
  try {
    const v = JSON5.parse(text);
    const nonFinite = JSON.stringify(v, (k, x) => (typeof x === 'number' && !isFinite(x) ? '__NF__' : x)).includes('__NF__');
    return { text, ok: true, json: JSON.stringify(v), nonFinite };
  } catch (e) {
    return { text, ok: false, message: e.message };
  }
});

const out = {
  jsonTestSuite: { source: 'https://github.com/nst/JSONTestSuite', license: 'MIT', commit, files },
  json5: { package: 'json5@' + version, cases: json5 },
};
writeFileSync(join(root, 'scripts/test-json-formatter.fixtures.json'), JSON.stringify(out) + '\n');
console.log('wrote ' + Object.keys(files).length + ' JSONTestSuite files and ' + json5.length + ' JSON5 cases');
