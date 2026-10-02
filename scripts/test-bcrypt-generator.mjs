// Bcrypt Generator & Checker — engine, worker and cross-library behaviour
//
// Read:  src/components/tools/BcryptGeneratorTool.astro (the real engine block between the
//        `engine:start` / `engine:end` markers and the frontmatter STRINGS table);
//        public/vendor/bcrypt-worker.js and public/vendor/bcryptjs.min.js (run in a vm context
//        the way a browser Worker loads them); src/data/persistence.ts;
//        scripts/test-bcrypt-generator.fixtures.json; src/content/tools/bcrypt-generator/{lang}.mdx
//        (examples marked `{/* bcg-check: {...} */}` and the compatibility table marked
//        `{/* bcg-compat */}` are re-checked against the engine and the fixture)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// The fixture was recorded on 2026-10-02: hashes made by the vendored bcryptjs 2.4.3 with fixed
// salts, then checked by PHP 8.4.26, Laravel illuminate/hashing 13.34.0, Symfony password-hasher
// 8.1.0, Python bcrypt 4.2.0 and 5.0.0, passlib 1.7.4, Node.js bcrypt 6.0.0, bcryptjs 3.0.3,
// Go golang.org/x/crypto v0.57.0 and Spring Security 7.1.1 / 6.5.11. `fixed[i] = 1` means that
// library produced exactly the same hash for the same salt.
//
// Live check (SKIPPED unless the recorded version is installed, as on the CI Ubuntu runner):
// Python bcrypt 4.2.0 checks fresh engine hashes and recomputes fixed-salt hashes; passlib 1.7.4
// checks them too.
//
// Run: npm run build && node scripts/test-bcrypt-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(root, p), 'utf8');
const source = read('src/components/tools/BcryptGeneratorTool.astro');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in BcryptGeneratorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + `
return { B64, PREFIXES, COST_MIN, COST_MAX, utf8Bytes, bcEncode, bcDecode, randomSaltBody, makeSalt, cutAt72,
  checkPassword, detectOtherScheme, normalizeHashInput, parseHash, hashNotes, verifySalt, judge, prefixVariants,
  sha256Hex, passwordFor, estimateMs, splitDuration, createClient };`)();

const stringsStart = source.indexOf('const STRINGS = {');
const stringsEnd = source.indexOf('\n};', stringsStart);
const STRINGS = new Function(source.slice(stringsStart, stringsEnd + 3) + '\nreturn STRINGS;')();
const FX = JSON.parse(read('scripts/test-bcrypt-generator.fixtures.json'));

let failures = 0;
let passes = 0;
let skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 600) : ''));
}
function skip(name, why) { skips++; console.log('SKIP: ' + name + ' — ' + why); }

// ── The vendored library and the worker, loaded like a browser Worker ──────────────────
const vendorSrc = read('public/vendor/bcryptjs.min.js');
const workerSrc = read('public/vendor/bcrypt-worker.js');
const builtWorker = read('dist/vendor/bcrypt-worker.js');
const builtURL = '/vendor/bcrypt-worker.js?v=' + createHash('sha256').update(builtWorker).digest('hex').slice(0, 16);
check('published worker matches source', builtWorker === workerSrc);
for (const lang of ['', 'zh/', 'ja/', 'ko/']) {
  const html = read(`dist/${lang}tools/bcrypt-generator/index.html`);
  check(`${lang || 'en/'}built page passes the published content URL to Worker`,
    html.includes('const WORKER_URL = ' + JSON.stringify(builtURL)) && /new Worker\(WORKER_URL\)/.test(html));
}
const ref = { self: { crypto: globalThis.crypto }, crypto: globalThis.crypto, setTimeout, clearTimeout };
vm.runInNewContext(vendorSrc, ref);
const BC = ref.dcodeIO.bcrypt;

function makeWorker(code = workerSrc) {
  const ctx = { crypto: globalThis.crypto, setTimeout, clearTimeout, performance, Date };
  ctx.self = ctx;
  ctx.imported = [];
  ctx.importScripts = (url) => {
    ctx.imported.push(url);
    if (url !== '/vendor/bcryptjs.min.js') throw new Error('unexpected importScripts ' + url);
    vm.runInContext(vendorSrc, ctx);
  };
  const w = { onmessage: null, onerror: null, terminated: false, ctx };
  ctx.postMessage = (data) => { if (!w.terminated && w.onmessage) setTimeout(() => w.onmessage({ data: structuredClone(data) }), 0); };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  w.postMessage = (data) => { const d = structuredClone(data); setTimeout(() => { if (!w.terminated) ctx.onmessage({ data: d }); }, 0); };
  w.terminate = () => { w.terminated = true; };
  return w;
}
const client = E.createClient(makeWorker);
const hashIn = async (password, salt) => (await client.run({ type: 'hash', password, salt })).hash;

// Keep the old unversioned response fresh in a URL-keyed cache. Run the actual page factory.
{
  const urlCode = source.match(/^const WORKER_URL = .*;$/m)?.[0] || '';
  const urlFor = (code) => new Function('createHash', 'workerSource', urlCode + '\nreturn typeof WORKER_URL === "undefined" ? null : WORKER_URL;')(createHash, code);
  const url = urlFor(workerSrc);
  check('worker content changes its URL', url !== null && url !== urlFor(FX.legacyWorker) && url !== urlFor(workerSrc + '\n'));
  const cache = new Map([['/vendor/bcrypt-worker.js', FX.legacyWorker]]);
  const requests = [];
  function Worker(path) { requests.push(path); return makeWorker(cache.get(path) || workerSrc); }
  const factoryCode = source.match(/var factory = function \(\) \{.*?\};/)[0];
  const factory = new Function('Worker', 'WORKER_URL', factoryCode + '\nreturn factory;')(Worker, url);
  const old = makeWorker(FX.legacyWorker);
  const replies = [];
  old.onmessage = ({ data }) => replies.push(data);
  // A legacy call acts as a queue barrier: the two new-protocol calls before it are ignored.
  old.postMessage({ id: 1, type: 'bench', cost: 4 });
  old.postMessage({ id: 2, type: 'hash', password: 'cache-check', salt: '$2b$04$abcdefghijklmnopqrstuu' });
  await new Promise((resolve) => {
    old.onmessage = ({ data }) => { replies.push(data); resolve(); };
    old.postMessage({ id: 3, type: 'generate', password: 'cache-check', rounds: 4 });
  });
  check('v55 cached worker ignores bench/hash but still answers generate', replies.length === 1 && replies[0].id === 3);
  old.terminate();
  const c = E.createClient(factory);
  let timer;
  try {
    const result = await Promise.race([
      (async () => {
        const b = await c.run({ type: 'bench', cost: 4 });
        const h = await c.run({ type: 'hash', password: 'cache-check', salt: '$2b$04$abcdefghijklmnopqrstuu' });
        const parsed = E.parseHash(h.hash);
        const v = await c.run({ type: 'hash', password: 'cache-check', salt: E.verifySalt(parsed, 'cache-check').salt });
        return typeof b.ms === 'number' && E.judge(parsed, v.hash) && BC.compareSync('cache-check', h.hash);
      })(),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), 2000); }),
    ]);
    check('page completes bench, generation and verification with the old URL cached', result);
    check('page requests a distinct content-versioned URL', requests.length === 1 && requests[0] === url && !cache.has(requests[0]));
  } finally { clearTimeout(timer); c.cancel(); }
  const h = await client.run({ type: 'generate', password: 'legacy-client', rounds: 4 }).catch(() => ({}));
  check('new worker generates for a cached old page', typeof h.hash === 'string' && BC.compareSync('legacy-client', h.hash));
  for (const password of ['legacy-client', 'wrong']) {
    const r = await client.run({ type: 'verify', password, hash: h.hash }).catch(() => ({}));
    check('new worker verifies for a cached old page: ' + password, r.match === (password === 'legacy-client'));
  }
  const error = await client.run({ type: 'generate', password: null, rounds: 4 }).then(() => null, (e) => e.message);
  check('legacy errors retain the result/error envelope', /Illegal arguments/.test(error || ''));
}

check('bcryptjs vendor loads in a page-like context', BC && typeof BC.hash === 'function');
{
  const w = makeWorker();
  check('worker imports only the vendored bcryptjs', w.ctx.imported.length === 1 && w.ctx.imported[0] === '/vendor/bcryptjs.min.js');
}

// ── A. bcrypt Base64 and salts ──────────────────────────────────────────────────────────
for (let i = 0; i < 2000; i++) {
  const n = i % 2 ? 16 : 23;
  const bytes = new Uint8Array(n); crypto.getRandomValues(bytes);
  const enc = E.bcEncode(bytes);
  if (enc !== BC.encodeBase64(Array.from(bytes), n)) { check('bcEncode matches bcryptjs encodeBase64', false, { bytes: Array.from(bytes), enc }); break; }
  const dec = E.bcDecode(enc, n);
  if (Buffer.compare(Buffer.from(dec), Buffer.from(bytes)) !== 0) { check('bcDecode reverses bcEncode', false, enc); break; }
  if (i === 1999) { check('bcEncode / bcDecode agree with bcryptjs on 2000 random byte strings', true); }
}
check('16 bytes encode to 22 characters, 23 bytes to 31', E.bcEncode(new Uint8Array(16)).length === 22 && E.bcEncode(new Uint8Array(23)).length === 31);
check('bcDecode rejects a character outside the alphabet', (() => { try { E.bcDecode('ab!d', 3); return false; } catch { return true; } })());
const salts = new Set();
for (let i = 0; i < 1000; i++) {
  const s = E.randomSaltBody();
  salts.add(s);
  if (!/^[./A-Za-z0-9]{21}[.Oeu]$/.test(s)) { check('random salt is 22 canonical characters', false, s); break; }
}
check('1000 random salts are all different', salts.size === 1000);
check('random salt uses crypto.getRandomValues', /function randomSaltBody\(\) \{[^}]*crypto\.getRandomValues/.test(block) && !/Math\.random/.test(block));
for (const p of ['$2b$', '$2y$', '$2a$']) check('makeSalt ' + p, E.makeSalt(p, 5, 'x'.repeat(22)) === p + '05$' + 'x'.repeat(22));
check('makeSalt writes cost 12 and 31', E.makeSalt('$2b$', 12, 'B').startsWith('$2b$12$') && E.makeSalt('$2b$', 31, 'B').startsWith('$2b$31$'));
for (const bad of [[ '$2x$', 10 ], [ '$2b$', 3 ], [ '$2b$', 32 ], [ '$2b$', 10.5 ]]) {
  let threw = false; try { E.makeSalt(bad[0], bad[1], 'x'); } catch { threw = true; }
  check('makeSalt rejects ' + bad.join(' '), threw);
}
check('the generator offers $2b$, $2y$, $2a$ and costs 4–31, default $2b$ / 12',
  /PREFIX_OPTIONS = \['\$2b\$', '\$2y\$', '\$2a\$'\]/.test(source) && /length: 28 \}, \(_, i\) => i \+ 4/.test(source)
  && /selected=\{p === '\$2b\$'\}/.test(source) && /selected=\{c === 12\}/.test(source));

// ── B. The fixture: same hashes from the vendored bcryptjs and from other libraries ─────
const casePw = (key) => FX.passwords[key.replace(/^ascii-noncanon-.*/, 'ascii')];
const regular = FX.cases.filter((c) => !c.key.startsWith('ascii-noncanon') && !c.hash.startsWith('$2x$'));
for (const c of regular) {
  const salt = c.hash.slice(0, 29);
  check(`worker recomputes fixture hash ${c.key} ${salt.slice(0, 4)}`, (await hashIn(casePw(c.key), salt)) === c.hash);
}
check('bcryptjs keeps a NUL byte in the password (fixture)', BC.hashSync('ab\u0000cd', FX.nulHashKeep.slice(0, 29)) === FX.nulHashKeep && FX.nulHashKeep !== FX.nulHashCut);
const impl = Object.fromEntries(FX.implementations.map((i) => [i.id, i]));
for (const i of FX.implementations) {
  if (!i.fixed) continue;
  const same = i.fixed.filter((x) => x === 1).length;
  const others = i.fixed.map((x, k) => [x, FX.cases[k]]).filter(([x]) => x !== 1);
  const explained = others.every(([x, c]) => (typeof x === 'string' && x.startsWith('err')) || c.key.startsWith('ascii-noncanon') || c.hash.startsWith('$2x$'));
  check(`${i.id} ${i.version}: every other fixed-salt result is an error, a $2x$ case or a non-canonical input`, explained, others.slice(0, 3));
  check(`${i.id} ${i.version}: produced identical hashes for ${same} salts`, same >= 24);
}
// Claims the tool shows next to each prefix and password issue
check('fixture: Node.js bcrypt 6.0.0 returns false for $2y$', impl['node-bcrypt'].verifyPrefix['$2y$'] === false && impl['node-bcrypt'].verifyPrefix['$2b$'] === true);
check('fixture: Laravel Hash::check throws for $2a$ and $2b$, accepts $2y$', impl.laravel.verifyPrefix['$2a$'] === 'error' && impl.laravel.verifyPrefix['$2b$'] === 'error' && impl.laravel.verifyPrefix['$2y$'] === true);
for (const id of ['php', 'python-bcrypt-4', 'python-bcrypt-5', 'bcryptjs-3', 'go', 'spring-7', 'spring-6', 'symfony', 'passlib']) {
  check(`fixture: ${id} accepts $2a$, $2b$ and $2y$`, ['$2a$', '$2b$', '$2y$'].every((p) => impl[id].verifyPrefix[p] === true));
}
check('fixture: Python bcrypt 5, Go and Spring Security refuse to hash more than 72 bytes', ['python-bcrypt-5', 'go', 'spring-7', 'spring-6'].every((id) => impl[id].hashOver72 === 'error'));
check('fixture: PHP, Node.js bcrypt and bcryptjs 3 cut more than 72 bytes', ['php', 'node-bcrypt', 'bcryptjs-3', 'python-bcrypt-4'].every((id) => impl[id].hashOver72 === 'truncates'));
check('fixture: PHP password_hash refuses NUL, password_verify stops at it', impl.php.nulHash === 'error' && impl.php.nulVerify === 'false/true');
for (const id of ['python-bcrypt-4', 'node-bcrypt', 'bcryptjs-3', 'spring-7']) check(`fixture: ${id} keeps the NUL byte`, impl[id].nulVerify === 'true/false');
check('fixture: Go keeps the NUL byte', impl.go.nulVerify.startsWith('<nil>/'));
check('fixture: Spring Security 7 and Symfony reject an empty password on verify', impl['spring-7'].verifyEmpty === false && impl.symfony.verifyEmpty === false && impl['spring-6'].verifyEmpty === true);
check('fixture: non-canonical salt — Python bcrypt errors, PHP / Node / Spring mismatch',
  impl['python-bcrypt-4'].verifyNonCanonicalSalt === 'error' && ['php', 'node-bcrypt', 'bcryptjs-3', 'spring-7'].every((id) => impl[id].verifyNonCanonicalSalt === false));
check('fixture: defaults — PHP $2y$12$, Python $2b$12$, Node $2b$10$, Go and Spring $2a$10$',
  impl.php.default.startsWith('$2y$12$') && impl['python-bcrypt-5'].default.startsWith('$2b$12$') && impl['node-bcrypt'].default.startsWith('$2b$10$')
  && impl.go.default.startsWith('$2a$10$') && impl['spring-7'].default.startsWith('$2a$10$'));

// ── C. Parsing pasted hashes ────────────────────────────────────────────────────────────
const H = FX.cases.find((c) => c.key === 'ascii' && c.hash.startsWith('$2b$')).hash;
const ok = (s) => E.parseHash(s);
for (const c of FX.cases) {
  const p = ok(c.hash);
  check('parses fixture hash ' + c.key + ' ' + c.hash.slice(0, 4), p.ok && p.cost === 5 && p.hash === c.hash, p.error);
}
{
  const p = ok(H);
  check('parse fields', p.prefix === '$2b$' && p.minor === 'b' && p.salt === FX.saltBody && p.checksum === H.slice(29) && p.canonical === H && !p.nonCanonicalSalt && !p.nonCanonicalSum);
}
const two = '$2$05$' + H.slice(7);
check('parses the original $2$ revision (59 characters)', ok(two).ok && ok(two).minor === '' && ok(two).header === '$2$05$');
const err = (s) => { const p = ok(s); return p.ok ? 'ok' : p.error.code + '@' + p.error.pos; };
const errCases = [
  ['', 'empty@0'],
  ['   ', 'empty@0'],
  ['$3b$05$' + H.slice(7), 'prefix@2'],
  ['2b$05$' + H.slice(7), 'prefix@1'],
  ['＄2b＄05＄' + H.slice(7), 'prefix@1'],
  ['$2c$05$' + H.slice(7), 'minor@3'],
  ['$2b05$' + H.slice(7), 'sep@4'],
  ['$2b$5$' + H.slice(7), 'cost@5'],
  ['$2b$1a$' + H.slice(7), 'cost@5'],
  ['$2b$03$' + H.slice(7), 'costRange@5'],
  ['$2b$32$' + H.slice(7), 'costRange@5'],
  ['$2b$12x' + H.slice(7), 'sep@7'],
  [H.slice(0, 40) + '!' + H.slice(41), 'char@41'],
  [H.slice(0, 40) + '+' + H.slice(41), 'char@41'],
  [H.slice(0, 50) + 'é' + H.slice(51), 'char@51'],
  [H.slice(0, 59), 'short@59'],
  [H + 'x', 'long@61'],
  [H.slice(0, 30) + ' ' + H.slice(30), 'char@31'],
];
for (const [s, want] of errCases) check(`parse error ${JSON.stringify(s.slice(0, 12))}… → ${want}`, err(s) === want, err(s));
check('short / long report the expected length', ok(H.slice(0, 59)).error.vars.want === 60 && ok(H + 'x').error.vars.got === 61);
const schemes = [
  ['$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$abc', 'argon2'],
  ['$6$saltsalt$' + 'a'.repeat(86), 'sha512crypt'],
  ['$5$saltsalt$' + 'a'.repeat(43), 'sha256crypt'],
  ['$1$saltsalt$' + 'a'.repeat(22), 'md5crypt'],
  ['$apr1$r31.....$HqJZimcKQFAMYayBlzkrA/', 'apr1'],
  ['$y$j9T$salt$hash', 'yescrypt'],
  ['$7$C6..../....SodiumChloride$abc', 'scrypt'],
  ['$P$BXSmTKZBHKKqWvBhjsLDgHn6Y8UzoZ0', 'phpass'],
  ['pbkdf2_sha256$870000$salt$hash=', 'pbkdf2'],
  ['{SHA}VBPuJHI7uixaa6LQGWx4s+5GKNE=', 'ldap'],
  ['5f4dcc3b5aa765d61d8327deb882cf99', 'hex'],
  ['e38ad214943daad1d64c102faec29de4afe9da3d', 'hex'],
];
for (const [s, want] of schemes) {
  const p = ok(s);
  check('recognises a non-bcrypt hash: ' + want, !p.ok && p.error.code === 'notBcrypt' && p.error.vars.scheme === want, p.error);
}
check('hex digest reports its bit length', ok('5f4dcc3b5aa765d61d8327deb882cf99').error.vars.schemeVars.bits === 128);
// Wrappers a hash arrives in
const notesOf = (s) => ok(s).notes.map((n) => n.code).join(',');
const wrapped = [
  ['  ' + H + '\n', H, 'trim'],
  ['"' + H + '"', H, 'quotes'],
  ["'" + H + "'", H, 'quotes'],
  [H.replace(/\$/g, '\\$'), H, 'backslash'],
  [H.replace(/\$/g, '$$$$'), H, 'dollar'],
  ['{bcrypt}' + H, H, 'spring'],
  ['admin:' + H, H, 'htpasswd'],
  ['bcrypt$' + H, H, 'django'],
  ['bcrypt_sha256$' + H, H, 'djangoSha'],
  ['  "{bcrypt}' + H + '"  ', H, 'trim,quotes,spring'],
  ['admin:' + H.replace(/\$/g, '$$$$'), H, 'htpasswd,dollar'],
];
for (const [s, want, codes] of wrapped) {
  const p = ok(s);
  check(`unwraps ${codes}`, p.ok && p.hash === want && notesOf(s) === codes, { hash: p.hash, notes: notesOf(s), err: p.error });
}
check('htpasswd note keeps the user name', ok('admin:' + H).notes[0].vars.user === 'admin');
check('Django bcrypt_sha256$ asks for a SHA-256 pre-hash', ok('bcrypt_sha256$' + H).prehash === 'sha256' && ok(H).prehash === null);
check('another Spring encoder id is reported', ok('{noop}password').error.code === 'springOther' && ok('{pbkdf2}abc').error.vars.id === '{pbkdf2}');
check('a hash that legitimately contains $$ inside is not unescaped', E.normalizeHashInput('x$$y').hash === 'x$$y');

// ── D. Non-canonical padding, $2x$ and prefix variants ─────────────────────────────────
const ncSalt = FX.cases.find((c) => c.key === 'ascii-noncanon-salt').hash;
const ncSum = FX.cases.find((c) => c.key === 'ascii-noncanon-sum').hash;
{
  const p = ok(ncSalt);
  check('non-canonical salt detected, canonical form restored', p.ok && p.nonCanonicalSalt && !p.nonCanonicalSum && p.canonical === H);
  const notes = E.hashNotes(p);
  check('non-canonical salt note names the character and the fix', notes.some((n) => n.code === 'ncSalt' && n.vars.ch === 'f' && n.vars.fix === 'e'));
  const q = ok(ncSum);
  check('non-canonical checksum detected', q.ok && q.nonCanonicalSum && !q.nonCanonicalSalt && q.canonical === H);
  check('bcryptjs compareSync reports a mismatch for the non-canonical forms (why the tool canonicalises)', !BC.compareSync(FX.passwords.ascii, ncSalt) && !BC.compareSync(FX.passwords.ascii, ncSum));
  for (const [name, hp] of [['salt', p], ['checksum', q]]) {
    const plan = E.verifySalt(hp, FX.passwords.ascii);
    check(`non-canonical ${name}: right password still matches after canonicalising`, E.judge(hp, await hashIn(FX.passwords.ascii, plan.salt)));
    check(`non-canonical ${name}: wrong password does not`, !E.judge(hp, await hashIn('wrong', plan.salt)));
  }
}
{
  const x = FX.cases.find((c) => c.hash.startsWith('$2x$')).hash;
  const p = ok(x);
  check('$2x$ parses with a note', p.ok && p.minor === 'x' && E.hashNotes(p).some((n) => n.code === '2x'));
  const plan = E.verifySalt(p, FX.passwords.ascii);
  check('$2x$ with an ASCII password is checked as $2a$', plan.salt.startsWith('$2a$05$') && E.judge(p, await hashIn(FX.passwords.ascii, plan.salt)));
  check('$2x$ with a non-ASCII password is not checked', E.verifySalt(p, 'パスワード').unsupported === '2x');
  check('$2x$ has no prefix variants', E.prefixVariants(p) === null);
  check('$2$ is checked without a NUL byte (bcryptjs minor 0)', E.verifySalt(ok(two), 'x').salt === '$2$05$' + FX.saltBody);
}
{
  const p = ok(FX.cases.find((c) => c.key === 'ja' && c.hash.startsWith('$2y$')).hash);
  const v = E.prefixVariants(p);
  check('prefix variants list the three forms', Object.keys(v).join() === '$2a$,$2b$,$2y$' && v['$2b$'].slice(4) === p.hash.slice(4));
  for (const k of Object.keys(v)) check('variant ' + k + ' is in the fixture (same bytes, other prefix)', FX.cases.some((c) => c.hash === v[k]));
  check('notes point $2y$ users at Node.js and $2a$ / $2b$ users at Laravel',
    E.hashNotes(p).some((n) => n.code === 'lib_$2y$') && E.hashNotes(ok(H)).some((n) => n.code === 'lib_$2b$'));
}

// ── E. Checking passwords end to end (worker) ───────────────────────────────────────────
for (const c of regular) {
  const p = ok(c.hash);
  const plan = E.verifySalt(p, casePw(c.key));
  const good = E.judge(p, await hashIn(casePw(c.key), plan.salt));
  const bad = E.judge(p, await hashIn(casePw(c.key) + 'x', plan.salt));
  const over = E.utf8Bytes(casePw(c.key)).length >= 72;
  check(`check ${c.key} ${c.hash.slice(0, 4)}: right password matches, appended character ${over ? 'is ignored (72 bytes)' : 'does not'}`, good && bad === over);
}
{
  const a72 = FX.cases.find((c) => c.key === 'a72' && c.hash.startsWith('$2b$')).hash;
  const p = ok(a72);
  check('a 73-byte password matches the hash of its first 72 bytes', E.judge(p, await hashIn(FX.passwords.a73, E.verifySalt(p, FX.passwords.a73).salt)));
}
for (const d of FX.django) {
  const p = ok(d.encoded);
  const input = await E.passwordFor(p, d.pw);
  check(`Django bcrypt_sha256 (Python-made) checks: ${d.pw.slice(0, 12)}`, input.length === 64 && E.judge(p, await hashIn(input, E.verifySalt(p, d.pw).salt)));
  check(`Django bcrypt_sha256 rejects a wrong password: ${d.pw.slice(0, 12)}`, !E.judge(p, await hashIn(await E.passwordFor(p, d.pw + '!'), E.verifySalt(p, d.pw).salt)));
}
{
  const s = ok(FX.springDocExample.stored);
  check('Spring Security reference example {bcrypt}…: "password" matches', s.ok && E.judge(s, await hashIn('password', E.verifySalt(s, 'password').salt)));
  const r = ok(FX.ruoyi.hash);
  check('RuoYi-Vue default admin hash: "admin123" matches', r.ok && E.judge(r, await hashIn('admin123', E.verifySalt(r, 'admin123').salt)));
}
{
  const salt = E.makeSalt('$2y$', 4, E.randomSaltBody());
  const h = await hashIn('パスワード', salt);
  check('worker output keeps the requested prefix and cost', h.startsWith('$2y$04$') && h.length === 60 && BC.compareSync('パスワード', h));
}

// ── F. Password checks ──────────────────────────────────────────────────────────────────
const codes = (pw) => E.checkPassword(pw).issues.map((i) => i.code).join(',');
check('password checks: plain', codes('correct horse battery staple') === '');
check('password checks: empty', codes('') === 'empty');
check('password checks: 72 bytes is fine', codes('a'.repeat(72)) === '' && E.checkPassword('a'.repeat(72)).bytes === 72);
check('password checks: 73 bytes', codes('a'.repeat(73)) === 'over72' && E.checkPassword('a'.repeat(73)).issues[0].vars.bytes === 73);
check('password checks: 24 kana fit, 25 do not', codes('あ'.repeat(24)) === '' && codes('あ'.repeat(25)) === 'over72');
check('password checks: limit inside a character', codes('a'.repeat(71) + 'あ') === 'over72,split' && E.checkPassword('a'.repeat(71) + 'あ').issues[1].vars.ch === 'あ');
check('password checks: tail shows the last kept characters', E.checkPassword('비'.repeat(30)).issues[0].vars.tail === '…' + '비'.repeat(12));
check('password checks: NUL', codes('ab\u0000cd') === 'nul');
check('password checks: edge whitespace', codes(' x') === 'space' && codes('x\n') === 'space' && codes('a b') === '');
check('password checks: characters counted by code point', E.checkPassword('👍a').chars === 2 && E.checkPassword('👍a').bytes === 5);
check('cutAt72 keeps whole characters', E.cutAt72('é'.repeat(40)).kept.length === 36 && E.cutAt72('é'.repeat(40)).used === 72);

// ── G. Worker client: overlapping calls, progress, cancel, errors ───────────────────────
function fakeWorkerFactory(log) {
  return () => {
    const w = { terminated: false, onmessage: null, onerror: null };
    w.postMessage = (m) => { log.push(m); w.last = m; };
    w.terminate = () => { w.terminated = true; };
    log.workers = (log.workers || 0) + 1;
    log.current = w;
    return w;
  };
}
{
  const log = [];
  const c = E.createClient(fakeWorkerFactory(log));
  const seen = [];
  const a = c.run({ type: 'hash', password: 'a' }, (p) => seen.push(['a', p]));
  const b = c.run({ type: 'hash', password: 'b' }, (p) => seen.push(['b', p]));
  check('client sends distinct ids', log.length === 2 && log[0].id !== log[1].id);
  const w = log.current;
  w.onmessage({ data: { id: log[1].id, type: 'progress', p: 0.5 } });
  w.onmessage({ data: { id: log[1].id, type: 'result', hash: 'B' } });
  w.onmessage({ data: { id: log[0].id, type: 'result', hash: 'A' } });
  const [ra, rb] = await Promise.all([a, b]);
  check('overlapping calls each get their own answer (the old client left the first button stuck)', ra.hash === 'A' && rb.hash === 'B');
  check('progress reaches only its caller', seen.length === 1 && seen[0][0] === 'b' && seen[0][1] === 0.5);
  check('one worker serves both calls', log.workers === 1 && c.size() === 0);
  const e = c.run({ type: 'hash' });
  log.current.onmessage({ data: { id: log[2].id, type: 'error', message: 'Invalid salt version: 3a' } });
  check('worker error rejects with its message', await e.then(() => false, (x) => x.message === 'Invalid salt version: 3a'));
  const x = c.run({ type: 'hash' });
  const first = log.current;
  c.cancel();
  check('cancel terminates the worker and rejects as cancelled', first.terminated && await x.then(() => false, (er) => er.cancelled === true));
  const y = c.run({ type: 'hash' });
  check('the next call starts a fresh worker', log.workers === 2 && log.current !== first);
  log.current.onerror({ message: 'boom', preventDefault() {} });
  check('a crashed worker rejects pending calls', await y.then(() => false, (er) => er.message === 'boom'));
  c.run({ type: 'hash' }).catch(() => {});
  check('after a crash the next call starts another worker', log.workers === 3);
}
{
  const r = await client.run({ type: 'bench', cost: 6 });
  check('worker bench returns a time', typeof r.ms === 'number' && r.ms >= 0);
  const bad = await client.run({ type: 'hash', password: 'x', salt: '$3a$05$abc' }).then(() => null, (e) => e.message);
  check('worker reports an invalid salt', /Invalid salt/.test(bad || ''), bad);
  const unk = await client.run({ type: 'nope' }).then(() => null, (e) => e.message);
  check('worker reports an unknown message', /unknown/.test(unk || ''));
  const seen = [];
  await client.run({ type: 'hash', password: 'x', salt: E.makeSalt('$2b$', 10, E.randomSaltBody()) }, (p) => seen.push(p));
  check('worker sends progress for a cost-10 hash', seen.length >= 1 && seen.every((p) => p >= 0 && p <= 1), seen.length);
}
check('estimateMs doubles per cost step', E.estimateMs(12, { cost: 8, ms: 10 }) === 160 && E.estimateMs(4, { cost: 8, ms: 16 }) === 1);
const dur = (ms) => { const d = E.splitDuration(ms); return d.n + d.unit; };
check('durations', dur(0.2) === '1ms' && dur(249.6) === '250ms' && dur(1234) === '1.2s' && dur(12345) === '12s' && dur(150000) === '3min' && dur(7200000) === '2h');

// ── H. Live cross-check with the recorded Python versions ───────────────────────────────
const pyVer = spawnSync('python3', ['-c', 'import bcrypt; print(bcrypt.__version__)'], { encoding: 'utf8' });
if (pyVer.error || pyVer.status !== 0 || pyVer.stdout.trim() !== '4.2.0') {
  skip('Python bcrypt 4.2.0 cross-check', 'python3 with bcrypt 4.2.0 not installed' + (pyVer.stdout ? ' (found ' + pyVer.stdout.trim() + ')' : ''));
} else {
  const rows = [];
  for (const [pw, prefix] of [['correct horse battery staple', '$2b$'], ['パスワード2026', '$2y$'], ['密码2026', '$2a$'], ['비밀번호2026', '$2b$'], ['', '$2b$'], ['a'.repeat(72), '$2y$']]) {
    const salt = E.makeSalt(prefix, 4, E.randomSaltBody());
    rows.push({ pw, salt, hash: await hashIn(pw, salt) });
  }
  const code = `
import sys, json, bcrypt
rows = json.loads(sys.stdin.read())
out = []
for r in rows:
    out.append([bcrypt.checkpw(r["pw"].encode(), r["hash"].encode()), bcrypt.hashpw(r["pw"].encode(), r["salt"].encode()).decode(), bcrypt.checkpw((r["pw"] + "x").encode(), r["hash"].encode())])
print(json.dumps(out))`;
  const res = spawnSync('python3', ['-c', code], { input: JSON.stringify(rows), encoding: 'utf8' });
  let out = null; try { out = JSON.parse(res.stdout.trim()); } catch { /* reported below */ }
  check('Python bcrypt 4.2.0 run', !!out, res.stderr.slice(-300));
  if (out) rows.forEach((r, i) => {
    check(`Python bcrypt 4.2.0 checks engine hash ${r.salt.slice(0, 4)} ${JSON.stringify(r.pw.slice(0, 8))}`, out[i][0] === true);
    check(`Python bcrypt 4.2.0 hashes the same salt to the same value ${r.salt.slice(0, 4)}`, out[i][1] === r.hash);
    check(`Python bcrypt 4.2.0 rejects an appended character unless past 72 bytes`, out[i][2] === (E.utf8Bytes(r.pw).length >= 72));
  });
  const pl = spawnSync('python3', ['-c', 'import passlib; print(passlib.__version__)'], { encoding: 'utf8' });
  if (pl.status !== 0 || pl.stdout.trim() !== '1.7.4') skip('passlib 1.7.4 cross-check', 'not installed');
  else {
    const code2 = `
import sys, json, warnings, logging
warnings.filterwarnings("ignore"); logging.disable(logging.CRITICAL)
from passlib.hash import bcrypt
rows = json.loads(sys.stdin.read())
print(json.dumps([bcrypt.verify(r["pw"], r["hash"]) for r in rows]))`;
    const r2 = spawnSync('python3', ['-c', code2], { input: JSON.stringify(rows), encoding: 'utf8' });
    let o2 = null; try { o2 = JSON.parse(r2.stdout.trim().split('\n').pop()); } catch { /* below */ }
    check('passlib 1.7.4 checks every engine hash', Array.isArray(o2) && o2.every((x) => x === true), r2.stderr.slice(-300));
  }
}

// ── I. STRINGS, privacy, persistence ────────────────────────────────────────────────────
check('STRINGS table found', STRINGS && STRINGS.en && STRINGS.zh && STRINGS.ja && STRINGS.ko);
const keys = Object.keys(STRINGS.en).sort().join();
const ph = (s) => (String(s).match(/\{[a-z0-9]+\}/gi) || []).sort().join();
for (const lang of ['zh', 'ja', 'ko']) {
  check(`STRINGS ${lang} has the same keys as en`, Object.keys(STRINGS[lang]).sort().join() === keys,
    Object.keys(STRINGS.en).filter((k) => !(k in STRINGS[lang])).concat(Object.keys(STRINGS[lang]).filter((k) => !(k in STRINGS.en))));
  for (const k of Object.keys(STRINGS.en)) check(`STRINGS ${lang}.${k} placeholders`, ph(STRINGS.en[k]) === ph(STRINGS[lang][k]), [STRINGS.en[k], STRINGS[lang][k]]);
}
const engineCodes = new Set([...block.matchAll(/code: '([A-Za-z0-9_$]+)'/g)].map((m) => m[1]));
const issueCodes = ['empty', 'over72', 'split', 'nul', 'space'];
for (const c of issueCodes) check('STRINGS issue_' + c, typeof STRINGS.en['issue_' + c] === 'string' && engineCodes.has(c));
for (const c of ['trim', 'quotes', 'backslash', 'dollar', 'spring', 'htpasswd', 'django', 'djangoSha', '2x', '2', 'ncSalt', 'ncSum', 'costTime', 'lib_$2y$', 'lib_$2a$', 'lib_$2b$'])
  check('STRINGS note_' + c, typeof STRINGS.en['note_' + c] === 'string');
for (const m of block.matchAll(/fail\('([a-zA-Z]+)'/g)) check('STRINGS err_' + m[1], m[1] === 'empty' || typeof STRINGS.en['err_' + m[1]] === 'string');
for (const s of ['argon2', 'scrypt', 'yescrypt', 'sha512crypt', 'sha256crypt', 'md5crypt', 'apr1', 'phpass', 'pbkdf2', 'ldap', 'hex']) check('STRINGS scheme_' + s, typeof STRINGS.en['scheme_' + s] === 'string');
for (const p of ['$2b$', '$2y$', '$2a$']) check('STRINGS option and note for ' + p, typeof STRINGS.en['opt_' + p] === 'string' && typeof STRINGS.en['note_' + p] === 'string');
for (const u of ['ms', 's', 'min', 'h']) check('STRINGS unit ' + u, /\{n\}/.test(STRINGS.en[u]));
const script = source.slice(source.indexOf('<script'));
check('component script uses no storage, cookies or network',
  !/localStorage|sessionStorage|ztPersist|document\.cookie|fetch\(|XMLHttpRequest|sendBeacon|location\.hash|innerHTML/.test(script));
{
  // Elements built by the script carry no Astro scope attribute; their rules must be :global (DESIGN.md).
  const style = source.slice(source.indexOf('<style>'));
  const dyn = new Set();
  for (const m of script.matchAll(/className = '([^']+)'/g)) for (const c of m[1].split(/\s+/)) if (c.startsWith('bcg-')) dyn.add(c);
  for (const m of script.matchAll(/className = '([a-z-]+--)' \+/g)) dyn.add(m[1]);
  for (const c of dyn) {
    if (c === 'bcg-result') continue; // static element
    check('dynamic class .' + c + ' has a :global rule', style.includes(':global(.' + c));
  }
}
check('worker uses no network beyond importScripts', !/fetch\(|XMLHttpRequest|sendBeacon/.test(workerSrc));
check("persistence policy stays 'disabled'", /'bcrypt-generator': 'disabled'/.test(read('src/data/persistence.ts')));
check('privacy line matches the About page promise (no analytics or ads)', /no analytics or ads/.test(STRINGS.en.privacy));

// ── J. Examples and the compatibility table on the tool pages ───────────────────────────
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = read(`src/content/tools/bcrypt-generator/${lang}.mdx`);
  const marks = [...mdx.matchAll(/\{\/\* bcg-check: (\{.*?\}) \*\/\}/g)];
  check(`${lang}.mdx has bcg-check examples`, marks.length >= 3, marks.length);
  for (const m of marks) {
    const ex = JSON.parse(m[1]);
    if (ex.hash) {
      check(`${lang} quoted hash is on the page: ${ex.hash.slice(0, 24)}`, mdx.includes(ex.hash));
      const p = ok(ex.hash);
      if (ex.error) {
        check(`${lang} parse error ${ex.hash.slice(0, 16)} → ${ex.error}`, !p.ok && p.error.code + '@' + p.error.pos === ex.error, p.error);
        continue;
      }
      check(`${lang} example parses: ${ex.hash.slice(0, 24)}`, p.ok, p.error);
      if (!p.ok) continue;
      if (ex.notes) check(`${lang} notes ${ex.notes}`, p.notes.concat(E.hashNotes(p)).map((n) => n.code).join(',') === ex.notes, p.notes.concat(E.hashNotes(p)).map((n) => n.code).join(','));
      if (ex.pw !== undefined) {
        const input = await E.passwordFor(p, ex.pw);
        const plan = E.verifySalt(p, ex.pw);
        const got = plan.unsupported ? 'unsupported' : (E.judge(p, await hashIn(input, plan.salt)) ? 'match' : 'nomatch');
        check(`${lang} example ${JSON.stringify(ex.pw).slice(0, 20)} → ${ex.result}`, got === ex.result, got);
      }
      if (ex.canonical) check(`${lang} canonical form quoted`, p.canonical === ex.canonical && mdx.includes(ex.canonical));
    }
    if (ex.password !== undefined && ex.bytes !== undefined) {
      check(`${lang} byte count for ${JSON.stringify(ex.password).slice(0, 20)}`, E.utf8Bytes(ex.password).length === ex.bytes && mdx.includes(String(ex.bytes)));
      if (ex.issues !== undefined) check(`${lang} password issues ${ex.issues}`, codes(ex.password) === ex.issues, codes(ex.password));
      if (ex.tail) check(`${lang} quoted tail ${ex.tail}`, E.checkPassword(ex.password).issues[0].vars.tail === ex.tail && mdx.includes(ex.tail));
    }
  }
  // Compatibility table: rows "| Library … | $2a$ | $2b$ | $2y$ | over 72 bytes |" with ✓ / ✗ / ⚠
  const t = mdx.indexOf('{/* bcg-compat */}');
  check(`${lang}.mdx has the compatibility table`, t >= 0);
  if (t >= 0) {
    const rows = mdx.slice(t).split('\n').filter((l) => /^\| \S/.test(l)).slice(1, 40);
    let checked = 0;
    for (const row of rows) {
      const cells = row.split('|').slice(1, -1).map((s) => s.trim());
      const idm = /<!-- (\S+) -->|\{\/\* (\S+) \*\/\}/.exec(row);
      const id = idm && (idm[1] || idm[2]);
      if (!id || !impl[id]) continue;
      const sym = (v) => (v === true ? '✓' : v === false ? '✗' : '⚠');
      const want = ['$2a$', '$2b$', '$2y$'].map((p) => sym(impl[id].verifyPrefix[p]));
      const got = cells.slice(2, 5).map((c) => c.charAt(0));
      check(`${lang} compat row ${id}: $2a$ $2b$ $2y$`, got.join() === want.join(), { got, want });
      const over = cells[5] || '';
      const wantOver = impl[id].hashOver72 === 'error' ? '✗' : impl[id].hashOver72 === 'truncates' ? '✂' : null;
      if (wantOver) check(`${lang} compat row ${id}: over 72 bytes`, over.charAt(0) === wantOver, over);
      check(`${lang} compat row ${id}: version`, cells[1] === impl[id].version.replace(/^v/, ''), cells[1]);
      checked++;
    }
    check(`${lang} compatibility table covers 10 libraries`, checked >= 10, checked);
  }
}

console.log(`\n${passes} passed, ${failures} failed, ${skips} skipped`);
process.exit(failures ? 1 : 0);
