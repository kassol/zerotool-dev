// Protobuf to JSON — 64-bit integers decode at full precision as decimal strings
//
// Read:  src/components/tools/ProtobufToJsonTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers and the order of its vendor
//        <script> tags), public/vendor/protobuf.min.js, public/vendor/long.min.js,
//        node_modules/long/package.json
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// The vendor scripts and the engine run in one vm context that looks like a browser page
// (`window` is the global object, no `require`), so protobuf.js cannot find long.js through
// Node and uses only what the page loads. Same realm matters: toObject compares
// `options.longs === String` by identity.
//
// Covers: int64 / uint64 / sint64 / fixed64 / sfixed64 above 2^53 and at their limits print
// the exact decimal string (proto3 JSON mapping, protobuf.dev/programming-guides/json:
// "JSON value will be a decimal string"; before the fix 9007199254740993 printed as
// "9007199254740992"), packed and unpacked repeated int64, map<string, int64>, int32 stays
// a JSON number, sample mode gives "0", the page example, hex and Base64 input, and that
// the component loads long.min.js before protobuf.min.js. Wire bytes are built by an
// independent BigInt encoder in this file.
//
// Run: node scripts/test-protobuf-to-json.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/ProtobufToJsonTool.astro'), 'utf8');

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

// ---------- the page loads long.js before protobuf.js ----------
const scriptSrcs = [...source.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
eq('component loads long.min.js then protobuf.min.js', scriptSrcs,
  ['/vendor/long.min.js', '/vendor/protobuf.min.js']);

let longSrc = '';
try { longSrc = readFileSync(join(root, 'public/vendor/long.min.js'), 'utf8'); } catch {}
check('public/vendor/long.min.js exists', longSrc.length > 0);
const longVersion = JSON.parse(readFileSync(join(root, 'node_modules/long/package.json'), 'utf8')).version;
check('vendor long.min.js header names the long version protobufjs depends on',
  longSrc.includes('long.js v' + longVersion), 'node_modules/long is ' + longVersion);

// ---------- browser-like context ----------
const ctx = { atob };
ctx.window = ctx;
ctx.self = ctx;
vm.createContext(ctx);
for (const src of scriptSrcs) {
  vm.runInContext(readFileSync(join(root, 'public', src), 'utf8'), ctx, { filename: src });
}
vm.runInContext(block + '\nthis.__engine = { parseBinaryText, decodeMessage, sampleMessage };', ctx);
const pb = ctx.protobuf;
const E = ctx.__engine;
check('protobuf.util.Long is the Long class from the page', pb && pb.util.Long && pb.util.Long === ctx.Long);

// ---------- independent wire encoder ----------
const U64 = (1n << 64n) - 1n;
function varint(v) {
  let n = BigInt.asUintN(64, BigInt(v));
  const out = [];
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
}
const zigzag = (v) => BigInt.asUintN(64, (BigInt(v) << 1n) ^ (BigInt(v) >> 63n));
function fixed64(v) {
  let n = BigInt.asUintN(64, BigInt(v));
  const out = [];
  for (let i = 0; i < 8; i++) { out.push(Number(n & 0xffn)); n >>= 8n; }
  return out;
}
const key = (field, wire) => varint((field << 3) | wire);
const lenDelim = (field, bytes) => [...key(field, 2), ...varint(bytes.length), ...bytes];
const toHex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');

const SCHEMA = `syntax = "proto3";
package t;
message Big {
  int64 i64 = 1;
  uint64 u64 = 2;
  sint64 s64 = 3;
  fixed64 f64 = 4;
  sfixed64 sf64 = 5;
  int32 i32 = 6;
  repeated int64 packed = 7;
  repeated int64 unpacked = 8 [packed = false];
  map<string, int64> m = 9;
}`;
const rootNs = pb.parse(SCHEMA, { keepCase: true }).root;
const Big = rootNs.lookupType('t.Big');
function decodeFields(bytes) {
  return E.decodeMessage(Big, E.parseBinaryText(toHex(bytes)));
}

const P53 = 2n ** 53n;
const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;

// ---------- the reported defect ----------
eq('int64 2^53 + 1', decodeFields([...key(1, 0), ...varint(P53 + 1n)]), { i64: '9007199254740993' });
eq('uint64 2^53 + 1', decodeFields([...key(2, 0), ...varint(P53 + 1n)]), { u64: '9007199254740993' });
eq('sint64 -(2^53 + 1)', decodeFields([...key(3, 0), ...varint(zigzag(-(P53 + 1n)))]), { s64: '-9007199254740993' });
eq('fixed64 2^53 + 1', decodeFields([...key(4, 1), ...fixed64(P53 + 1n)]), { f64: '9007199254740993' });
eq('sfixed64 -(2^53 + 1)', decodeFields([...key(5, 1), ...fixed64(-(P53 + 1n))]), { sf64: '-9007199254740993' });

// ---------- limits ----------
eq('int64 max', decodeFields([...key(1, 0), ...varint(I64_MAX)]), { i64: '9223372036854775807' });
eq('int64 min', decodeFields([...key(1, 0), ...varint(I64_MIN)]), { i64: '-9223372036854775808' });
eq('int64 -1 (10-byte varint)', decodeFields([...key(1, 0), ...varint(-1n)]), { i64: '-1' });
eq('uint64 max', decodeFields([...key(2, 0), ...varint(U64)]), { u64: '18446744073709551615' });
eq('uint64 2^63', decodeFields([...key(2, 0), ...varint(2n ** 63n)]), { u64: '9223372036854775808' });
eq('sint64 min', decodeFields([...key(3, 0), ...varint(zigzag(I64_MIN))]), { s64: '-9223372036854775808' });
eq('sint64 max', decodeFields([...key(3, 0), ...varint(zigzag(I64_MAX))]), { s64: '9223372036854775807' });
eq('fixed64 max', decodeFields([...key(4, 1), ...fixed64(U64)]), { f64: '18446744073709551615' });
eq('sfixed64 min', decodeFields([...key(5, 1), ...fixed64(I64_MIN)]), { sf64: '-9223372036854775808' });
eq('small int64 is still a string', decodeFields([...key(1, 0), ...varint(42n)]), { i64: '42' });
eq('int32 stays a JSON number', decodeFields([...key(6, 0), ...varint(-5n)]), { i32: -5 });

// ---------- repeated and map ----------
const packedBody = [...varint(P53 + 1n), ...varint(-1n), ...varint(7n)];
eq('packed repeated int64', decodeFields(lenDelim(7, packedBody)),
  { packed: ['9007199254740993', '-1', '7'] });
eq('unpacked repeated int64', decodeFields([...key(8, 0), ...varint(I64_MAX), ...key(8, 0), ...varint(P53 + 3n)]),
  { unpacked: ['9223372036854775807', '9007199254740995'] });
const entry = [...lenDelim(1, [...Buffer.from('id')]), ...key(2, 0), ...varint(P53 + 1n)];
eq('map<string, int64> value', decodeFields(lenDelim(9, entry)), { m: { id: '9007199254740993' } });

// ---------- JSON text ----------
eq('JSON.stringify keeps the digits',
  JSON.stringify(decodeFields([...key(2, 0), ...varint(U64)])), '{"u64":"18446744073709551615"}');

// ---------- sample mode ----------
const sample = E.sampleMessage(Big);
eq('sample: 64-bit defaults are "0"', [sample.i64, sample.u64, sample.s64, sample.f64, sample.sf64],
  ['0', '0', '0', '0', '0']);
eq('sample: int32 default is 0', sample.i32, 0);

// ---------- input parsing ----------
const bigBytes = [...key(1, 0), ...varint(P53 + 1n)];
eq('Base64 input', E.decodeMessage(Big, E.parseBinaryText(Buffer.from(bigBytes).toString('base64'))),
  { i64: '9007199254740993' });
eq('hex with colons', E.decodeMessage(Big, E.parseBinaryText(toHex(bigBytes).replace(/ /g, ':'))),
  { i64: '9007199254740993' });

// ---------- page example (demo.Person) unchanged ----------
const DEMO = `syntax = "proto3";
package demo;
message Person { string name = 1; int32 age = 2; repeated string emails = 3; Address address = 4; Status status = 5; }
message Address { string street = 1; string city = 2; string country = 3; }
enum Status { UNKNOWN = 0; ACTIVE = 1; INACTIVE = 2; }`;
const Person = pb.parse(DEMO, { keepCase: true }).root.lookupType('demo.Person');
const expectedPerson = {
  name: 'Alice', age: 30, emails: ['alice@example.com'],
  address: { city: 'Austin', country: 'US' }, status: 'ACTIVE',
};
eq('page example hex', E.decodeMessage(Person, E.parseBinaryText(
  '0a 05 41 6c 69 63 65 10 1e 1a 11 61 6c 69 63 65 40 65 78 61 6d 70 6c 65 2e 63 6f 6d 22 0c 12 06 41 75 73 74 69 6e 1a 02 55 53 28 01')),
  expectedPerson);
eq('page example Base64', E.decodeMessage(Person, E.parseBinaryText(
  'CgVBbGljZRAeGhFhbGljZUBleGFtcGxlLmNvbSIMEgZBdXN0aW4aAlVTKAE=')), expectedPerson);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
