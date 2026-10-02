// AI Token Counter — tokenizer engine, cost table and page examples
//
// Read:  src/components/tools/ai-token-counter-engine.js (extracts the real engine block between the
//        `engine:start` / `engine:end` markers and the frontmatter STRINGS / SAMPLES tables, so this
//        test cannot drift from the shipped source); js-tiktoken rank files in node_modules;
//        src/data/deepseek-v4-tokenizer.mjs; scripts/test-ai-token-counter.fixtures.json;
//        src/content/tools/ai-token-counter/{lang}.mdx and the ai-token-counter-guide mdx files
// Write: stdout only. With --regenerate: the fixtures file, and temporary files under the OS temp
//        directory (removed afterwards)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Reference implementations (the fixtures hold their output, so CI needs no Python):
//   - OpenAI tiktoken 0.14.0, encode_ordinary() with o200k_base and cl100k_base
//   - Hugging Face tokenizers, Tokenizer.from_file() on DeepSeek's official tokenizer.json from
//     https://cdn.deepseek.com/api-docs/deepseek_v4_tokenizer.zip (the package linked from
//     https://api-docs.deepseek.com/quick_start/token_usage). Its demo script loads the same file
//     with transformers; transformers 4.57.6 gives the same ids, transformers 5.18.0 returns []
//     for Chinese text, so the fixtures use tokenizers directly.
//
// Covers:
// - Token ids equal the reference for every fixture string (fixed edge cases, page samples and
//   examples, 1,500 seeded random strings over ASCII, CJK, Hangul, emoji, combining marks,
//   U+FEFF, U+0085, U+00A0, U+2028, U+3000 and DeepSeek added tokens). Before the fix the page
//   used js-tiktoken's encode(): it differs from tiktoken on text with U+FEFF or U+0085 (JavaScript
//   \s), and it throws on "<|endoftext|>", which left the previous counts on screen.
// - Long pieces: 20,000 Han characters in a row and 100,000 spaces finish in seconds (js-tiktoken
//   took minutes on the first and did not finish the second).
// - encodeSteps() gives the same ids as encodeAll() with any time budget, and progress rises to 1.
// - unicodeWhiteSpace() rewrites \s and \S inside and outside character classes.
// - textStats(): code points (not UTF-16 units), UTF-8 bytes, CRLF / CR / LF lines, words.
// - Cost: per-model prices and limits, long-context rates, CNY prices for DeepSeek, no output price
//   for embeddings, over-limit flag; no model uses a fudge factor (the old page multiplied the
//   o200k count by 0.97 / 1.01 / 0.98 and called it Claude / Gemini / DeepSeek).
// - formatMoney / formatPercent / tokenLabel (partial UTF-8 shown as hex).
// - 4-language STRINGS have the same keys and {placeholders}; SAMPLES exist for each language.
// - Every `{/* atc: {...} */}` example on the tool pages and guide gives the stated counts.
// - The component script makes no network requests (fetch / XHR / sendBeacon / WebSocket).
//
// Run:        node scripts/test-ai-token-counter.mjs
// Regenerate: node scripts/test-ai-token-counter.mjs --regenerate /path/to/python /path/to/tokenizer.json
//             (python with tiktoken==0.14.0 and tokenizers installed)

import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
// Timing limits catch order-of-magnitude regressions; CI runners are several times slower than a dev machine.
const PERF_SLACK = process.env.CI ? 4 : 1;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const componentPath = join(root, 'src/components/tools/AiTokenCounterTool.astro');
const fixturesPath = join(root, 'scripts/test-ai-token-counter.fixtures.json');
const source = readFileSync(componentPath, 'utf8');

const START = '/* ── engine:start ── */';
const END = '/* ── engine:end ── */';
const engineSource = readFileSync(join(root, 'src/components/tools/ai-token-counter-engine.js'), 'utf8');
const s0 = engineSource.indexOf(START);
const s1 = engineSource.indexOf(END);
if (s0 < 0 || s1 <= s0) {
   console.error('FAIL: engine block not found in ai-token-counter-engine.js');
  process.exit(1);
}
const E = new Function(engineSource.slice(s0, s1) + `
return { unicodeWhiteSpace, createTiktokenEncoding, createHfBpeEncoding, encodeAll, encodeSteps, textStats,
  PRICES_CHECKED, PRICE_SOURCES, MODELS, costFor, formatMoney, formatPercent, tokenLabel, fill };`)();

const st0 = source.indexOf('/* ── strings:start ── */');
const st1 = source.indexOf('/* ── strings:end ── */');
const { STRINGS, SAMPLES } = new Function(source.slice(st0, st1) + '\nreturn { STRINGS, SAMPLES };')();

let passes = 0;
let failures = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? '\n      ' + String(detail).slice(0, 600) : ''));
}
const sha = (ids) => createHash('sha256').update(ids.join(',')).digest('hex').slice(0, 16);

const o200kRanks = (await import('js-tiktoken/ranks/o200k_base')).default;
const cl100kRanks = (await import('js-tiktoken/ranks/cl100k_base')).default;
const dsMod = await import(join(root, 'src/data/deepseek-v4-tokenizer.mjs'));
const enc = {
  o200k: E.createTiktokenEncoding('o200k_base', o200kRanks),
  cl100k: E.createTiktokenEncoding('cl100k_base', cl100kRanks),
  deepseek: E.createHfBpeEncoding('DeepSeek V4', dsMod),
};

// ── Page examples: {/* atc: {"text": ..., "o200k": n, "deepseek": n, "cl100k": n} */} ──────
function mdxFiles() {
  const files = [];
  for (const dir of ['src/content/tools/ai-token-counter', 'src/content/blog/ai-token-counter-guide']) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) if (f.endsWith('.mdx')) files.push(join(dir, f));
  }
  return files;
}
function pageExamples() {
  const out = [];
  for (const file of mdxFiles()) {
    const text = readFileSync(join(root, file), 'utf8');
    const re = /\{\/\* atc: (\{[\s\S]*?\}) \*\/\}/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      let spec;
      try { spec = JSON.parse(m[1]); } catch (e) { out.push({ file, error: e.message, raw: m[1] }); continue; }
      out.push({ file, spec, after: text.slice(m.index + m[0].length, m.index + m[0].length + 1500) });
    }
  }
  return out;
}

// ── Inputs whose reference ids live in the fixtures ─────────────────────────────────
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
function fixtureInputs() {
  const fixed = [
    'Hello!', 'Hello, world', '你好，世界', 'こんにちは世界 テスト', '안녕하세요 세계', '12345 abc 1234567',
    'emoji 👨‍👩‍👧 ok 🏳️‍🌈', 'def f(x):\n    return x ** 2  # square\n', '  \u3000x\u00a0y\u2028z\ufeffw\u0085v',
    '<｜User｜>hi<|EOT|>', '<|endoftext|> hi', '<|endoftext|>', 'a\r\nb\rc\n\n\nd', '\t\t\tindent', '',
    'e\u0301 café naïve', 'ＡＢＣ１２３　全角', '123,456.78 €', '\u202e\u202d', 'x'.repeat(300), '中'.repeat(500),
    '\ufeffBOM at the start of a Windows file', 'NEL\u0085line', 'line\u2028sep\u2029para',
    '日本語のテキストを分割します。カタカナとひらがな、漢字。', '한국어 문장입니다. 띄어쓰기가 있어요!',
    'https://example.com/path?q=1&r=2#frag', '{"key": [1, 2, 3], "nested": {"a": null}}',
    'SELECT id, name FROM users WHERE created_at > NOW() - INTERVAL \'7 days\';',
    '    ', ' \n ', '\n', 'a  b   c    d', 'I\'m sure they\'ll say it\'s fine', 'DON\'T STOP',
  ];
  const pool = [...'abcXYZ019 .,;:!?\'"-_()[]{}<>/\\@#$%^&*+=~`|\n\r\t', ...'中文汉字测试一二三ひらがなカタカナ한국어ÉéñÜß€™©',
    '\u3000', '\u00a0', '\u2028', '\ufeff', '\u0085', '\u200d', '👍', '🏽', '\u0301', 'ｱ', '①', '٣', '۳', '😀', '  ', '\u2009',
    '<｜User｜>', '<|EOT|>', '<|endoftext|>', 'Ⅻ', '½', 'the', ' the', 'tion', '\'s', '\'LL', '0000'];
  const rnd = seededRandom(20261001);
  const random = [];
  for (let i = 0; i < 1500; i++) {
    const n = 1 + Math.floor(rnd() * 60);
    let s = '';
    for (let k = 0; k < n; k++) s += pool[Math.floor(rnd() * pool.length)];
    random.push(s);
  }
  const samples = Object.values(SAMPLES);
  const examples = pageExamples().filter((x) => x.spec).map((x) => x.spec.text);
  return [...new Set([...fixed, ...samples, ...examples, ...random])];
}
const LONG = [
  { name: '20,000 Han characters', text: '中'.repeat(20000) },
  { name: '100,000 spaces', text: ' '.repeat(100000) },
  { name: 'repeated sample x 200', text: Object.values(SAMPLES).join('\n\n').repeat(200) },
];

const PY = `
import json, sys, tiktoken, tokenizers
inp = json.load(open(sys.argv[1], encoding='utf-8'))
tok = tokenizers.Tokenizer.from_file(sys.argv[2])
o = tiktoken.get_encoding('o200k_base'); c = tiktoken.get_encoding('cl100k_base')
res = []
for t in inp:
    res.append({'o200k': o.encode_ordinary(t), 'cl100k': c.encode_ordinary(t), 'deepseek': tok.encode(t).ids})
json.dump({'tiktoken': tiktoken.__version__, 'tokenizers': tokenizers.__version__, 'results': res}, open(sys.argv[3], 'w'))
`;

if (process.argv[2] === '--regenerate') {
  const [python, tokenizerJson] = process.argv.slice(3);
  if (!python || !tokenizerJson) {
    console.error('usage: --regenerate /path/to/python /path/to/tokenizer.json');
    process.exit(1);
  }
  const dir = mkdtempSync(join(tmpdir(), 'atc-fixtures-'));
  try {
    const texts = [...fixtureInputs(), ...LONG.map((l) => l.text)];
    writeFileSync(join(dir, 'in.json'), JSON.stringify(texts));
    writeFileSync(join(dir, 'gen.py'), PY);
    execFileSync(python, [join(dir, 'gen.py'), join(dir, 'in.json'), tokenizerJson, join(dir, 'out.json')], { stdio: 'inherit' });
    const out = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));
    const tokenizerSha = createHash('sha256').update(readFileSync(tokenizerJson)).digest('hex');
    const cases = [];
    texts.forEach((t, i) => {
      const r = out.results[i];
      const isLong = i >= texts.length - LONG.length;
      cases.push({
        text: isLong ? null : t,
        long: isLong ? LONG[i - (texts.length - LONG.length)].name : undefined,
        o200k: [r.o200k.length, sha(r.o200k)],
        cl100k: [r.cl100k.length, sha(r.cl100k)],
        deepseek: [r.deepseek.length, sha(r.deepseek)],
        ...(t.length <= 40 && !isLong ? { ids: { o200k: r.o200k, cl100k: r.cl100k, deepseek: r.deepseek } } : {}),
      });
    });
    writeFileSync(fixturesPath, JSON.stringify({
      generated: new Date().toISOString().slice(0, 10),
      reference: { tiktoken: out.tiktoken, tokenizers: out.tokenizers, deepseekTokenizerSha256: tokenizerSha },
      cases,
    }) + '\n');
    console.log('wrote ' + fixturesPath + ' (' + cases.length + ' cases)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  process.exit(0);
}

// ── 1. Reference ids ─────────────────────────────────────────────────────────────
const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf8'));
check('fixtures were made from the same DeepSeek tokenizer.json as the data module',
  fixtures.reference.deepseekTokenizerSha256 === dsMod.SOURCE_SHA256,
  fixtures.reference.deepseekTokenizerSha256 + ' vs ' + dsMod.SOURCE_SHA256);
const byText = new Map(fixtures.cases.filter((c) => c.text !== null).map((c) => [c.text, c]));
const inputs = fixtureInputs();
const missing = inputs.filter((t) => !byText.has(t));
check('every fixture input has reference ids (run --regenerate after changing inputs)', missing.length === 0, JSON.stringify(missing.slice(0, 3)));
let compared = 0;
for (const t of inputs) {
  const ref = byText.get(t);
  if (!ref) continue;
  for (const key of ['o200k', 'cl100k', 'deepseek']) {
    const ids = E.encodeAll(enc[key], t);
    compared++;
    const ok = ids.length === ref[key][0] && sha(ids) === ref[key][1];
    check(`${key} ids for ${JSON.stringify(t).slice(0, 60)}`, ok,
      `got ${ids.length} ${ref.ids ? JSON.stringify(ids) : sha(ids)}, want ${ref[key][0]} ${ref.ids ? JSON.stringify(ref.ids[key]) : ref[key][1]}`);
  }
}
check('compared at least 4,500 encodings', compared >= 4500, compared);

// Spot values that a reader can check against tiktoken by hand.
check('"<|endoftext|>" counts as ordinary text in o200k_base (7 tokens, no exception)', E.encodeAll(enc.o200k, '<|endoftext|>').length === 7, E.encodeAll(enc.o200k, '<|endoftext|>').length);
check('DeepSeek added token <｜User｜> is one token (id 128803)', JSON.stringify(E.encodeAll(enc.deepseek, '<｜User｜>')) === '[128803]');
check('o200k: "Hello!" is [13225, 0]', JSON.stringify(E.encodeAll(enc.o200k, 'Hello!')) === '[13225,0]', JSON.stringify(E.encodeAll(enc.o200k, 'Hello!')));
check('DeepSeek: "Hello!" is [19923, 3] (DeepSeek demo script output)', JSON.stringify(E.encodeAll(enc.deepseek, 'Hello!')) === '[19923,3]');

// ── 2. Long pieces ───────────────────────────────────────────────────────────────
for (const l of LONG) {
  const ref = fixtures.cases.find((c) => c.long === l.name);
  for (const key of ['o200k', 'cl100k', 'deepseek']) {
    const t0 = performance.now();
    const ids = E.encodeAll(enc[key], l.text);
    const ms = performance.now() - t0;
    check(`${key} ${l.name}: ids match the reference`, ref && ids.length === ref[key][0] && sha(ids) === ref[key][1], `${ids.length} vs ${ref && ref[key][0]}`);
    check(`${key} ${l.name}: under 5 s`, ms < 5000 * PERF_SLACK, Math.round(ms) + ' ms');
  }
}

// ── 3. Stepped encoding ──────────────────────────────────────────────────────────
{
  const text = Object.values(SAMPLES).join('\n').repeat(30) + '<｜User｜>' + '中'.repeat(3000);
  for (const key of ['o200k', 'cl100k', 'deepseek']) {
    const whole = E.encodeAll(enc[key], text);
    let fake = 0;
    const step = E.encodeSteps(enc[key], text, () => (fake += 1));
    let r; let prev = -1; let rounds = 0; let mono = true;
    do { r = step(3); rounds++; if (r.progress < prev) mono = false; prev = r.progress; } while (!r.done && rounds < 100000);
    check(`${key} encodeSteps equals encodeAll`, sha(r.ids) === sha(whole) && r.ids.length === whole.length);
    check(`${key} encodeSteps ran in several steps with rising progress ending at 1`, rounds > 3 && mono && r.progress === 1, rounds);
  }
  const empty = E.encodeSteps(enc.o200k, '', () => 0)(10);
  check('encodeSteps on empty text is done with no ids', empty.done && empty.ids.length === 0 && empty.progress === 1);
}

// ── 4. White space rewrite ───────────────────────────────────────────────────────
{
  const rw = E.unicodeWhiteSpace('a\\s+(?!\\S)|[^\\s\\p{L}]');
  const re = new RegExp(rw, 'u');
  check('rewritten \\s matches U+0085', new RegExp('^' + E.unicodeWhiteSpace('\\s') + '$', 'u').test('\u0085'));
  check('rewritten \\s does not match U+FEFF', !new RegExp('^' + E.unicodeWhiteSpace('\\s') + '$', 'u').test('\ufeff'));
  check('rewritten \\S matches U+FEFF', new RegExp('^' + E.unicodeWhiteSpace('\\S') + '$', 'u').test('\ufeff'));
  check('rewritten \\s inside a class stays a valid class', re.test('a ') && /\[\^\\t-\\r/.test(rw), rw);
  check('\\p{S} is not touched', E.unicodeWhiteSpace('\\p{S}') === '\\p{S}');
  check('escaped backslash before s is not touched', E.unicodeWhiteSpace('\\\\s') === '\\\\s');
  let threw = false;
  try { E.unicodeWhiteSpace('[\\S]'); } catch (e) { threw = true; }
  check('\\S inside a class is rejected', threw);
  for (const ws of ['\t', '\n', '\u000b', '\f', '\r', ' ', '\u0085', '\u00a0', '\u1680', '\u2000', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000']) {
    check(`White_Space U+${ws.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`, new RegExp('^' + E.unicodeWhiteSpace('\\s') + '$', 'u').test(ws));
  }
  for (const nws of ['\u200b', '\u180e', '\ufeff', '\u200d', 'a']) {
    check(`not White_Space U+${nws.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`, !new RegExp('^' + E.unicodeWhiteSpace('\\s') + '$', 'u').test(nws));
  }
}

// ── 5. Text statistics ───────────────────────────────────────────────────────────
{
  const a = E.textStats('👨‍👩‍👧 中文');
  check('characters are code points (ZWJ family = 5, plus space and 2 Han)', a.chars === 8, a.chars);
  check('UTF-8 bytes', a.bytes === new TextEncoder().encode('👨‍👩‍👧 中文').length, a.bytes);
  check('CRLF, CR and LF each end a line', E.textStats('a\r\nb\rc\nd').lines === 4);
  check('empty text has 0 lines and 0 words', E.textStats('').lines === 0 && E.textStats('').words === 0);
  check('English words', E.textStats('The quick, brown fox.').words === 4);
  check('Chinese words come from Intl.Segmenter, not spaces', E.textStats('我们今天去公园散步').words > 1);
}

// ── 6. Prices and cost ───────────────────────────────────────────────────────────
{
  check('prices carry a check date', /^\d{4}-\d{2}-\d{2}$/.test(E.PRICES_CHECKED));
  const providers = new Set(E.PRICE_SOURCES.map((p) => p[0]));
  for (const m of E.MODELS) {
    check(`${m.id}: provider has a source link`, providers.has(m.provider));
    check(`${m.id}: tokenizer is o200k / cl100k / deepseek / ref`, ['o200k', 'cl100k', 'deepseek', 'ref'].includes(m.enc));
    check(`${m.id}: no fudge factor`, !('factor' in m));
    check(`${m.id}: input price and limit are positive`, m.input > 0 && m.limit > 0);
  }
  for (const m of E.MODELS.filter((x) => /^(claude|gemini|gpt-6)/.test(x.id))) {
    check(`${m.id}: counted as a reference, not exact`, m.enc === 'ref');
  }
  const get = (id) => E.MODELS.find((m) => m.id === id);
  const g = get('gpt-5.5');
  check('gpt-5.5 short context: 100k in + 1k out = $0.53', Math.abs(E.costFor(g, 100000, 1000, 'USD').total - 0.53) < 1e-9);
  const gl = E.costFor(g, 300000, 1000, 'USD');
  check('gpt-5.5 above 272k input uses $10 / $45', gl.long && Math.abs(gl.total - (3 + 0.045)) < 1e-9, gl.total);
  check('gpt-5.5 at exactly 272k stays on the short rate', !E.costFor(g, 272000, 0, 'USD').long);
  const gp = E.costFor(get('gemini-3.1-pro-preview'), 250000, 0, 'USD');
  check('gemini-3.1-pro-preview above 200k uses $4 input', gp.long && Math.abs(gp.input - 1) < 1e-9);
  const emb = E.costFor(get('text-embedding-3-small'), 8000, 500, 'USD');
  check('embedding model has no output cost', emb.output === null && Math.abs(emb.total - 0.00016) < 1e-12);
  check('embedding over 8,192 tokens is flagged', E.costFor(get('text-embedding-3-small'), 8193, 0, 'USD').over);
  const ds = get('deepseek-flash');
  const dsUsd = E.costFor(ds, 1e6, 1e6, 'USD');
  const dsCny = E.costFor(ds, 1e6, 1e6, 'CNY');
  check('deepseek-flash 1M in + 1M out = $1.50 (peak)', Math.abs(dsUsd.total - 1.5) < 1e-9);
  check('deepseek-flash 1M in + 1M out = ¥10 (peak, Chinese price list)', Math.abs(dsCny.total - 10) < 1e-9);
  check('deepseek off-peak is half', ds.offPeak === 0.5);
  check('model ids are unique', new Set(E.MODELS.map((m) => m.id)).size === E.MODELS.length);
}

// ── 7. Formatting ────────────────────────────────────────────────────────────────
{
  const cases = [[0, '$0'], [0.53, '$0.53'], [1.5, '$1.5'], [12.345, '$12.35'], [0.000123, '$0.000123'], [0.00016, '$0.00016'], [0.0123456, '$0.01235'], [3.045, '$3.05'], [1e-9, '<$0.000001'], [0.000001, '$0.000001'], [999.995, '$1000']];
  for (const [v, want] of cases) check(`formatMoney(${v})`, E.formatMoney(v, '$') === want, E.formatMoney(v, '$'));
  check('formatMoney(null) is a dash', E.formatMoney(null, '$') === '—');
  check('formatPercent small', E.formatPercent(1, 1e6) === '<0.01%');
  check('formatPercent 12.3%', E.formatPercent(123, 1000) === '12.3%');
  check('formatPercent over 100%', E.formatPercent(3000, 1000) === '300%');
  const half = E.tokenLabel(new Uint8Array([0xe4, 0xb8]));
  check('partial UTF-8 shown as hex', half.partial && half.text === '\u27E8e4 b8\u27E9', half.text);
  const sp = E.tokenLabel(new TextEncoder().encode(' hi\n'));
  check('spaces and newlines visible', !sp.partial && sp.text === '\u00B7hi\u21B5', sp.text);
  check('cl100k splits "🦜" into byte tokens shown as hex', E.encodeAll(enc.cl100k, '🦜').map((id) => E.tokenLabel(enc.cl100k.tokenBytes(id))).some((l) => l.partial));
  const ds = E.encodeAll(enc.deepseek, 'Hello 世界');
  check('DeepSeek tokenBytes rebuild the text', new TextDecoder().decode(Uint8Array.from(ds.flatMap((id) => [...enc.deepseek.tokenBytes(id)]))) === 'Hello 世界');
  const ot = E.encodeAll(enc.o200k, 'Hello 世界 👍');
  check('o200k tokenBytes rebuild the text', new TextDecoder().decode(Uint8Array.from(ot.flatMap((id) => [...enc.o200k.tokenBytes(id)]))) === 'Hello 世界 👍');
}

// ── 8. Strings and samples ───────────────────────────────────────────────────────
{
  const langs = ['en', 'zh', 'ja', 'ko'];
  const keys = Object.keys(STRINGS.en).sort().join(',');
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  for (const l of langs) {
    check(`${l}: STRINGS keys match en`, Object.keys(STRINGS[l]).sort().join(',') === keys);
    for (const k of Object.keys(STRINGS.en)) check(`${l}.${k}: placeholders match en`, ph(STRINGS[l][k] || '') === ph(STRINGS.en[k]), STRINGS[l][k]);
    check(`${l}: sample exists`, typeof SAMPLES[l] === 'string' && SAMPLES[l].length > 100);
  }
}

// ── 9. Page examples ─────────────────────────────────────────────────────────────
{
  const examples = pageExamples();
  for (const ex of examples) {
    if (ex.error) { check(`${ex.file}: atc example parses`, false, ex.error + ' ' + ex.raw); continue; }
    const { spec } = ex;
    for (const key of ['o200k', 'cl100k', 'deepseek']) {
      if (spec[key] === undefined) continue;
      const n = E.encodeAll(enc[key], spec.text).length;
      check(`${ex.file}: ${key} count of ${JSON.stringify(spec.text).slice(0, 40)}`, n === spec[key], `${n} vs ${spec[key]}`);
      const shown = [String(n), n.toLocaleString('en-US')];
      check(`${ex.file}: ${key} count ${n} appears right after the example`, shown.some((s) => ex.after.includes(s)));
    }
  }
  const tools = examples.filter((x) => x.file.includes('content/tools/'));
  for (const l of ['en', 'zh', 'ja', 'ko']) {
    check(`${l} tool page has at least 2 checked examples`, tools.filter((x) => x.file.endsWith(`/${l}.mdx`)).length >= 2);
  }
}

// ── 10. No network ───────────────────────────────────────────────────────────────
{
  const script = source.slice(source.indexOf('<script>'), source.indexOf('</script>'));
  for (const api of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource']) {
    check(`component script does not use ${api}`, !new RegExp('\\b' + api.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(script));
  }
}

// ── 11. The shipped runner and client protocol ──────────────────────────────────
{
  const { createTokenRunner, createTokenClient } = await import('../src/components/tools/ai-token-counter-run.js');
  const ranks = {
    o200k: (await import('js-tiktoken/ranks/o200k_base')).default,
    cl100k: (await import('js-tiktoken/ranks/cl100k_base')).default,
    deepseek: await import('../src/data/deepseek-v4-tokenizer.mjs'),
  };
  const loads = [];
  const run = createTokenRunner(async key => { loads.push(key); return ranks[key]; });
  await run({ type: 'prefetch' });
  check('idle prefetch only loads o200k', loads.join() === 'o200k');
  const text = 'Hello 世界 🦜\r\n'.repeat(800);
  const result = await run({ type: 'count', text, keys: ['o200k', 'cl100k', 'deepseek'] });
  check('runner statistics equal the original engine', JSON.stringify(result.stats) === JSON.stringify(E.textStats(text)));
  for (const key of ['o200k', 'cl100k', 'deepseek']) {
    const ids = E.encodeAll(enc[key], text);
    check(`${key}: runner full count and first 2000 ids/byte labels match`, result.results[key].count === ids.length &&
      JSON.stringify(result.results[key].tokens) === JSON.stringify(ids.slice(0, 2000).map(id => ({ id, ...E.tokenLabel(enc[key].tokenBytes(id)) }))));
  }
  check('only requested tokenizers load, each once', loads.join() === 'o200k,cl100k,deepseek');
  let tries = 0;
  const retry = createTokenRunner(async () => { if (++tries === 1) throw new Error('load fixture'); return ranks.o200k; });
  check('failed rank load is reported without a stale count', (await retry({ type: 'count', text: 'Hello!', keys: ['o200k'] })).failed.o200k === 'load fixture');
  check('failed rank load can be retried', (await retry({ type: 'count', text: 'Hello!', keys: ['o200k'] })).results.o200k.count === 2);

  const workers = [];
  const client = createTokenClient(() => {
    const worker = { messages: [], terminated: false, postMessage(data) { this.messages.push(data); }, terminate() { this.terminated = true; } };
    workers.push(worker); return worker;
  });
  const first = client.count('old', ['o200k']).catch(error => error.name);
  const old = workers[0];
  client.cancel();
  check('cancel terminates a busy worker and rejects the pending request', old.terminated && await first === 'AbortError');
  let settled = false; let progress = 0;
  const second = client.count('new', ['o200k'], () => progress++).then(value => { settled = true; return value; });
  const fresh = workers[1]; const request = fresh.messages[0];
  old.onmessage({ data: { id: old.messages[0].id, type: 'result', result: 'stale' } });
  await Promise.resolve();
  check('late results from a terminated worker cannot resolve a new request', !settled);
  fresh.onmessage({ data: { id: request.id, type: 'progress', key: 'o200k', pct: 50 } });
  fresh.onmessage({ data: { id: request.id, type: 'result', result: 'fresh' } });
  check('fresh result and progress reach their matching request', await second === 'fresh' && progress === 1);
  const broken = client.count('broken', ['o200k']).catch(error => error.message);
  fresh.onerror();
  check('worker failure terminates it and rejects the request', fresh.terminated && await broken === 'Worker failed');
  const recovered = client.count('retry', ['o200k']);
  const replacement = workers[2];
  replacement.onmessage({ data: { id: replacement.messages[0].id, type: 'result', result: 'recovered' } });
  check('next request recreates a failed worker', await recovered === 'recovered');
  const pending = client.prefetch().catch(error => error.name);
  client.dispose();
  check('page disposal also terminates idle/prefetch work', replacement.terminated && await pending === 'AbortError');
  check('page creates the content-versioned Vite worker', source.includes("./ai-token-counter.worker.js?worker"));
  check('page has no synchronous text statistics or tokenizer call', !/\b(textStats|encodeSteps|createTiktokenEncoding|createHfBpeEncoding)\s*\(/.test(source));

  const { Worker } = await import('node:worker_threads');
  const entry = new URL('../src/components/tools/ai-token-counter.worker.js', import.meta.url).href;
  const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(`
    import { parentPort } from 'node:worker_threads';
    globalThis.self = { postMessage: data => parentPort.postMessage(data) };
    await import(${JSON.stringify(entry)});
    parentPort.on('message', data => self.onmessage({ data }));
  `)), { type: 'module' });
  try {
    const messages = [];
    const result = await new Promise((resolve, reject) => {
      worker.once('error', reject);
      worker.on('message', data => { messages.push(data); if (data.type === 'result') resolve(data.result); if (data.type === 'error') reject(new Error(data.message)); });
      worker.postMessage({ id: 7, type: 'count', text: 'Hello 世界 🦜', keys: ['o200k', 'cl100k', 'deepseek'] });
    });
    check('real worker entry preserves request ids and returns progress', messages.every(m => m.id === 7) && messages.some(m => m.type === 'progress'));
    check('real worker entry counts all three tokenizers', ['o200k', 'cl100k', 'deepseek'].every(k => result.results[k].count === E.encodeAll(enc[k], 'Hello 世界 🦜').length));
  } finally { await worker.terminate(); }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
