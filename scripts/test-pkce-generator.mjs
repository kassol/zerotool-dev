// PKCE Generator — RFC 7636 code_verifier / code_challenge, authorization and token requests
//
// Read:  src/components/tools/PkceGeneratorTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers and the frontmatter STRINGS table, so this
//        test cannot drift from the shipped source); src/data/persistence.ts;
//        src/content/tools/pkce-generator/{lang}.mdx (JavaScript / Python / Go blocks are run)
// Write: stdout only (test results); a temporary directory under the OS temp dir for Go
// Exit:  0 if all PASS, 1 if any FAIL
//
// Sources: RFC 7636 §4.1 (code-verifier = 43*128unreserved, unreserved = ALPHA / DIGIT / "-" /
// "." / "_" / "~"; a 32-octet random sequence base64url-encoded gives 43 characters), §4.2
// (S256 = BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))), §4.3 (code_challenge_method defaults
// to "plain" when omitted), Appendix A (base64url without padding), Appendix B (octets
// [116, 24, …, 121] → dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk →
// E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM); §7.1 (at least 256 bits of entropy);
// RFC 6749 §3.1 (endpoint URI must not include a fragment), §4.1.1 / §4.1.3 and Appendix B
// (application/x-www-form-urlencoded parameters); LINE Developers "LINEログインをPKCE対応する"
// (verifier wJKN8qz5t8SSI9lMFhBB6qwNkQBkuPZoCxzRhwLRUo1 → BSCQwo_m8Wf0fpjmwkIKmPAJ1A7tiuRSNDnXzODS7QI).
//
// Covers:
// - Generation: base64url of the RFC Appendix B octets is the RFC verifier; a 43-character
//   verifier uses exactly 32 random bytes (before the fix: 37 bytes, then truncated); bytes and
//   entropy for every length 43–128; output alphabet and length; 1,000 verifiers are unique.
// - Validation: the RFC verifier is valid without a warning (before the fix: every verifier of
//   43–63 characters got "64+ chars gives stronger entropy", which contradicts RFC 7636 §7.1);
//   every printable ASCII character against the RFC ABNF; length 42 / 129 / empty; the first
//   invalid character is reported with its position (by code point) and a hint for standard
//   Base64 ("+", "/", "="), whitespace and non-ASCII text; surrounding whitespace is ignored.
// - Challenge: S256 for the RFC, LINE and Feishu examples; plain returns the verifier.
// - Diagnosis of a pasted code_challenge: match, "=" padding, standard Base64, hex digest, the
//   verifier itself (plain), SHA-256 over the decoded random bytes, the S256 value while plain is
//   selected, mismatch.
// - Authorization URL: exact string for a worked example; random state (before the fix: the
//   literal OPAQUE_STATE) and nonce only with the openid scope; existing query kept, duplicate
//   PKCE parameters replaced; endpoints that are not http(s) URLs or carry a fragment are errors
//   (before the fix: "example.com/authorize" produced a broken URL silently); empty optional
//   values omitted; redirect_uri round trip; a comma-separated scope with openid (Kakao, WeChat)
//   gets a nonce.
// - Token request cURL: exact string, shell quoting round trip through /bin/sh.
// - No storage, URL or network access in the component script; persistence policy disabled.
// - 4-language STRINGS tables have the same keys and {placeholders}.
// - Examples on the 4 tool pages: the RFC pair, the quoted "+" error message (STRINGS output),
//   the Feishu (zh) and LINE (ja) pairs, every row of the challenge diagnosis table and the en
//   authorization URL are what the engine produces.
// - Code blocks on the 4 tool pages: JavaScript, Python and Go produce the RFC challenge and a
//   valid 43-character verifier (Python / Go are skipped when not installed).
//
// Run: node scripts/test-pkce-generator.mjs

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/PkceGeneratorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in PkceGeneratorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { base64url, bytesForLength, entropyBits, generateVerifier, randomToken, validateVerifier, computeChallenge, diagnoseChallenge, buildAuthUrl, buildCurl, shQuote };')();

const stringsStart = source.indexOf('const STRINGS = {');
const stringsEnd = source.indexOf('\n};', stringsStart);
const STRINGS = stringsStart >= 0 && stringsEnd > stringsStart
  ? new Function(source.slice(stringsStart, stringsEnd + 3) + '\nreturn STRINGS;')()
  : null;

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

const RFC_BYTES = [116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121];
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const LINE_VERIFIER = 'wJKN8qz5t8SSI9lMFhBB6qwNkQBkuPZoCxzRhwLRUo1';
const LINE_CHALLENGE = 'BSCQwo_m8Wf0fpjmwkIKmPAJ1A7tiuRSNDnXzODS7QI';
const FEISHU_VERIFIER = 'TxYmzM4PHLBlqm5NtnCmwxMH8mFlRWl_ipie3O0aVzo';
const FEISHU_CHALLENGE = 'O0nS63zirsJkDT3cMvBt9oV_H48bhFpeAh4EyyILRWE';
const UNRESERVED = /^[A-Za-z0-9\-._~]*$/; // RFC 7636 §4.1 ABNF, written independently of the engine
const B64URL = /^[A-Za-z0-9_-]*$/;

// ── Generation ───────────────────────────────────────────────────────────────
eq('base64url(RFC Appendix B octets)', E.base64url(new Uint8Array(RFC_BYTES)), RFC_VERIFIER);
{
  let asked = -1;
  const fill = (u8) => { asked = u8.length; for (let i = 0; i < u8.length; i++) u8[i] = RFC_BYTES[i]; return u8; };
  eq('43-character verifier from the RFC octets', E.generateVerifier(43, fill), RFC_VERIFIER);
  eq('43-character verifier asks for exactly 32 random bytes (RFC 7636 §4.1 / §7.1)', asked, 32);
}
eq('bytesForLength 43 / 44 / 45 / 64 / 86 / 128', [43, 44, 45, 64, 86, 128].map(E.bytesForLength), [32, 33, 34, 48, 64, 96]);
eq('entropyBits 43 / 44 / 45 / 64 / 128', [43, 44, 45, 64, 128].map(E.entropyBits), [256, 264, 270, 384, 768]);
{
  const cryptoFill = (u8) => globalThis.crypto.getRandomValues(u8);
  let bad = [];
  for (let len = 43; len <= 128; len++) {
    const v = E.generateVerifier(len, cryptoFill);
    if (v.length !== len || !B64URL.test(v) || !UNRESERVED.test(v)) bad.push(len + ':' + v);
    // every kept character carries 6 random bits: the encoder never pads inside the kept prefix
    if (E.entropyBits(len) < 256) bad.push(len + ': entropy ' + E.entropyBits(len));
    if (Math.ceil(E.bytesForLength(len) * 8 / 6) < len) bad.push(len + ': too few bytes');
  }
  eq('verifiers of every length 43–128 have that length, base64url alphabet, ≥ 256 bits', bad, []);
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(E.generateVerifier(43, cryptoFill));
  eq('1,000 generated verifiers are unique', seen.size, 1000);
  const t = E.randomToken(24, cryptoFill);
  check('randomToken(24) is 32 base64url characters', t.length === 32 && B64URL.test(t), t);
  check('randomToken values differ', E.randomToken(24, cryptoFill) !== t);
}

// ── Validation ───────────────────────────────────────────────────────────────
{
  const ok = E.validateVerifier(RFC_VERIFIER);
  eq('RFC verifier is valid with no warning', [ok.code, ok.value, ok.len], ['ok', RFC_VERIFIER, 43]);
  eq('surrounding whitespace is ignored', E.validateVerifier('  ' + RFC_VERIFIER + '\n').code, 'ok');
  eq('empty', E.validateVerifier('   ').code, 'empty');
  const s = E.validateVerifier(RFC_VERIFIER.slice(0, 42));
  eq('42 characters is too short', [s.code, s.len], ['short', 42]);
  const l = E.validateVerifier('a'.repeat(129));
  eq('129 characters is too long', [l.code, l.len], ['long', 129]);
  eq('128 characters is valid', E.validateVerifier('~'.repeat(128)).code, 'ok');
  eq('all 66 unreserved characters are valid', E.validateVerifier('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~').code, 'ok');
  const wrong = [];
  for (let c = 0x21; c <= 0x7e; c++) {
    const ch = String.fromCharCode(c);
    const r = E.validateVerifier('A'.repeat(20) + ch + 'A'.repeat(22));
    const expectOk = UNRESERVED.test(ch);
    if ((r.code === 'ok') !== expectOk) wrong.push(ch);
    if (!expectOk && (r.ch !== ch || r.pos !== 21)) wrong.push(ch + '@' + r.pos);
  }
  eq('printable ASCII accepted exactly per the RFC ABNF, first bad character and position reported', wrong, []);
  const std = E.validateVerifier('dBjftJeZ4CVP+mB92K27uhbUJU1p1r/wW1gFWFOEjXk=');
  eq('standard Base64 verifier: "+" at position 13, hint base64', [std.code, std.ch, std.pos, std.hint], ['char', '+', 13, 'base64']);
  const pad = E.validateVerifier(RFC_VERIFIER + '=');
  eq('trailing "=" padding: position 44, hint base64', [pad.code, pad.ch, pad.pos, pad.hint], ['char', '=', 44, 'base64']);
  const sp = E.validateVerifier(RFC_VERIFIER.slice(0, 20) + ' ' + RFC_VERIFIER.slice(20));
  eq('inner space: hint space', [sp.code, sp.pos, sp.hint], ['char', 21, 'space']);
  const nl = E.validateVerifier(RFC_VERIFIER.slice(0, 30) + '\n' + RFC_VERIFIER.slice(30));
  eq('inner line break: hint space', [nl.code, nl.pos, nl.hint], ['char', 31, 'space']);
  const cjk = E.validateVerifier('😀密' + RFC_VERIFIER);
  eq('non-ASCII: position counted by code point, hint nonascii', [cjk.code, cjk.ch, cjk.pos, cjk.hint], ['char', '😀', 1, 'nonascii']);
}

// ── Challenge ────────────────────────────────────────────────────────────────
eq('S256 of the RFC verifier (Appendix B)', await E.computeChallenge(RFC_VERIFIER, 'S256'), RFC_CHALLENGE);
eq('S256 of the LINE Developers example', await E.computeChallenge(LINE_VERIFIER, 'S256'), LINE_CHALLENGE);
eq('S256 of the Feishu token API example verifier', await E.computeChallenge(FEISHU_VERIFIER, 'S256'), FEISHU_CHALLENGE);
eq('plain returns the verifier', await E.computeChallenge(RFC_VERIFIER, 'plain'), RFC_VERIFIER);

// ── Diagnosis of a pasted challenge ─────────────────────────────────────────
{
  const d = async (given, method = 'S256', v = RFC_VERIFIER) => (await E.diagnoseChallenge(v, given, method)).code;
  eq('exact match', await d(RFC_CHALLENGE), 'match');
  eq('match ignores surrounding whitespace', await d('  ' + RFC_CHALLENGE + '\n'), 'match');
  eq('"=" padding', await d(RFC_CHALLENGE + '='), 'padding');
  eq('standard Base64 with padding', await d('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw+cM='), 'base64');
  eq('standard Base64 without padding', await d('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw+cM'), 'base64');
  eq('hex digest', await d('13d31e961a1ad8ec2f16b10c4c982e0876a878ad6df144566ee1894acb70f9c3'), 'hex');
  eq('hex digest upper case', await d('13D31E961A1AD8EC2F16B10C4C982E0876A878AD6DF144566EE1894ACB70F9C3'), 'hex');
  eq('challenge equals the verifier (plain sent as S256)', await d(RFC_VERIFIER), 'plain');
  eq('SHA-256 over the decoded random bytes', await d('38v3YOi6zQgk1xkqk6Y5dvSDoBHqZrTh3mmWHxxWvyk'), 'rawBytes');
  eq('unrelated value', await d(LINE_CHALLENGE), 'mismatch');
  eq('empty', await d(''), 'empty');
  eq('plain selected, plain challenge', await d(RFC_VERIFIER, 'plain'), 'match');
  eq('plain selected, S256 challenge pasted', await d(RFC_CHALLENGE, 'plain'), 's256');
  eq('plain selected, unrelated value', await d(LINE_CHALLENGE, 'plain'), 'mismatch');
  const r = await E.diagnoseChallenge(RFC_VERIFIER, 'x', 'S256');
  eq('diagnosis returns the expected challenge', r.expected, RFC_CHALLENGE);
}

// ── Authorization URL ────────────────────────────────────────────────────────
{
  const base = {
    endpoint: 'https://auth.example.com/authorize', clientId: 's6BhdRkqt3', redirectUri: 'https://client.example.org/cb',
    scope: 'openid profile', state: 'xyz', nonce: 'n-0S6_WzA2Mj', challenge: RFC_CHALLENGE, method: 'S256',
  };
  eq('worked example (hand-written expected URL)', E.buildAuthUrl(base).url,
    'https://auth.example.com/authorize?response_type=code&client_id=s6BhdRkqt3&redirect_uri=https%3A%2F%2Fclient.example.org%2Fcb&scope=openid+profile&state=xyz&nonce=n-0S6_WzA2Mj&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256');
  const noOidc = new URL(E.buildAuthUrl({ ...base, scope: 'read write' }).url);
  eq('nonce only with the openid scope', noOidc.searchParams.has('nonce'), false);
  eq('comma-separated scope (Kakao, WeChat style) with openid gets a nonce', new URL(E.buildAuthUrl({ ...base, scope: 'openid,profile_nickname' }).url).searchParams.get('nonce'), 'n-0S6_WzA2Mj');
  eq('scope with openid as a substring does not count', new URL(E.buildAuthUrl({ ...base, scope: 'openidx' }).url).searchParams.has('nonce'), false);
  const plain = new URL(E.buildAuthUrl({ ...base, challenge: RFC_VERIFIER, method: 'plain' }).url);
  eq('plain is sent explicitly', plain.searchParams.get('code_challenge_method'), 'plain');
  const q = new URL(E.buildAuthUrl({ ...base, endpoint: 'https://login.example.com/oauth2/v2.0/authorize?prompt=login&code_challenge=old' }).url);
  eq('existing query kept, old code_challenge replaced', [q.searchParams.get('prompt'), q.searchParams.getAll('code_challenge')], ['login', [RFC_CHALLENGE]]);
  const redir = 'http://127.0.0.1:8765/callback?x=1&y=a b';
  eq('redirect_uri round trip', new URL(E.buildAuthUrl({ ...base, redirectUri: redir }).url).searchParams.get('redirect_uri'), redir);
  const empty = new URL(E.buildAuthUrl({ ...base, redirectUri: '', scope: '  ', state: '' }).url);
  eq('empty optional values omitted', ['redirect_uri', 'scope', 'state', 'nonce'].map((k) => empty.searchParams.has(k)), [false, false, false, false]);
  eq('endpoint without scheme is an error', E.buildAuthUrl({ ...base, endpoint: 'example.com/oauth/authorize' }).error, 'endpoint');
  eq('javascript: endpoint is an error', E.buildAuthUrl({ ...base, endpoint: 'javascript:alert(1)' }).error, 'endpoint');
  eq('endpoint with a fragment is an error (RFC 6749 §3.1)', E.buildAuthUrl({ ...base, endpoint: 'https://auth.example.com/authorize#x' }).error, 'fragment');
  eq('localhost http endpoint is allowed', typeof E.buildAuthUrl({ ...base, endpoint: 'http://localhost:8080/realms/dev/protocol/openid-connect/auth' }).url, 'string');
}

// ── Token request cURL ──────────────────────────────────────────────────────
{
  const curl = E.buildCurl({ tokenEndpoint: 'https://auth.example.com/token', code: 'SplxlOBeZQQYbYS6WxSbIA', redirectUri: 'https://client.example.org/cb', clientId: 's6BhdRkqt3', verifier: RFC_VERIFIER });
  eq('cURL worked example', curl, [
    "curl -X POST 'https://auth.example.com/token' \\",
    "  -H 'Content-Type: application/x-www-form-urlencoded' \\",
    "  --data 'grant_type=authorization_code&code=SplxlOBeZQQYbYS6WxSbIA&redirect_uri=https%3A%2F%2Fclient.example.org%2Fcb&client_id=s6BhdRkqt3&code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'",
  ].join('\n'));
  const noRedirect = E.buildCurl({ tokenEndpoint: 'https://auth.example.com/token', code: 'c', redirectUri: '', clientId: 'a', verifier: RFC_VERIFIER });
  check('cURL omits an empty redirect_uri', !noRedirect.includes('redirect_uri'), noRedirect);
  const nasty = ["it's", '$(id)', '`id`', 'a\\b', 'line\nbreak', "''", '"q"'];
  const back = nasty.map((s) => execFileSync('/bin/sh', ['-c', 'printf %s ' + E.shQuote(s)]).toString());
  eq('shQuote survives /bin/sh', back, nasty);
}

// ── Static checks ────────────────────────────────────────────────────────────
{
  const scripts = [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  check('component has a script', scripts.length > 1000);
  const forbidden = ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'location.', 'history.', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'ztPersist', 'WebSocket'];
  eq('script reads or writes no storage, URL or network', forbidden.filter((w) => scripts.includes(w)), []);
  const persistence = readFileSync(join(root, 'src/data/persistence.ts'), 'utf8');
  check('persistence policy is disabled (no GA4 / AdSense, stored input wiped)', /'pkce-generator':\s*'disabled'/.test(persistence));
  check('generation uses crypto.getRandomValues', /crypto\.getRandomValues/.test(scripts));
}

// ── STRINGS ─────────────────────────────────────────────────────────────────
{
  check('STRINGS table found', STRINGS && STRINGS.en && STRINGS.zh && STRINGS.ja && STRINGS.ko);
  if (STRINGS) {
    const keys = (o) => Object.keys(o).sort().join(',');
    const ph = (o) => Object.keys(o).sort().map((k) => k + ':' + (String(o[k]).match(/\{\w+\}/g) || []).sort().join('')).join('|');
    for (const l of ['zh', 'ja', 'ko']) {
      eq('STRINGS.' + l + ' has the same keys as en', keys(STRINGS[l]), keys(STRINGS.en));
      eq('STRINGS.' + l + ' has the same placeholders as en', ph(STRINGS[l]), ph(STRINGS.en));
    }
    const used = [...source.matchAll(/S\.(\w+)/g)].map((m) => m[1]).concat([...source.matchAll(/L\.(\w+)/g)].map((m) => m[1]));
    eq('every S.key / L.key exists in STRINGS.en', [...new Set(used)].filter((k) => !(k in STRINGS.en)), []);
  }
}

// ── Examples quoted on the tool pages ───────────────────────────────────────
{
  const fmt = (t, o) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in o ? o[k] : m));
  const authUrl = E.buildAuthUrl({
    endpoint: 'https://auth.example.com/authorize', clientId: 's6BhdRkqt3', redirectUri: 'https://client.example.org/cb',
    scope: 'openid profile', state: 'xyz', nonce: 'n-0S6_WzA2Mj', challenge: RFC_CHALLENGE, method: 'S256',
  }).url;
  const pairs = { zh: [[FEISHU_VERIFIER, FEISHU_CHALLENGE]], ja: [[LINE_VERIFIER, LINE_CHALLENGE]] };
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const mdx = readFileSync(join(root, 'src/content/tools/pkce-generator/' + lang + '.mdx'), 'utf8');
    check(lang + ': page shows the RFC verifier and challenge', mdx.includes(RFC_VERIFIER) && mdx.includes(RFC_CHALLENGE));
    if (STRINGS) check(lang + ': quoted error message is the tool output', mdx.includes(fmt(STRINGS[lang].errChar, { pos: 13, ch: '+' })));
    for (const [v, c] of pairs[lang] || []) {
      check(lang + ': page shows ' + v.slice(0, 8) + '… and its challenge', mdx.includes(v) && mdx.includes(c));
      eq(lang + ': ' + v.slice(0, 8) + '… challenge computed by the engine', await E.computeChallenge(v, 'S256'), c);
    }
    const rows = [...mdx.matchAll(/^\| `([A-Za-z0-9_+=/-]{43,64})` \|/gm)].map((m) => m[1]);
    const codes = [];
    for (const r of rows) codes.push((await E.diagnoseChallenge(RFC_VERIFIER, r, 'S256')).code);
    const expectCodes = lang === 'en' ? ['match', 'padding', 'base64', 'hex', 'plain', 'rawBytes'] : ['padding', 'base64', 'hex', 'plain', 'rawBytes'];
    eq(lang + ': diagnosis table rows give the stated results', codes, expectCodes);
  }
  const en = readFileSync(join(root, 'src/content/tools/pkce-generator/en.mdx'), 'utf8');
  check('en: authorization URL example is the engine output', en.includes(authUrl), authUrl);
}

// ── Code blocks on the tool pages ───────────────────────────────────────────
{
  let hasPython = true;
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); } catch { hasPython = false; }
  let hasGo = true;
  try { execFileSync('go', ['version'], { stdio: 'ignore' }); } catch { hasGo = false; }
  if (!hasPython) console.log('SKIP: python3 not found, Python blocks not run');
  if (!hasGo) console.log('SKIP: go not found, Go blocks not run');
  const goDone = new Map();
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const mdx = readFileSync(join(root, 'src/content/tools/pkce-generator/' + lang + '.mdx'), 'utf8');
    const js = (mdx.match(/```(?:javascript|js)\n([\s\S]*?)```/) || [])[1];
    check(lang + ': page has a JavaScript block', !!js);
    if (js) {
      const fns = new Function(js + '\nreturn { createVerifier, createChallenge };')();
      eq(lang + ': JavaScript createChallenge(RFC verifier)', await fns.createChallenge(RFC_VERIFIER), RFC_CHALLENGE);
      const v = fns.createVerifier();
      eq(lang + ': JavaScript createVerifier() is a valid 43-character verifier', [v.length, E.validateVerifier(v).code], [43, 'ok']);
    }
    const py = (mdx.match(/```python\n([\s\S]*?)```/) || [])[1];
    check(lang + ': page has a Python block', !!py);
    if (py && hasPython) {
      const out = execFileSync('python3', ['-c', py + '\nimport sys\nprint(create_challenge(sys.argv[1]))\nprint(create_verifier())\n', RFC_VERIFIER]).toString().trim().split('\n');
      eq(lang + ': Python create_challenge(RFC verifier)', out[0], RFC_CHALLENGE);
      eq(lang + ': Python create_verifier() is a valid 43-character verifier', [out[1].length, E.validateVerifier(out[1]).code], [43, 'ok']);
    }
    const go = (mdx.match(/```go\n([\s\S]*?)```/) || [])[1];
    check(lang + ': page has a Go block', !!go);
    if (go && hasGo) {
      let out = goDone.get(go);
      if (!out) {
        const dir = mkdtempSync(join(tmpdir(), 'pkce-go-'));
        try {
          const prog = go.replace('import (', 'import (\n\t"fmt"\n\t"os"') + '\nfunc main() {\n\tfmt.Println(createChallenge(os.Args[1]))\n\tfmt.Println(createVerifier())\n}\n';
          writeFileSync(join(dir, 'main.go'), prog);
          out = execFileSync('go', ['run', 'main.go', RFC_VERIFIER], { cwd: dir, env: { ...process.env, GO111MODULE: 'off' } }).toString().trim().split('\n');
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
        goDone.set(go, out);
      }
      eq(lang + ': Go createChallenge(RFC verifier)', out[0], RFC_CHALLENGE);
      eq(lang + ': Go createVerifier() is a valid 43-character verifier', [out[1].length, E.validateVerifier(out[1]).code], [43, 'ok']);
    }
  }
}

// ── Clearing while the actual page is waiting for SHA-256 ───────────────────
{
  const nodes = new Map(), events = {}, timers = [], digests = [];
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', textContent: '', hidden: false, className: '', listeners: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      dispatch(type) { for (const fn of this.listeners[type] || []) fn({ target: this }); },
    });
    return nodes.get(id);
  };
  const wrap = { contains: el => [...nodes.values()].includes(el), querySelectorAll: () => [] };
  const document = {
    getElementById: get, querySelector: () => wrap, activeElement: null,
    addEventListener(type, fn) { (events[type] ||= []).push(fn); },
  };
  get('pkce-length').value = '43';
  get('pkce-endpoint').value = 'https://auth.example/authorize';
  const context = {
    document, S: STRINGS.en, navigator: {}, TextEncoder, Uint8Array, URL, URLSearchParams, btoa,
    crypto: {
      getRandomValues: bytes => crypto.getRandomValues(bytes),
      subtle: { digest(algorithm, bytes) {
        const output = createHash('sha256').update(bytes).digest();
        return new Promise(resolve => digests.push(() => resolve(output.buffer.slice(output.byteOffset, output.byteOffset + output.length))));
      } },
    },
    setTimeout: fn => timers.push(fn),
  };
  context.window = context;
  const inline = source.match(/<script is:inline define:vars=[^>]*>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(inline, context);
  const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  digests.shift()(); await drain();
  for (const key of ['ctrlKey', 'metaKey']) {
    get('pkce-verifier').value = RFC_VERIFIER;
    get('pkce-verifier').dispatch('input');
    check(key + ': SHA-256 is pending', digests.length === 1);
    document.activeElement = get('pkce-verifier');
    for (const fn of events.keydown) fn({ [key]: true, key: 'l' });
    // ToolLayout clears these values without input events, after the component listener.
    for (const node of nodes.values()) node.value = '';
    digests.shift()(); await drain();
    eq(key + ': late digest cannot restore outputs before the clear timer',
      ['pkce-challenge', 'pkce-authurl', 'pkce-curl'].map(id => get(id).textContent), ['—', '—', '—']);
    while (timers.length) timers.shift()();
    eq(key + ': outputs stay empty after the clear timer',
      ['pkce-challenge', 'pkce-authurl', 'pkce-curl'].map(id => get(id).textContent), ['—', '—', '—']);
    get('pkce-endpoint').value = 'https://auth.example/authorize';
    get('pkce-verifier').value = RFC_VERIFIER;
    get('pkce-verifier').dispatch('input');
    digests.shift()(); await drain();
    eq(key + ': a new input still produces the RFC challenge', get('pkce-challenge').textContent, RFC_CHALLENGE);
  }
  get('pkce-verifier').dispatch('input');
  document.activeElement = {};
  for (const fn of events.keydown) fn({ ctrlKey: true, key: 'l' });
  digests.shift()(); await drain();
  eq('shortcut outside the tool keeps its pending result', get('pkce-challenge').textContent, RFC_CHALLENGE);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
