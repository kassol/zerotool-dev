// Protobuf to JSON — wire decoder, ProtoJSON printer and parser, encoder, raw decoder
//
// Read:  src/components/tools/ProtobufToJsonTool.astro (extracts the engine block between the
//        `engine:start` / `engine:end` markers, the order of its vendor <script> tags and the
//        STRINGS table), public/vendor/protobuf.min.js, public/vendor/long.min.js,
//        node_modules/long/package.json, scripts/test-protobuf-to-json.fixtures.json,
//        src/content/tools/protobuf-to-json/{en,zh,ja,ko}.mdx
// Write: stdout only. With --regenerate: scripts/test-protobuf-to-json.fixtures.json and a
//        temporary directory under os.tmpdir() (removed at the end).
// Exit:  0 if all PASS, 1 if any FAIL
//
// The vendor scripts and the engine run in one vm context that looks like a browser page
// (`window` is the global object, no `require`), so protobuf.js uses only what the page loads.
//
// Oracles:
// - protoc (libprotoc 36.2) and Python protobuf 7.36.2 (upb) json_format, recorded in the
//   fixtures file: random messages for a proto3 schema with every scalar type, maps, oneofs,
//   proto3 optional and all well-known types, a proto2 schema with groups, required fields,
//   closed enums, defaults and extensions, and an edition 2023 schema with field presence,
//   expanded repeated fields, delimited messages and a closed enum. protoc --encode turns the
//   generated text format into bytes; Python prints ProtoJSON in three option sets and
//   re-serializes the default JSON with deterministic=True. The engine must print the same
//   JSON and, from that JSON, encode the same bytes.
// - protoc --decode_raw output for the same bytes and for random byte strings: the raw text
//   view must match it byte for byte, and inputs protoc rejects must be rejected.
// - protobuf.js (same vm realm, long.js loaded first): its encoder and decoder round-trip
//   random messages with the engine for a schema without well-known types.
//
// Run: node scripts/test-protobuf-to-json.mjs
//      node scripts/test-protobuf-to-json.mjs --regenerate   (needs protoc and a Python with
//      protobuf >= 6 as $PB_PYTHON or python3)

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/ProtobufToJsonTool.astro'), 'utf8');
const FIXTURES = join(root, 'scripts/test-protobuf-to-json.fixtures.json');
const REGENERATE = process.argv.includes('--regenerate');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in ProtobufToJsonTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);

let failures = 0;
let passes = 0;
let skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual, (k, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v));
  const e = JSON.stringify(expected, (k, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v));
  check(name, a === e, 'got ' + a + ', expected ' + e);
}
function throwsCode(name, fn, code) {
  try { fn(); check(name, false, 'no error, expected ' + code); }
  catch (e) { check(name, e && e.pbCode === code, 'got ' + (e && (e.pbCode || e.message)) + ', expected ' + code); }
}
function skip(name, why) { skips++; console.log('SKIP: ' + name + ' — ' + why); }

// ---------- the page loads long.js before protobuf.js ----------
const scriptSrcs = [...source.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
eq('component loads long.min.js then protobuf.min.js', scriptSrcs, ['/vendor/long.min.js', '/vendor/protobuf.min.js']);
let longSrc = '';
try { longSrc = readFileSync(join(root, 'public/vendor/long.min.js'), 'utf8'); } catch {}
check('public/vendor/long.min.js exists', longSrc.length > 0);
const longVersion = JSON.parse(readFileSync(join(root, 'node_modules/long/package.json'), 'utf8')).version;
check('vendor long.min.js header names the long version protobufjs depends on',
  longSrc.includes('long.js v' + longVersion), 'node_modules/long is ' + longVersion);

// ---------- browser-like context ----------
const ctx = { atob, TextDecoder, TextEncoder };
ctx.window = ctx;
ctx.self = ctx;
vm.createContext(ctx);
for (const src of scriptSrcs) vm.runInContext(readFileSync(join(root, 'public', src), 'utf8'), ctx, { filename: src });
vm.runInContext(block + `\nthis.__engine = { readBytes, detectFormat, unframe, splitFrames, frameBytes, buildSchema, decodeTyped,
  msgJson, stringifyJson, collectUnknown, parseRaw, rawText, rawJson, fromJsonText, encodeToBytes, sampleFor,
  formatBytes, rankTypes, toBase64, fromBase64, toJsonName, fileSyntax, gunzip, finfo, lookupType };`, ctx);
const pb = ctx.protobuf;
const E = ctx.__engine;
const U8 = vm.runInContext('Uint8Array', ctx);
const u8 = (arr) => U8.from(arr);
check('protobuf.util.Long is the Long class from the page', pb && pb.util.Long && pb.util.Long === ctx.Long);

function schema(files) { if (!Array.isArray(files)) files = [files]; return E.buildSchema(pb, files.map((f) => (typeof f === 'string' ? { name: 'main.proto', text: f } : f))); }
function decodeJson(c, type, bytes, opts, indent) {
  const msg = E.decodeTyped(c, type, u8(bytes));
  return E.stringifyJson(E.msgJson(c, msg, opts || {}, '', 0), indent || 0, false);
}
function encodeHex(c, type, json, opts) {
  return Buffer.from(E.encodeToBytes(c, E.fromJsonText(c, type, json, opts || {}))).toString('hex');
}

// ---------- independent wire encoder ----------
const U64 = (1n << 64n) - 1n;
function varint(v) {
  let n = BigInt.asUintN(64, BigInt(v));
  const out = [];
  do { let b = Number(n & 0x7fn); n >>= 7n; if (n) b |= 0x80; out.push(b); } while (n);
  return out;
}
const zigzag = (v) => BigInt.asUintN(64, (BigInt(v) << 1n) ^ (BigInt(v) >> 63n));
function fixed64(v) { let n = BigInt.asUintN(64, BigInt(v)); const out = []; for (let i = 0; i < 8; i++) { out.push(Number(n & 0xffn)); n >>= 8n; } return out; }
const key = (field, wire) => varint((field << 3) | wire);
const lenDelim = (field, bytes) => [...key(field, 2), ...varint(bytes.length), ...bytes];
const toHex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');

// ---------- 64-bit integers at full precision (2026-09-30 regression) ----------
const BIG = schema(`syntax = "proto3";
package t;
message Big {
  int64 i64 = 1; uint64 u64 = 2; sint64 s64 = 3; fixed64 f64 = 4; sfixed64 sf64 = 5; int32 i32 = 6;
  repeated int64 packed = 7; repeated int64 unpacked = 8 [packed = false]; map<string, int64> m = 9;
}`);
const big = (bytes) => JSON.parse(decodeJson(BIG, 't.Big', bytes));
const P53 = 2n ** 53n, I64_MIN = -(2n ** 63n), I64_MAX = 2n ** 63n - 1n;
eq('int64 2^53 + 1', big([...key(1, 0), ...varint(P53 + 1n)]), { i64: '9007199254740993' });
eq('uint64 2^53 + 1', big([...key(2, 0), ...varint(P53 + 1n)]), { u64: '9007199254740993' });
eq('sint64 -(2^53 + 1)', big([...key(3, 0), ...varint(zigzag(-(P53 + 1n)))]), { s64: '-9007199254740993' });
eq('fixed64 2^53 + 1', big([...key(4, 1), ...fixed64(P53 + 1n)]), { f64: '9007199254740993' });
eq('sfixed64 -(2^53 + 1)', big([...key(5, 1), ...fixed64(-(P53 + 1n))]), { sf64: '-9007199254740993' });
eq('int64 max', big([...key(1, 0), ...varint(I64_MAX)]), { i64: '9223372036854775807' });
eq('int64 min', big([...key(1, 0), ...varint(I64_MIN)]), { i64: '-9223372036854775808' });
eq('int64 -1 (10-byte varint)', big([...key(1, 0), ...varint(-1n)]), { i64: '-1' });
eq('uint64 max', big([...key(2, 0), ...varint(U64)]), { u64: '18446744073709551615' });
eq('sint64 min', big([...key(3, 0), ...varint(zigzag(I64_MIN))]), { s64: '-9223372036854775808' });
eq('sint64 max', big([...key(3, 0), ...varint(zigzag(I64_MAX))]), { s64: '9223372036854775807' });
eq('fixed64 max', big([...key(4, 1), ...fixed64(U64)]), { f64: '18446744073709551615' });
eq('sfixed64 min', big([...key(5, 1), ...fixed64(I64_MIN)]), { sf64: '-9223372036854775808' });
eq('int32 stays a JSON number', big([...key(6, 0), ...varint(-5n)]), { i32: -5 });
eq('packed repeated int64', big(lenDelim(7, [...varint(P53 + 1n), ...varint(-1n), ...varint(7n)])), { packed: ['9007199254740993', '-1', '7'] });
eq('unpacked repeated int64', big([...key(8, 0), ...varint(I64_MAX), ...key(8, 0), ...varint(P53 + 3n)]), { unpacked: ['9223372036854775807', '9007199254740995'] });
eq('map<string, int64>', big(lenDelim(9, [...lenDelim(1, [...Buffer.from('id')]), ...key(2, 0), ...varint(P53 + 1n)])), { m: { id: '9007199254740993' } });
eq('JSON text keeps the digits', decodeJson(BIG, 't.Big', [...key(2, 0), ...varint(U64)]), '{"u64":"18446744073709551615"}');
eq('JSON → bytes keeps int64 digits', encodeHex(BIG, 't.Big', '{"i64":"9223372036854775807","u64":18446744073709551615}'),
  Buffer.from([...key(1, 0), ...varint(I64_MAX), ...key(2, 0), ...varint(U64)]).toString('hex'));

// ---------- byte input ----------
const B = (text, fmt) => Array.from(E.readBytes(text, fmt).bytes);
eq('hex with spaces', B('0a 05 41'), [10, 5, 65]);
eq('hex with colons', B('0a:05:41'), [10, 5, 65]);
eq('hex with 0x prefix', B('0x0a0541'), [10, 5, 65]);
eq('C array', B('{ 0x0a, 0x05, 0x41 }'), [10, 5, 65]);
eq('Base64', B('CgVBbGljZQ=='), [10, 5, 65, 108, 105, 99, 101]);
eq('Base64 without padding', B('CgVBbGljZQ'), [10, 5, 65, 108, 105, 99, 101]);
eq('Base64 URL-safe', B('-_8'), [0xfb, 0xff]);
eq('data URL', B('data:application/x-protobuf;base64,CgE='), [10, 1]);
eq('Python bytes repr', B("b'\\n\\x05Alice'"), [10, 5, 65, 108, 105, 99, 101]);
eq('protoc octal escapes', B('"\\n\\005Alice"'), [10, 5, 65, 108, 105, 99, 101]);
eq('escaped string with UTF-8', B('"\\n\\x02é"'), [10, 2, 0xc3, 0xa9]);
eq('Java byte list', B('[10, 5, -1]'), [10, 5, 255]);
eq('auto picks hex', E.readBytes('0a 05', 'auto').format, 'hex');
eq('auto picks Base64', E.readBytes('CgVBbGljZQ==', 'auto').format, 'base64');
eq('auto picks escaped', E.readBytes("b'\\x08\\x01'", 'auto').format, 'escaped');
eq('auto picks byte list', E.readBytes('[8, 1]', 'auto').format, 'decimal');
eq('hex-looking Base64 is flagged', E.readBytes('AAAA', 'auto').ambiguous, true);
eq('explicit Base64 reads AAAA as 3 zero bytes', B('AAAA', 'base64'), [0, 0, 0]);
eq('spaced hex is not flagged', E.readBytes('aa aa', 'auto').ambiguous, false);
throwsCode('odd hex', () => E.readBytes('0a 0', 'hex'), 'hexOdd');
throwsCode('bad hex digit', () => E.readBytes('0a zz', 'hex'), 'hexChar');
try { E.readBytes('0a\n0g', 'hex'); } catch (e) { eq('hex error position', [e.pbArgs.line, e.pbArgs.col, e.pbArgs.ch], [2, 2, 'g']); }
throwsCode('Base64 bad char', () => E.readBytes('Cg*V', 'base64'), 'b64Char');
throwsCode('Base64 one char over', () => E.readBytes('CgVBb', 'base64'), 'b64Length');
throwsCode('Base64 mixed alphabets', () => E.readBytes('a+b_', 'base64'), 'b64Mixed');
throwsCode('Base64 padding in the middle', () => E.readBytes('Cg==CgE=', 'base64'), 'b64Pad');
throwsCode('unknown escape', () => E.readBytes('"\\q"', 'escaped'), 'escUnknown');
throwsCode('octal escape above 255', () => E.readBytes('"\\777"', 'escaped'), 'escBad');
throwsCode('unclosed quote', () => E.readBytes("b'\\x01", 'escaped'), 'escQuote');
throwsCode('byte list value out of range', () => E.readBytes('[10, 300]', 'decimal'), 'decToken');

// ---------- gRPC frames ----------
const msgBytes = [...key(1, 0), 1];
const frame = (flag, body) => [flag, 0, 0, 0, body.length, ...body];
eq('auto strips one gRPC frame', Array.from(E.unframe(u8(frame(0, msgBytes)), 'auto')[0].payload), msgBytes);
eq('auto splits two frames', E.unframe(u8([...frame(0, msgBytes), ...frame(0, msgBytes)]), 'auto').length, 2);
eq('gRPC-Web trailers frame is kept apart', E.unframe(u8([...frame(0, msgBytes), ...frame(0x80, [...Buffer.from('grpc-status:0\r\n')])]), 'auto')[1].flag, 0x80);
eq('auto leaves plain messages alone', E.unframe(u8(msgBytes), 'auto'), null);
eq('auto leaves a near-frame alone', E.unframe(u8([0, 0, 0, 0, 9, 8, 1]), 'auto'), null);
throwsCode('forced frame too short', () => E.unframe(u8([0, 0, 0, 0, 9, 8, 1]), 'yes'), 'grpcBad');
throwsCode('forced frame bad flag', () => E.unframe(u8(msgBytes), 'yes'), 'grpcFlags');
eq('frameBytes', Array.from(E.frameBytes(u8(msgBytes))), frame(0, msgBytes));

// ---------- schema building ----------
eq('fileSyntax proto3', E.fileSyntax('// x\nsyntax = "proto3";'), 'proto3');
eq('fileSyntax without a line is proto2', E.fileSyntax('message A {}'), 'proto2');
eq('fileSyntax edition', E.fileSyntax('edition = "2023";'), '2023');
eq('protoc json names', ['foo_bar', 'foo__bar', '_foo', 'a_1b', 'fooBar', 'foo_bar_'].map((n) => E.toJsonName(n)),
  ['fooBar', 'fooBar', 'Foo', 'a1b', 'fooBar', 'fooBar']);
throwsCode('schema syntax error', () => schema('syntax = "proto3";\nmessage A {\n  int32 x = ;\n}'), 'schemaSyntax');
try { schema('syntax = "proto3";\nmessage A {\n  int32 x = ;\n}'); } catch (e) { eq('schema error line', [e.pbArgs.file, e.pbArgs.line], ['main.proto', 3]); }
try { schema('syntax = "proto3";\nimport "common/money.proto";\nmessage A { common.Money price = 1; }'); check('unresolved type throws', false); }
catch (e) { eq('unresolved type names the missing import', [e.pbCode, e.pbArgs.type, e.pbArgs.missing], ['schemaUnresolved', 'common.Money', ['common/money.proto']]); }
const multi = schema([
  { name: 'main.proto', text: 'syntax = "proto3";\nimport "common/money.proto";\npackage shop;\nmessage A { common.Money price = 1; }' },
  { name: 'money.proto', text: 'syntax = "proto3";\npackage common;\nmessage Money { string currency_code = 1; int64 units = 2; }' },
]);
eq('import resolved from an added file', multi.types, ['shop.A', 'common.Money']);
eq('default type is the one nothing references', multi.defaultType, 'shop.A');
const wktNoImport = schema('syntax = "proto3";\nmessage T { google.protobuf.Timestamp t = 1; }');
eq('well-known types resolve without the import line', wktNoImport.types, ['T']);
const customOpt = schema(`syntax = "proto3";
import "google/protobuf/descriptor.proto";
extend google.protobuf.FieldOptions { string sensitive = 50001; }
message U { string ssn = 1 [(sensitive) = "pii"]; }`);
eq('custom options without descriptor.proto are dropped with a note', [customOpt.types, customOpt.warnings.map((w) => w.code)], [['U'], ['optionExtDropped']]);
const annot = schema('syntax = "proto3";\nimport "google/api/annotations.proto";\nmessage Q { string q = 1; }\nservice S { rpc Get(Q) returns (Q) { option (google.api.http) = { get: "/v1/q" }; } }');
eq('unused missing import is a note', annot.warnings.map((w) => [w.code, w.args.path]), [['importMissing', 'google/api/annotations.proto']]);

// ---------- ProtoJSON details ----------
const P3 = schema(`syntax = "proto3";
package p;
message M {
  string user_name = 1;
  float f = 2;
  double d = 3;
  int32 n = 4;
  string s = 5;
  oneof k { string a = 6; int32 b = 7; }
  Inner inner = 8;
  bytes by = 9;
  optional int32 opt = 10;
  int32 named = 11 [json_name = "customName"];
  repeated int32 r = 12;
  E e = 13;
  map<bool, string> bm = 14;
  map<int64, Inner> im = 15;
}
message Inner { int32 x = 1; }
enum E { option allow_alias = true; E_ZERO = 0; E_ONE = 1; E_UNO = 1; }`);
const j = (bytes, opts) => decodeJson(P3, 'p.M', bytes, opts);
eq('lowerCamelCase names', j([...lenDelim(1, [0x61])]), '{"userName":"a"}');
eq('proto names option', j([...lenDelim(1, [0x61])], { protoNames: true }), '{"user_name":"a"}');
eq('json_name option', j([...key(11, 0), 5]), '{"customName":5}');
eq('float 0.1 prints as 0.1', j([...key(2, 5), 0xcd, 0xcc, 0xcc, 0x3d]), '{"f":0.1}');
eq('double NaN is a string', j([...key(3, 1), 0, 0, 0, 0, 0, 0, 0xf8, 0x7f]), '{"d":"NaN"}');
eq('double -Infinity is a string', j([...key(3, 1), 0, 0, 0, 0, 0, 0, 0xf0, 0xff]), '{"d":"-Infinity"}');
eq('double -0 is printed', j([...key(3, 1), 0, 0, 0, 0, 0, 0, 0, 0x80]), '{"d":-0}');
eq('implicit field with default on the wire is omitted', j([...key(4, 0), 0]), '{}');
eq('defaults option prints implicit fields', j([], { defaults: true }), '{"userName":"","f":0,"d":0,"n":0,"s":"","by":"","customName":0,"r":[],"e":"E_ZERO","bm":{},"im":{}}');
eq('proto3 optional set to 0 is printed', j([...key(10, 0), 0]), '{"opt":0}');
eq('oneof member set to default is printed', j([...key(7, 0), 0]), '{"b":0}');
eq('later oneof member replaces the earlier one', j([...lenDelim(6, [0x61]), ...key(7, 0), 3]), '{"b":3}');
eq('enum alias prints the first name', j([...key(13, 0), 1]), '{"e":"E_ONE"}');
eq('open enum unknown value prints the number', j([...key(13, 0), 9]), '{"e":9}');
eq('enums as numbers option', j([...key(13, 0), 1], { enumNumbers: true }), '{"e":1}');
eq('bytes are standard Base64', j([...lenDelim(9, [0xfb, 0xff, 0xfe])]), '{"by":"+//+"}');
eq('map bool key', j(lenDelim(14, [...key(1, 0), 1, ...lenDelim(2, [0x78])])), '{"bm":{"true":"x"}}');
eq('map int64 key and message value', j(lenDelim(15, [...key(1, 0), ...varint(-2n), ...lenDelim(2, [...key(1, 0), 4])])), '{"im":{"-2":{"x":4}}}');
eq('map entry without value gets the default message', j(lenDelim(15, [...key(1, 0), 1])), '{"im":{"1":{}}}');
eq('singular message fields merge', j([...lenDelim(8, [...key(1, 0), 1]), ...lenDelim(8, [])]), '{"inner":{"x":1}}');
eq('repeated scalar accepts packed and unpacked', j([...key(12, 0), 1, ...lenDelim(12, [2, 3])]), '{"r":[1,2,3]}');
const unk = E.decodeTyped(P3, 'p.M', u8([...key(4, 0), 5, ...key(20, 0), 1]));
eq('unknown field is reported, not printed', [E.stringifyJson(E.msgJson(P3, unk, {}, '', 0), 0, false), E.collectUnknown(P3, unk, '', []).map((x) => [x.u.num, x.u.wt, x.u.offset])], ['{"n":5}', [[20, 0, 2]]]);
const mism = E.decodeTyped(P3, 'p.M', u8(lenDelim(4, [1, 2])));
eq('wrong wire type becomes an unknown field', E.collectUnknown(P3, mism, '', []).map((x) => x.u.note && x.u.note.code), ['wireMismatch']);
throwsCode('invalid UTF-8 in a proto3 string', () => E.decodeTyped(P3, 'p.M', u8(lenDelim(5, [0xc3, 0x28]))), 'badUtf8');
try { E.decodeTyped(P3, 'p.M', u8(lenDelim(5, [0x61, 0xc3, 0x28]))); } catch (e) { eq('UTF-8 error offset is the string start', e.pbArgs.offset, 2); }
throwsCode('truncated length', () => E.decodeTyped(P3, 'p.M', u8([0x0a, 0x05, 0x41])), 'lenOverrun');
throwsCode('truncated varint', () => E.decodeTyped(P3, 'p.M', u8([0x20, 0x80])), 'truncVarint');
throwsCode('truncated fixed64', () => E.decodeTyped(P3, 'p.M', u8([0x19, 1, 2])), 'truncFixed');
throwsCode('field number 0', () => E.decodeTyped(P3, 'p.M', u8([0x02, 0x00])), 'fieldZero');
throwsCode('wire type 6', () => E.decodeTyped(P3, 'p.M', u8([0x0e])), 'wireType');
throwsCode('stray end group', () => E.decodeTyped(P3, 'p.M', u8([0x0c])), 'endGroup');
throwsCode('11-byte varint', () => E.decodeTyped(P3, 'p.M', u8([0x20, ...Array(10).fill(0xff), 1])), 'longVarint');
throwsCode('nesting deeper than 100', () => {
  const S = schema('syntax = "proto3";\nmessage N { N n = 1; }');
  let b = [];
  for (let i = 0; i < 102; i++) b = lenDelim(1, b);
  E.decodeTyped(S, 'N', u8(b));
}, 'tooDeep');
throwsCode('unknown message type', () => E.decodeTyped(P3, 'p.Nope', u8([])), 'noType');

// ---------- ProtoJSON parser ----------
const enc = (json, opts) => encodeHex(P3, 'p.M', json, opts);
eq('accepts json name and proto name', [enc('{"userName":"a"}'), enc('{"user_name":"a"}')], ['0a0161', '0a0161']);
eq('int as string and exponent form', enc('{"n":"7","r":[1e2, "2"]}'), '2007' + '6202' + '6402');
eq('enum by name and number', [enc('{"e":"E_UNO"}'), enc('{"e":1}')], ['6801', '6801']);
eq('null leaves a field unset', enc('{"n":null,"inner":null}'), '');
eq('implicit default value is not written', enc('{"n":0,"s":""}'), '');
eq('optional default value is written', enc('{"opt":0}'), '5000');
eq('bytes accept URL-safe without padding', enc('{"by":"-_8"}'), '4a02fbff');
eq('float NaN string', enc('{"f":"NaN"}'), '150000c07f');
eq('map keys are converted', enc('{"bm":{"false":"x"},"im":{"-1":{}}}'), '7205080012' + '0178' + '7a0d08ffffffffffffffffff011200');
eq('map entries are sorted by key', enc('{"bm":{"true":"b","false":"a"}}'), '7205080012' + '0161' + '7205080112' + '0162');
const jerr = (json, code, opts) => throwsCode('JSON error ' + code + ' for ' + json, () => E.fromJsonText(P3, 'p.M', json, opts || {}), code);
jerr('{"n":1.5}', 'notInteger');
jerr('{"n":2147483648}', 'intRange');
jerr('{"n":"0x10"}', 'expectNumber');
jerr('{"n":true}', 'expectNumber');
jerr('{"f":1e39}', 'floatRange');
jerr('{"d":1e400}', 'floatRange');
jerr('{"s":5}', 'expectString');
jerr('{"by":"!!"}', 'badBase64');
jerr('{"e":"E_TWO"}', 'badEnum');
jerr('{"r":5}', 'expectArray');
jerr('{"r":[1,null]}', 'nullInArray');
jerr('{"username":"a"}', 'unknownField');
jerr('{"a":"x","b":1}', 'oneofTwice');
jerr('{"userName":"a","user_name":"b"}', 'dupField');
jerr('{"bm":{"yes":"x"}}', 'badMapKey');
jerr('{"s":"\\ud800"}', 'loneSurrogate');
jerr('{"n":1,}', 'jsonUnexpected');
jerr('{"n":01}', 'jsonNumber');
jerr('{"n":1} x', 'jsonTrailing');
jerr('{"s":"a', 'jsonEnd');
jerr('{"s":"a\nb"}', 'jsonControl');
jerr('null', 'topNull');
try { E.fromJsonText(P3, 'p.M', '{\n  "username": "a"\n}', {}); } catch (e) { eq('unknown field error: position and hint', [e.pbArgs.line, e.pbArgs.col, e.pbArgs.hint], [2, 3, 'userName']); }
eq('ignore unknown fields option', enc('{"zzz":1,"n":2}', { ignoreUnknown: true }), '2002');

// ---------- well-known types ----------
const W = schema(`syntax = "proto3";
import "google/protobuf/any.proto"; import "google/protobuf/timestamp.proto"; import "google/protobuf/duration.proto";
import "google/protobuf/struct.proto"; import "google/protobuf/wrappers.proto"; import "google/protobuf/field_mask.proto";
import "google/protobuf/empty.proto";
package w;
message W {
  google.protobuf.Timestamp ts = 1; google.protobuf.Duration du = 2; google.protobuf.Struct st = 3;
  google.protobuf.Value v = 4; google.protobuf.ListValue lv = 5; google.protobuf.FieldMask fm = 6;
  google.protobuf.Any any = 7; google.protobuf.Int64Value i64 = 8; google.protobuf.BytesValue bv = 9;
  google.protobuf.Empty empty = 10; google.protobuf.NullValue nv = 11; google.protobuf.FloatValue fv = 12;
}
message Pet { string pet_name = 1; }`);
const wj = (json) => decodeJson(W, 'w.W', [...E.encodeToBytes(W, E.fromJsonText(W, 'w.W', json, {}))]);
eq('Timestamp round trip, 3/6/9 fraction digits', [wj('{"ts":"2026-10-01T08:30:00Z"}'), wj('{"ts":"2026-10-01T08:30:00.25Z"}'), wj('{"ts":"2026-10-01T08:30:00.000001Z"}'), wj('{"ts":"2026-10-01T08:30:00.123456789Z"}')],
  ['{"ts":"2026-10-01T08:30:00Z"}', '{"ts":"2026-10-01T08:30:00.250Z"}', '{"ts":"2026-10-01T08:30:00.000001Z"}', '{"ts":"2026-10-01T08:30:00.123456789Z"}']);
eq('Timestamp offset is converted to UTC', wj('{"ts":"2026-10-01T17:30:00+09:00"}'), '{"ts":"2026-10-01T08:30:00Z"}');
eq('Timestamp limits', [wj('{"ts":"0001-01-01T00:00:00Z"}'), wj('{"ts":"9999-12-31T23:59:59.999999999Z"}')], ['{"ts":"0001-01-01T00:00:00Z"}', '{"ts":"9999-12-31T23:59:59.999999999Z"}']);
eq('Duration', [wj('{"du":"1.5s"}'), wj('{"du":"-0.25s"}'), wj('{"du":"0s"}'), wj('{"du":"315576000000s"}')], ['{"du":"1.500s"}', '{"du":"-0.250s"}', '{"du":"0s"}', '{"du":"315576000000s"}']);
eq('FieldMask camel ↔ snake', wj('{"fm":"user.displayName,etag"}'), '{"fm":"user.displayName,etag"}');
eq('FieldMask stored in snake_case', Buffer.from(E.encodeToBytes(W, E.fromJsonText(W, 'w.W', '{"fm":"displayName"}', {}))).toString(), '2\x0e\n\fdisplay_name');
eq('Struct, Value, ListValue', wj('{"st":{"a":1,"b":[true,null,"x"],"c":{}},"v":null,"lv":[1.5,{"k":"v"}]}'), '{"st":{"a":1,"b":[true,null,"x"],"c":{}},"v":null,"lv":[1.5,{"k":"v"}]}');
eq('wrappers', wj('{"i64":"-5","bv":"AQI=","fv":0.1}'), '{"i64":"-5","bv":"AQI=","fv":0.1}');
eq('wrapper with default value is still present', wj('{"i64":"0"}'), '{"i64":"0"}');
eq('Empty', wj('{"empty":{}}'), '{"empty":{}}');
eq('NullValue field is implicit, so null is the default', wj('{"nv":null}'), '{}');
eq('NullValue field with the defaults option', decodeJson(W, 'w.W', [], { defaults: true }).includes('"nv":null'), true);
eq('Any with a message', wj('{"any":{"@type":"type.googleapis.com/w.Pet","petName":"Mochi"}}'), '{"any":{"@type":"type.googleapis.com/w.Pet","petName":"Mochi"}}');
eq('Any with a well-known type uses "value"', wj('{"any":{"@type":"type.googleapis.com/google.protobuf.Duration","value":"2s"}}'), '{"any":{"@type":"type.googleapis.com/google.protobuf.Duration","value":"2s"}}');
eq('empty Any', wj('{"any":{}}'), '{"any":{}}');
const wtErr = (json, code) => throwsCode('WKT error ' + code + ' for ' + json, () => E.fromJsonText(W, 'w.W', json, {}), code);
wtErr('{"ts":"2026-10-01 08:30:00Z"}', 'badTimestamp');
wtErr('{"ts":"2026-02-30T00:00:00Z"}', 'badTimestamp');
wtErr('{"ts":"10000-01-01T00:00:00Z"}', 'badTimestamp');
wtErr('{"du":"1.5"}', 'badDuration');
wtErr('{"du":"315576000001s"}', 'badDuration');
wtErr('{"fm":"display_name"}', 'badFieldMask');
wtErr('{"any":{"petName":"x"}}', 'anyNoType');
wtErr('{"any":{"@type":"type.googleapis.com/w.Nope"}}', 'anyUnknownType');
const wd = (bytes) => { try { return decodeJson(W, 'w.W', bytes); } catch (e) { return e.pbCode; } };
eq('Timestamp out of range on decode', wd(lenDelim(1, [...key(1, 0), ...varint(253402300800n)])), 'tsRange');
eq('Timestamp negative nanos on decode', wd(lenDelim(1, [...key(2, 0), ...varint(-1n)])), 'nanosRange');
eq('Duration sign mismatch on decode', wd(lenDelim(2, [...key(1, 0), 1, ...key(2, 0), ...varint(-1n)])), 'durationSign');
eq('Value without a kind', wd(lenDelim(4, [])), 'valueEmpty');
eq('Value NaN', wd(lenDelim(4, [...key(2, 1), 0, 0, 0, 0, 0, 0, 0xf8, 0x7f])), 'valueNonFinite');
eq('FieldMask path not convertible', wd(lenDelim(6, lenDelim(1, [...Buffer.from('fooBar')]))), 'fieldMaskPath');
const anyUnk = E.decodeTyped(W, 'w.W', u8(lenDelim(7, [...lenDelim(1, [...Buffer.from('type.googleapis.com/x.Gone')]), ...lenDelim(2, [8, 1])])));
eq('Any with an unknown type keeps Base64 and adds a note', [E.stringifyJson(E.msgJson(W, anyUnk, {}, '', 0), 0, false), W.notes.map((n) => n.code)],
  ['{"any":{"@type":"type.googleapis.com/x.Gone","value":"CAE="}}', ['anyUnknown']]);
const prec = E.fromJsonText(W, 'w.W', '{"v":9007199254740993}', {});
eq('Value number above 2^53 adds a precision note', W.notes.map((n) => [n.code, n.args.stored]), [['valuePrecision', '9007199254740992']]);
void prec;

// ---------- proto2 and editions ----------
const P2 = schema(`syntax = "proto2";
package t2;
enum E2 { A = 1; B = 2; }
message P2 {
  optional int32 a = 1 [default = 7];
  required string r = 2;
  optional group Grp = 3 { optional int32 x = 4; }
  optional E2 e = 5;
  repeated E2 es = 6;
  extensions 100 to 199;
}
extend P2 { optional int32 ext_i = 100; }`);
eq('proto2 group, extension, explicit zero', decodeJson(P2, 't2.P2', [...key(1, 0), 0, ...lenDelim(2, [0x72]), ...key(3, 3), ...key(4, 0), 9, ...key(3, 4), ...key(100, 0), 5]),
  '{"a":0,"r":"r","grp":{"x":9},"[t2.ext_i]":5}');
const p2closed = E.decodeTyped(P2, 't2.P2', u8([...lenDelim(2, [0x72]), ...key(5, 0), 9, ...lenDelim(6, [1, 9, 2])]));
eq('proto2 closed enum: unknown values become unknown fields', [E.stringifyJson(E.msgJson(P2, p2closed, {}, '', 0), 0, false), E.collectUnknown(P2, p2closed, '', []).map((x) => x.u.note.code)],
  ['{"r":"r","es":["A","B"]}', ['closedEnum', 'closedEnum']]);
E.msgJson(P2, E.decodeTyped(P2, 't2.P2', u8([])), {}, '', 0);
eq('missing proto2 required field is noted', P2.notes.map((n) => n.code), ['requiredMissing']);
eq('proto2 group encodes as start/end group', encodeHex(P2, 't2.P2', '{"r":"","grp":{"x":1}}'), '1200' + '1b' + '2001' + '1c');
eq('proto2 sample uses [default]', E.stringifyJson(E.sampleFor(P2, 't2.P2', {}), 0, false), '{"a":7,"r":"","grp":{"x":0},"e":"A","es":["A"],"[t2.ext_i]":0}');
const ED = schema(`edition = "2023";
package ted;
message Ed {
  int32 explicit_i = 1;
  int32 implicit_i = 2 [features.field_presence = IMPLICIT];
  repeated int32 packed_r = 3;
  repeated int32 expanded_r = 4 [features.repeated_field_encoding = EXPANDED];
  Ed child = 5 [features.message_encoding = DELIMITED];
  Closed c = 6;
}
enum Closed { option features.enum_type = CLOSED; C0 = 0; C1 = 1; }`);
eq('edition 2023: explicit presence prints zero, implicit omits it', decodeJson(ED, 'ted.Ed', [...key(1, 0), 0, ...key(2, 0), 0]), '{"explicitI":0}');
eq('edition 2023: packed by default, EXPANDED opt-out, DELIMITED child', encodeHex(ED, 'ted.Ed', '{"packedR":[1,2],"expandedR":[3,4],"child":{"explicitI":1}}'),
  '1a020102' + '2003' + '2004' + '2b' + '0801' + '2c');
eq('edition 2023: closed enum', E.collectUnknown(ED, E.decodeTyped(ED, 'ted.Ed', u8([...key(6, 0), 5])), '', []).map((x) => x.u.note.code), ['closedEnum']);

// ---------- raw decoding ----------
const raw = (bytes) => E.rawText(E.parseRaw(u8(bytes), 0, bytes.length, 0, null));
eq('raw nested message and string', raw([...lenDelim(1, [...Buffer.from('Alice')]), ...key(2, 0), 30, ...lenDelim(4, [...lenDelim(2, [...Buffer.from('Austin')])])]),
  '1: "Alice"\n2: 30\n4 {\n  2: "Austin"\n}\n');
eq('raw prefers a message for "hi" like protoc', raw(lenDelim(1, [0x68, 0x69])), '1 {\n  13: 105\n}\n');
eq('raw fixed32 / fixed64 in hex', raw([...key(2, 5), 0, 0, 0x80, 0x3f, ...key(3, 1), ...fixed64(0x3ff0000000000000n)]), '2: 0x3f800000\n3: 0x3ff0000000000000\n');
eq('raw group', raw([...key(1, 3), ...key(1, 0), 1, ...key(1, 4)]), '1 {\n  1: 1\n}\n');
eq('raw escapes', raw(lenDelim(1, [0x22, 0x27, 0x5c, 0xc3, 0xa9, 0x7f])), '1: "\\"\\\'\\\\\\303\\251\\177"\n');
eq('raw JSON: readable text stays a string', E.stringifyJson(E.rawJson(E.parseRaw(u8(lenDelim(1, [0x68, 0x69])), 0, 4, 0, null)), 0, false), '{"1":"hi"}');
eq('raw JSON: repeated numbers become an array, big varints strings', E.stringifyJson(E.rawJson(E.parseRaw(u8([...key(1, 0), 1, ...key(1, 0), ...varint(U64)]), 0, 13, 0, null)), 0, false), '{"1":[1,"18446744073709551615"]}');
eq('raw JSON: binary that is not a message is base64', E.stringifyJson(E.rawJson(E.parseRaw(u8(lenDelim(1, [0xff, 0xfe])), 0, 4, 0, null)), 0, false), '{"1":"base64://4="}');
eq('raw JSON with other readings', E.stringifyJson(E.rawJson(E.parseRaw(u8([...key(1, 0), 3, ...key(2, 5), 0, 0, 0x80, 0xbf, ...key(3, 1), ...fixed64(-1n)]), 0, 16, 0, null), 0, true), 0, false),
  '{"1":{"uint64":3,"sint64":-2},"2":{"hex":"0xbf800000","fixed32":3212836864,"sfixed32":-1082130432,"float":-1},"3":{"hex":"0xffffffffffffffff","fixed64":"18446744073709551615","sfixed64":-1,"double":"NaN"}}');
throwsCode('raw: field 0 fails like protoc', () => E.parseRaw(u8([0x02, 0x00]), 0, 2, 0, null), 'fieldZero');

// ---------- encoder output formats ----------
const sample = u8([0x0a, 0x02, 0x27, 0x5c, 0x22, 0xff]);
eq('format hex', E.formatBytes(sample, 'hex'), '0a 02 27 5c 22 ff');
eq('format base64', E.formatBytes(sample, 'base64'), 'CgInXCL/');
eq('format C array', E.formatBytes(sample, 'carray'), '{ 0x0a, 0x02, 0x27, 0x5c, 0x22, 0xff }');
eq('format Python repr', E.formatBytes(sample, 'escaped'), "b'\\n\\x02\\'\\\\\"\\xff'");
eq('format Python repr picks double quotes', E.formatBytes(u8([0x27]), 'escaped'), 'b"\'"');
eq('escaped output reads back', Array.from(E.readBytes(E.formatBytes(sample, 'escaped'), 'auto').bytes), Array.from(sample));

// ---------- sample JSON ----------
const sampleP3 = E.sampleFor(P3, 'p.M', {});
eq('sample JSON lists every field once, one oneof member', E.stringifyJson(sampleP3, 0, false),
  '{"userName":"","f":0,"d":0,"n":0,"s":"","a":"","inner":{"x":0},"by":"","opt":0,"customName":0,"r":[0],"e":"E_ZERO","bm":{"true":""},"im":{"0":{"x":0}}}');
eq('sample notes the other oneof members', P3.notes.map((n) => [n.code, n.args.others]), [['sampleOneof', 'b']]);
const SW = schema('syntax = "proto3";\nimport "google/protobuf/timestamp.proto";\nmessage Node { string id = 1; repeated Node children = 2; google.protobuf.Timestamp at = 3; }');
eq('recursive types stop at the second level', E.stringifyJson(E.sampleFor(SW, 'Node', {}), 0, false), '{"id":"","children":[{}],"at":"1970-01-01T00:00:00Z"}');
eq('every sample encodes', [P3, W, P2, ED].every((c) => c.types.every((t) => {
  try { E.encodeToBytes(c, E.fromJsonText(c, t, E.stringifyJson(E.sampleFor(c, t, {}), 2, false), {})); return true; }
  catch (e) { console.log('  sample for ' + t + ' does not encode: ' + e.pbCode); return false; }
})), true);

// ---------- type ranking ----------
const RK = schema('syntax = "proto3";\nmessage Customer { string name = 1; }\nmessage Order { string order_id = 1; int32 qty = 2; }\nmessage Ping { int64 t = 3; }');
eq('rankTypes lists types that fit without unknown fields', E.rankTypes(RK, u8([...lenDelim(1, [0x41]), ...key(2, 0), 2])), ['Order']);

// ---------- gzip frames (DecompressionStream, Node 18+) ----------
if (typeof DecompressionStream === 'function') {
  ctx.DecompressionStream = DecompressionStream; ctx.Blob = Blob; ctx.Response = Response;
  const zlib = await import('node:zlib');
  const gz = zlib.gzipSync(Buffer.from(msgBytes));
  const out = await E.gunzip(u8([...gz]));
  eq('gunzip of a compressed gRPC payload', Array.from(out), msgBytes);
} else skip('gunzip', 'DecompressionStream not available in this Node');

// ---------- protobuf.js cross-check (same realm) ----------
let seed = 20261002;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function ri(n) { return Math.floor(rnd() * n); }
const PJ_SCHEMA = `syntax = "proto3";
package pj;
enum Color { COLOR_UNSPECIFIED = 0; RED = 1; GREEN = 2; }
message Item { string name = 1; sint32 delta = 2; Color color = 3; }
message All {
  double d = 1; float f = 2; int32 i32 = 3; int64 i64 = 4; uint32 u32 = 5; uint64 u64 = 6; sint32 s32 = 7;
  sint64 s64 = 8; fixed32 fx32 = 9; fixed64 fx64 = 10; sfixed32 sfx32 = 11; sfixed64 sfx64 = 12; bool b = 13;
  string s = 14; bytes by = 15; Color color = 16; repeated int32 ri = 17; repeated string rs = 18;
  repeated Item items = 19; map<string, int64> m = 20; Item item = 21; repeated double rd = 22;
}`;
const PJ = schema(PJ_SCHEMA);
const pjRoot = pb.parse(PJ_SCHEMA, { keepCase: true }).root;
const PJAll = pjRoot.lookupType('pj.All');
function rBig(signed) { const v = BigInt.asUintN(64, (BigInt(ri(2 ** 30)) << 34n) ^ BigInt(ri(2 ** 30)) ^ (BigInt(ri(16)) << 60n)); return signed ? BigInt.asIntN(64, v) : v; }
function rStr() { const pool = ['a', 'Z', ' ', 'é', '中', '😀', '\n', '"']; let s = ''; for (let i = ri(6); i > 0; i--) s += pool[ri(pool.length)]; return s; }
let pjOk = 0;
for (let n = 0; n < 300; n++) {
  const obj = {};
  if (rnd() < 0.5) obj.d = (rnd() - 0.5) * 1e6;
  if (rnd() < 0.5) obj.f = Math.fround((rnd() - 0.5) * 1000);
  if (rnd() < 0.5) obj.i32 = ri(2 ** 31) * (rnd() < 0.5 ? -1 : 1);
  if (rnd() < 0.5) obj.i64 = rBig(true).toString();
  if (rnd() < 0.5) obj.u32 = ri(2 ** 32);
  if (rnd() < 0.5) obj.u64 = rBig(false).toString();
  if (rnd() < 0.5) obj.s32 = ri(2 ** 31) * (rnd() < 0.5 ? -1 : 1);
  if (rnd() < 0.5) obj.s64 = rBig(true).toString();
  if (rnd() < 0.5) obj.fx32 = ri(2 ** 32);
  if (rnd() < 0.5) obj.fx64 = rBig(false).toString();
  if (rnd() < 0.5) obj.sfx32 = ri(2 ** 31) * (rnd() < 0.5 ? -1 : 1);
  if (rnd() < 0.5) obj.sfx64 = rBig(true).toString();
  if (rnd() < 0.5) obj.b = rnd() < 0.5;
  if (rnd() < 0.5) obj.s = rStr();
  if (rnd() < 0.5) obj.by = Buffer.from(rStr()).toString('base64');
  if (rnd() < 0.5) obj.color = ri(3);
  if (rnd() < 0.5) obj.ri = Array.from({ length: ri(4) }, () => ri(1000) - 500);
  if (rnd() < 0.5) obj.rs = Array.from({ length: ri(3) }, rStr);
  if (rnd() < 0.5) obj.items = Array.from({ length: ri(3) }, () => ({ name: rStr(), delta: ri(200) - 100, color: ri(3) }));
  if (rnd() < 0.5) { obj.m = {}; for (let k = ri(3); k > 0; k--) obj.m[rStr() + k] = rBig(true).toString(); }
  if (rnd() < 0.5) obj.item = { name: rStr(), delta: ri(9) };
  if (rnd() < 0.5) obj.rd = Array.from({ length: ri(3) }, () => rnd() * 100);
  const pbBytes = PJAll.encode(PJAll.fromObject(obj)).finish();
  const mine = E.decodeTyped(PJ, 'pj.All', u8([...pbBytes]));
  const reenc = E.encodeToBytes(PJ, mine);
  const sortMap = (o) => { o.m = Object.fromEntries(Object.entries(o.m).sort()); return o; };
  const back = sortMap(PJAll.toObject(PJAll.decode(reenc), { longs: String, enums: Number, bytes: String, defaults: true, arrays: true, objects: true }));
  const want = sortMap(PJAll.toObject(PJAll.decode(pbBytes), { longs: String, enums: Number, bytes: String, defaults: true, arrays: true, objects: true }));
  if (JSON.stringify(back) === JSON.stringify(want)) pjOk++;
  else if (pjOk + 5 > n) console.log('  protobuf.js mismatch: ' + JSON.stringify(obj));
}
eq('protobuf.js encode → engine decode → engine encode → protobuf.js decode (300 random messages)', pjOk, 300);

// ---------- protoc / Python oracle (recorded) ----------
const ORACLE_FILES = {
  't3.proto': `syntax = "proto3";
package t3;
import "google/protobuf/any.proto";
import "google/protobuf/timestamp.proto";
import "google/protobuf/duration.proto";
import "google/protobuf/struct.proto";
import "google/protobuf/wrappers.proto";
import "google/protobuf/field_mask.proto";
import "google/protobuf/empty.proto";
enum Color { COLOR_UNSPECIFIED = 0; RED = 1; GREEN = 2; }
message Scalars {
  double d = 1; float f = 2; int32 i32 = 3; int64 i64 = 4; uint32 u32 = 5; uint64 u64 = 6; sint32 s32 = 7;
  sint64 s64 = 8; fixed32 fx32 = 9; fixed64 fx64 = 10; sfixed32 sfx32 = 11; sfixed64 sfx64 = 12; bool b = 13;
  string s = 14; bytes by = 15; Color color = 16; optional int32 opt_i = 17; optional string opt_s = 18;
  int32 snake_case_field = 19; int32 custom = 20 [json_name = "renamedField"];
}
message Rep {
  repeated double d = 1; repeated float f = 2; repeated int32 i32 = 3; repeated int64 i64 = 4; repeated uint64 u64 = 5;
  repeated sint32 s32 = 6; repeated fixed64 fx64 = 7; repeated bool b = 8; repeated string s = 9; repeated bytes by = 10;
  repeated Color color = 11; repeated Scalars msgs = 12; repeated int32 unpacked = 13 [packed = false];
}
message Maps {
  map<string, int32> si = 1; map<int64, string> ls = 2; map<bool, Scalars> bm = 3; map<uint32, Color> ue = 4;
  map<sint64, bytes> sb = 5; map<fixed32, double> fd = 6; map<string, google.protobuf.Timestamp> st = 7;
}
message Oneofs { oneof kind { string name = 1; int64 id = 2; Scalars sc = 3; Color c = 4; google.protobuf.Duration du = 5; } }
message Wkt {
  google.protobuf.Timestamp ts = 1; google.protobuf.Duration du = 2; google.protobuf.Struct st = 3;
  google.protobuf.Value v = 4; google.protobuf.ListValue lv = 5; google.protobuf.FieldMask fm = 6;
  google.protobuf.Any any = 7; google.protobuf.Int64Value i64w = 8; google.protobuf.UInt64Value u64w = 9;
  google.protobuf.Int32Value i32w = 10; google.protobuf.UInt32Value u32w = 11; google.protobuf.BoolValue bw = 12;
  google.protobuf.StringValue sw = 13; google.protobuf.BytesValue byw = 14; google.protobuf.FloatValue fw = 15;
  google.protobuf.DoubleValue dw = 16; google.protobuf.Empty e = 17; repeated google.protobuf.Any anys = 18;
  google.protobuf.NullValue nv = 19; repeated google.protobuf.Timestamp tss = 20;
}
message Top { Scalars sc = 1; Rep rep = 2; Maps maps = 3; Oneofs oo = 4; Wkt wkt = 5; Top child = 6; }
`,
  't2.proto': `syntax = "proto2";
package t2;
enum E2 { A = 1; B = 2; }
message P2 {
  optional int32 a = 1 [default = 7];
  required string r = 2;
  repeated int32 rp = 3;
  repeated int32 pk = 4 [packed = true];
  optional group Grp = 5 { optional int32 x = 6; optional string y = 7; }
  optional E2 e = 8;
  repeated E2 es = 9;
  optional bytes bt = 10;
  optional string st = 11;
  repeated group Rg = 12 { optional int64 z = 13; }
  map<string, int32> me = 14;
  extensions 100 to 199;
}
extend P2 { optional int32 ext_i = 100; repeated string ext_s = 101; }
`,
  'ted.proto': `edition = "2023";
package ted;
enum Closed { option features.enum_type = CLOSED; C0 = 0; C1 = 1; C2 = 2; }
enum Open { O0 = 0; O1 = 1; }
message Ed {
  int32 explicit_i = 1;
  int32 implicit_i = 2 [features.field_presence = IMPLICIT];
  repeated int32 packed_r = 3;
  repeated int32 expanded_r = 4 [features.repeated_field_encoding = EXPANDED];
  Ed child = 5 [features.message_encoding = DELIMITED];
  Closed c = 6;
  Open o = 7;
  string s = 8;
  repeated Ed kids = 9 [features.message_encoding = DELIMITED];
}
`,
};
const ORACLE_TYPES = [['t3.Top', 't3.proto'], ['t3.Scalars', 't3.proto'], ['t3.Wkt', 't3.proto'], ['t3.Maps', 't3.proto'], ['t3.Oneofs', 't3.proto'], ['t2.P2', 't2.proto'], ['ted.Ed', 'ted.proto']];
const OC = schema(Object.keys(ORACLE_FILES).map((name) => ({ name, text: ORACLE_FILES[name] })));
const VARIANTS = [{}, { protoNames: true, defaults: true }, { enumNumbers: true }];

function genTextMessages() {
  // Random values as protobuf text format, from protobuf.js reflection only.
  seed = 4242;
  const isWkt = (t) => t.fullName.startsWith('.google.protobuf.');
  function q(bytes) {
    let s = '"';
    for (const b of bytes) {
      if (b === 0x22) s += '\\"'; else if (b === 0x5c) s += '\\\\';
      else if (b < 0x20 || b >= 0x7f) s += '\\' + b.toString(8).padStart(3, '0');
      else s += String.fromCharCode(b);
    }
    return s + '"';
  }
  function fmtFloat(v, single) {
    if (Number.isNaN(v)) return 'nan';
    if (v === Infinity) return 'inf';
    if (v === -Infinity) return '-inf';
    if (Object.is(v, -0)) return '-0';
    if (single) { for (let p = 1; p <= 9; p++) { const x = Number(v.toPrecision(p)); if (Math.fround(x) === v) return String(x); } }
    return String(v);
  }
  function scalar(type) {
    const r = rnd();
    switch (type) {
      case 'double': return fmtFloat(r < 0.05 ? NaN : r < 0.1 ? -Infinity : r < 0.15 ? -0 : r < 0.2 ? 0 : (rnd() - 0.5) * 10 ** ri(30) / 7, false);
      case 'float': return fmtFloat(r < 0.05 ? Infinity : r < 0.1 ? 0 : Math.fround((rnd() - 0.5) * 10 ** ri(12) / 3), true);
      case 'int32': case 'sint32': case 'sfixed32': return String(r < 0.2 ? 0 : ri(2 ** 31) * (rnd() < 0.5 ? -1 : 1));
      case 'uint32': case 'fixed32': return String(r < 0.2 ? 0 : ri(2 ** 32));
      case 'int64': case 'sint64': case 'sfixed64': return String(r < 0.2 ? 0n : rBig(true));
      case 'uint64': case 'fixed64': return String(r < 0.2 ? 0n : rBig(false));
      case 'bool': return r < 0.5 ? 'true' : 'false';
      case 'string': return q(Buffer.from(r < 0.2 ? '' : rStr()));
      case 'bytes': return q(r < 0.2 ? [] : Array.from({ length: ri(6) }, () => ri(256)));
    }
    throw new Error(type);
  }
  function enumVal(en, closed) {
    const names = Object.keys(en.values);
    // google.protobuf.NullValue prints as null; Python prints numbers for it with
    // use_integers_for_enums, Go and C++ print null, so only NULL_VALUE is generated.
    if (!closed && rnd() < 0.15 && en.name !== 'NullValue') return String(5 + ri(50));
    return names[ri(names.length)];
  }
  function wkt(t, depth) {
    const n = t.name;
    if (n === 'Timestamp') return `{ seconds: ${-62135596800 + ri(2 ** 30) * 300} nanos: ${[0, 250000000, 1000, 123456789][ri(4)]} }`;
    if (n === 'Duration') { const s = ri(100000), ns = [0, 500000000, 7][ri(3)]; return rnd() < 0.5 ? `{ seconds: ${s} nanos: ${ns} }` : `{ seconds: -${s} nanos: -${ns} }`; }
    if (n === 'FieldMask') return '{ ' + ['user.display_name', 'etag', 'items', 'a1.b_c'].slice(0, ri(4)).map((p) => `paths: "${p}"`).join(' ') + ' }';
    if (n === 'Value') return '{ ' + valueText(depth) + ' }';
    if (n === 'ListValue') return '{ ' + Array.from({ length: ri(3) }, () => 'values { ' + valueText(depth) + ' }').join(' ') + ' }';
    if (n === 'Struct') return structText(depth);
    if (n === 'Empty') return '{ }';
    if (n === 'Any') {
      const pick = ri(3);
      if (pick === 0) return '{ }';
      if (pick === 1) return `{ [type.googleapis.com/t3.Scalars] ${msg(OC.root.lookupType('t3.Scalars'), depth + 1)} }`;
      return `{ [type.googleapis.com/google.protobuf.Duration] { seconds: ${ri(99)} } }`;
    }
    const map = { Int64Value: 'int64', UInt64Value: 'uint64', Int32Value: 'int32', UInt32Value: 'uint32', BoolValue: 'bool', StringValue: 'string', BytesValue: 'bytes', FloatValue: 'float', DoubleValue: 'double' };
    let v = scalar(map[n]);
    if (/^(nan|-?inf)$/.test(v)) v = '1.5';
    return `{ value: ${v} }`;
  }
  function valueText(depth) {
    const k = depth > 2 ? ri(4) : ri(6);
    if (k === 0) return 'null_value: NULL_VALUE';
    if (k === 1) return `number_value: ${fmtFloat((rnd() - 0.5) * 1000, false)}`;
    if (k === 2) return `string_value: ${q(Buffer.from(rStr()))}`;
    if (k === 3) return `bool_value: ${rnd() < 0.5}`;
    if (k === 4) return 'struct_value ' + structText(depth + 1);
    return 'list_value { ' + Array.from({ length: ri(3) }, () => 'values { ' + valueText(depth + 1) + ' }').join(' ') + ' }';
  }
  function structText(depth) {
    return '{ ' + Array.from({ length: ri(3) }, (_, i) => `fields { key: ${q(Buffer.from('k' + i + rStr()))} value { ${valueText(depth + 1)} } }`).join(' ') + ' }';
  }
  function fieldValue(f, depth) {
    const rt = f.resolvedType;
    if (rt instanceof pb.Type) return isWkt(rt) ? wkt(rt, depth) : msg(rt, depth + 1);
    if (rt instanceof pb.Enum) return enumVal(rt, rt.fullName.startsWith('.t2.') || rt.name === 'Closed');
    return scalar(f.type);
  }
  function msg(type, depth) {
    const parts = [];
    const oneofsDone = new Set();
    for (const f of type.fieldsArray) {
      if (f.declaringField) continue;
      const required = f.rule === 'required';
      if (!required && rnd() < 0.45) continue;
      if (f.partOf && !f.partOf.isProto3Optional) { if (oneofsDone.has(f.partOf)) continue; oneofsDone.add(f.partOf); }
      const rt = f.resolvedType;
      if (rt instanceof pb.Type && !isWkt(rt) && depth > 2) continue;
      const name = rt instanceof pb.Type && rt.group ? rt.name : f.name;
      if (f.map) {
        const used = new Set();
        for (let i = ri(3); i > 0; i--) {
          let k = scalar(f.keyType);
          if (used.has(k)) continue;
          used.add(k);
          parts.push(`${name} { key: ${k} value: ${fieldValue(f, depth)} }`);
        }
        continue;
      }
      const count = f.repeated ? ri(4) : 1;
      for (let i = 0; i < count; i++) {
        const v = fieldValue(f, depth);
        parts.push(v.startsWith('{') ? `${name} ${v}` : `${name}: ${v}`);
      }
    }
    if (type.fullName === '.t2.P2') {
      if (rnd() < 0.5) parts.push(`[t2.ext_i]: ${ri(1000) - 500}`);
      for (let i = ri(3); i > 0; i--) parts.push(`[t2.ext_s]: ${q(Buffer.from(rStr()))}`);
    }
    return '{ ' + parts.join(' ') + ' }';
  }
  const out = [];
  for (let n = 0; n < 140; n++) {
    const [type, file] = ORACLE_TYPES[n % ORACLE_TYPES.length];
    const text = msg(OC.root.lookupType(type), 0);
    out.push({ type, file, text: text.slice(1, -1).trim() });
  }
  return out;
}

const PY = `
import sys, json, base64
from google.protobuf import descriptor_pb2, descriptor_pool, json_format, message_factory
fds = descriptor_pb2.FileDescriptorSet(); fds.ParseFromString(open(sys.argv[1], 'rb').read())
pool = descriptor_pool.DescriptorPool()
for f in fds.file: pool.Add(f)
out = []
for line in sys.stdin:
    c = json.loads(line)
    cls = message_factory.GetMessageClass(pool.FindMessageTypeByName(c['type']))
    m = cls(); m.ParseFromString(bytes.fromhex(c['hex']))
    r = {'json': [], 'canonical': None}
    try:
        r['json'].append(json_format.MessageToJson(m, indent=None, descriptor_pool=pool))
        r['json'].append(json_format.MessageToJson(m, indent=None, descriptor_pool=pool, preserving_proto_field_name=True, always_print_fields_with_no_presence=True))
        r['json'].append(json_format.MessageToJson(m, indent=None, descriptor_pool=pool, use_integers_for_enums=True))
        m2 = cls(); json_format.Parse(r['json'][0], m2, descriptor_pool=pool)
        r['canonical'] = m2.SerializeToString(deterministic=True).hex()
    except Exception as e:
        r = {'error': type(e).__name__ + ': ' + str(e)}
    out.append(r)
print(json.dumps(out))
`;

function regenerate() {
  const dir = mkdtempSync(join(tmpdir(), 'pbj-'));
  try {
    for (const [name, text] of Object.entries(ORACLE_FILES)) writeFileSync(join(dir, name), text);
    const protocVersion = execFileSync('protoc', ['--version']).toString().trim();
    execFileSync('protoc', ['-I', dir, '--include_imports', '--descriptor_set_out=' + join(dir, 'all.desc'), ...Object.keys(ORACLE_FILES)], { cwd: dir });
    const typed = genTextMessages().map((c) => {
      const res = spawnSync('protoc', ['-I', dir, '--encode=' + c.type, c.file], { cwd: dir, input: c.text });
      if (res.status !== 0) throw new Error('protoc --encode failed for ' + c.text + '\n' + res.stderr);
      return { type: c.type, text: c.text, hex: res.stdout.toString('hex') };
    });
    const python = process.env.PB_PYTHON || 'python3';
    const pyVersion = execFileSync(python, ['-c', 'import google.protobuf as g; print(g.__version__)']).toString().trim();
    const py = spawnSync(python, ['-c', PY, join(dir, 'all.desc')], { input: typed.map((c) => JSON.stringify({ type: c.type, hex: c.hex })).join('\n') });
    if (py.status !== 0) throw new Error('python failed: ' + py.stderr);
    JSON.parse(py.stdout.toString()).forEach((r, i) => Object.assign(typed[i], r));
    seed = 777;
    const garbage = [];
    const TAGS = [8, 10, 18, 26, 0x0b, 0x0c, 0x0d, 0x15, 0x19, 0x22, 2, 1, 0x7f, 0x80];
    for (let i = 0; i < 120; i++) {
      const arr = Array.from({ length: 1 + ri(24) }, () => (rnd() < 0.5 ? TAGS[ri(TAGS.length)] : ri(256)));
      garbage.push(Buffer.from(arr).toString('hex'));
    }
    const rawCases = typed.map((c) => c.hex).concat(garbage).map((hex) => {
      const res = spawnSync('protoc', ['--decode_raw'], { input: Buffer.from(hex, 'hex') });
      return { hex, ok: res.status === 0, text: res.status === 0 ? res.stdout.toString('latin1') : res.stderr.toString().trim() };
    });
    writeFileSync(FIXTURES, JSON.stringify({ protoc: protocVersion, python_protobuf: pyVersion, typed, raw: rawCases }, null, 1) + '\n');
    console.log('wrote ' + FIXTURES + ' (' + typed.length + ' typed, ' + rawCases.length + ' raw)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
if (REGENERATE) regenerate();

let fixtures = null;
try { fixtures = JSON.parse(readFileSync(FIXTURES, 'utf8')); } catch { fixtures = null; }
if (!fixtures) {
  check('fixtures file exists', false, 'run with --regenerate');
} else {
  let typedOk = 0, typedErr = 0, encOk = 0, encTotal = 0, encReordered = 0, rawOk = 0, rawFail = 0;
  for (const c of fixtures.typed) {
    const bytes = u8([...Buffer.from(c.hex, 'hex')]);
    if (c.error) {
      let threw = false;
      try { E.msgJson(OC, E.decodeTyped(OC, c.type, bytes), {}, '', 0); } catch (e) { threw = !!e.pbCode; }
      if (threw) typedErr++;
      else check('Python rejects, engine must too: ' + c.type + ' ' + c.text.slice(0, 120), false, c.error);
      continue;
    }
    let good = true;
    VARIANTS.forEach((opts, vi) => {
      let mine;
      try { mine = E.stringifyJson(E.msgJson(OC, E.decodeTyped(OC, c.type, bytes), opts, '', 0), 0, false); }
      catch (e) { good = false; check('decode ' + c.type + ' variant ' + vi, false, (e.pbCode || e.message) + ' ' + JSON.stringify(e.pbArgs) + ' text: ' + c.text.slice(0, 160)); return; }
      if (!jsonEqual(JSON.parse(mine), JSON.parse(c.json[vi]))) {
        good = false;
        check('ProtoJSON matches Python for ' + c.type + ' variant ' + vi, false, '\n  mine:   ' + mine + '\n  python: ' + c.json[vi]);
      }
    });
    if (good) typedOk++;
    encTotal++;
    try {
      const mineHex = Buffer.from(E.encodeToBytes(OC, E.fromJsonText(OC, c.type, c.json[0], {}))).toString('hex');
      // Python's upb serializer with deterministic=True writes map entries and extensions in
      // descending order; protoc's C++ serializer and the engine write them ascending. When the
      // bytes differ, they must have the same length and byte multiset and decode to the same JSON.
      const sameish = () => {
        if (mineHex.length !== c.canonical.length) return false;
        const sortHex = (h) => (h.match(/../g) || []).sort().join('');
        if (sortHex(mineHex) !== sortHex(c.canonical)) return false;
        const a = decodeJson(OC, c.type, [...Buffer.from(mineHex, 'hex')], { defaults: true });
        const b = decodeJson(OC, c.type, [...Buffer.from(c.canonical, 'hex')], { defaults: true });
        return jsonEqual(JSON.parse(a), JSON.parse(b));
      };
      if (mineHex === c.canonical) encOk++;
      else if (sameish()) { encOk++; encReordered++; }
      else check('encode of Python JSON matches deterministic bytes for ' + c.type, false, '\n  mine:   ' + mineHex + '\n  python: ' + c.canonical + '\n  json: ' + c.json[0]);
    } catch (e) { check('encode of Python JSON ' + c.type, false, (e.pbCode || e.message) + ' ' + JSON.stringify(e.pbArgs) + ' json: ' + c.json[0]); }
  }
  eq(`ProtoJSON equals Python json_format ${fixtures.python_protobuf} in 3 option sets (${fixtures.typed.length - typedErr} messages)`, typedOk, fixtures.typed.length - typedErr);
  eq(`engine encodes Python JSON to SerializeToString(deterministic=True) bytes (${encReordered} differ only in map/extension order)`, encOk, encTotal);
  check('most encodings are byte-identical', encReordered < encTotal / 2, encReordered + ' of ' + encTotal);
  check('fixtures cover messages Python rejects', typedErr > 0 || fixtures.typed.every((c) => !c.error));
  for (const c of fixtures.raw) {
    const bytes = u8([...Buffer.from(c.hex, 'hex')]);
    let mine;
    try { mine = E.rawText(E.parseRaw(bytes, 0, bytes.length, 0, null)); } catch (e) { mine = null; }
    if (c.ok) {
      const want = Buffer.from(c.text, 'latin1').toString('latin1');
      if (mine === want) rawOk++;
      else check('raw text equals ' + fixtures.protoc + ' --decode_raw for ' + c.hex, false, '\n  mine:\n' + mine + '\n  protoc:\n' + want);
    } else if (mine === null) rawFail++;
    else check('protoc rejects ' + c.hex + ', engine must too', false, mine);
  }
  eq(`raw view equals protoc --decode_raw (${fixtures.raw.length} inputs, ${rawFail} rejected by both)`, rawOk + rawFail, fixtures.raw.length);
}

// Floats: the engine prints the shortest decimal that rounds to the same float32 and rounds
// ties away from zero (toPrecision); Python formats with '%.Ng', which rounds ties to even, so
// -1196269.25f prints as -1196269.3 here and -1196269.2 there. Both read back to the same float.
function jsonEqual(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b) || a === b || (isFinite(a) && Math.fround(a) === Math.fround(b) && Math.abs(a - b) <= Math.abs(a) * 1e-7);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && jsonEqual(a[k], b[k]));
}

// ---------- 4-language strings ----------
const fm = source.slice(0, source.indexOf('\n---', 4));
const stringsSrc = fm.slice(fm.indexOf('const STRINGS = '), fm.indexOf('const L = STRINGS[lang];'));
const STRINGS = vm.runInNewContext('(' + stringsSrc.replace('const STRINGS = ', '').replace(/;\s*$/, '') + ')');
function flat(o, p, out) { for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object') flat(v, p + k + '.', out); else out[p + k] = String(v); } return out; }
const flatEn = flat(STRINGS.en, '', {});
for (const lang of ['zh', 'ja', 'ko']) {
  const f = flat(STRINGS[lang], '', {});
  eq(lang + ' has the same string keys as en', Object.keys(f).sort(), Object.keys(flatEn).sort());
  for (const k of Object.keys(flatEn)) {
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
    if (f[k] !== undefined && ph(f[k]) !== ph(flatEn[k])) check(lang + ' placeholders of ' + k, false, ph(f[k]) + ' vs ' + ph(flatEn[k]));
  }
}
const engineCodes = new Set([...block.matchAll(/pbErr\('(\w+)'/g), ...block.matchAll(/jErr\(ctx, '(\w+)'/g)].map((m) => m[1]));
const noteCodes = new Set([...block.matchAll(/code: '(\w+)'/g)].map((m) => m[1]));
for (const c of engineCodes) check('error code ' + c + ' has a message', STRINGS.en.err[c] !== undefined || c === 'tooDeep' && STRINGS.en.err.tooDeep);
for (const c of noteCodes) check('note code ' + c + ' has a message', STRINGS.en.note[c] !== undefined || STRINGS.en.err[c] !== undefined);

// ---------- the page stores and sends nothing ----------
const script = source.slice(source.indexOf('<script is:inline define:vars'));
check('component does not touch storage directly', !/localStorage|sessionStorage|document\.cookie/.test(script));
check('component sends no requests', !/\bfetch\(|XMLHttpRequest|sendBeacon/.test(script));
check('only options are persisted', /window\.ztPersist\.save\(SLUG, prefs\)/.test(script));

// ---------- tool page examples ----------
// Blocks marked {/* pbj-check: {...} */} in the mdx are recomputed: the code block that follows
// the marker must equal the engine output for the given schema, input and options.
const EXAMPLE_SCHEMA = source.match(/const EXAMPLE_SCHEMA = `([\s\S]*?)`;/)[1];
const EXAMPLE_BYTES = source.match(/const EXAMPLE_BYTES = '([^']+)';/)[1];
let mdxChecks = 0;
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  let mdx;
  try { mdx = readFileSync(join(root, 'src/content/tools/protobuf-to-json/' + lang + '.mdx'), 'utf8'); } catch { continue; }
  const re = /\{\/\* pbj-check: (\{[\s\S]*?\}) \*\/\}\s*```[a-z]*\n([\s\S]*?)\n```/g;
  let m;
  while ((m = re.exec(mdx))) {
    mdxChecks++;
    const spec = JSON.parse(m[1]);
    const want = m[2];
    let got;
    try {
      const sch = spec.schema === 'example' ? EXAMPLE_SCHEMA : spec.schema;
      const c = sch ? schema([{ name: 'main.proto', text: sch }].concat(spec.files || [])) : null;
      const input = spec.input === 'example' ? EXAMPLE_BYTES : spec.input;
      if (spec.mode === 'encode') {
        let b = E.encodeToBytes(c, E.fromJsonText(c, spec.type, spec.json, spec.opts || {}));
        if (spec.frame) b = E.frameBytes(b);
        got = E.formatBytes(b, spec.out || 'hex');
      } else if (spec.mode === 'sample') {
        got = E.stringifyJson(E.sampleFor(c, spec.type, spec.opts || {}), 2, false);
      } else {
        let bytes = E.readBytes(input, spec.fmt || 'auto').bytes;
        const fr = E.unframe(bytes, spec.grpc || 'auto');
        if (fr) bytes = fr[0].payload;
        if (spec.raw) {
          const fields = E.parseRaw(bytes, 0, bytes.length, 0, null);
          got = spec.raw === 'protoc' ? E.rawText(fields).replace(/\n$/, '') : E.stringifyJson(E.rawJson(fields), 2, false);
        } else got = E.stringifyJson(E.msgJson(c, E.decodeTyped(c, spec.type, bytes), spec.opts || {}, '', 0), 2, false);
      }
    } catch (e) {
      got = 'ERROR ' + (e.pbCode || e.message);
      if (spec.error) { check(lang + ' example error ' + spec.error, e.pbCode === spec.error, got); continue; }
    }
    check(lang + '.mdx example #' + mdxChecks + ' matches the engine', got === want, '\n  engine:\n' + got + '\n  page:\n' + want);
  }
}
check('tool pages carry checked examples', mdxChecks >= 8, mdxChecks + ' found');

console.log(passes + ' passed, ' + failures + ' failed' + (skips ? ', ' + skips + ' skipped' : ''));
process.exit(failures ? 1 : 0);
