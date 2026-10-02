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
// the example token and the examples on the English page; the English guide
// (src/content/blog/jwt-decoder-guide/en.mdx): the demo token is rebuilt from its claims and
// secret, the decoded JSON, dates, lengths and the signature-length table are recomputed, the
// RFC 7515 A.1 and RFC 7519 6.1 tokens decode as the guide says, and code blocks marked
// {/* jwt-run: {"lang":"node|python","expect":"…"} */} are run (Python needs PyJWT; SKIP otherwise).
//
// Run: node scripts/test-jwt-decoder.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHmac, generateKeyPairSync, sign as cryptoSign, constants } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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
let skips = 0;
function skip(name, why) { skips++; console.log('SKIP: ' + name + ' (' + why + ')'); }
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

// guide
{
  const guide = readFileSync(join(root, 'src/content/blog/jwt-decoder-guide/en.mdx'), 'utf8');
  const has = (name, text) => eq('guide: ' + name, guide.includes(text), true);
  const iat = Date.UTC(2026, 9, 1, 9, 0, 0) / 1000;
  const claims = { iss: 'https://auth.example.com', sub: 'user-4821', aud: 'orders-api', iat, exp: iat + 900, scope: 'orders:read' };
  const hSeg = seg({ alg: 'HS256', typ: 'JWT' });
  const pSeg = seg(claims);
  const sig = createHmac('sha256', 'demo-secret-from-zerotool-guide-do-not-reuse').update(hSeg + '.' + pSeg).digest('base64url');
  const demo = hSeg + '.' + pSeg + '.' + sig;
  const shown = /jwt-check: demo-token \*\/\}\n```text\n([^\n]+)\n/.exec(guide);
  eq('guide demo token', shown && shown[1], demo);
  has('token length', 'It is ' + demo.length + ' characters long');
  const lens = demo.split('.').map((x) => x.length);
  has('part lengths', lens[0] + ' characters of header, ' + lens[1] + ' of payload and ' + lens[2] + ' of signature');
  const [dh, dp] = decode(demo);
  has('decoded header', JSON.stringify(dh, null, 2));
  has('decoded payload', JSON.stringify(dp, null, 2));
  has('iat date', new Date(dp.iat * 1000).toUTCString());
  has('exp date', new Date(dp.exp * 1000).toUTCString());
  has('raw signature', '`' + sig + '`');
  eq('eyJ prefix of {"a', Buffer.from('{"a').toString('base64url').slice(0, 3), 'eyJ');
  eq('demo segments start with eyJ', hSeg.startsWith('eyJ') && pSeg.startsWith('eyJ'), true);

  // RFC 7515 A.1 / RFC 7519 3.1 example
  const rfc = 'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const [rh, rp] = decode(rfc);
  has('RFC header compact', '`' + JSON.stringify(rh) + '`');
  has('RFC payload compact', '`' + JSON.stringify(rp) + '`');
  has('RFC exp', new Date(rp.exp * 1000).toUTCString() + ' — EXPIRED');
  eq('RFC header has CRLF', E.b64urlDecode(rfc.split('.')[0]).includes('\r\n'), true);
  has('CRLF fragment', 'LA0KICJ');

  // RFC 7519 6.1 unsecured JWT
  const none = /jwt-check: unsecured \*\/\}\n```text\n([^\n]+)\n/.exec(guide)[1];
  const [nh, np] = decode(none);
  eq('unsecured header', JSON.stringify(nh), '{"alg":"none"}');
  eq('unsecured claims equal the RFC example', JSON.stringify(np), JSON.stringify(rp));
  eq('unsecured signature empty', none.split('.')[2], '');
  eq('decoder auto-decodes a token with an empty signature', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(none) && source.includes(String.raw`var JWT_REGEX = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;`), true);
  eq('JWE error string', source.includes("errInvalid: 'Invalid JWT: expected 3 dot-separated parts, got '") && source.includes("t.errInvalid + parts.length + '.'"), true);
  has('JWE message', 'Invalid JWT: expected 3 dot-separated parts, got 5.');

  // signature lengths
  const input = Buffer.from('a.b');
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ed = generateKeyPairSync('ed25519');
  const sigs = {
    HS256: createHmac('sha256', 'k').update(input).digest(),
    RS256: cryptoSign('sha256', input, rsa.privateKey),
    PS256: cryptoSign('sha256', input, { key: rsa.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING }),
    ES256: cryptoSign('sha256', input, { key: ec.privateKey, dsaEncoding: 'ieee-p1363' }),
    EdDSA: cryptoSign(null, input, ed.privateKey),
  };
  const row = (label, s) => '| ' + label + ' | ' + s.length + ' | ' + s.toString('base64url').length + ' |';
  has('HS256 row', row('HS256', sigs.HS256));
  eq('PS256 same length as RS256', sigs.PS256.length, sigs.RS256.length);
  has('RS256 row', row('RS256, PS256 (2048-bit key)', sigs.RS256));
  has('ES256 row', row('ES256', sigs.ES256));
  has('EdDSA row', row('EdDSA (Ed25519)', sigs.EdDSA));
  const der = cryptoSign('sha256', input, ec.privateKey).length;
  eq('DER ES256 signature is 70-72 bytes', der >= 70 && der <= 72, true);

  // code blocks
  let pyjwt = false;
  // The guide's expected output was recorded with PyJWT 2.10.1; error texts differ between releases.
  try { pyjwt = execFileSync('python3', ['-c', 'import jwt;print(jwt.__version__)'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() === '2.10.1'; } catch {}
  const re = /\{\/\* jwt-run: (\{.*?\}) \*\/\}\s*```[a-z]*\n([\s\S]*?)```/g;
  let m; let runs = 0;
  while ((m = re.exec(guide))) {
    runs++;
    const spec = JSON.parse(m[1]);
    const name = 'guide ' + spec.lang + ' block ' + runs;
    if (spec.lang === 'python' && !pyjwt) { skip(name, 'python3 with PyJWT 2.10.1 not installed'); continue; }
    const dir = mkdtempSync(join(tmpdir(), 'jwt-run-'));
    try {
      const file = join(dir, spec.lang === 'node' ? 'main.mjs' : 'main.py');
      writeFileSync(file, m[2]);
      const out = execFileSync(spec.lang === 'node' ? process.execPath : 'python3', [file]).toString().trim();
      eq(name, out, spec.expect);
    } catch (e) {
      eq(name, String(e.stderr || e.message).slice(0, 300), spec.expect);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  eq('guide has 3 runnable blocks', runs, 3);
}

console.log(passes + ' passed, ' + failures + ' failed' + (skips ? ', ' + skips + ' skipped' : ''));
process.exit(failures ? 1 : 0);
