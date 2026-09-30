// Text Case Converter — word splitting for camelCase / PascalCase / kebab / snake / CONSTANT
//
// Read:  src/components/tools/TextCaseTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: words split at lower→upper and ACRONYM→Word case boundaries, at letter↔digit
// boundaries and at separators (change-case v5 `split` + `separateNumbers`; lodash `words`
// also puts digits in their own word). Before the fix, camelCase input was lowercased as one
// word (userLoginCount → userlogincount) and letters outside a–z were dropped (café → caf).
// Unicode letters, combining marks and digits are kept; apostrophes are removed inside words
// (lodash `reApos`); accents are kept in every format (the tool page does not promise ASCII
// output; the Slugify tool does). Title Case / Sentence case keep the text's own spacing and
// punctuation.
//
// Run: node scripts/test-text-case.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/TextCaseTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in TextCaseTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { converters };')();
const conv = {};
E.converters.forEach((c) => { conv[c.id] = c.fn; });

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
function all(input, expected) {
  Object.keys(expected).forEach((id) => eq(id + '(' + JSON.stringify(input) + ')', conv[id](input), expected[id]));
}

// ---------- the reported defect: camelCase input is one word ----------
all('userLoginCount', {
  camel: 'userLoginCount', pascal: 'UserLoginCount', kebab: 'user-login-count',
  snake: 'user_login_count', constant: 'USER_LOGIN_COUNT',
});
all('UserLoginCount', { camel: 'userLoginCount', snake: 'user_login_count' });
// acronym followed by a word (change-case SPLIT_UPPER_UPPER_RE)
all('XMLHttpRequest', { camel: 'xmlHttpRequest', pascal: 'XmlHttpRequest', kebab: 'xml-http-request', constant: 'XML_HTTP_REQUEST' });
all('parseHTML', { kebab: 'parse-html', camel: 'parseHtml' });
all('USER_LOGIN_COUNT', { camel: 'userLoginCount', kebab: 'user-login-count' });
all('user-login-count', { camel: 'userLoginCount', pascal: 'UserLoginCount', snake: 'user_login_count' });

// ---------- digit boundaries ----------
all('base64Encode', { kebab: 'base-64-encode', camel: 'base64Encode', snake: 'base_64_encode' });
all('version 2 update', { camel: 'version2Update', kebab: 'version-2-update' });
all('2FA code', { kebab: '2-fa-code', constant: '2_FA_CODE' });

// ---------- the reported defect: letters outside a–z dropped ----------
all('café au lait', { camel: 'caféAuLait', pascal: 'CaféAuLait', kebab: 'café-au-lait', snake: 'café_au_lait', constant: 'CAFÉ_AU_LAIT' });
all('Straße Übung', { kebab: 'straße-übung', camel: 'straßeÜbung' });
all('ÉlanVital', { kebab: 'élan-vital', camel: 'élanVital' });
all('Привет мир', { camel: 'приветМир', kebab: 'привет-мир' });
all('用户 登录', { kebab: '用户-登录', snake: '用户_登录' });
// NFD input: the combining acute accent stays with its letter
eq('combining mark kept', conv.kebab('cafe\u0301 noir'), 'cafe\u0301-noir');

// ---------- separators and punctuation ----------
all('  hello,   world!  ', { camel: 'helloWorld', kebab: 'hello-world', snake: 'hello_world' });
all("don't stop", { kebab: 'dont-stop', camel: 'dontStop' });
all('it’s fine', { kebab: 'its-fine' });
all('__init__', { camel: 'init', constant: 'INIT' });
all('!!!', { camel: '', kebab: '', constant: '' });

// ---------- prose formats keep spacing and punctuation ----------
eq('title', conv.title('hello world, élan vital'), 'Hello World, Élan Vital');
eq('title keeps punctuation', conv.title('(hello) world'), '(Hello) World');
eq('sentence', conv.sentence('hello WORLD'), 'Hello world');
eq('upper', conv.upper('café'), 'CAFÉ');
eq('lower', conv.lower('CAFÉ'), 'café');

// ---------- tool page examples ----------
eq('page: title does not split identifiers', conv.title('userLoginCount'), 'Userlogincount');
eq('page: ß in CONSTANT_CASE', conv.constant('Straße'), 'STRASSE');
eq('page: mixed separators', conv.camel('user-login_count'), 'userLoginCount');
eq('page ja: katakana with prolonged sound mark', conv.snake('ユーザー 名'), 'ユーザー_名');
eq('page ko: Hangul', conv.snake('사용자 이름'), '사용자_이름');

// ---------- placeholder sample ----------
all('hello world', {
  upper: 'HELLO WORLD', lower: 'hello world', title: 'Hello World', sentence: 'Hello world',
  camel: 'helloWorld', pascal: 'HelloWorld', kebab: 'hello-world', snake: 'hello_world', constant: 'HELLO_WORLD',
});

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
