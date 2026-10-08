// Secret Redactor — spec-driven regression test
//
// Read:  src/components/tools/SecretRedactorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: every rule category positive + known false-positive negatives, same value →
// same placeholder, overlap resolution, pre-existing placeholder skipping, idempotent
// re-run, restore round-trip and tolerated variations, missing / invented placeholders,
// and a 1,000,000-character timing run. Local-service rules (Feishu / Lark webhook,
// WeCom webhook key, kintone X-Cybozu-Authorization, Kakao KakaoAK) have positives and
// look-alike negatives (doc placeholders, env references, other hosts and paths).
//
// Token-shaped fixtures are assembled by concatenation so no literal secret-shaped
// string sits in the repository (push protection, repo scanners).
//
// Run: node scripts/test-secret-redactor.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { load as loadYaml } from 'js-yaml';
import { toolSteps } from '../src/data/llms.mjs';
import { parseFragment } from 'parse5';
import { contractProblems } from './lib/tool-mdx-contract.mjs';
// Timing limits catch order-of-magnitude regressions; CI runners are several times slower than a dev machine.
const PERF_SLACK = process.env.CI ? 4 : 1;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/SecretRedactorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in SecretRedactorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { LIMIT, RULES, CATEGORY_IDS, detect, restore };')();

// ---------- harness ----------
let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + detail));
}
function equal(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}

const ALL = Object.fromEntries(E.CATEGORY_IDS.map((c) => [c, true]));
const only = (...cats) => Object.fromEntries(E.CATEGORY_IDS.map((c) => [c, cats.includes(c)]));
const run = (text, enabled = ALL) => E.detect(text, enabled);

// Random-looking bodies (mixed case + digits) built at runtime.
const B32 = 'Q9vXmT2kLp8RwZ4nYb7Hc1Js5Df3Ga6E';
const B36 = 'Ab3De6Gh9Jk2Mn5Pq8St1Vw4Yz7Bc0Ef3Hi6';
const B40 = B32 + 'u0KiWoPq';
// Local-service credentials: obviously fake values in the documented shapes.
const FEISHU_TOKEN = '00000000-0000-0000-0000-00000EXAMPLE';
const WECOM_KEY = '00000000-EXAM-PLE0-0000-000000000000';
const KINTONE_AUTH = Buffer.from('EXAMPLE:EXAMPLE').toString('base64'); // RVhBTVBMRTpFWEFNUExF
const KAKAO_KEY = '0000EXAMPLE0000EXAMPLE0000000000';

// ---------- 1. every rule: positive ----------
// [rule id, text, expected redacted value]
const positives = [
  ['private-key', 'k:\n' + '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----\nafter',
    '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----'],
  ['anthropic-key', 'key ' + 'sk-' + 'ant-api03-' + B32 + ' end', 'sk-' + 'ant-api03-' + B32],
  ['openai-key', 'key ' + 'sk-' + 'proj-' + B40 + ' end', 'sk-' + 'proj-' + B40],
  ['openai-legacy-key', 'key ' + 'sk-' + 'Ab3De6Gh9Jk2Mn5Pq8St' + 'T3Blbk' + 'FJ' + 'u0KiWoPqNrLs7Xy2Za9B' + ' end', 'sk-' + 'Ab3De6Gh9Jk2Mn5Pq8St' + 'T3Blbk' + 'FJ' + 'u0KiWoPqNrLs7Xy2Za9B'],
  ['huggingface-token', 'hf ' + 'hf' + '_' + B36 + ' end', 'hf' + '_' + B36],
  ['generic-sk-key', 'deepseek ' + 'sk-' + 'or-v1-' + B40 + ' end', 'sk-' + 'or-v1-' + B40],
  ['github-fine-grained-pat', 'pat ' + 'github' + '_pat_' + (B40 + B40 + 'x').slice(0, 82) + ' end', 'github' + '_pat_' + (B40 + B40 + 'x').slice(0, 82)],
  ['github-token', 'gh ' + 'gh' + 'p_' + B36 + ' end', 'gh' + 'p_' + B36],
  ['gitlab-pat', 'gl ' + 'gl' + 'pat-' + 'Ab3De6Gh9Jk2Mn5Pq8St' + ' end', 'gl' + 'pat-' + 'Ab3De6Gh9Jk2Mn5Pq8St'],
  ['slack-webhook', 'hook https://hooks.slack.com/services/' + 'T000/B000/' + B32 + ' end', 'https://hooks.slack.com/services/' + 'T000/B000/' + B32],
  ['slack-token', 'slack ' + 'xo' + 'xb-' + '1234567890-abcdEFGH' + ' end', 'xo' + 'xb-' + '1234567890-abcdEFGH'],
  ['stripe-secret-key', 'stripe ' + 'sk' + '_live_' + 'Ab3De6Gh9Jk2Mn5P' + ' end', 'sk' + '_live_' + 'Ab3De6Gh9Jk2Mn5P'],
  ['stripe-webhook-secret', 'wh ' + 'wh' + 'sec_' + 'Ab3De6Gh9Jk2Mn5Pq8St1Vw4' + ' end', 'wh' + 'sec_' + 'Ab3De6Gh9Jk2Mn5Pq8St1Vw4'],
  ['aws-access-key-id', 'id ' + 'AKIA' + 'IOSFODNN7EXAMPLE' + ' end', 'AKIA' + 'IOSFODNN7EXAMPLE'],
  ['aws-secret-access-key', 'AWS_SECRET_ACCESS_KEY=' + 'wJalrXUtnFEMI/K7MDENG/' + 'bPxRfiCYEXAMPLEKEY', 'wJalrXUtnFEMI/K7MDENG/' + 'bPxRfiCYEXAMPLEKEY'],
  ['google-api-key', 'g ' + 'AI' + 'za' + 'Ab3De6Gh9Jk2Mn5Pq8St1Vw4Yz7Bc0Ef3Hi' + ' end', 'AI' + 'za' + 'Ab3De6Gh9Jk2Mn5Pq8St1Vw4Yz7Bc0Ef3Hi'],
  ['google-oauth-secret', 'g ' + 'GOC' + 'SPX-' + 'Ab3De6Gh9Jk2Mn5Pq8St1Vw4Yz7B' + ' end', 'GOC' + 'SPX-' + 'Ab3De6Gh9Jk2Mn5Pq8St1Vw4Yz7B'],
  ['sendgrid-key', 'sg ' + 'SG' + '.' + 'Ab3De6Gh9Jk2Mn5Pq8St1V' + '.' + 'Ab3De6Gh9Jk2Mn5Pq8St1Vw4Yz7Bc0Ef3Hi6Kl9Mn2P' + ' end', 'SG' + '.' + 'Ab3De6Gh9Jk2Mn5Pq8St1V' + '.' + 'Ab3De6Gh9Jk2Mn5Pq8St1Vw4Yz7Bc0Ef3Hi6Kl9Mn2P'],
  ['npm-token', 'npm ' + 'np' + 'm_' + B36 + ' end', 'np' + 'm_' + B36],
  ['pypi-token', 'pypi ' + 'pypi-' + 'AgEIcHlwaS5vcmc' + B40 + B32 + ' end', 'pypi-' + 'AgEIcHlwaS5vcmc' + B40 + B32],
  ['telegram-bot-token', 'bot ' + '123456789:' + 'AA' + 'Ab3De6Gh9Jk2Mn5Pq8St1Vw4Yz7Bc0Ef3' + ' end', '123456789:' + 'AA' + 'Ab3De6Gh9Jk2Mn5Pq8St1Vw4Yz7Bc0Ef3'],
  ['jwt', 'jwt ' + 'ey' + 'JhbGciOiJIUzI1NiJ9' + '.ey' + 'JzdWIiOiIxMjM0In0' + '.' + 'sig_Ab3De6' + ' end', 'ey' + 'JhbGciOiJIUzI1NiJ9' + '.ey' + 'JzdWIiOiIxMjM0In0' + '.' + 'sig_Ab3De6'],
  ['basic-auth-header', 'Authorization: Basic ' + 'dXNlcjpwYXNzd29yZA==', 'dXNlcjpwYXNzd29yZA=='],
  ['bearer-token', 'Authorization: Bearer ' + 'opaque.token-value_12345', 'opaque.token-value_12345'],
  ['url-credential', 'DATABASE_URL=postgres://app:' + 'hunter2x' + '@db:5432/app', 'hunter2x'],
  ['keyed-secret', 'db_password: "' + 'correcthorse' + '"', 'correcthorse'],
  ['feishu-webhook', "curl -X POST https://open.feishu.cn/open-apis/bot/v2/hook/" + FEISHU_TOKEN + " -d '{}'", FEISHU_TOKEN],
  ['wecom-webhook-key', "curl 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=" + WECOM_KEY + "'", WECOM_KEY],
  ['kintone-password-auth', 'curl -H "X-Cybozu-Authorization: ' + KINTONE_AUTH + '" https://example.cybozu.com/k/v1/record.json', KINTONE_AUTH],
  ['kakao-rest-api-key', 'curl -H "Authorization: KakaoAK ' + KAKAO_KEY + '" https://dapi.kakao.com/v2/local/search/address.json', KAKAO_KEY],
];
for (const [id, text, value] of positives) {
  const r = run(text);
  const e = r.entries.find((x) => x.value === value);
  check('positive ' + id, !!e && e.rule === id, JSON.stringify(r.entries.map((x) => [x.rule, x.value])));
  check('positive ' + id + ' removes value', !r.output.includes(value));
}
check('every rule has a positive case', E.RULES.every((rule) => positives.some((p) => p[0] === rule.id)));

// entropy
{
  const v = 'Zq8Xw3Rt6Yp1Lm4Nk7Jh2Gf5Dd9Sa0Qb3';
  const r = run('value: x ' + v + ' done', only('entropy'));
  check('positive high-entropy', r.entries.length === 1 && r.entries[0].value === v && r.entries[0].ph === '[HIGH_ENTROPY_1]', JSON.stringify(r.entries));
}

// ---------- 2. known false-positive negatives ----------
const negatives = [
  ['git SHA (40 hex)', 'commit 9fceb02d0ae598e95dc970b74767f19372d61af8 merged'],
  ['sha256 digest', 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['UUID', 'request 123e4567-e89b-12d3-a456-426614174000 done'],
  ['max_tokens', 'max_tokens: 1024'],
  ['token_count', 'token_count=12'],
  ['env reference', 'DB_PASSWORD=${DB_PASS}'],
  ['template placeholder', 'api_key: "<your-api-key>"'],
  ['mustache placeholder', 'secret: {{ .Values.secret }}'],
  ['masked stars', 'password: ********'],
  ['boolean value', 'require_token: true'],
  ['npm integrity', '"integrity": "sha512-' + 'Ab3De6Gh9Jk2Mn5Pq8St1Vw4Yz7Bc0Ef3Hi6Kl9Mn2Pq5St8Vw1Yz4Bc7Ef0Hi3Kl6=="'],
  ['data URI', 'src="data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="'],
  ['mixed-case path', 'at src/components/tools/SecretRedactorTool2Astro/renderOutput.js'],
  ['certificate block', '-----BEGIN CERTIFICATE-----\nMIIDdzCCAl+gAwIBAgIEAgAAuTANBgkqhkiG9w0BAQUFADBaMQswCQYDVQQGEwJJ\n-----END CERTIFICATE-----'],
  ['stripe publishable key (rule 12 only)', 'pk' + '_live_' + 'Ab3De6Gh9Jk2Mn5P'],
  ['placeholder-looking text', 'see [SECRET_1] and [OPENAI_KEY_2]'],
];
for (const [name, text] of negatives) {
  const r = run(text);
  equal('negative ' + name, r.entries.length, 0);
}

// ---------- 2b. local-service credentials: variants and look-alikes ----------
{
  const lark = run('POST https://open.larksuite.com/open-apis/bot/v2/hook/' + FEISHU_TOKEN);
  check('lark webhook host', lark.entries.length === 1 && lark.entries[0].rule === 'feishu-webhook', JSON.stringify(lark.entries));
  equal('feishu keeps the URL, masks the token', run('https://open.feishu.cn/open-apis/bot/v2/hook/' + FEISHU_TOKEN).output, 'https://open.feishu.cn/open-apis/bot/v2/hook/[FEISHU_HOOK_TOKEN_1]');
  const upload = run('POST https://qyapi.weixin.qq.com/cgi-bin/webhook/upload_media?type=file&key=' + WECOM_KEY);
  check('wecom upload_media, key after another param', upload.entries.length === 1 && upload.entries[0].value === WECOM_KEY, JSON.stringify(upload.entries));
  equal('wecom keeps the URL, masks the key', run('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + WECOM_KEY).output, 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=[WECOM_WEBHOOK_KEY_1]');
  const json = run('{"X-Cybozu-Authorization": "' + KINTONE_AUTH + '"}');
  check('kintone header in JSON', json.entries.length === 1 && json.entries[0].rule === 'kintone-password-auth', JSON.stringify(json.entries));
  const kakaoLower = run("headers = {'authorization': 'KakaoAK " + KAKAO_KEY + "'}");
  check('KakaoAK in a Python dict', kakaoLower.entries.length === 1 && kakaoLower.entries[0].rule === 'kakao-rest-api-key', JSON.stringify(kakaoLower.entries));
  equal('KakaoAK keeps the scheme', run('Authorization: KakaoAK ' + KAKAO_KEY).output, 'Authorization: KakaoAK [KAKAO_API_KEY_1]');
}
const localNegatives = [
  ['feishu doc placeholder ****', 'https://open.feishu.cn/open-apis/bot/v2/hook/****'],
  ['feishu doc placeholder xxxx', 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxxxxxxxxxxx'],
  ['feishu other open-apis path', 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id'],
  ['feishu hook on another host', 'https://example.com/open-apis/bot/v2/hook/' + FEISHU_TOKEN.replace(/0/g, '1')],
  ['wecom placeholder KEY', 'https://qyapi.weixin.qq.com/cgi-bin/webhook/upload_media?key=KEY&type=TYPE'],
  ['wecom env reference', 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${WECOM_KEY}'],
  ['wecom other API with key=', 'https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=ww0000&corpsecret=${S}&key=abcdefgh1234'],
  ['key= on another host', 'https://example.com/search?key=Ab3De6Gh9Jk2'],
  ['kintone env reference', 'X-Cybozu-Authorization: ${KINTONE_AUTH}'],
  ['kintone btoa call', "'X-Cybozu-Authorization': btoa(user + ':' + pass)"],
  ['kintone variable name', "'X-Cybozu-Authorization': encodedCredentials"],
  ['kintone base64 without colon', 'X-Cybozu-Authorization: ' + Buffer.from('no-colon-here').toString('base64')],
  ['kintone header name in prose', 'Set the X-Cybozu-Authorization header to the Base64 of login:password.'],
  ['kakao env reference', 'Authorization: KakaoAK ${REST_API_KEY}'],
  ['kakao doc placeholder', 'Authorization: KakaoAK {REST_API_KEY}'],
  ['kakao bare placeholder', 'Authorization: KakaoAK REST_API_KEY'],
  ['kakao in prose', 'Send the key with the KakaoAK scheme in the Authorization header.'],
];
for (const [name, text] of localNegatives) {
  const r = run(text);
  equal('negative ' + name, r.entries.length, 0);
}
{
  const r = run('client_secret: Bearer ' + 'opaque.token-value_12345');
  check('keyed rule skips scheme word Bearer', r.entries.length === 1 && r.entries[0].rule === 'bearer-token', JSON.stringify(r.entries));
}
{
  const r = run('aws_access_key_id=' + 'AKIA' + 'IOSFODNN7EXAMPLE');
  check('aws_access_key_id not keyed-secret', r.entries.length === 1 && r.entries[0].rule === 'aws-access-key-id', JSON.stringify(r.entries));
}

// ---------- 3. placeholders ----------
{
  const key = 'sk-' + 'proj-' + B40;
  const text = 'A=' + key + '\nlog: ' + key + '\nagain ' + key;
  const r = run(text);
  equal('same value → one entry', r.entries.length, 1);
  equal('same value → count 3', r.entries[0] && r.entries[0].count, 3);
  equal('same value → same placeholder', r.output, 'A=[OPENAI_KEY_1]\nlog: [OPENAI_KEY_1]\nagain [OPENAI_KEY_1]');
}
{
  const text = 'password=first1 password=second2 password=first1';
  const r = run(text);
  equal('per-label numbering', r.output, 'password=[SECRET_1] password=[SECRET_2] password=[SECRET_1]');
}
{
  // Overlap: rule 3, rule 6, rule 26 and entropy all hit; rule 3 wins.
  const r = run('OPENAI_API_KEY=' + 'sk-' + 'proj-' + B40);
  check('overlap → openai-key wins', r.entries.length === 1 && r.entries[0].rule === 'openai-key' && r.entries[0].label === 'OPENAI_KEY', JSON.stringify(r.entries));
  equal('overlap output', r.output, 'OPENAI_API_KEY=[OPENAI_KEY_1]');
}
{
  // Bearer JWT: rule 22 beats rule 24 on the same span.
  const jwt = 'ey' + 'JhbGciOiJIUzI1NiJ9' + '.ey' + 'JzdWIiOiIxMjM0In0' + '.' + 'sig_Ab3De6';
  const r = run('Authorization: Bearer ' + jwt);
  check('overlap → jwt beats bearer', r.entries.length === 1 && r.entries[0].rule === 'jwt', JSON.stringify(r.entries));
}
{
  // Category off → lower-priority rule takes over.
  const r = run('OPENAI_API_KEY=' + 'sk-' + 'proj-' + B40, only('password'));
  check('ai off → keyed-secret takes it', r.entries.length === 1 && r.entries[0].rule === 'keyed-secret', JSON.stringify(r.entries));
  const none = run('OPENAI_API_KEY=' + 'sk-' + 'proj-' + B40, only());
  equal('all off → no entries', none.entries.length, 0);
}
{
  const text = 'existing [SECRET_1] here; password=hunter22';
  const r = run(text);
  equal('pre-existing placeholder skipped in numbering', r.output, 'existing [SECRET_1] here; password=[SECRET_2]');
  const back = E.restore('rotate [SECRET_2]; ignore [SECRET_1]', r.entries);
  equal('restore never touches pre-existing literal', back.text, 'rotate hunter22; ignore [SECRET_1]');
}
{
  const text = [
    'OPENAI_API_KEY=' + 'sk-' + 'proj-' + B40,
    'DATABASE_URL=postgres://app:' + 'S3cure!Pass42' + '@db:5432/app',
    'Authorization: Bearer ' + 'opaque.token-value_12345',
  ].join('\r\n');
  const once = run(text);
  const twice = run(once.output);
  equal('re-run on redacted text finds nothing', twice.entries.length, 0);
  equal('re-run output identical', twice.output, once.output);
  check('CRLF preserved', once.output.split('\r\n').length === 3);
}
{
  const text = 'k ' + '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\nno end marker';
  const r = run(text);
  check('unterminated private key → redact to end', r.entries.length === 1 && r.output === 'k [PRIVATE_KEY_1]', JSON.stringify(r.output));
}
{
  const text = '日本語 🙂 password=hunter22 中文';
  const r = run(text);
  equal('surrogate pairs / CJK intact', r.output, '日本語 🙂 password=[SECRET_1] 中文');
}

// ---------- 4. restore ----------
{
  const key = 'sk-' + 'proj-' + B40;
  const pw = 'S3cure!Pass42';
  const text = 'OPENAI_API_KEY=' + key + '\nDATABASE_URL=postgres://app:' + pw + '@db:5432/app';
  const r = run(text);
  const back = E.restore(r.output, r.entries);
  equal('round-trip restores input exactly', back.text, text);
  equal('round-trip total', back.total, 2);
  equal('round-trip distinct', back.distinct, 2);

  const variants = 'a [OPENAI_KEY_1] b \\[OPENAI_KEY_1\\] c [openai_key_1] d [ OPENAI_KEY_1 ] e `[OPENAI_KEY_1]`';
  const v = E.restore(variants, r.entries);
  equal('accepted variations', v.text, 'a ' + key + ' b ' + key + ' c ' + key + ' d ' + key + ' e `' + key + '`');
  equal('accepted variations count', v.total, 5);

  const rejected = 'OPENAI_KEY_1 and [OPENAI_KEY_01] and [OPENAI-KEY-1]';
  const rj = E.restore(rejected, r.entries);
  equal('rejected variations untouched', rj.text, rejected);
  equal('rejected variations count', rj.total, 0);

  const partial = E.restore('rotate [OPENAI_KEY_1] and [PASSWORD_7], also [OPENAI_KEY_1]', r.entries);
  equal('missing placeholder: total', partial.total, 2);
  equal('missing placeholder: distinct 1 of 2', partial.distinct, 1);
  equal('invented placeholder reported', JSON.stringify(partial.unknown), '["[PASSWORD_7]"]');
  check('invented placeholder left unchanged', partial.text.includes('[PASSWORD_7]'));

  const empty = E.restore('no placeholders here', r.entries);
  check('no placeholders → unchanged', empty.total === 0 && empty.text === 'no placeholders here');

  const nested = E.restore('[URL_PASSWORD_1]', [{ ph: '[URL_PASSWORD_1]', value: '[OPENAI_KEY_1]' }, { ph: '[OPENAI_KEY_1]', value: 'x' }]);
  equal('restored value is not re-scanned', nested.text, '[OPENAI_KEY_1]');
}

// ---------- 5. 1,000,000-character timing ----------
{
  const lines = [
    '2026-09-23T10:12:03Z INFO request id=123e4567-e89b-12d3-a456-426614174000 commit=9fceb02d0ae598e95dc970b74767f19372d61af8 max_tokens=1024 path=/v1/chat/completions',
    '2026-09-23T10:12:04Z WARN Authorization: Bearer ' + 'opaque.token-value_12345' + ' user=alice status=401',
    '2026-09-23T10:12:05Z INFO connecting postgres://app:' + 'S3cure!Pass42' + '@db.internal:5432/app retry=3',
    '2026-09-23T10:12:06Z DEBUG OPENAI_API_KEY=' + 'sk-' + 'proj-' + B40 + ' model=gpt-x',
    '2026-09-23T10:12:07Z DEBUG blob=Zq8Xw3Rt6Yp1Lm4Nk7Jh2Gf5Dd9Sa0Qb3 digest=sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  ];
  let big = '';
  let i = 0;
  while (big.length < E.LIMIT) big += lines[i++ % lines.length] + '\n';
  big = big.slice(0, E.LIMIT);
  const t0 = performance.now();
  const r = run(big);
  const t1 = performance.now();
  const back = E.restore(r.output, r.entries);
  const t2 = performance.now();
  equal('1 MB round-trip exact', back.text === big, true);
  console.log('1 MB detect: ' + (t1 - t0).toFixed(1) + ' ms (' + r.hits.length + ' hits, ' + r.entries.length + ' placeholders); restore: ' + (t2 - t1).toFixed(1) + ' ms');
  check('1 MB detect under 1000 ms in Node', t1 - t0 < 1000 * PERF_SLACK, (t1 - t0).toFixed(1) + ' ms');
}

// ---------- real page copy/clear lifecycle and actual shared shortcuts ----------
const pageScript = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const labelTable = vm.runInNewContext('(' + source.match(/const STRINGS = ([\s\S]*?) as const;/)[1] + ')');
const shell = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = shell.slice(shell.indexOf('// ── Keyboard shortcuts:'), shell.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes('window.ztPersist.clear(_slug)')) throw Error('Shared keyboard handler extraction failed');
function pageVM(lang = 'en', shellFirst = false) {
  const timers = new Map(), copies = [], fallbackCalls = [], cleared = [], tracked = [], windowListeners = {};
  let now = 0, nextTimer = 0, selected, document;
  const childrenOf = el => el.children.flatMap(child => [child, ...childrenOf(child)]);
  const matches = (el, selector) => selector.split(',').some(part => {
    if (el.tagName.startsWith('#')) return false;
    const parts = part.trim().split(/\s+(?![^\[]*\])/), last = parts.pop();
    const attrs = [...last.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)], plain = last.replace(/\[[^\]]*\]/g, '');
    const tag = /^[\w-]+/.exec(plain), id = /#([\w-]+)/.exec(plain);
    if ((tag && el.tagName !== tag[0].toUpperCase()) || (id && el.id !== id[1])) return false;
    if (![...plain.matchAll(/\.([\w-]+)/g)].every(m => el.classList.contains(m[1]))) return false;
    if (!attrs.every(m => m[2] === undefined ? el.getAttribute(m[1]) !== null : el.getAttribute(m[1]) === m[2])) return false;
    if (!parts.length) return true;
    for (let p = el.parentElement; p; p = p.parentElement) if (matches(p, parts.join(' '))) return true;
    return false;
  });
  class Element {
    constructor(tag = 'div') { Object.assign(this, { tagName: tag.toUpperCase(), children: [], attributes: {}, listeners: {}, id: '', className: '', text: '', value: '', style: {}, disabled: false, checked: false, hidden: false, open: false, parentElement: null }); }
    setAttribute(k,v) { this.attributes[k] = String(v); if (['id','class','type','value'].includes(k)) this[k === 'class' ? 'className' : k] = String(v); if (['disabled','checked','hidden','open'].includes(k)) this[k] = true; }
    getAttribute(k) { return this.attributes[k] ?? null; }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) el.className = (el.className + ' ' + c).trim(); }, remove(c) { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); } }; }
    get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
    set textContent(value) { for (const c of this.children) c.parentElement = null; this.children = []; this.text = String(value); }
    set innerHTML(value) { this.textContent = ''; for (const node of parseFragment(String(value)).childNodes) this.appendChild(fromParse5(node)); }
    appendChild(el) { el.parentElement = this; this.children.push(el); return el; }
    append(...els) { els.forEach(el => this.appendChild(el)); }
    removeChild(el) { const i = this.children.indexOf(el); if (i < 0) throw Error('Cannot remove detached node'); this.children.splice(i,1); el.parentElement = null; return el; }
    contains(el) { return this === el || childrenOf(this).includes(el); }
    querySelectorAll(selector) { return childrenOf(this).filter(el => matches(el,selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    addEventListener(type,fn) { (this.listeners[type] ??= []).push(fn); }
    dispatch(type, options = {}) {
      const event = { type, target: this, bubbles: true, defaultPrevented: false, ...options, preventDefault() { this.defaultPrevented = true; } };
      for (let el = this; el; el = el.parentElement) { for (const fn of el.listeners[type] || []) fn.call(el,event); if (!event.bubbles) break; }
      return event;
    }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { document.activeElement = this; }
    select() { selected = this; }
  }
  function fromParse5(node) {
    const el = new Element(node.tagName || node.nodeName);
    if (node.nodeName === '#text') el.text = node.value;
    for (const a of node.attrs || []) el.setAttribute(a.name,a.value);
    for (const c of node.childNodes || []) if (c.nodeName !== '#comment') el.appendChild(fromParse5(c));
    return el;
  }
  const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const { tips: _tips, ...T } = labelTable[lang];
  const categories = vm.runInNewContext('(' + source.match(/const categories = ([\s\S]*?);/)[1] + ')', { L: T });
  let markup = source.slice(source.indexOf('\n---',4)+4,source.indexOf('<script'));
  markup = markup.replace(/<Toggletip\b[\s\S]*?<\/Toggletip>/g, '').replace(/\{categories\.map\(\(c\) => \(([\s\S]*?)\)\)\}/, (_,template) => categories.map(c => template
    .replace(/class=\{`([^`]+)`\}/g, (_,value) => 'class="'+value.replace('${c.id}',c.id)+'"')
    .replace(/=\{c\.id\}/g,'="'+c.id+'"').replace(/\{c\.name\}/g,escape(c.name))).join(''))
    .replace(/=\{L\.(\w+)\}/g,(_,key) => '="'+escape(T[key])+'"').replace(/\{L\.(\w+)\}/g,(_,key) => escape(T[key]));
  document = new Element('#document'); document.body = document.appendChild(new Element('body')); document.activeElement = document.body;
  const widget = document.body.appendChild(new Element()); widget.className = 'tool-widget'; widget.innerHTML = markup;
  document.getElementById = id => childrenOf(document).find(el => el.id === id) ?? null;
  document.createElement = tag => new Element(tag);
  const options = { fallback: false };
  document.execCommand = command => { fallbackCalls.push({ command, value: selected?.value }); if (options.fallback instanceof Error) throw options.fallback; return options.fallback; };
  const context = { document, console, T, atob, btoa, _slug: 'secret-redactor',
    navigator: { clipboard: { writeText(value) { let resolve,reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); copies.push({value,resolve,reject}); return promise; } } },
    ztPersist: { clear(slug) { cleared.push(slug); } }, trackTool(...args) { tracked.push(args); },
    addEventListener(type,fn) { (windowListeners[type] ??= []).push(fn); },
    setTimeout(fn,delay=0) { const id = ++nextTimer; timers.set(id,{fn,delay,due:now+delay}); return id; }, clearTimeout(id) { timers.delete(id); }
  };
  context.window=context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut,context);
  vm.runInContext(pageScript,context);
  if (!shellFirst) vm.runInContext(shortcut,context);
  const get = id => { const el=document.getElementById(id); if (!el) throw Error('Missing actual ID '+id); return el; };
  return { get, context, document, copies, fallbackCalls, options, cleared, tracked, timers,
    input(id,value) { get(id).value=value;get(id).dispatch('input'); },
    key(key='l',modifiers={ctrlKey:true}) { return document.activeElement.dispatch('keydown',{key,...modifiers}); },
    pagehide() { for (const fn of windowListeners.pagehide || []) fn(); },
    advance(ms) { const until=now+ms;for (;;) { const item=[...timers].filter(([,t])=>t.due<=until).sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];if (!item)break;now=item[1].due;timers.delete(item[0]);item[1].fn(); }now=until; },
    snapshot() { return ['scr-input','scr-reply','scr-output','scr-restored','scr-status','scr-restore-status','scr-unknown','scr-findings-count','scr-copy','scr-copy-restored'].map(id => { const e=get(id); return [id,e.tagName==='TEXTAREA'?e.value:e.textContent,e.className,e.hidden,e.disabled]; }); }
  };
}
const samePage = (name,actual,expected) => equal(name,JSON.stringify(actual),JSON.stringify(expected));
const flushCopy = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const copyMessages = {
  en: 'Could not copy. Select and copy the text manually.',
  zh: '复制失败。请选中文本后手动复制。',
  ja: 'コピーできませんでした。テキストを選択して手動でコピーしてください。',
  ko: '복사하지 못했습니다. 텍스트를 선택하여 직접 복사하세요.'
};
const copyCases = [
  { button:'scr-copy', status:'scr-status', output:'scr-output', expected:'password=[SECRET_1]', action:'redact_copy' },
  { button:'scr-copy-restored', status:'scr-restore-status', output:'scr-restored', expected:'Use sampleSecret42', action:'restore_copy' }
];
function readyPage(lang='en',shellFirst=false) {
  const p=pageVM(lang,shellFirst);
  p.input('scr-input','password=sampleSecret42');p.advance(250);
  p.input('scr-reply','Use [SECRET_1]');p.advance(150);return p;
}
const unhandled=[];const onUnhandled=error=>unhandled.push(String(error));process.on('unhandledRejection',onUnhandled);
for (const lang of Object.keys(copyMessages)) for (const c of copyCases) {
  const name=lang+'/'+c.button,T=labelTable[lang];
  const p=readyPage(lang);samePage(name+': actual detection and restore', [p.get('scr-output').textContent,p.get('scr-restored').textContent], ['password=[SECRET_1]','Use sampleSecret42']);
  p.get(c.button).click();equal(name+': copies full current result',p.copies.at(-1).value,c.expected);
  const beforeStatus=p.get(c.status).textContent;p.copies.at(-1).resolve();await flushCopy();
  samePage(name+': current success preserves scan/restore status',[p.get(c.button).textContent,p.get(c.status).textContent],[T.copied,beforeStatus]);
  p.advance(1399);equal(name+': feedback remains for 1400ms',p.get(c.button).textContent,T.copied);
  p.advance(1);equal(name+': current feedback expires',p.get(c.button).textContent,T.copy);
  for (const api of ['reject','missing','throw']) for (const fallback of [false,new Error('stub copy denied'),true]) {
    const q=readyPage(lang),clipboard=q.context.navigator.clipboard;let thrown;
    q.options.fallback=fallback;
    if (api==='missing')q.context.navigator.clipboard=undefined;
    if (api==='throw')q.context.navigator.clipboard={writeText(){throw Error('API throws synchronously');}};
    try { q.get(c.button).click();if(api==='reject')q.copies.at(-1).reject(Error('API rejected')); } catch(error) { thrown=error.message; }
    await flushCopy();equal(name+'/'+api+': failure boundary does not throw',thrown,undefined);
    samePage(name+'/'+api+': fallback copies only clicked value',q.fallbackCalls,[{command:'copy',value:c.expected}]);
    equal(name+'/'+api+': fallback removes temporary textarea',q.document.querySelectorAll('textarea').length,2);
    if (fallback===true) {
      equal(name+'/'+api+': truthful fallback success',q.get(c.button).textContent,T.copied);
    } else {
      samePage(name+'/'+api+': false/throw fallback is visibly failed',[q.get(c.button).textContent,q.get(c.status).textContent,q.get(c.status).className],[T.copy,copyMessages[lang],'tool-status error']);
      q.context.navigator.clipboard=clipboard;q.get(c.button).click();q.copies.at(-1).resolve();await flushCopy();
      samePage(name+'/'+api+': same-output direct retry clears own error',[q.get(c.button).textContent,q.get(c.status).textContent,q.get(c.output).textContent],[T.copied,'',c.expected]);
    }
  }
}
const lifecyclePasses=passes,lifecycleFailures=failures;
function boundary(p,action) {
  if(action==='clear')p.get('scr-clear').click();
  else if(action==='ctrlL'){p.get('scr-input').focus();p.key();p.advance(0);}
  else if(action==='pagehide')p.pagehide();
  else if(action==='example')p.get('scr-example').click();
  else if(action==='input')p.input('scr-input','password=nextValue73');
  else if(action==='new-redaction'){p.input('scr-input','password=nextValue73');p.advance(250);}
  else if(action==='reply')p.input('scr-reply','Next [SECRET_1]');
  else if(action==='new-reply'){p.input('scr-reply','Next [SECRET_1]');p.advance(150);}
  else if(action==='category'){const toggle=p.document.querySelector('input[data-cat="password"]');toggle.checked=false;toggle.dispatch('change');}
  else if(action==='too-long'){p.input('scr-input','x'.repeat(1000001));p.advance(250);}
  else if(action==='empty'){p.input('scr-input','');p.advance(250);}
  else throw Error('Unknown test boundary '+action);
}
for(const lang of Object.keys(copyMessages))for(const c of copyCases){
  const T=labelTable[lang],name=lang+'/'+c.button;
  const actions=['clear','ctrlL','pagehide','example','input','new-redaction','category','too-long','empty',...(c.button==='scr-copy-restored'?['reply','new-reply']:[])];
  for(const action of actions)for(const shellFirst of action==='ctrlL'?[false,true]:[false])for(const result of ['resolve','reject']){
    const p=readyPage(lang,shellFirst);p.get(c.button).click();const old=p.copies.at(-1);boundary(p,action);
    const before=p.snapshot(),track=p.tracked.length,fallback=p.fallbackCalls.length;
    old[result](result==='reject'?Error('old request rejected'):undefined);await flushCopy();
    samePage(`${name}: late ${result} after ${action}, sharedFirst=${shellFirst}`,p.snapshot(),before);
    equal(name+': old '+result+' never invokes fallback after '+action,p.fallbackCalls.length,fallback);
    equal(name+': old '+result+' never reports copied after '+action,p.tracked.length,track);
  }
  for(const action of actions)for(const shellFirst of action==='ctrlL'?[false,true]:[false]){
    const p=readyPage(lang,shellFirst);p.get(c.button).click();p.copies.at(-1).resolve();await flushCopy();
    const timer=[...p.timers.values()].find(t=>t.delay===1400);if(!timer)throw Error('Actual copy feedback timer missing');
    boundary(p,action);equal(name+': '+action+' removes previous feedback immediately',p.get(c.button).textContent,T.copy);
    const before=p.snapshot();timer.fn();samePage(name+': already queued old timer after '+action+' has no effect',p.snapshot(),before);
  }
  for(const shellFirst of [false,true])for(const modifiers of [{ctrlKey:true},{metaKey:true}])for(const outcome of ['resolve','reject']){
    const p=readyPage(lang,shellFirst);p.get(c.button).click();const old=p.copies.at(-1);p.get('scr-reply').focus();p.key('L',modifiers);
    const before=p.snapshot();old[outcome](outcome==='reject'?Error('between keydown and timer'):undefined);await flushCopy();
    samePage(name+': CtrlL synchronously invalidates copy before zero timer',p.snapshot(),before);
    equal(name+': CtrlL blocks fallback before zero timer',p.fallbackCalls.length,0);
    p.advance(0);samePage(name+': shared CtrlL clears inputs and both outputs', ['scr-input','scr-reply'].map(id=>p.get(id).value).concat(['scr-output','scr-restored'].map(id=>p.get(id).textContent)),['','','','']);
    samePage(name+': shared CtrlL preserves disabled persistence contract',p.cleared,['secret-redactor']);
  }
  {
    const p=readyPage(lang);p.get(c.button).click();const old=p.copies.at(-1);p.get(c.button).click();const newer=p.copies.at(-1);
    newer.resolve();await flushCopy();const state=p.snapshot();old.reject(Error('older failed'));await flushCopy();
    samePage(name+': older reject cannot replace newer success',p.snapshot(),state);equal(name+': older reject cannot call fallback',p.fallbackCalls.length,0);
    p.get(c.button).click();const first=p.copies.at(-1);p.get(c.button).click();p.copies.at(-1).reject(Error('newest fails'));await flushCopy();const failed=p.snapshot();first.resolve();await flushCopy();
    samePage(name+': older success cannot clear newer error',p.snapshot(),failed);
    p.get(c.button).click();p.copies.at(-1).resolve();await flushCopy();equal(name+': latest direct retry recovers',p.get(c.status).textContent,'');
  }
  {
    const p=readyPage(lang);p.get(c.button).click();p.copies.at(-1).resolve();await flushCopy();
    const oldTimer=[...p.timers.values()].find(t=>t.delay===1400);p.advance(500);p.get(c.button).click();p.copies.at(-1).resolve();await flushCopy();
    oldTimer.fn();equal(name+': old timer cannot reset newest copied label',p.get(c.button).textContent,T.copied);
    p.advance(900);equal(name+': first deadline retains new copied label',p.get(c.button).textContent,T.copied);
    p.advance(500);equal(name+': newest deadline resets copied label',p.get(c.button).textContent,T.copy);
  }
  {
    const p=readyPage(lang);p.get(c.button).click();p.copies.at(-1).resolve();await flushCopy();p.get(c.button).click();p.copies.at(-1).reject(Error('retry failed'));await flushCopy();
    samePage(name+': false fallback after earlier success cannot leave Copied',[p.get(c.button).textContent,p.get(c.status).textContent],[T.copy,copyMessages[lang]]);
    p.document.body.focus();const before=p.snapshot();p.key();p.advance(0);samePage(name+': CtrlL outside tool leaves current status and data unchanged',p.snapshot(),before);
  }
  {
    const p=readyPage(lang);p.get(c.button).click();p.copies.at(-1).reject(Error('current failure'));await flushCopy();p.get(c.button).click();const retry=p.copies.at(-1);
    boundary(p,'too-long');const before=p.snapshot();retry.resolve();await flushCopy();samePage(name+': retry success cannot erase later validation state',p.snapshot(),before);
  }
}
for(const lang of Object.keys(copyMessages)){
  const p=readyPage(lang),T=labelTable[lang];
  p.get('scr-copy').click();const redacted=p.copies.at(-1);p.input('scr-reply','Next [SECRET_1]');p.advance(150);
  redacted.resolve();await flushCopy();equal(lang+': editing reply keeps unrelated redacted copy current',p.get('scr-copy').textContent,T.copied);
  p.get('scr-copy-restored').click();p.copies.at(-1).reject(Error('restore copy failed'));await flushCopy();const restoreError=p.get('scr-restore-status').textContent;
  p.get('scr-copy').click();p.copies.at(-1).resolve();await flushCopy();equal(lang+': redacted success preserves other copy error',p.get('scr-restore-status').textContent,restoreError);
  p.get('scr-copy').click();p.copies.at(-1).reject(Error('redacted failed'));await flushCopy();const redactError=p.get('scr-status').textContent;
  p.get('scr-copy-restored').click();p.copies.at(-1).resolve();await flushCopy();equal(lang+': restored success preserves other copy error',p.get('scr-status').textContent,redactError);
  const q=pageVM(lang);q.input('scr-input','password=sampleSecret42');q.advance(249);equal(lang+': actual scan waits 250ms',q.get('scr-output').textContent,'');q.advance(1);
  q.input('scr-reply','Use [SECRET_1] and [UNKNOWN_9]');q.advance(149);equal(lang+': actual restore waits 150ms',q.get('scr-restored').textContent,'');q.advance(1);
  samePage(lang+': real mapping/unknown/count state', [q.get('scr-output').textContent,q.get('scr-restored').textContent,q.get('scr-findings-count').textContent,q.get('scr-unknown').hidden,q.get('scr-unknown').textContent.includes('[UNKNOWN_9]')], ['password=[SECRET_1]','Use sampleSecret42 and [UNKNOWN_9]','1',false,true]);
  q.input('scr-input','password=willNeverReturn');q.get('scr-clear').click();q.advance(250);samePage(lang+': queued scan after Clear reads only current empty data',[q.get('scr-input').value,q.get('scr-output').textContent,q.get('scr-restored').textContent,q.get('scr-copy').disabled,q.get('scr-copy-restored').disabled],['','','',true,true]);
  const toggles=q.document.querySelectorAll('input[data-cat]');samePage(lang+': Clear keeps category settings',toggles.map(t=>t.checked),[true,true,true,true,true,true]);
  q.input('scr-input','password=nextValue73');q.advance(250);toggles.forEach(t=>{t.checked=false;t.dispatch('change');});
  samePage(lang+': all detectors off keeps original text and empty mapping',[q.get('scr-output').textContent,q.get('scr-findings-count').textContent,q.get('scr-status').textContent],['password=nextValue73','0',T.statusAllOff]);
}
console.log('Page lifecycle: '+(passes-lifecyclePasses)+' passed, '+(failures-lifecycleFailures)+' failed');

samePage('all rejected copy promises handled',unhandled,[]);
process.removeListener('unhandledRejection',onUnhandled);
equal('protected engine bytes remain exact',createHash('sha256').update(source.slice(startIndex,endIndex+END_MARK.length)).digest('hex'),'cac8d2eecee8cf79150ea3d92f261a0513e98f1a75e761bfa93ce745d42ce7df');

// ---------- v2 page layout ----------
{
  const beforePasses = passes, beforeFailures = failures;
  const markup = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'));
  const css = source.match(/<style is:global>([\s\S]*?)<\/style>/)[1];
  const sha = text => createHash('sha256').update(text).digest('hex');
  const tipKeys = ['detect', 'example', 'clear', 'input', 'output', 'findings', 'reply', 'restored'];
  equal('entire page script remains byte-exact after layout', sha(pageScript), '59b4bedf4be3633631cbf7f91f17b31d3fcc52e4c359611f16ad4853982444d4');
  equal('protected engine is still 11145 bytes', Buffer.byteLength(source.slice(startIndex, endIndex + END_MARK.length)), 11145);
  check('registered convert layout', /'secret-redactor':\s*'convert'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
  check('direct flex root has zero minimum height', /^\s*<div class="scr-wrap">/.test(markup) && /\.scr-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 0/.test(css));
  equal('two shared input/output grids', (markup.match(/class="scr-panels zt-io"/g) || []).length, 2);
  equal('four shared panes', (markup.match(/\bzt-io-pane\b/g) || []).length, 4);
  equal('four filling text regions', (markup.match(/\bzt-io-fill\b/g) || []).length, 4);
  check('desktop stages divide remaining height without viewport-sized children', /\.scr-stage\s*\{[^}]*flex: 1 1 0;[^}]*min-height: 0/.test(css) && /\.scr-panels\.zt-io\s*\{ flex: 1 1 0; min-height: 0; \}/.test(css) && !/100svh|100vh/.test(css));
  check('controls precede stable status and first input', markup.indexOf('scr-controls') < markup.indexOf('id="scr-status"') && markup.indexOf('id="scr-status"') < markup.indexOf('id="scr-input"'));
  samePage('all four original actions remain buttons', [...markup.matchAll(/<button\b[^>]*id="([^"]+)"/g)].map(m => m[1]).sort(), ['scr-example', 'scr-clear', 'scr-copy', 'scr-copy-restored'].sort());
  check('automatic tool has no invented primary execution action', !/btn-primary/.test(markup));
  samePage('eight build-time tips attach to actual workflow', [...markup.matchAll(/<Toggletip id="([^"]+)"/g)].map(m => m[1]).sort(), tipKeys.map(k => 'scr-tip-' + k).sort());
  check('tips and buttons are outside labels and summaries', [...markup.matchAll(/<(?:label|summary)\b[\s\S]*?<\/(?:label|summary)>/g)].every(m => !/<Toggletip|<button/.test(m[0])));
  check('tips are excluded from client payload', /const \{ tips: TIPS, \.\.\.CLIENT_T \} = L;/.test(source) && /define:vars=\{\{ T: CLIENT_T \}\}/.test(source));
  check('no runtime language replacements', !/data-i18n|document\.documentElement\.lang/.test(source));
  check('output pre elements own keyboard-scroll regions', ['scr-output','scr-restored'].every(id => new RegExp('<pre id="' + id + '"[^>]*zt-io-fill[^>]*tabindex="0"').test(markup)) && /\.scr-editor\.zt-io-fill, \.scr-out\.zt-io-fill\s*\{ min-height: 0; overflow: auto; \}/.test(css));
  check('findings fixed height scroll region stays keyboard accessible', /id="scr-findings-list"[^>]*tabindex="0" role="region"/.test(markup) && /\.scr-findings-list\s*\{[^}]*height: min\(12svh, 7rem\);[^}]*overflow: auto/.test(css));
  check('unknown placeholders have visible, reserved, keyboard-scrollable area', markup.indexOf('id="scr-unknown"') > markup.indexOf('id="scr-restored"') && /id="scr-unknown"[^>]*tabindex="0"/.test(markup) && /\.scr-unknown-slot\s*\{ height: 2\.5rem;[^}]*flex: none/.test(css) && /\.scr-unknown\s*\{ height: 100%; overflow: auto;/.test(css));
  check('status height is reserved and scrollable', /\.scr-wrap #scr-status, \.scr-wrap #scr-restore-status\s*\{ height: 1\.5rem; overflow: auto; flex: none; \}/.test(css));
  check('shared hidden cannot be overridden by flex/grid', /\.scr-wrap \[hidden\]\s*\{ display: none !important; \}/.test(css));
  check('860 stacks without hiding either input', /@media \(max-width: 860px\)/.test(css) && /\.scr-result-pane:has\(> \.scr-out:empty\)\s*\{ display: none; \}/.test(css) && !/#scr-(?:input|reply)[^{]*\{[^}]*display:\s*none/.test(css));
  check('phone fixed editor/status heights and 44px controls', /@media \(max-width: 640px\)/.test(css) && /\.scr-editor\.zt-io-fill, \.scr-out\.zt-io-fill\s*\{ height: 10rem; \}/.test(css) && /height: 3\.75rem/.test(css) && /\.scr-controls \.btn-ghost\s*\{ min-height: 44px; \}/.test(css));
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  equal('all IDs unique', new Set(ids).size, ids.length);
  const require = createRequire(import.meta.url);
  const { compile } = await import(require.resolve('@mdx-js/mdx'));
  for (const lang of ['en','zh','ja','ko']) {
    const entry = labelTable[lang], { tips, ...client } = entry;
    samePage(lang + ': all localized keys match', Object.keys(entry).sort(), Object.keys(labelTable.en).sort());
    samePage(lang + ': tip keys match actual controls', Object.keys(tips).sort(), tipKeys.slice().sort());
    for (const key of tipKeys) check(lang + '/' + key + ': plain nonempty tip', typeof tips[key] === 'string' && tips[key].trim().length > 0 && !tips[key].includes('\n'));
    check(lang + ': client excludes every tip string', !('tips' in client) && Object.values(tips).every(tip => !JSON.stringify(client).includes(JSON.stringify(tip))));
    const mdx = readFileSync(join(root, 'src/content/tools/secret-redactor', lang + '.mdx'), 'utf8');
    const [,metadata,body] = mdx.match(/^---([\s\S]*?)---([\s\S]*)$/);
    const parsed = loadYaml(metadata);
    check(lang + ': six plain steps fit content limits', parsed.steps.length === 6 && parsed.steps.every(step => typeof step === 'string' && step.length <= 280 && !/<[^>]*>/.test(step)) && parsed.steps.join('').length <= 1200);
    equal(lang + ': MDX content contract', contractProblems('secret-redactor', lang), '');
    check(lang + ': Usage section removed', !/<h2>(?:How to use|使用步骤|使い方|사용 방법)<\/h2>/.test(body));
    equal(lang + ': llms sees six steps', toolSteps(parsed).length, 6);
    await compile(body); check(lang + ': preserved MDX compiles', true);
    const p = pageVM(lang);
    for (const [id,key] of [['scr-example','loadExample'],['scr-clear','clear'],['scr-copy','copy'],['scr-copy-restored','copy']]) equal(lang + ': localized button ' + id, p.get(id).textContent, entry[key]);
    for (const [id,key] of [['scr-output','outputEmpty'],['scr-restored','restoredEmpty']]) equal(lang + ': localized empty output ' + id, p.get(id).getAttribute('data-empty'), entry[key]);
    for (const id of ['scr-input','scr-reply']) {
      check(lang + ': editable input preserved ' + id, p.get(id).tagName === 'TEXTAREA' && !p.get(id).disabled && p.get(id).getAttribute('readonly') === null);
      samePage(lang + ': sensitive input settings ' + id, ['autocomplete','autocorrect','autocapitalize','spellcheck'].map(k => p.get(id).getAttribute(k)), ['off','off','off','false']);
    }
    for (const [selector,key] of [['.scr-mapping-hint','replyHint'],['.scr-review-hint','reviewHint'],['.scr-restored-hint','restoredHint']]) {
      const hint = p.document.querySelector(selector);
      equal(lang + ': directly rendered ' + key, hint.textContent, entry[key]);
      let hiddenAncestor = false;
      for (let el = hint; el; el = el.parentElement) if (el.hidden || el.tagName === 'DETAILS') hiddenAncestor = true;
      check(lang + ': ' + key + ' is outside collapsed/hidden content', !hiddenAncestor);
    }
    samePage(lang + ': six detector defaults retained', p.document.querySelectorAll('input[data-cat]').map(el => [el.getAttribute('data-cat'),el.checked]), E.CATEGORY_IDS.map(id => [id,true]));
    equal(lang + ': detector details initially closed', p.get('scr-detectors').getAttribute('open'), null);
    const initial = p.snapshot();
    for (const focus of ['scr-input','scr-reply','scr-example']) {
      p.get(focus).focus();p.key('Enter');samePage(lang + ': CtrlEnter has no invented conversion ' + focus,p.snapshot(),initial);
    }
    p.input('scr-input','password=sampleSecret42');p.advance(250);
    p.input('scr-reply','Use [secret_1], [ UNKNOWN_7 ]');p.advance(150);
    samePage(lang + ': visible warning retains unknown placeholder', [p.get('scr-restored').textContent,p.get('scr-unknown').hidden,p.get('scr-unknown').textContent], ['Use sampleSecret42, [ UNKNOWN_7 ]',false,entry.restoreUnknown.replace('{list}','[UNKNOWN_7]')]);
    p.input('scr-reply','[unknown_7]');p.advance(150);
    samePage(lang + ': unknown lowercase spelling stays literal without uppercase warning', [p.get('scr-restored').textContent,p.get('scr-unknown').hidden], ['[unknown_7]',true]);
    p.get('scr-clear').click();check(lang + ': Clear hides warning and findings', p.get('scr-unknown').hidden && p.get('scr-findings').hidden);
    p.input('scr-input','password=sampleSecret42\n' + 'a'.repeat(100000));p.advance(250);
    equal(lang + ': long displayed redacted result keeps every character',p.get('scr-output').textContent,'password=[SECRET_1]\n' + 'a'.repeat(100000));
    p.get('scr-copy').click();equal(lang + ': long result copy has no truncation',p.copies.at(-1).value,p.get('scr-output').textContent);p.copies.at(-1).resolve();await flushCopy();
    p.input('scr-reply', '[SECRET_1]\n'.repeat(2000));p.advance(150);
    equal(lang + ': long restored result keeps every replacement',p.get('scr-restored').textContent,'sampleSecret42\n'.repeat(2000));
    p.get('scr-copy-restored').click();equal(lang + ': long restored copy has no truncation',p.copies.at(-1).value,p.get('scr-restored').textContent);p.copies.at(-1).resolve();await flushCopy();
  }
  const { transform } = await import(require.resolve('@astrojs/compiler', { paths: [dirname(require.resolve('astro'))] }));
  const { transform: parseJs } = await import('esbuild');
  const compiled = await transform(source, { filename: 'SecretRedactorTool.astro' });
  check('Astro compiler emits no errors', compiled.diagnostics.filter(d => d.severity === 1).length === 0);
  await parseJs(compiled.code, { loader: 'ts', format: 'esm' });
  check('compiled script serializes only client strings', compiled.code.includes('$$defineScriptVars({ T: CLIENT_T })'));
  check('global stylesheet contains no unresolved global syntax', !compiled.css.join('\n').includes(':global('));
  check('compiled CSS retains native empty-state selector', compiled.css.join('\n').includes('.scr-result-pane:has(>.scr-out:empty)') || compiled.css.join('\n').includes('.scr-result-pane:has(> .scr-out:empty)'));
  console.log('v2 page layout: ' + (passes - beforePasses) + ' passed, ' + (failures - beforeFailures) + ' failed');
}

console.log('PASS ' + passes + '  FAIL ' + failures);
process.exit(failures ? 1 : 0);
