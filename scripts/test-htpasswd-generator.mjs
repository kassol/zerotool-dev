// htpasswd Generator — hash formats, verification, htpasswd file editing
//
// Read:  src/components/tools/HtpasswdGeneratorTool.astro (the real engine block between the
//        `engine:start` / `engine:end` markers and the frontmatter STRINGS table, so this test
//        cannot drift from the shipped source); public/vendor/bcryptjs.min.js (run in a vm
//        context the way the page loads it); src/data/persistence.ts;
//        src/layouts/ToolLayout.astro (real clear shortcut);
//        scripts/test-htpasswd-generator.fixtures.json (hashes made by passlib 1.7.4 with fixed
//        salts, an independent implementation); src/content/tools/htpasswd-generator/{lang}.mdx
//        (examples marked with `{/* htpw-check: {...} */}` are re-checked by the engine)
// Write: stdout only; a temporary directory under the OS temp dir for `htpasswd -v` (removed)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Sources: Apache HTTP Server 2.4 "Password Formats" (misc/password_encryptions.html: the
// myName / myPassword examples for bcrypt, MD5, SHA1 and CRYPT, and the OpenSSL apr1 / crypt
// examples) and the htpasswd manual (programs/htpasswd.html: usernames may not contain ":",
// bcrypt cost 4–17, SHA-2 crypt rounds default 5,000, CRYPT uses the first 8 characters);
// Ulrich Drepper, "Unix crypt using SHA-256 and SHA-512" (rounds=10000 vectors, minimum 1000
// rounds); APR apr_passwd.c apr_password_validate() (only "$2a$" and "$2y$" are handled by APR
// itself, everything else goes to the system crypt()); nginx ngx_crypt.c ({PLAIN}, {SSHA},
// {SHA}, $apr1$ handled by nginx, the rest by crypt()).
//
// External checks (each is SKIPPED when the tool is missing, as on the CI Ubuntu runner):
// - `htpasswd -v` verifies lines produced by the engine (bcrypt $2y$ / $2a$, APR1, SHA-1,
//   CRYPT; SHA-256 / SHA-512 crypt only where the local htpasswd supports `-2` / `-5`).
// - Python passlib verifies lines produced by the engine (all hash formats).
//
// Run: node scripts/test-htpasswd-generator.mjs

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/HtpasswdGeneratorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in HtpasswdGeneratorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + `
return { FORMATS, utf8Bytes, md5, sha1, sha256, sha512, md5Crypt, shaCrypt, desCrypt, randomSalt,
  randomPassword, hashPassword, identifyHash, verifyPassword, checkUser, checkPassword, buildLine,
  parseHtpasswd, upsertUser, removeUser, parseBatch, htpasswdCommand };`)();

const stringsStart = source.indexOf('const STRINGS = {');
const stringsEnd = source.indexOf('\n};', stringsStart);
const STRINGS = stringsStart >= 0 && stringsEnd > stringsStart
  ? new Function(source.slice(stringsStart, stringsEnd + 3) + '\nreturn STRINGS;')()
  : null;

const vendor = readFileSync(join(root, 'public/vendor/bcryptjs.min.js'), 'utf8');
const ctx = { self: { crypto: globalThis.crypto }, crypto: globalThis.crypto, setTimeout, clearTimeout };
vm.runInNewContext(vendor, ctx);
const BC = ctx.dcodeIO && ctx.dcodeIO.bcrypt;

let failures = 0;
let passes = 0;
let skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? '\n      ' + JSON.stringify(detail) : ''));
}
function skip(name, why) { skips++; console.log('SKIP: ' + name + ' — ' + why); }

check('bcryptjs vendor loads in a page-like context', BC && typeof BC.hash === 'function');

// ── A. Published vectors ────────────────────────────────────────────────────────────────
const doc = {
  bcrypt: '$2y$05$c4WoMPo3SXsafkva.HHa6uXQZWr7oboPiC2bT/r7q1BB8I2s0BRqC',
  md5: '$apr1$r31.....$HqJZimcKQFAMYayBlzkrA/',
  sha1: '{SHA}VBPuJHI7uixaa6LQGWx4s+5GKNE=',
  crypt: 'rqXexS6ZhobKA',
};
check('Apache doc: APR1 myPassword salt r31.....', E.md5Crypt('myPassword', 'r31.....', '$apr1$') === doc.md5, E.md5Crypt('myPassword', 'r31.....', '$apr1$'));
check('Apache doc: openssl passwd -apr1 example', E.md5Crypt('myPassword', 'qHDFfhPC', '$apr1$') === '$apr1$qHDFfhPC$nITSVHgYbDAK1Y0acGRnY0');
check('Apache doc: CRYPT myPassword salt rq', E.desCrypt('myPassword', 'rq') === doc.crypt, E.desCrypt('myPassword', 'rq'));
check('Apache doc: openssl passwd -crypt example (salt qQ)', E.desCrypt('myPassword', 'qQ') === 'qQ5vTYO3c8dsU');
check('Apache doc: CRYPT uses only the first 8 characters', E.desCrypt('myPasswo', 'rq') === doc.crypt);
for (const [id, hash] of Object.entries(doc)) {
  const r = await E.verifyPassword(hash, 'myPassword', BC);
  check('Apache doc example verifies: ' + id, r.ok === true && r.supported, r);
  const w = await E.verifyPassword(hash, 'MyPassword', BC);
  check('Apache doc example rejects a wrong password: ' + id, w.ok === false && w.supported, w);
}
// Drepper's rounds=10000 vectors and the minimum-rounds vector (checked with passlib)
const drepper = [
  [256, 'Hello world!', 'saltstringsaltstring', 10000, '$5$rounds=10000$saltstringsaltst$3xv.VbSHBb41AL9AvLeujZkZRBAwqFMz2.opqey6IcA'],
  [512, 'Hello world!', 'saltstringsaltstring', 10000, '$6$rounds=10000$saltstringsaltst$OW1/O6BYHV6BcXZu8QVeXbDWra3Oeqh0sbHbbMCVNSnCM/UrjmM0Dp8vOuZeHBy/YTBmSK6H9qs/y3RnOaw5v.'],
  [512, 'Hello world!', 'saltstring', null, '$6$saltstring$svn8UoSVapNtMuq1ukKS4tPQd8iKwSMHWjl/O817G3uBnIFNjnQJuesI68u4OTLiBFdcbYEdFCoEOfaS35inz1'],
  [256, 'Hello world!', 'saltstring', null, '$5$saltstring$5B8vYYiY.CVt1RlTTf8KbXBH3hsxY/GNooZaBBGWEc5'],
  [256, 'the minimum number is still observed', 'roundstoolow', 10, '$5$rounds=1000$roundstoolow$yfvwcWrQ8l/K0DAWyuPMDNHpIVlTQebY9l/gL972bIC'],
];
for (const [bits, pw, salt, rounds, want] of drepper) {
  const got = E.shaCrypt(pw, salt, rounds, bits);
  check(`SHA-crypt vector $${bits === 256 ? 5 : 6}$ ${salt} rounds=${rounds}`, got === want, got);
}
// Digest primitives against node:crypto
const { createHash } = await import('node:crypto');
const hex = (u8) => Buffer.from(u8).toString('hex');
for (const len of [0, 1, 55, 56, 63, 64, 65, 111, 112, 127, 128, 129, 1000]) {
  const buf = new Uint8Array(len).map((_, i) => (i * 131 + len) & 255);
  for (const alg of ['md5', 'sha1', 'sha256', 'sha512']) {
    check(`${alg} of ${len} bytes matches node:crypto`, hex(E[alg](buf)) === createHash(alg).update(buf).digest('hex'));
  }
}

// ── B. passlib fixtures (fixed salts) ───────────────────────────────────────────────────
const fixtures = JSON.parse(readFileSync(join(root, 'scripts/test-htpasswd-generator.fixtures.json'), 'utf8')).rows;
let fixtureExact = 0;
for (const [kind, pw, salt, rounds, hash] of fixtures) {
  let got = null;
  if (kind === 'apr1') got = E.md5Crypt(pw, salt, '$apr1$');
  else if (kind === 'md5crypt') got = E.md5Crypt(pw, salt, '$1$');
  else if (kind === 'sha256') got = E.shaCrypt(pw, salt, rounds === 5000 ? null : rounds, 256);
  else if (kind === 'sha512') got = E.shaCrypt(pw, salt, rounds === 5000 ? null : rounds, 512);
  else if (kind === 'des') got = E.desCrypt(pw, salt);
  if (got !== null) {
    check(`passlib ${kind} recomputed exactly: ${JSON.stringify(pw)}`, got === hash, { got, hash });
    fixtureExact++;
  }
  const ok = await E.verifyPassword(hash, pw, BC);
  check(`passlib ${kind} verifies: ${JSON.stringify(pw)}`, ok.ok === true, { hash, ok });
  // change the first character: CRYPT ignores everything after 8 bytes, bcrypt after 72
  const bad = await E.verifyPassword(hash, (pw[0] === 'Q' ? 'R' : 'Q') + pw.slice(1), BC);
  check(`passlib ${kind} rejects a wrong password: ${JSON.stringify(pw)}`, bad.ok === false, { hash, bad });
  if (kind === 'bcrypt' && E.utf8Bytes(pw).length >= 72) {
    check('bcrypt ignores bytes after 72 (passlib agrees)', (await E.verifyPassword(hash, pw + 'tail', BC)).ok === true);
  }
  if (kind === 'des' && pw.length >= 8) {
    check('CRYPT ignores characters after 8 (passlib agrees)', (await E.verifyPassword(hash, pw.slice(0, 8) + 'tail', BC)).ok === true);
  }
}
check('fixtures recomputed for apr1, $1$, SHA-256, SHA-512 and CRYPT', fixtureExact === 128, fixtureExact);
check('DES of UTF-8 text matches passlib (high bit dropped)', E.desCrypt('pässwörd', 'ab') === 'abzp3RXJm5gNA', E.desCrypt('pässwörd', 'ab'));

// ── C. Generation ───────────────────────────────────────────────────────────────────────
const shapes = {
  'bcrypt-2y': /^\$2y\$10\$[./A-Za-z0-9]{53}$/,
  'bcrypt-2a': /^\$2a\$10\$[./A-Za-z0-9]{53}$/,
  sha512: /^\$6\$[./A-Za-z0-9]{16}\$[./A-Za-z0-9]{86}$/,
  sha256: /^\$5\$[./A-Za-z0-9]{16}\$[./A-Za-z0-9]{43}$/,
  apr1: /^\$apr1\$[./A-Za-z0-9]{8}\$[./A-Za-z0-9]{22}$/,
  sha1: /^\{SHA\}[A-Za-z0-9+/]{27}=$/,
  crypt: /^[./A-Za-z0-9]{13}$/,
  plain: /^Correct-Horse-42$/,
  'nginx-plain': /^\{PLAIN\}Correct-Horse-42$/,
};
check('FORMATS lists the 9 output formats', Object.keys(E.FORMATS).sort().join() === Object.keys(shapes).sort().join(), Object.keys(E.FORMATS));
const generated = {};
for (const id of Object.keys(shapes)) {
  const h = await E.hashPassword('Correct-Horse-42', { format: id, cost: 10, rounds: 5000 }, BC);
  generated[id] = h;
  check('hashPassword shape: ' + id, shapes[id].test(h), h);
  const v = await E.verifyPassword(h, 'Correct-Horse-42', BC);
  check('hashPassword output verifies: ' + id, v.ok === true, { h, v });
  const w = await E.verifyPassword(h, 'Xorrect-Horse-42', BC);
  check('hashPassword output rejects a wrong password: ' + id, w.ok === false, { h, w });
}
check('bcrypt $2y$ output verifies with bcryptjs.compare', BC.compareSync('Correct-Horse-42', generated['bcrypt-2y']));
check('two APR1 hashes of one password differ (random salt)', (await E.hashPassword('pw', { format: 'apr1' }, BC)) !== (await E.hashPassword('pw', { format: 'apr1' }, BC)));
check('SHA-512 crypt writes rounds= only when not 5000',
  /^\$6\$rounds=20000\$/.test(await E.hashPassword('pw', { format: 'sha512', rounds: 20000 }, BC))
  && !/rounds=/.test(await E.hashPassword('pw', { format: 'sha512', rounds: 5000 }, BC)));
check('SHA-256 crypt clamps rounds below 1000 to 1000', /^\$5\$rounds=1000\$/.test(await E.hashPassword('pw', { format: 'sha256', rounds: 10 }, BC)));
for (const cost of [4, 5, 12]) {
  const h = await E.hashPassword('pw', { format: 'bcrypt-2y', cost }, BC);
  check('bcrypt cost written into the hash: ' + cost, h.startsWith('$2y$' + String(cost).padStart(2, '0') + '$'), h);
}
let rejected = false;
try { await E.hashPassword('pw', { format: 'bcrypt-2y', cost: 18 }, BC); } catch (e) { rejected = true; }
check('bcrypt cost above 17 (APR limit) is rejected', rejected);
const cjk = 'パスワード中文한글';
for (const id of ['bcrypt-2y', 'sha512', 'apr1', 'sha1']) {
  const h = await E.hashPassword(cjk, { format: id, cost: 4 }, BC);
  check('UTF-8 password round trip: ' + id, (await E.verifyPassword(h, cjk, BC)).ok === true);
}
// salts: 64-symbol alphabet, every symbol reachable, no Math.random in the engine
const seen = new Set();
for (let i = 0; i < 300; i++) for (const c of E.randomSalt(16)) seen.add(c);
check('randomSalt draws from all 64 crypt characters', seen.size === 64, seen.size);
check('engine uses crypto.getRandomValues and never Math.random', /crypto\.getRandomValues/.test(block) && !/Math\.random/.test(block));
const pwSeen = new Set();
for (let i = 0; i < 200; i++) { const p = E.randomPassword(); check('randomPassword length 20, alphanumeric', /^[A-Za-z0-9]{20}$/.test(p), p); for (const c of p) pwSeen.add(c); }
check('randomPassword uses a 56-character alphabet without look-alikes', pwSeen.size === 56 && !/[0O1lI]/.test([...pwSeen].join('')), [...pwSeen].join(''));

// ── D. Hash identification ──────────────────────────────────────────────────────────────
const ids = [
  ['$2y$10$' + 'a'.repeat(53), 'bcrypt'], ['$2a$05$' + 'a'.repeat(53), 'bcrypt'], ['$2b$05$' + 'a'.repeat(53), 'bcrypt'],
  ['$2x$05$' + 'a'.repeat(53), 'bcrypt-2x'], ['$6$abc$' + 'a'.repeat(86), 'sha512'], ['$6$rounds=9000$abc$' + 'a'.repeat(86), 'sha512'],
  ['$5$abc$' + 'a'.repeat(43), 'sha256'], ['$apr1$abc$' + 'a'.repeat(22), 'apr1'], ['$1$abc$' + 'a'.repeat(22), 'md5crypt'],
  ['{SHA}VBPuJHI7uixaa6LQGWx4s+5GKNE=', 'sha1'], ['{SSHA}6JX5JLRIe30u+sYD5UgcEFPp/7lTypmz', 'ssha'], ['{PLAIN}x', 'nginx-plain'],
  ['rqXexS6ZhobKA', 'des'], ['$y$j9T$abc$def', 'yescrypt'], ['$7$CU..', 'scrypt'], ['_J9..CCCCXBrJUJV154M', 'bsdi'],
  ['{SHA256}yBtdRbhZYl00ABfkbdVxpV7rDj6RS6/xjX2gHgDCSZo=', 'unknown-scheme'], ['secret', 'plain'],
];
for (const [h, want] of ids) check('identifyHash ' + h.slice(0, 16), E.identifyHash(h).id === want, E.identifyHash(h));
check('identifyHash reads the bcrypt cost', E.identifyHash(doc.bcrypt).cost === 5);
check('identifyHash reads SHA-crypt rounds', E.identifyHash('$6$rounds=9000$abc$x').rounds === 9000 && E.identifyHash('$6$abc$x').rounds === 5000);
const unsup = await E.verifyPassword('{SHA256}yBtdRbhZYl00ABfkbdVxpV7rDj6RS6/xjX2gHgDCSZo=', 'Correct-Horse-42', BC);
check('{SHA256} is reported as unsupported, not as a mismatch', unsup.supported === false, unsup);
check('a plaintext line verifies by comparison', (await E.verifyPassword('secret', 'secret', BC)).ok === true);
const plainDes = await E.verifyPassword('abcdefghijklm', 'abcdefghijklm', BC);
check('13 crypt characters that are really plaintext still match', plainDes.ok === true && plainDes.id === 'plain', plainDes);

// ── E. Username and password checks ─────────────────────────────────────────────────────
const codes = (issues) => issues.map((i) => i.level + ':' + i.code).sort().join(',');
const userCases = [
  ['admin', ''], ['', 'error:userEmpty'], ['a:b', 'error:userColon'], ['#admin', 'error:userHash'],
  [' admin', 'error:userSpaceEdge'], ['admin ', 'error:userSpaceEdge'], ['ad\nmin', 'error:userControl'],
  ['ad\tmin', 'error:userControl'], ['a'.repeat(255), ''], ['a'.repeat(256), 'error:userTooLong'],
  ['ユーザー', 'warn:userNonAscii'], ['あ'.repeat(86), 'error:userTooLong,warn:userNonAscii'], ['john doe', ''],
];
for (const [u, want] of userCases) check('checkUser ' + JSON.stringify(u.slice(0, 12)), codes(E.checkUser(u)) === want, codes(E.checkUser(u)));
const passCases = [
  ['Correct-Horse-42', 'bcrypt-2y', ''], ['', 'bcrypt-2y', 'error:passEmpty'],
  ['a'.repeat(255), 'apr1', ''], ['a'.repeat(256), 'apr1', 'error:passTooLong'],
  ['a'.repeat(73), 'bcrypt-2y', 'warn:bcrypt72'], ['あ'.repeat(24), 'bcrypt-2y', 'info:passNonAscii'],
  ['あ'.repeat(25), 'bcrypt-2a', 'info:passNonAscii,warn:bcrypt72'], ['a'.repeat(73), 'sha512', ''],
  ['Correct-Horse-42', 'crypt', 'warn:des8'], ['pässwö', 'crypt', 'info:passNonAscii,warn:desNonAscii'],
  ['a:b', 'plain', 'error:passColonPlain'], ['a:b', 'nginx-plain', 'error:passColonPlain'], ['a:b', 'apr1', ''],
  [' pw', 'apr1', 'warn:passSpaceEdge'], ['pw\u3000', 'apr1', 'info:passNonAscii,warn:passSpaceEdge'],
  ['p\nw', 'sha1', 'warn:passControl'], ['p\nw', 'plain', 'error:passControl'],
];
for (const [p, f, want] of passCases) check(`checkPassword ${f} ${JSON.stringify(p.slice(0, 10))}`, codes(E.checkPassword(p, f)) === want, codes(E.checkPassword(p, f)));
const bcryptIssue = E.checkPassword('あ'.repeat(25), 'bcrypt-2y').find((i) => i.code === 'bcrypt72');
check('bcrypt72 reports the UTF-8 byte count', bcryptIssue && bcryptIssue.vars.bytes === 75, bcryptIssue);
check('buildLine joins user and hash', E.buildLine('deploy', '{SHA}x') === 'deploy:{SHA}x');

// ── F. Reading an htpasswd file ─────────────────────────────────────────────────────────
const file = [
  '# staging users', '', 'alice:' + doc.bcrypt, 'bob:' + doc.md5, ' carol:' + doc.sha1,
  'dave:' + doc.crypt + '  ', 'alice:' + doc.sha1, 'erin:{SHA}x:Erin Example', 'broken line',
  ':' + doc.md5, 'frank:', 'gina:{SHA256}abc', 'hank:secret',
].join('\r\n') + '\r\n';
const parsed = E.parseHtpasswd(file);
check('parseHtpasswd detects CRLF', parsed.eol === '\r\n');
check('parseHtpasswd line count (trailing newline is not a line)', parsed.lines.length === 13, parsed.lines.length);
const kinds = parsed.lines.map((l) => l.kind).join(',');
check('parseHtpasswd line kinds', kinds === 'comment,blank,entry,entry,entry,entry,entry,entry,invalid,entry,entry,entry,entry', kinds);
const byLine = (n) => parsed.lines[n - 1];
const issueCodes = (n) => (byLine(n).issues || []).map((i) => i.code).sort().join(',');
check('entry user and scheme', byLine(3).user === 'alice' && byLine(3).scheme.id === 'bcrypt' && byLine(4).scheme.id === 'apr1');
check('leading space: Apache strips it, Nginx keeps it', issueCodes(5) === 'leadingSpace,weakScheme', issueCodes(5));
check('trailing space after the hash', issueCodes(6) === 'trailingSpace,weakScheme', issueCodes(6));
check('duplicate user points to the first line', issueCodes(7) === 'duplicate,weakScheme' && byLine(7).issues.find((i) => i.code === 'duplicate').vars.first === 3, byLine(7).issues);
check('third field is a comment', byLine(8).hash === '{SHA}x' && issueCodes(8).includes('extraField'), byLine(8));
check('line without a colon is invalid', byLine(9).kind === 'invalid' && byLine(9).issues[0].code === 'noColon');
check('empty username', issueCodes(10).includes('emptyUser'), issueCodes(10));
check('empty hash', issueCodes(11).includes('emptyHash'), issueCodes(11));
check('{SHA256} is flagged as unreadable by Apache and Nginx', issueCodes(12).includes('unknownScheme'), issueCodes(12));
check('plaintext is flagged', issueCodes(13).includes('plainScheme'), issueCodes(13));
check('LF file', E.parseHtpasswd('a:b\nc:d').eol === '\n' && E.parseHtpasswd('a:b\nc:d').lines.length === 2);

// ── G. Add, update and remove like htpasswd ─────────────────────────────────────────────
// htpasswd -b on 2026-10-01 (Apache 2.4.67): every line of the user is replaced in place,
// comments and blank lines are kept, a new user is appended at the end.
const base = '# comment\n\nbob:old1\nalice:x\nbob:old2\n';
const up = E.upsertUser(base, 'bob', 'bob:NEW');
check('upsert replaces every line of an existing user in place', up.text === '# comment\n\nbob:NEW\nalice:x\nbob:NEW\n' && up.action === 'updated' && up.lines.join() === '3,5', up);
const add = E.upsertUser(base, 'carol', 'carol:NEW');
check('upsert appends a new user', add.text === base + 'carol:NEW\n' && add.action === 'added' && add.lines.join() === '6', add);
check('upsert adds the missing final newline first', E.upsertUser('a:x', 'b', 'b:y').text === 'a:x\nb:y\n');
check('upsert keeps CRLF', E.upsertUser('a:x\r\n', 'b', 'b:y').text === 'a:x\r\nb:y\r\n');
check('upsert on an empty file', E.upsertUser('', 'b', 'b:y').text === 'b:y\n');
check('upsert matches the username exactly (case and spaces)', E.upsertUser('Bob:x\n bob:y\n', 'bob', 'bob:z').action === 'added');
const rm = E.removeUser(base, 'bob');
check('remove deletes every line of the user', rm.text === '# comment\n\nalice:x\n' && rm.lines.join() === '3,5', rm);
check('remove of a missing user changes nothing', E.removeUser(base, 'zed').text === base && E.removeUser(base, 'zed').lines.length === 0);

// ── H. Batch input ──────────────────────────────────────────────────────────────────────
const batch = E.parseBatch('alice:pw with space \r\nbob:a:b:c\n\n# note\ncarol\n:nouser\n#x:y\n  \ndave:\nerin:ok');
const items = batch.items.map((i) => i.user + '=' + JSON.stringify(i.password) + '@' + i.line).join(' ');
check('batch keeps passwords exactly (trailing space, colons)', items === 'alice="pw with space "@1 bob="a:b:c"@2 erin="ok"@10', items);
const berr = batch.errors.map((e) => e.line + ':' + e.code).join(',');
check('batch reports bad lines with numbers', berr === '5:noColon,6:userEmpty,9:passEmpty', berr);
check('batch skips blank and # lines', !batch.errors.some((e) => [3, 4, 7, 8].includes(e.line)));
const dup = E.parseBatch('a:1\na:2');
check('batch flags a repeated user', dup.errors.map((e) => e.code).join() === 'duplicateBatch' && dup.items.length === 1);

// ── I. htpasswd command ─────────────────────────────────────────────────────────────────
const cmd = (f, o, u) => E.htpasswdCommand(f, o, u);
check('command bcrypt', cmd('bcrypt-2y', { cost: 10 }, 'deploy') === 'htpasswd -nB -C 10 deploy');
check('command sha512 default rounds', cmd('sha512', { rounds: 5000 }, 'deploy') === 'htpasswd -n5 deploy');
check('command sha256 rounds', cmd('sha256', { rounds: 20000 }, 'deploy') === 'htpasswd -n2 -r 20000 deploy');
check('command apr1 / sha1 / crypt / plain', cmd('apr1', {}, 'u') === 'htpasswd -nm u' && cmd('sha1', {}, 'u') === 'htpasswd -ns u' && cmd('crypt', {}, 'u') === 'htpasswd -nd u' && cmd('plain', {}, 'u') === 'htpasswd -np u');
check('command quotes a username with spaces', cmd('apr1', {}, "john o'neil") === "htpasswd -nm 'john o'\\''neil'", cmd('apr1', {}, "john o'neil"));
check('no htpasswd command for $2a$ and {PLAIN}', cmd('bcrypt-2a', { cost: 10 }, 'u') === null && cmd('nginx-plain', {}, 'u') === null);

// ── J. External verifiers ───────────────────────────────────────────────────────────────
const lines = {};
for (const id of Object.keys(shapes)) lines[id] = await E.hashPassword('Correct-Horse-42', { format: id, cost: 5, rounds: 5000 }, BC);
lines.cjk = await E.hashPassword(cjk, { format: 'bcrypt-2y', cost: 5 }, BC);
lines.cjkApr1 = await E.hashPassword(cjk, { format: 'apr1' }, BC);
lines.cjkSha512 = await E.hashPassword(cjk, { format: 'sha512', rounds: 5000 }, BC);
const htp = spawnSync('htpasswd', ['-nbm', 'u', 'x'], { encoding: 'utf8' });
if (htp.error || htp.status !== 0) {
  skip('htpasswd -v on engine output', 'htpasswd not installed');
} else {
  const dir = mkdtempSync(join(tmpdir(), 'htpw-'));
  try {
    const sha2 = spawnSync('htpasswd', ['-nb5', 'u', 'x']).status === 0;
    const run = (id, pw) => {
      writeFileSync(join(dir, 'f'), 'u:' + lines[id] + '\n');
      return spawnSync('htpasswd', ['-vb', join(dir, 'f'), 'u', pw]).status === 0;
    };
    for (const id of ['bcrypt-2y', 'bcrypt-2a', 'apr1', 'sha1', 'crypt', ...(sha2 ? ['sha256', 'sha512'] : [])]) {
      check('htpasswd -v accepts engine ' + id, run(id, 'Correct-Horse-42'));
      check('htpasswd -v rejects a wrong password for engine ' + id, !run(id, 'Xorrect-Horse-42'));
    }
    check('htpasswd -v accepts engine bcrypt for a UTF-8 password', run('cjk', cjk));
    check('htpasswd -v accepts engine APR1 for a UTF-8 password', run('cjkApr1', cjk));
    if (!sha2) skip('htpasswd -v on SHA-256 / SHA-512 crypt', 'local htpasswd has no SHA-2 crypt (macOS)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const py = spawnSync('python3', ['-c', 'import passlib'], { encoding: 'utf8' });
if (py.error || py.status !== 0) {
  skip('passlib verifies engine output', 'python3 with passlib not installed');
} else {
  const code = `
import sys, json, warnings
warnings.filterwarnings("ignore")
import logging; logging.disable(logging.CRITICAL)
from passlib.apache import HtpasswdFile
rows = json.loads(sys.stdin.read())
out = []
for user, line, pw in rows:
    ht = HtpasswdFile.from_string(("%s:%s\\n" % (user, line)).encode("utf-8"))
    try: out.append(bool(ht.check_password(user, pw)))
    except Exception as e: out.append(str(e))
print(json.dumps(out))`;
  const rows = [];
  for (const id of ['bcrypt-2y', 'bcrypt-2a', 'sha512', 'sha256', 'apr1', 'sha1', 'crypt']) rows.push([id, lines[id], 'Correct-Horse-42']);
  rows.push(['cjk', lines.cjk, cjk], ['cjkApr1', lines.cjkApr1, cjk], ['cjkSha512', lines.cjkSha512, cjk]);
  const res = spawnSync('python3', ['-c', code], { input: JSON.stringify(rows), encoding: 'utf8' });
  let out = null;
  try { out = JSON.parse(res.stdout.trim().split('\n').pop()); } catch { /* reported below */ }
  if (!out) check('passlib run', false, res.stderr.slice(-400));
  else rows.forEach((r, i) => check('passlib HtpasswdFile accepts engine ' + r[0], out[i] === true, out[i]));
}

// ── K. STRINGS, privacy, persistence ────────────────────────────────────────────────────
check('STRINGS table found', STRINGS && STRINGS.en && STRINGS.zh && STRINGS.ja && STRINGS.ko);
if (STRINGS) {
  const keys = Object.keys(STRINGS.en).sort().join();
  for (const lang of ['zh', 'ja', 'ko']) {
    check(`STRINGS ${lang} has the same keys as en`, Object.keys(STRINGS[lang]).sort().join() === keys,
      Object.keys(STRINGS.en).filter((k) => !(k in STRINGS[lang])).concat(Object.keys(STRINGS[lang]).filter((k) => !(k in STRINGS.en))));
    for (const k of Object.keys(STRINGS.en)) {
      const ph = (s) => (String(s).match(/\{[a-z]+\}/gi) || []).sort().join();
      check(`STRINGS ${lang}.${k} placeholders`, ph(STRINGS.en[k]) === ph(STRINGS[lang][k]), [STRINGS.en[k], STRINGS[lang][k]]);
    }
  }
  const codesUsed = new Set();
  for (const m of block.matchAll(/code: '([a-zA-Z0-9]+)'/g)) codesUsed.add(m[1]);
  for (const c of codesUsed) check('STRINGS has a message for issue code ' + c, typeof STRINGS.en['issue_' + c] === 'string');
  for (const id of Object.keys(shapes)) check('STRINGS has compat text for ' + id, typeof STRINGS.en['compat_' + id] === 'string' && typeof STRINGS.en['fmt_' + id] === 'string');
}
const script = source.slice(source.indexOf('<script'));
check('component script uses no storage, cookies or network',
  !/localStorage|sessionStorage|ztPersist|document\.cookie|fetch\(|XMLHttpRequest|sendBeacon|location\.hash/.test(script));
const persistence = readFileSync(join(root, 'src/data/persistence.ts'), 'utf8');
check("persistence policy stays 'disabled'", /'htpasswd-generator': 'disabled'/.test(persistence));

// ── L. Examples on the tool pages ───────────────────────────────────────────────────────
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, `src/content/tools/htpasswd-generator/${lang}.mdx`), 'utf8');
  const marks = [...mdx.matchAll(/\{\/\* htpw-check: (\{.*?\}) \*\/\}/g)];
  check(`${lang}.mdx has htpw-check examples`, marks.length >= 2, marks.length);
  for (const m of marks) {
    const ex = JSON.parse(m[1]);
    if (ex.line) {
      check(`${lang} example line is on the page: ${ex.line.slice(0, 30)}`, mdx.includes(ex.line));
      const sep = ex.line.indexOf(':');
      const r = await E.verifyPassword(ex.line.slice(sep + 1), ex.password, BC);
      check(`${lang} example verifies: ${ex.line.slice(0, 30)}`, r.ok === (ex.ok !== false), r);
    }
    if (ex.user !== undefined) {
      const got = codes(E.checkUser(ex.user));
      check(`${lang} username example ${JSON.stringify(ex.user)} → ${ex.codes}`, got === ex.codes, got);
    }
    if (ex.passwordCheck !== undefined) {
      const got = codes(E.checkPassword(ex.passwordCheck, ex.format));
      check(`${lang} password example ${ex.format} → ${ex.codes}`, got === ex.codes, got);
    }
    if (ex.bytes !== undefined) {
      check(`${lang} quoted byte count for ${JSON.stringify(ex.passwordCheck)}`, E.utf8Bytes(ex.passwordCheck).length === ex.bytes && mdx.includes(String(ex.bytes)));
    }
    if (ex.message) {
      check(`${lang} quoted message is STRINGS output: ${ex.message}`, STRINGS && mdx.includes(STRINGS[lang]['issue_' + ex.message].replace(/\{[a-z]+\}/gi, '').trim().slice(0, 12)));
    }
  }
}


// ── M. Pending page actions must not publish after their inputs change ──────
{
  function page() {
    const nodes = new Map(), events = {}, timers = [], pending = [], comparisons = [], readErrors = [];
    const document = { activeElement: null };
    class Element {
      constructor(id = '', tag = 'DIV') { Object.assign(this, { id, tagName: tag, value: '', textContent: '', hidden: false, disabled: false, className: '', listeners: {}, children: [], style: {} }); }
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
      dispatch(type, extra = {}) { for (const fn of this.listeners[type] || []) fn.call(this, { target: this, ...extra }); }
      click() { if (!this.disabled) this.dispatch('click'); }
      appendChild(child) { this.children.push(child); }
      getBoundingClientRect() { return { top: 100, bottom: 200 }; }
      scrollIntoView() {}
    }
    const get = id => { if (!nodes.has(id)) nodes.set(id, new Element(id)); return nodes.get(id); };
    for (const m of source.matchAll(/<(input|textarea|select|button)[^>]*\bid="([^"]+)"[^>]*>/g)) {
      get(m[2]).tagName = m[1].toUpperCase(); get(m[2]).type = /\btype="([^"]+)"/.exec(m[0])?.[1] || 'text';
    }
    const widget = { contains: el => [...nodes.values()].includes(el), querySelectorAll: () => [...nodes.values()].filter(el => el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' && el.type === 'text') };
    Object.assign(document, { getElementById: get, querySelector: () => widget,
      createElement: tag => new Element('', tag.toUpperCase()),
      addEventListener(type, fn) { (events[type] ||= []).push(fn); } });
    const bc = { ...BC, hash(password, salt, callback, progress) { pending.push({ password, salt, callback, progress }); },
      compare(password, hash, callback) { comparisons.push(() => callback(null, BC.compareSync(password, hash))); } };
    get('htpw-format').value = 'bcrypt-2y'; get('htpw-cost').value = '4'; get('htpw-rounds').value = '5000';
    const context = { document, S: STRINGS.en, navigator: {}, crypto, TextEncoder, TextDecoder, Uint8Array, atob, btoa,
      setTimeout(fn, delay) { const id = timers.length; timers.push({ fn, delay }); return id; }, clearTimeout() {},
      dcodeIO: { bcrypt: bc }, innerHeight: 900, ztPersist: { clear() {} }, _slug: 'htpasswd-generator' };
    context.window = context;
    const shell = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
    const keyStart = shell.indexOf("document.addEventListener('keydown'", shell.indexOf('// ── Keyboard shortcuts:'));
    vm.runInNewContext(shell.slice(keyStart, shell.indexOf('// ── Copy button visual feedback', keyStart)), context);
    vm.runInNewContext(source.match(/<script is:inline define:vars=[^>]*>([\s\S]*?)<\/script>/)[1], context);
    return { get, pending, comparisons, readErrors,
      type(id, value, type = 'input') { get(id).value = value; get(id).dispatch(type); },
      clear(flush = true) {
        document.activeElement = get('htpw-user');
        for (const fn of events.keydown || []) fn({ ctrlKey: true, key: 'l', preventDefault() {} });
        if (flush) this.flushClear();
      },
      flushClear() { for (const job of timers.splice(0)) if (job.delay === 0) job.fn(); },
      openFile(size = 64) {
        let resolve, reject, reads = 0;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        const then = promise.then.bind(promise);
        // Observe an unhandled rejection from the actual handler without terminating the
        // test runner before the other red/green cases can report their own result.
        promise.then = (yes, no) => { const result = then(yes, no); result.catch(error => readErrors.push(String(error))); return result; };
        get('htpw-file-input').files = [{ size, text() { reads++; return promise; } }];
        get('htpw-file-input').dispatch('change');
        return { resolve, reject, get reads() { return reads; } };
      },
      async release() {
        const job = pending.shift();
        const hash = BC.hashSync(job.password, job.salt);
        job.progress?.(1); job.callback(null, hash);
        for (let i = 0; i < 16; i++) await Promise.resolve();
        return hash;
      },
    };
  }
  for (const action of ['edit', 'invalid user', 'format', 'clear']) {
    const p = page(); p.type('htpw-user', 'alice'); p.type('htpw-pass', 'old-password');
    p.get('htpw-generate').click();
    check(action + ': actual page starts bcrypt', p.pending.length === 1);
    if (action === 'edit') { p.type('htpw-user', 'bob'); p.type('htpw-pass', 'new-password'); }
    if (action === 'invalid user') p.type('htpw-user', 'bad:name');
    if (action === 'format') p.type('htpw-format', 'apr1', 'change');
    if (action === 'clear') p.clear();
    await p.release();
    check(action + ': stale generation stays hidden and empty', p.get('htpw-out').hidden && p.get('htpw-line').textContent === '');
    check(action + ': stale progress and success stay cleared', p.get('htpw-status').textContent === '');
    check(action + ': stale command stays hidden', p.get('htpw-cmd-wrap').hidden);
    check(action + ': controls reenable after cancellation', !p.get('htpw-generate').disabled);
    p.type('htpw-user', 'carol'); p.type('htpw-pass', 'current-password'); p.type('htpw-format', 'bcrypt-2y', 'change');
    p.get('htpw-generate').click(); const hash = await p.release();
    check(action + ': next run publishes matching credentials', p.get('htpw-line').textContent === 'carol:' + hash && BC.compareSync('current-password', hash) && !p.get('htpw-out').hidden);
    check(action + ': next command uses the same input', p.get('htpw-cmd').textContent === 'htpasswd -nB -C 4 carol');
  }
  for (const action of ['edit', 'clear', 'file edit']) {
    const p = page(); p.type('htpw-user', 'alice'); p.type('htpw-pass', 'old-password'); p.type('htpw-file', '# keep\nbob:x\n');
    p.get('htpw-upsert').click();
    if (action === 'edit') p.type('htpw-user', 'carol');
    if (action === 'clear') p.clear();
    if (action === 'file edit') p.type('htpw-file', '# new file\n');
    const before = p.get('htpw-file').value;
    await p.release();
    check(action + ': stale upsert cannot mutate file content', p.get('htpw-file').value === before);
    check(action + ': stale upsert cannot report success', !p.get('htpw-file-status').className.includes('success'));
  }
  for (const action of ['batch edit', 'format', 'clear']) {
    const p = page(); p.type('htpw-batch', 'alice:old-password\nbob:second-password');
    p.get('htpw-batch-run').click();
    check(action + ': batch starts its first hash', p.pending.length === 1);
    if (action === 'batch edit') p.type('htpw-batch', 'carol:new-password');
    if (action === 'format') p.type('htpw-format', 'apr1', 'change');
    if (action === 'clear') p.clear();
    await p.release();
    check(action + ': canceled batch stops before hashing another line', p.pending.length === 0);
    check(action + ': canceled batch has no published result or progress', p.get('htpw-batch-result').value === '' && p.get('htpw-batch-status').textContent === '');
    check(action + ': batch controls recover', !p.get('htpw-batch-run').disabled);
  }
  for (const action of ['password edit', 'clear']) {
    const p = page(); p.type('htpw-user', 'alice'); p.type('htpw-pass', 'old-password');
    p.type('htpw-file', 'alice:' + BC.hashSync('old-password', 4)); p.get('htpw-check').click();
    check(action + ': verify starts the actual bcrypt comparison', p.comparisons.length === 1);
    if (action === 'password edit') p.type('htpw-pass', 'new-password'); else p.clear();
    p.comparisons.shift()();
    for (let i = 0; i < 16; i++) await Promise.resolve();
    check(action + ': old verification cannot publish a result', p.get('htpw-file-status').textContent === '');
    check(action + ': verification controls recover', !p.get('htpw-check').disabled);
  }
  // ── N. File.text settlement follows the same input revision as hash actions ──
  const oldFile = 'alice:{SHA}2jmj7l5rSw0yVb/vlWAYkK/YBwk=\n';
  const newerFile = 'bob:{SHA}2jmj7l5rSw0yVb/vlWAYkK/YBwk=\n';
  async function settleRead() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
  for (const action of ['clear', 'clear before timer', 'file edit', 'credentials edit', 'new file', 'oversized file']) {
    const p = page(), old = p.openFile();
    check(action + ': File.text starts exactly once', old.reads === 1);
    if (action === 'clear') p.clear();
    if (action === 'clear before timer') p.clear(false);
    if (action === 'file edit') p.type('htpw-file', '# manually replaced\n');
    if (action === 'credentials edit') p.type('htpw-user', 'new-user');
    if (action === 'new file') { p.openFile().resolve(newerFile); await settleRead(); }
    if (action === 'oversized file') {
      const large = p.openFile(1048577);
      check('oversized file: rejected before reading', large.reads === 0);
      check('oversized file: reports the limit', p.get('htpw-file-status').textContent === STRINGS.en.fileTooBig);
    }
    const before = p.get('htpw-file').value, status = p.get('htpw-file-status').textContent;
    old.resolve(oldFile); await settleRead();
    check(action + ': stale file cannot replace current text', p.get('htpw-file').value === before);
    check(action + ': stale file cannot clear current status', p.get('htpw-file-status').textContent === status);
    if (action === 'clear before timer') {
      check('Ctrl+L cancels file read before the zero-delay reset runs', p.get('htpw-file').value === '');
      p.flushClear();
      check('delayed reset leaves the file table empty', p.get('htpw-file-table').hidden);
    }
    p.openFile().resolve(newerFile); await settleRead();
    check(action + ': a later valid read still recovers', p.get('htpw-file').value === newerFile && !p.get('htpw-file-table').hidden && p.get('htpw-file-status').textContent === '');
    check(action + ': successful reads have no unhandled rejection', p.readErrors.length === 0);
  }
  for (const action of ['clear', 'file edit', 'new file']) {
    const p = page(), old = p.openFile();
    if (action === 'clear') p.clear();
    if (action === 'file edit') p.type('htpw-file', '# newer edit\n');
    if (action === 'new file') { p.openFile().resolve(newerFile); await settleRead(); }
    const before = p.get('htpw-file').value, status = p.get('htpw-file-status').textContent;
    old.reject(new Error('old read failed')); await settleRead();
    check(action + ': stale read rejection is handled', p.readErrors.length === 0);
    check(action + ': stale read error cannot overwrite current file/status', p.get('htpw-file').value === before && p.get('htpw-file-status').textContent === status);
  }
  {
    const p = page(); p.type('htpw-file', '# retained file\n');
    const failed = p.openFile(); failed.reject(new Error('cannot read fixture')); await settleRead();
    check('current read failure: error is handled', p.readErrors.length === 0);
    check('current read failure: user sees the cause', p.get('htpw-file-status').textContent === 'cannot read fixture' && p.get('htpw-file-status').className.includes('error'));
    check('current read failure: previous text is retained', p.get('htpw-file').value === '# retained file\n');
    p.openFile().resolve(newerFile); await settleRead();
    check('current read failure: next file recovers and clears error', p.get('htpw-file').value === newerFile && p.get('htpw-file-status').textContent === '');
  }
  for (const action of ['generate', 'batch', 'upsert', 'check']) {
    const p = page(); p.type('htpw-user', 'alice'); p.type('htpw-pass', 'old-password');
    p.type('htpw-file', 'alice:' + BC.hashSync('old-password', 4) + '\n');
    p.type('htpw-batch', 'alice:old-password\nbob:second-password');
    p.get('htpw-' + (action === 'batch' ? 'batch-run' : action)).click();
    check('file during ' + action + ': actual bcrypt operation is pending', action === 'check' ? p.comparisons.length === 1 : p.pending.length === 1);
    p.openFile().resolve(newerFile); await settleRead();
    check('file during ' + action + ': new file loads without releasing busy early', p.get('htpw-file').value === newerFile && p.get('htpw-generate').disabled);
    if (action === 'check') { p.comparisons.shift()(); await settleRead(); } else await p.release();
    check('file during ' + action + ': old operation cannot replace new file', p.get('htpw-file').value === newerFile);
    check('file during ' + action + ': old operation cannot publish stale progress/result', !p.get('htpw-status').textContent && !p.get('htpw-batch-status').textContent && !p.get('htpw-file-status').textContent && !p.get('htpw-line').textContent);
    check('file during ' + action + ': busy controls recover after settlement', !p.get('htpw-generate').disabled && !p.get('htpw-check').disabled);
    if (action === 'batch') check('file during batch: stale batch does not start the next hash', p.pending.length === 0);
  }
  for (const action of ['remove', 'upsert', 'check']) {
    const p = page(); p.type('htpw-user', 'alice'); p.type('htpw-pass', 'old-password');
    p.type('htpw-file', 'alice:' + BC.hashSync('old-password', 4) + '\n' + newerFile);
    const old = p.openFile(); p.get('htpw-' + action).click();
    if (action === 'upsert') await p.release();
    const before = p.get('htpw-file').value;
    old.resolve('# obsolete imported file\n'); await settleRead();
    check(action + ' after file request: earlier read cannot override the later file action', p.get('htpw-file').value === before);
    if (action === 'check') {
      p.comparisons.shift()(); await settleRead();
      check('check after file request: verification reports the retained file', p.get('htpw-file-status').className.includes('success') && p.get('htpw-file').value === before);
    }
  }

}

console.log(`\n${passes} passed, ${failures} failed, ${skips} skipped`);
process.exit(failures ? 1 : 0);
