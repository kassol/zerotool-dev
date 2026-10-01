// JSON to Go Struct — the structs compile, pass go vet, and decode the sample without losing fields
//
// Read:  src/components/tools/JsonToGoStructTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); src/content/tools/json-to-go-struct/{en,zh,ja,ko}.mdx
// Write: stdout; one Go program per case under os.tmpdir() (removed at the end)
// Exit:  0 if all PASS, 1 if any FAIL
//
// When `go` is installed (local, GitHub ubuntu runners), each generated set of structs is put
// in a program that decodes the sample with encoding/json and DisallowUnknownFields, so a JSON
// key without a field (a field lost from a shared struct) is an error, and so is a decimal
// number such as 19.0 in an int field. The program is checked with `go vet` and run. Without
// Go those checks are SKIP and only the text of the output is checked. Cases: two nested
// objects with the same key and different fields, the same shape twice, 19.0 and 1e3 as
// float64, int and float mixed in one array or key, field names that cannot start an exported
// Go identifier (2fa, non-ASCII), two keys that give the same field name (user_id, userId),
// keys that a struct tag cannot name ("" and keys with a double quote), keys named
// constructor, top-level arrays, and the examples on the tool pages.
//
// Run: node scripts/test-json-to-go-struct.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToGoStructTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JsonToGoStructTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { parseJson, generateGo };')();

let failures = 0;
let passes = 0;
let skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}

const haveGo = spawnSync('go', ['version']).status === 0;
if (!haveGo) console.log('SKIP: go not installed; generated code is not compiled');
const tmp = mkdtempSync(join(tmpdir(), 'jgs-test-'));
let n = 0;
function gen(json, rootName = 'RootObject') {
  return E.generateGo(E.parseJson(json), rootName).code;
}
function decodes(name, json, opts = {}) {
  const code = gen(json);
  if (!haveGo) { skips++; return code; }
  const isArray = Array.isArray(JSON.parse(json));
  const program = [
    'package main',
    '',
    'import (',
    '\t"bytes"',
    '\t"encoding/json"',
    '\t"fmt"',
    '\t"os"',
    ')',
    '',
    code,
    '',
    'const sample = ' + JSON.stringify(json),
    '',
    'func main() {',
    '\tdec := json.NewDecoder(bytes.NewReader([]byte(sample)))',
    opts.allowUnknown ? '' : '\tdec.DisallowUnknownFields()',
    '\tvar v ' + (isArray ? '[]RootObject' : 'RootObject'),
    '\tif err := dec.Decode(&v); err != nil {',
    '\t\tfmt.Fprintln(os.Stderr, err)',
    '\t\tos.Exit(1)',
    '\t}',
    '}',
  ].join('\n');
  const dir = join(tmp, 'c' + (++n));
  spawnSync('mkdir', ['-p', dir]);
  writeFileSync(join(dir, 'main.go'), program);
  const env = { ...process.env, GO111MODULE: 'off', GOFLAGS: '' };
  const vet = spawnSync('go', ['vet', 'main.go'], { cwd: dir, encoding: 'utf8', env });
  check(name + ': go vet passes', vet.status === 0, vet.stderr + '\n' + code);
  const run = spawnSync('go', ['run', 'main.go'], { cwd: dir, encoding: 'utf8', env });
  check(name + ': decodes the sample' + (opts.allowUnknown ? '' : ' with DisallowUnknownFields'), run.status === 0, run.stderr + '\n' + code);
  return code;
}

// ---------- the reported defect: two nested objects with the same key ----------
{
  const code = decodes('a.meta and b.meta differ', '{"a":{"meta":{"x":1}},"b":{"meta":{"y":"s"}}}');
  check('a.meta keeps X', /type Meta struct \{\n\tX int `json:"x"`\n\}/.test(code), code);
  check('b.meta gets its own struct', /type BMeta struct \{\n\tY string `json:"y"`\n\}/.test(code), code);
}
{
  const code = decodes('same shape twice', '{"a":{"meta":{"x":1}},"b":{"meta":{"x":2}}}');
  eq('identical shapes share one struct', (code.match(/type \w*Meta struct/g) || []).length, 1);
}
decodes('array items with the same name', '{"a":{"items":[{"p":1}]},"b":{"items":[{"q":"x"}]}}');
{
  const code = decodes('nested key equal to the root name', '{"rootObject":{"z":1},"k":2}');
  check('the root keeps its name', /^type RootObject struct \{/.test(code), code);
}

// ---------- numbers: the reported 19.0 → int ----------
{
  const code = decodes('19.0 is float64', '{"price":19.0,"qty":3,"big":1e3,"neg":-0.0}');
  check('price float64', /Price float64 `json:"price"`/.test(code), code);
  check('qty int', /Qty int `json:"qty"`/.test(code), code);
  check('1e3 float64', /Big float64 `json:"big"`/.test(code), code);
}
{
  const code = decodes('int and float in one array', '{"values":[1,2.5,3]}');
  check('mixed numbers become []float64', /Values \[\]float64/.test(code), code);
}
{
  const code = decodes('int and float under one key in array items', '[{"v":1},{"v":2.5}]');
  check('merged key becomes float64', /V float64/.test(code), code);
}
eq('float root', gen('2.0'), 'type RootObject = float64');

// ---------- field names ----------
{
  const code = decodes('keys that cannot start an exported identifier', '{"2fa":true,"名前":"x","_id":1,"a-b":2,"type":"t"}');
  check('2fa field is exported', /\tX2fa bool `json:"2fa"`/.test(code), code);
  check('non-ASCII key gets an exported name', /\tX名前 string `json:"名前"`/.test(code), code);
}
{
  const code = decodes('two keys give the same field name', '{"user_id":1,"userId":2,"UserID":3}');
  check('field names are unique', new Set(code.match(/^\t\w+/gm)).size === 3, code);
}
{
  const code = decodes('keys a struct tag cannot name', '{"":1,"a\\"b":2,"ok":3}', { allowUnknown: true });
  check('empty key is listed in a comment', code.includes('// JSON key "" cannot be named in a struct tag'), code);
  check('key with a double quote is listed in a comment', code.includes('// JSON key "a\\"b" cannot be named in a struct tag'), code);
}
decodes('prototype key names', '{"constructor":{"a":1},"toString":"x","items":[{"constructor":1,"hasOwnProperty":2},{"constructor":3,"hasOwnProperty":4}]}');
decodes('top-level array', '[{"sku":"A1","qty":2},{"sku":"B2","note":"gift"}]');
decodes('nulls and nested arrays', '{"a":null,"b":[[1,2],[3]],"c":[{"d":null},{"d":{"e":1}}]}');

// ---------- tool page examples ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/json-to-go-struct/' + lang + '.mdx'), 'utf8');
  const re = /```json\n([\s\S]*?)\n```\s*\n[^`]*```go\n(type [\s\S]*?)\n```/g;
  let m;
  let count = 0;
  while ((m = re.exec(mdx))) {
    count++;
    eq(lang + ': example ' + count + ' output', gen(m[1]), m[2]);
  }
  check(lang + ': page has at least three examples', count >= 3, String(count));
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passes} passed, ${failures} failed` + (skips ? `, ${skips} skipped` : ''));
process.exit(failures ? 1 : 0);
