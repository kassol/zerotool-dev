// JWT Decoder — Base64URL decoding to UTF-8 and escaped highlighting
//
// Read:  src/components/tools/JwtDecoderTool.astro (the engine block between the
//        `engine:start` / `engine:end` markers)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: header and payload segments decode as UTF-8 (atob alone gave one character per
// byte, so "José" showed as "JosÃ©"); missing padding; invalid characters return null;
// syntaxHighlight escapes < > & before it adds spans, because the result is written with
// innerHTML (a claim such as "<img src=x onerror=...>" used to become a real element);
// the example token and the examples on the English page.
//
// Run: node scripts/test-jwt-decoder.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JwtDecoderTool.astro'), 'utf8');
const startIndex = source.indexOf('/* ── engine:start ── */');
const endIndex = source.indexOf('/* ── engine:end ── */');
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JwtDecoderTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { b64urlDecode, parseJSON, syntaxHighlight };')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual));
}
const seg = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const decode = (token) => token.split('.').slice(0, 2).map((p) => E.parseJSON(E.b64urlDecode(p)));

// example token in the component
const example = /var EXAMPLE_JWT = '([^']+)'/.exec(source)[1];
const [h, p] = decode(example);
eq('example header', JSON.stringify(h), '{"alg":"HS256","typ":"JWT"}');
eq('example payload', JSON.stringify(p), '{"sub":"1234567890","name":"John Doe","iat":1516239022,"exp":1893456000}');
eq('example exp date', new Date(p.exp * 1000).toUTCString(), 'Tue, 01 Jan 2030 00:00:00 GMT');

// UTF-8
eq('UTF-8 claim', E.b64urlDecode(seg({ name: 'José', city: '東京' })), '{"name":"José","city":"東京"}');
eq('UTF-8 segment from the page', E.b64urlDecode('eyJuYW1lIjoiSm9zw6kiLCJyb2xlcyI6WyJhZG1pbiJdfQ'), '{"name":"José","roles":["admin"]}');
eq('padding restored', E.b64urlDecode('eyJhIjoxfQ'), '{"a":1}');
eq('standard alphabet also accepted', E.b64urlDecode('-_8'), E.b64urlDecode('+/8'));
eq('invalid character', E.b64urlDecode('ab$c'), null);
eq('not JSON', E.parseJSON('abc'), null);

// escaping
const xss = E.syntaxHighlight({ name: '<img src=x onerror=alert(1)>', note: 'a & b' });
eq('no raw tag in output', /<img/.test(xss), false);
eq('escaped tag', xss.includes('&lt;img src=x onerror=alert(1)&gt;'), true);
eq('escaped ampersand', xss.includes('a &amp; b'), true);
eq('highlight spans kept', E.syntaxHighlight({ a: 1, b: true, c: null, d: 'x' }),
  '{\n  <span class="jv-key">"a":</span> <span class="jv-num">1</span>,\n  <span class="jv-key">"b":</span> <span class="jv-bool">true</span>,\n  <span class="jv-key">"c":</span> <span class="jv-null">null</span>,\n  <span class="jv-key">"d":</span> <span class="jv-str">"x"</span>\n}');

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
