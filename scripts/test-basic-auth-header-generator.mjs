// Basic Auth Header Generator — decoding reports the right reason for non-UTF-8 credentials
//
// Read:  src/components/tools/BasicAuthHeaderGeneratorTool.astro (extracts the real engine
//        block between the `engine:start` / `engine:end` markers), the 4 tool page mdx files
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: RFC 7617 §2 example (Aladdin / open sesame) and the two §2.1 examples
// ("test" / "123£" sent as UTF-8 "dGVzdDoxMjPCow==" and as ISO-8859-1 "dGVzdDoxMjOj").
// Before the fix the ISO-8859-1 token was reported as "Invalid Base64 token." because the
// strict UTF-8 decoder threw inside the same try block; now it decodes as ISO-8859-1 and is
// marked so the page can say why. Also: header / scheme / token forms, first-colon split,
// real Base64 errors still reported as invalidBase64, missing colon, 4 language strings.
//
// Run: node scripts/test-basic-auth-header-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/BasicAuthHeaderGeneratorTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in BasicAuthHeaderGeneratorTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { decodeCredentials };')();

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
function errorOf(input) {
  try { E.decodeCredentials(input); return null; } catch (e) { return e.message; }
}

eq('RFC 7617 §2 example', E.decodeCredentials('Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=='), { username: 'Aladdin', password: 'open sesame', charset: 'utf-8' });
eq('RFC 7617 §2.1 UTF-8 example', E.decodeCredentials('dGVzdDoxMjPCow=='), { username: 'test', password: '123£', charset: 'utf-8' });
eq('RFC 7617 §2.1 ISO-8859-1 example is decoded, not "invalid Base64"', E.decodeCredentials('dGVzdDoxMjOj'), { username: 'test', password: '123£', charset: 'iso-8859-1' });
eq('full Authorization header, any case', E.decodeCredentials('authorization:  basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=='), { username: 'Aladdin', password: 'open sesame', charset: 'utf-8' });
eq('split at the first colon', E.decodeCredentials(Buffer.from('user:pa:ss').toString('base64')), { username: 'user', password: 'pa:ss', charset: 'utf-8' });
eq('UTF-8 username', E.decodeCredentials(Buffer.from('José:pässword', 'utf8').toString('base64')).username, 'José');
eq('page example cmVu6WU6czNjcmV0 (renée / s3cret in ISO-8859-1)', E.decodeCredentials('cmVu6WU6czNjcmV0'), { username: 'renée', password: 's3cret', charset: 'iso-8859-1' });
eq('ISO-8859-1 username', E.decodeCredentials(Buffer.from('José:x', 'latin1').toString('base64')), { username: 'José', password: 'x', charset: 'iso-8859-1' });
eq('empty password', E.decodeCredentials(Buffer.from('user:').toString('base64')), { username: 'user', password: '', charset: 'utf-8' });

eq('bad Base64 character', errorOf('Basic abc$'), 'invalidBase64');
eq('Base64 length 4n+1', errorOf('QWxhZ'), 'invalidBase64');
eq('URL-safe alphabet is rejected', errorOf('Basic QWxh-_'), 'invalidBase64');
eq('other scheme', errorOf('Bearer abc'), 'invalidScheme');
eq('empty input', errorOf('   '), 'missingDecode');
eq('no colon', errorOf(Buffer.from('nocolon').toString('base64')), 'missingColon');

// strings
const keysOf = (lang) => {
  const block = source.slice(source.indexOf(lang + ': {'), source.indexOf('}', source.indexOf(lang + ': {')));
  return [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]).sort();
};
const en = keysOf('en');
check('en has decodedLatin1', en.includes('decodedLatin1'));
for (const lang of ['zh', 'ja', 'ko']) eq(lang + ' STRINGS keys match en', keysOf(lang), en);

// pages
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/basic-auth-header-generator', lang + '.mdx'), 'utf8');
  check(lang + ': page describes the ISO-8859-1 fallback, not a Base64 error', mdx.includes('cmVu6WU6czNjcmV0') && !/Invalid Base64 token\.\", even|Base64 token 无效。」，尽管|Base64 トークンが無効です。」になります|유효하지 않습니다.\"가 됩니다/.test(mdx), lang);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
