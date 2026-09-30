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
  check('1 MB detect under 1000 ms in Node', t1 - t0 < 1000, (t1 - t0).toFixed(1) + ' ms');
}

console.log('PASS ' + passes + '  FAIL ' + failures);
process.exit(failures ? 1 : 0);
