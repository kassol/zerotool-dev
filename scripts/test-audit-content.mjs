#!/usr/bin/env node
// Regression tests at audit.mjs's content-check seam. Uses in-memory MDX only;
// reads no repo fixtures, writes no files, and never runs a build or the full audit.
import { strict as assert } from 'node:assert';
import { absoluteRunClaimIssues, toolFaqIssues } from './lib/audit-content.mjs';

let passed = 0, failed = 0;
function test(name, run) {
  try { run(); passed++; }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}

const claims = [
  '100% client-side', '100％ ローカル', '100% private', '100% in your browser',
  'Entirely in your browser', 'Fully client-side', 'Entirely client-side', 'Completely local',
  '纯浏览器端运行', '完全在浏览器中处理', 'ブラウザ完結',
  '完全ブラウザ処理', '完全にブラウザで処理', '브라우저에서 완결', '완전히 브라우저에서 처리',
  '完全クライアントサイド', '完全なクライアントサイド処理',
  '완전 브라우저 처리', '完全 브라우저 처리',
  'Your data never leaves your browser.', 'The key never leaves the tab.',
  'Sensitive responses never leave your machine.', 'The image never leaves the page.',
  'The input never leaves your device.', 'It never leaves your computer.',
  'Your Markdown stays in your browser.', 'Images stay in the browser tab.',
  'Your tags remain inside your browser.', 'Files stay in browser.',
  'Nothing leaves your browser.', 'Nothing leaves your machine.',
  '数据不离开你的设备。', '私钥全程不离开本机。', '数据不离开本地。',
  '密钥和消息不会离开你的设备。', '数据不出本机。', '数据从未离开过本机。',
  '文字和文档其余部分留在浏览器里。', '输入文字留在你的浏览器内。',
  'ファイルはブラウザ外に出ません。', 'ファイルはブラウザーの外に出ません。',
  'パスワードはブラウザから外に出ません。', '写真はブラウザ内に留まります。',
  '入力はブラウザー内にとどまります。',
  '入力はブラウザの中に留まります。', '入力はマシンから出ません。',
  '入力はブラウザを離れません。', 'データはマシンを離れない。',
  '데이터가 브라우저 밖으로 나가지 않습니다.', '데이터가 브라우저 밖으로 나가지 않음',
  'Markdown은 브라우저에 남습니다.', '입력은 브라우저 안에만 남습니다.',
  '입력은 머신을 떠나지 않습니다.', '입력은 브라우저를 벗어나지 않습니다.',
  '파일이 기기 밖으로 나가지 않음', '정책은 브라우저 탭을 떠나지 않는다.',
];
for (const text of claims) test(`rejects ${text}`, () => {
  assert.ok(absoluteRunClaimIssues('src/content/tools/example/en.mdx', text).length > 0);
});

const facts = [
  'Runs in your browser. Tool input is not uploaded to our servers.',
  'The tool makes no network request with the image or any tile.',
  'Clipboard and downloaded files contain copies of your input.',
  'The generated private key is not sent to a server; copying or downloading creates a copy.',
  'The key never leaves the hardware boundary.',
  'The mapping never leaves the process that built it.',
  'The values stay in the browser history after #.',
  'Settings stay in your browser’s local storage until you clear them.',
  'Keys stay in this browser tab until Clear; Copy writes to the system clipboard.',
  'Values stay in browser memory until you close the tab; Download saves a separate copy.',
  '在浏览器中处理；工具不上传输入内容。复制和下载会生成副本。',
  '工具不会把输入发送到我们的服务器。基准时间会留在浏览器历史里。',
  '设置保存在本浏览器的 localStorage 中。',
  'ブラウザ内で処理します。入力を当サイトのサーバーには送信しません。',
  '設定はブラウザ内のローカルストレージに保存されます。',
  '브라우저에서 처리하며 입력을 당사 서버에 업로드하지 않습니다.',
  '브라우저의 로컬 저장소에 설정을 저장합니다.',
  'Analytics records only tool name and action, not SVG content.',
  'Lookups send the domain to the selected Cloudflare or Google DNS resolver.',
  'Images load from their URLs; their hosts receive a request.',
  'Export downloads web images only with Embed web images enabled.',
  'Copying never leaves the previous output selected.',
];
for (const text of facts) test(`allows ${text}`, () => {
  assert.deepEqual(absoluteRunClaimIssues('src/content/tools/example/en.mdx', text), []);
});

test('claims include source path and line', () => {
  assert.match(absoluteRunClaimIssues('src/i18n/en.json', 'OK\nYour data never leaves your browser.')[0], /^src\/i18n\/en\.json:2:/);
});
for (const eol of ['\n', '\r\n']) test(`draft blog is skipped (${JSON.stringify(eol)})`, () => {
  assert.deepEqual(absoluteRunClaimIssues('src/content/blog/example/en.mdx', ['---', 'draft: true # unpublished', '---', claims[0]].join(eol)), []);
});
for (const header of ['draft: false', 'noindex: true', 'draft: "true"']) test(`published ${header} is scanned`, () => {
  assert.ok(absoluteRunClaimIssues('src/content/blog/example/en.mdx', `---\n${header}\n---\n${claims[0]}`).length > 0);
});
test('malformed blog YAML cannot hide claims', () => {
  assert.ok(absoluteRunClaimIssues('src/content/blog/example/en.mdx', `---\ndraft: true\nbroken: [\n---\n${claims[0]}`).length > 0);
});
test('tool draft field does not skip scanning', () => {
  assert.ok(absoluteRunClaimIssues('src/content/tools/example/en.mdx', `---\ndraft: true\n---\n${claims[0]}`).length > 0);
});

const mdx = (yaml) => `---\n${yaml}\n---\n\nBody.\n`;
const valid = mdx('faqItems: [{question: "Question?", answer: "Answer."}]');
const pages = (overrides = {}) => ({ en: valid, zh: valid, ja: valid, ko: valid, ...overrides });
test('four valid languages pass', () => assert.deepEqual(toolFaqIssues('example', pages()), []));
test('FAQ shape errors identify file and item', () => {
  assert.match(toolFaqIssues('example', pages({ ko: mdx('faqItems: [{question: Q, answer: 12}]') }))[0],
    /src\/content\/tools\/example\/ko\.mdx: faqItems\[0\]\.answer/);
});
test('equal counts in different YAML styles and multiline answers pass', () => {
  assert.deepEqual(toolFaqIssues('example', pages({
    zh: mdx('faqItems:\n- answer: 答案\n  question: 问题'),
    ja: mdx('faqItems:\n  - question: 質問\n    answer: |\n      回答\n      - question: this line is answer text'),
    ko: mdx('entry: &entry {question: 질문, answer: 답변}\nfaqItems: [*entry]'),
  })), []);
});
test('real YAML count ignores question-like body and scalar text', () => {
  const one = mdx('notes: |\n  - question: not a FAQ\nfaqItems:\n- question: Q\n  answer: >-\n    - question: still an answer') + '\n- question: in the body\n';
  assert.deepEqual(toolFaqIssues('example', pages({ zh: one })), []);
});
for (const lang of ['en', 'zh', 'ja', 'ko']) test(`count mismatch in ${lang} fails`, () => {
  const twice = mdx('faqItems: [{question: Q, answer: A}, {question: Q2, answer: A2}]');
  const issues = toolFaqIssues('example', pages({ [lang]: twice }));
  assert.equal(issues.length, 1);
  assert.match(issues[0], /FAQ counts differ \(en=\d, zh=\d, ja=\d, ko=\d\)/);
});
for (const [name, text] of [
  ['missing file', null], ['missing header', 'Body.'], ['unclosed header', '---\nfaqItems: []'],
  ['bad YAML', mdx('faqItems: [')], ['duplicate YAML field', mdx('faqItems: []\nfaqItems: []')],
  ['empty mapping', mdx('')], ['scalar header', mdx('text')], ['sequence header', mdx('- text')],
  ['absent FAQ', mdx('title: T')], ['null FAQ', mdx('faqItems: null')],
  ['empty FAQ', mdx('faqItems: []')], ['mapping FAQ', mdx('faqItems: {question: Q, answer: A}')],
  ['scalar FAQ', mdx('faqItems: text')], ['null item', mdx('faqItems: [null]')],
  ['string item', mdx('faqItems: [text]')], ['sequence item', mdx('faqItems: [[Q, A]]')],
  ['missing question', mdx('faqItems: [{answer: A}]')], ['missing answer', mdx('faqItems: [{question: Q}]')],
  ['numeric question', mdx('faqItems: [{question: 12, answer: A}]')],
  ['boolean answer', mdx('faqItems: [{question: Q, answer: true}]')],
  ['empty question', mdx('faqItems: [{question: "", answer: A}]')],
  ['blank answer', mdx('faqItems: [{question: Q, answer: "  "}]')],
  ['mapping answer', mdx('faqItems: [{question: Q, answer: {value: A}}]')],
]) test(`${name} fails even if every language has it`, () => {
  assert.ok(toolFaqIssues('example', { en: text, zh: text, ja: text, ko: text }).length >= 4);
});
test('CRLF frontmatter and closing delimiter at EOF pass', () => {
  assert.deepEqual(toolFaqIssues('example', pages({ zh: valid.replace(/\n/g, '\r\n'), ko: valid.slice(0, valid.indexOf('\n---', 4) + 4) })), []);
});

console.log(`Audit content: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
