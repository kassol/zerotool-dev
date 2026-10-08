// Structure contract for tool page MDX (src/content/tools/{slug}/{lang}.mdx).
//
// Tool tests call toolMdxContract(slug) instead of hashing the MDX bytes. The contract
// checks what must stay true when the text changes: the four languages exist, steps fit
// the llms-full.txt limits, every FAQ item has a question and an answer, the four
// languages have the same number of FAQ items (and the same FAQ id sequence once ids are
// used), the old "How to use" section is gone, and a Limits section exists. Worked
// examples are checked by each tool test with its engine (see annotations() below).
//
// The S2 lists below say which tools are still being brought up to the S2 content rules
// (S2-PLAN.md, 2026-10-08). Only the main session changes them, after each S2 batch.
// scripts/test-tool-content-parity.mjs checks that every list is still accurate.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';
import { MAX_HOWTO_CHARS, MAX_STEP_CHARS, MAX_STEPS } from '../../src/data/llms.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LANGS = ['en', 'zh', 'ja', 'ko'];

// Tools that have not finished S2: S2-PLAN.md §1.2 table A 32 + table B 15 + §7 29 = 76
// (S2-evidence/content-stats.py on v1.140.3), plus 3 added by S2-0 = 79; S2-1 (2026-10-08)
// finished 9, S2-2 (2026-10-08) finished 9, S2-3 (2026-10-08) finished 8, S2-4 (2026-10-08)
// finished 8, S2-5 (2026-10-08) finished 13, S2-6 (2026-10-08) finished 8 and S2-7 (2026-10-09)
// finished 8, so 16 are left.
// These get only the basic checks:
// files, steps, nonempty FAQ items, no Usage section, and equal FAQ and step counts (unless
// listed in FAQ_COUNT_MISMATCH / STEPS_COUNT_MISMATCH).
export const S2_PENDING = new Set([
  // §1.2 table A: site self-review, min(zh, ja, ko) < 800 characters (32; S2-1 to S2-4 finished all 32)
  // §1.2 table B: FAQ counts differ between languages (15; S2-4 finished 2 and S2-5 finished 13)
  // §7 / §8.2: other non-premium tools below the body floor in at least one language (29; S2-6 finished 8
  // and S2-7 finished 8)
  'color-contrast-checker', 'css-specificity-calculator',
  'env-file-parser', 'exif-metadata-viewer', 'fake-data-generator', 'hash-generator',
  'http-header-analyzer', 'http-status-codes', 'jwt-generator',
  'keycode-explorer', 'nato-phonetic-alphabet', 'rsa-key-generator',
  'timestamp-converter',
  // Added by S2-0 (2026-10-08): the parity test found no Limits section in any of the four
  // languages. The text is unchanged; an S2 batch adds the section.
  'csp-header-generator', 'cubic-bezier-generator', 'favicon-generator',
]);

// Tools that pass every S2 rule except FAQ ids: they were outside the S2 scope, and S2-0
// adds no ids (S2-PLAN.md §8.1). All tools not in S2_PENDING on 2026-10-08 (62). Remove a
// tool when its four MDX files get FAQ ids.
export const FAQ_IDS_TODO = new Set([
  'aes-encrypt-decrypt', 'ai-token-counter', 'barcode-generator', 'basic-auth-header-generator',
  'bcrypt-generator', 'color-palette-generator', 'cookie-parser', 'csr-decoder', 'css-to-tailwind',
  'curl-to-code', 'dns-lookup', 'docker-to-compose', 'eyedropper-color-picker',
  'file-hash-checker', 'gif-compressor', 'gif-splitter', 'gitignore-generator',
  'glassmorphism-generator', 'graphql-formatter', 'har-file-analyzer', 'hmac-generator',
  'html-minifier', 'html-to-jsx', 'htpasswd-generator', 'iban-validator-parser',
  'image-color-palette', 'image-compressor', 'image-splitter', 'image-to-base64', 'jq-playground',
  'json-formatter', 'json-schema-validator', 'json-to-java-pojo', 'json-xml-converter',
  'jsonl-converter', 'markdown-preview', 'markdown-table-generator', 'markdown-to-word',
  'markdown-toc-generator', 'mime-type-lookup', 'openapi-to-typescript', 'openapi-validator',
  'pixelate-image', 'pkce-generator', 'protobuf-to-json', 'qr-code-decoder', 'qr-code-generator',
  'secret-redactor', 'sprite-sheet-generator', 'sqlite-viewer', 'ssl-certificate-decoder',
  'string-escape', 'svg-to-jsx', 'svg-to-png-converter', 'text-to-binary', 'toml-json',
  'totp-generator', 'unicode-text-converter', 'url-parser', 'yaml-json', 'yaml-toml',
  'yaml-validator',
]);

// Tools whose four languages have different FAQ counts today (S2-PLAN.md §1.2: 8 in table A,
// 15 in table B; S2-1 aligned password-generator, url-encode and uuid-generator, S2-2 aligned
// box-shadow-generator, css-gradient-generator and css-unit-converter, S2-4 aligned
// html-to-markdown, lorem-ipsum, slugify and color-converter, S2-5 aligned the other 13, so the
// list is empty). Add a tool only while its counts differ and it is in S2_PENDING; remove it
// when they match.
export const FAQ_COUNT_MISMATCH = new Set([]);

// Tools whose four languages have different step counts today. S2-PLAN.md §1.1 listed
// htaccess-generator (5 en steps, 4 in zh / ja / ko); S2-3 (2026-10-08) aligned it, so the list
// is empty. Add a tool only while its counts differ; remove it when they match.
export const STEPS_COUNT_MISMATCH = new Set([]);

// The three v2 sample pages moved every limit into the control tips (root AGENTS.md,
// 2026-10-04: the later tools keep a Limits section in the reference text).
export const LIMITS_EXEMPT = new Set(['json-formatter', 'color-palette-generator', 'har-file-analyzer']);

// Limits sections whose heading the LIMITS patterns below do not match (exact H2 text).
export const LIMITS_HEADINGS = {
  'toml-json': { en: 'What Changes in Conversion', zh: '转换时会变的地方', ja: '変換で変わるもの', ko: '변환하면서 바뀌는 것' },
  'curl-to-code': { en: 'Check These Before You Run the Code', zh: '运行前请检查', ja: '実行前に確認すること', ko: '실행 전에 확인할 것' },
};

// FAQ ids (src/content/AGENTS.md): a common question uses a semantic id such as `privacy`
// or `limits`; a question that exists for local readers only uses `local-…`.
export const FAQ_ID = /^(?:local-)?[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const PRIVACY_ID = 'privacy';

const USAGE = {
  en: /^(?:how to use\b.*|usage)$/i,
  zh: /^(?:使用方法|如何使用|用法)$/,
  ja: /^(?:使い方|使用方法)$/,
  ko: /^(?:사용 방법|사용법)$/,
};
// A section about what the tool does not do: limits, scope or boundaries.
const LIMITS = {
  en: /limit|scope|boundar|edge case|what (?:it|the tool) (?:does not|doesn't|can't|cannot)/i,
  zh: /限制|上限|范围|边界|局限/,
  ja: /制限|制約|上限|範囲|境界|できないこと|限界/,
  ko: /제한|한계|한도|범위|경계/,
};

export function splitToolMdx(text) {
  if (!text.startsWith('---\n')) throw new Error('MDX does not start with frontmatter');
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('frontmatter is not closed');
  const frontmatter = text.slice(4, end + 1);
  return { frontmatter, data: loadYaml(frontmatter) ?? {}, body: text.slice(end + 5) };
}

export function readToolMdx(slug, { root = ROOT } = {}) {
  const out = {};
  for (const lang of LANGS) {
    const file = join(root, 'src', 'content', 'tools', slug, `${lang}.mdx`);
    out[lang] = existsSync(file) ? { file, text: readFileSync(file, 'utf8') } : { file, text: null };
    if (out[lang].text !== null) {
      try { Object.assign(out[lang], splitToolMdx(out[lang].text)); }
      catch (error) { out[lang].error = error.message; }
    }
  }
  return out;
}

// Body text with fenced code blocks and <pre> blocks replaced by blank lines.
export function withoutCode(body) {
  return body
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (m) => m.replace(/[^\n]/g, ''))
    .replace(/<pre\b[\s\S]*?<\/pre>/gi, (m) => m.replace(/[^\n]/g, ''));
}

// H2 headings in document order: Markdown `## X` and HTML <h2>X</h2>, outside code.
export function headings(body) {
  const text = withoutCode(body);
  const out = [];
  const re = /^##[ \t]+(.+?)[ \t#]*$|<h2\b[^>]*>([\s\S]*?)<\/h2>/gm;
  for (const m of text.matchAll(re)) {
    out.push((m[1] ?? m[2]).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
  }
  return out;
}

// Body size in the page-quality standard §0 units (S2-evidence/content-stats.py, T6):
// body after the frontmatter without code blocks, import / export lines, MDX and HTML
// comments, tags and link targets. One difference from content-stats.py: a tag is
// `</?[A-Za-z!][^<>]*>`, not `<[^>]+>`. The old pattern ran from a `<` in prose (`a < b`,
// `<URL>` placeholders) to the next `>` and dropped the text between; 35 of the 564 files
// count higher with the new pattern (none lower), and appending a tag no longer removes text. en counts words that contain a letter or digit; zh / ja /
// ko count Han, kana and Hangul characters plus 1 for each Latin or digit run between them.
const CJK = /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\u1100-\u11ff\u3130-\u318f\uff66-\uff9f]/g;
const LATIN = /[A-Za-z0-9][A-Za-z0-9'’._-]*/g;
export const BODY_FLOOR = { en: 400, zh: 600, ja: 900, ko: 750 };

export function proseText(body) {
  return body
    .replace(/^```[\s\S]*?^```[^\n]*$/gm, ' ')
    .replace(/^~~~[\s\S]*?^~~~[^\n]*$/gm, ' ')
    .replace(/<pre\b[\s\S]*?<\/pre>/gi, ' ')
    .replace(/^\s*(?:import|export)\s.*$/gm, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[A-Za-z!][^<>]*>/g, ' ')
    .replace(/\]\([^)]*\)/g, ']');
}

export function bodySize(lang, body) {
  const text = proseText(body);
  if (lang === 'en') return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  const cjk = (text.match(CJK) ?? []).length;
  return cjk + (text.replace(CJK, ' ').match(LATIN) ?? []).length;
}

export const isUsageHeading = (lang, heading) => USAGE[lang].test(heading);
export const isLimitsHeading = (lang, heading) => LIMITS[lang].test(heading);

// Worked-example annotations: `{/* tag: <JSON> */}` (the JSON part is optional).
// Returns [{ spec, raw, index, after }] where `after` is the text up to the next
// annotation with the same tag or the next H2, whichever comes first.
export function annotations(body, tag) {
  const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\{/\\*\\s*${esc}(?::\\s*([\\s\\S]*?))?\\s*\\*/\\}`, 'g');
  const found = [...body.matchAll(re)];
  return found.map((m, i) => {
    const start = m.index + m[0].length;
    const next = found[i + 1]?.index ?? body.length;
    const rest = body.slice(start, next);
    const h2 = rest.search(/^##[ \t]|<h2\b/m);
    const raw = m[1] ?? '';
    let spec = null;
    if (raw.trim()) {
      try { spec = JSON.parse(raw); } catch { spec = undefined; }
    }
    return { spec, raw, index: m.index, after: h2 < 0 ? rest : rest.slice(0, h2) };
  });
}

// Code blocks of a body, in order: [{ lang, text }] (text without the final newline). Covers
// Markdown fences and the MDX form <pre><code>{`…`}</code></pre> (lang 'pre'; the template
// literal escapes \n, \t, \`, \$ and \\ are decoded).
export function fencedBlocks(body) {
  const re = /^(`{3,}|~{3,})([^\n`]*)\n([\s\S]*?)\n?^\1[ \t]*$|<pre\b[^>]*>\s*<code\b[^>]*>\{`((?:[^`\\]|\\[\s\S])*)`\}<\/code>\s*<\/pre>/gm;
  return [...body.matchAll(re)].map((m) => (m[4] !== undefined
    ? { lang: 'pre', text: m[4].replace(/\\([\s\S])/g, (_, c) => ({ n: '\n', t: '\t' })[c] ?? c).replace(/\n$/, '') }
    : { lang: m[2].trim(), text: m[3] }));
}

// Worked examples written as an input block followed by its output block. Walks the blocks in
// order and pairs block i with block i + 1 when isInput(block i) and isOutput(block i + 1); a
// paired output never starts a new pair. Returns [[input, output], ...].
export function examplePairs(body, isInput, isOutput) {
  const blocks = fencedBlocks(body), pairs = [];
  for (let i = 0; i + 1 < blocks.length; i++) {
    if (isInput(blocks[i]) && isOutput(blocks[i + 1])) { pairs.push([blocks[i], blocks[i + 1]]); i++; }
  }
  return pairs;
}

/**
 * Check one tool's four MDX files against the content contract.
 * @param {string} slug
 * @param {object} [opts]
 * @param {string} [opts.root] repository root (tests of this module pass a fixture root)
 * @param {number} [opts.stepCount] required number of steps in every language
 * @param {Record<string, number>} [opts.stepCounts] required steps per language (exceptions only)
 * @param {Array<{tag: string, min?: number, verify: Function}>} [opts.annotations]
 *   worked examples: verify({ spec, raw, after, lang, body }) returns null when the
 *   example matches the engine, otherwise a problem string. `min` is per language.
 * @returns {{ ok: boolean, problems: string[], results: Array<{rule: string, ok: boolean, message: string}>, docs: object }}
 */
export function toolMdxContract(slug, opts = {}) {
  const { root = ROOT } = opts;
  const pending = opts.pending ?? S2_PENDING.has(slug);
  const countMismatch = opts.faqCountMismatch ?? FAQ_COUNT_MISMATCH.has(slug);
  const limitsRequired = opts.limits ?? (!LIMITS_EXEMPT.has(slug) && !pending);
  const docs = readToolMdx(slug, { root });
  const results = [];
  const add = (rule, ok, detail) => results.push({ rule, ok: !!ok, message: ok ? `${slug} ${rule}` : `${slug} ${rule}: ${detail}` });

  for (const lang of LANGS) {
    const d = docs[lang];
    add(`${lang} MDX file parses`, d.text !== null && !d.error && d.data && typeof d.data === 'object', d.text === null ? 'missing file' : d.error ?? 'frontmatter is not an object');
  }
  if (!results.every((r) => r.ok)) return finish(results, docs);

  for (const lang of LANGS) {
    const { data, body } = docs[lang];
    for (const key of ['seoTitle', 'seoDescription']) {
      add(`${lang} ${key} is nonempty text`, typeof data[key] === 'string' && data[key].trim(), JSON.stringify(data[key]));
    }
    const steps = data.steps;
    const stepProblem = !Array.isArray(steps) || steps.length === 0 ? 'steps missing or empty'
      : steps.length > MAX_STEPS ? `${steps.length} steps > ${MAX_STEPS}`
      : steps.findIndex((s) => typeof s !== 'string' || !s.trim() || s.length > MAX_STEP_CHARS || /<[^>]*>|\n/.test(s)) >= 0
        ? `step ${steps.findIndex((s) => typeof s !== 'string' || !s.trim() || s.length > MAX_STEP_CHARS || /<[^>]*>|\n/.test(s)) + 1} is empty, too long, multi-line or has HTML`
      : steps.join('').length > MAX_HOWTO_CHARS ? `${steps.join('').length} characters > ${MAX_HOWTO_CHARS}` : null;
    add(`${lang} steps are plain text within the llms limits`, !stepProblem, stepProblem);
    const want = opts.stepCounts?.[lang] ?? opts.stepCount;
    if (want !== undefined) add(`${lang} has ${want} steps`, Array.isArray(steps) && steps.length === want, `${steps?.length}`);

    const faq = data.faqItems ?? [];
    const badItem = Array.isArray(faq) ? faq.findIndex((f) => !f || typeof f.question !== 'string' || !f.question.trim() || typeof f.answer !== 'string' || !f.answer.trim()) : 0;
    add(`${lang} FAQ items have a question and an answer`, Array.isArray(faq) && badItem < 0, Array.isArray(faq) ? `item ${badItem + 1}` : 'faqItems is not a list');

    const hs = headings(body);
    const usage = hs.filter((h) => isUsageHeading(lang, h));
    add(`${lang} has no Usage section`, usage.length === 0, usage.join(' | '));
    if (limitsRequired) {
      const named = LIMITS_HEADINGS[slug]?.[lang];
      add(`${lang} has a Limits section`, hs.some((h) => h === named || isLimitsHeading(lang, h)), hs.join(' | ') || 'no H2');
    }
  }

  if (!(opts.stepCount !== undefined || opts.stepCounts || STEPS_COUNT_MISMATCH.has(slug))) {
    const counts = LANGS.map((l) => (Array.isArray(docs[l].data.steps) ? docs[l].data.steps.length : 0));
    add('steps counts match across languages', new Set(counts).size === 1, counts.join('/'));
  }
  const faqs = LANGS.map((l) => (Array.isArray(docs[l].data.faqItems) ? docs[l].data.faqItems : []));
  const counts = faqs.map((f) => f.length);
  if (!countMismatch) add('FAQ counts match across languages', new Set(counts).size === 1, counts.join('/'));

  const hasIds = faqs.some((list) => list.some((f) => f && f.id !== undefined));
  if (hasIds || opts.requireFaqIds) {
    const bad = [];
    faqs.forEach((list, i) => list.forEach((f, j) => { if (typeof f?.id !== 'string' || !FAQ_ID.test(f.id)) bad.push(`${LANGS[i]}#${j + 1}=${JSON.stringify(f?.id)}`); }));
    add('every FAQ item has a valid id', bad.length === 0, bad.join(', '));
    const dup = faqs.map((list, i) => { const ids = list.map((f) => f?.id); return ids.length === new Set(ids).size ? null : LANGS[i]; }).filter(Boolean);
    add('FAQ ids are unique within each language', dup.length === 0, dup.join(', '));
    const seqs = faqs.map((list) => list.map((f) => (String(f?.id).startsWith('local-') ? 'local-*' : f?.id)).join(','));
    add('FAQ id sequences match across languages (local-* matched by position)', new Set(seqs).size === 1, seqs.join(' / '));
  }

  for (const a of opts.annotations ?? []) {
    for (const lang of LANGS) {
      const body = docs[lang].body;
      const found = annotations(body, a.tag);
      if (a.min !== undefined) add(`${lang} has at least ${a.min} ${a.tag} examples`, found.length >= a.min, `${found.length}`);
      found.forEach((note, i) => {
        let problem;
        try { problem = note.spec === undefined ? 'annotation JSON does not parse' : a.verify({ ...note, lang, body }); }
        catch (error) { problem = error.message; }
        add(`${lang} ${a.tag} #${i + 1} matches the engine`, !problem, problem);
      });
    }
  }
  return finish(results, docs);
}

function finish(results, docs) {
  const problems = results.filter((r) => !r.ok).map((r) => r.message);
  return { ok: problems.length === 0, problems, results, docs };
}

// For tool tests that check per language: the failed rules of one language plus the failed
// cross-language rules, joined with '; ' ('' when everything passes). Cached per slug.
const cache = new Map();
export function contractProblems(slug, lang, opts) {
  const key = slug + '\0' + JSON.stringify(opts ?? {});
  if (!cache.has(key)) cache.set(key, toolMdxContract(slug, opts));
  const own = (r) => r.rule.startsWith(lang + ' ') || !LANGS.some((l) => r.rule.startsWith(l + ' '));
  return cache.get(key).results.filter((r) => !r.ok && own(r)).map((r) => r.message).join('; ');
}

// Convenience for tests: report every contract rule through the test's own check function.
export function reportContract(check, slug, opts) {
  const contract = toolMdxContract(slug, opts);
  for (const r of contract.results) check('MDX contract: ' + r.message, r.ok);
  return contract;
}
