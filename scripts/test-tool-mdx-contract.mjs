#!/usr/bin/env node
// Unit tests for scripts/lib/tool-mdx-contract.mjs. Fixture MDX files live in a temporary
// directory that is removed at the end. Run: node scripts/test-tool-mdx-contract.mjs
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FAQ_COUNT_MISMATCH, FAQ_ID, LANGS, LIMITS_EXEMPT, S2_PENDING, STEPS_COUNT_MISMATCH,
  annotations, bodySize, contractProblems, examplePairs, fencedBlocks, headings, isLimitsHeading, isUsageHeading, proseText, splitToolMdx, toolMdxContract,
} from './lib/tool-mdx-contract.mjs';

let passes = 0, failures = 0;
function check(name, ok, detail = '') {
  if (ok) passes++;
  else { failures++; console.log(`FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}
const equal = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

// ── Parsing helpers ─────────────────────────────────────────────────────────
const sample = '---\nseoTitle: "T"\nsteps:\n  - "Paste."\n---\n\nBody text.\n';
const parts = splitToolMdx(sample);
equal('splitToolMdx: frontmatter', parts.frontmatter, 'seoTitle: "T"\nsteps:\n  - "Paste."\n');
equal('splitToolMdx: data', parts.data, { seoTitle: 'T', steps: ['Paste.'] });
equal('splitToolMdx: body', parts.body, '\nBody text.\n');
check('splitToolMdx: rejects text without frontmatter', (() => { try { splitToolMdx('Body'); return false; } catch { return true; } })());
check('splitToolMdx: rejects unclosed frontmatter', (() => { try { splitToolMdx('---\na: 1\n'); return false; } catch { return true; } })());

const body = [
  '<h2 class="x">Examples</h2>',
  '## Limits ##',
  '```md',
  '## Usage',
  '```',
  '~~~',
  '## Not a heading',
  '~~~',
  '<pre>',
  '<h2>Inside pre</h2>',
  '</pre>',
  '<h2>Line\n  <code>two</code></h2>',
].join('\n');
equal('headings: Markdown and HTML, code skipped, tags removed', headings(body), ['Examples', 'Limits', 'Line two']);

check('usage heading: en How to Use', isUsageHeading('en', 'How to Use'));
check('usage heading: en How to use the converter', isUsageHeading('en', 'How to use the converter'));
check('usage heading: en Usage', isUsageHeading('en', 'Usage'));
check('usage heading: en "How Lock Ratio Works" is not usage', !isUsageHeading('en', 'How Lock Ratio Works'));
check('usage heading: zh 使用方法', isUsageHeading('zh', '使用方法'));
check('usage heading: ja 使い方', isUsageHeading('ja', '使い方'));
check('usage heading: ja よくある使い方 is not usage', !isUsageHeading('ja', 'よくある使い方'));
check('usage heading: ko 사용 방법', isUsageHeading('ko', '사용 방법'));
for (const [lang, h] of [['en', 'Limits'], ['en', 'Limitations'], ['en', 'Scope'], ['zh', '限制'], ['ja', '制限事項'], ['ja', '対応範囲'], ['ko', '제한 사항'], ['ko', '한계']]) {
  check(`limits heading: ${lang} ${h}`, isLimitsHeading(lang, h));
}
check('limits heading: en Examples is not limits', !isLimitsHeading('en', 'Examples'));

equal('proseText removes code, comments, tags and link targets',
  proseText('a\n```\ncode\n```\n{/* note */}<!-- c --><b>bold</b> [link](https://x.test)\nimport X from "y";\n').replace(/\s+/g, ' ').trim(),
  'a bold [link]');
equal('bodySize en counts words with letters or digits', bodySize('en', 'Hello, world — 42 !'), 3);
equal('bodySize zh counts Han characters and Latin runs', bodySize('zh', '使用 JSON 格式，v1.2 版'), 7);
equal('bodySize ja counts kana and kanji', bodySize('ja', 'ひらがなとカタカナ、漢字'), 11);
equal('bodySize ko counts Hangul syllables', bodySize('ko', '한글 테스트 API'), 6);
equal('bodySize keeps prose after a bare < (a tag cannot contain <)', bodySize('en', 'x < y z <b>w</b> <!-- c --> v'), 5);
equal('bodySize ignores code blocks', bodySize('en', 'one\n```\ntwo three\n```\n'), 1);

const ann = annotations('x {/* demo-check: {"in":"a"} */}\n`A`\n{/* demo-check */}\nplain\n## Next\nB {/* demo-check: {bad */}', 'demo-check');
equal('annotations: count', ann.length, 3);
equal('annotations: JSON spec', ann[0].spec, { in: 'a' });
check('annotations: after runs to the next annotation', ann[0].after.includes('`A`') && !ann[0].after.includes('plain'));
check('annotations: after stops at the next H2', ann[1].after.includes('plain') && !ann[1].after.includes('Next'));
equal('annotations: no JSON gives a null spec', ann[1].spec, null);
equal('annotations: bad JSON gives an undefined spec', ann[2].spec, undefined);
equal('annotations: other tags are ignored', annotations('{/* other: {} */}', 'demo-check').length, 0);

const fenceBody = 'Text\n```json\n{"a":1}\n```\n\n```ts\nconst a = 1;\n```\n~~~text\nplain\n~~~\n```json\n{}\n```\n```ts\nx\n```\n';
equal('fencedBlocks: languages and text', fencedBlocks(fenceBody), [{ lang: 'json', text: '{"a":1}' }, { lang: 'ts', text: 'const a = 1;' }, { lang: 'text', text: 'plain' }, { lang: 'json', text: '{}' }, { lang: 'ts', text: 'x' }]);
equal('examplePairs: input followed by output', examplePairs(fenceBody, (b) => b.lang === 'json', (b) => b.lang === 'ts').map(([a, b]) => [a.text, b.text]), [['{"a":1}', 'const a = 1;'], ['{}', 'x']]);
equal('fencedBlocks: MDX <pre><code> template literal', fencedBlocks('<pre><code>{`a\\n\\`b\\` \\${x}`}</code></pre>\n'), [{ lang: 'pre', text: 'a\n`b` ${x}' }]);
equal('examplePairs: an output never starts a pair', examplePairs('```a\n1\n```\n```a\n2\n```\n```a\n3\n```\n', () => true, () => true).map(([a, b]) => [a.text, b.text]), [['1', '2']]);

check('FAQ_ID: semantic id', FAQ_ID.test('privacy') && FAQ_ID.test('max-size'));
check('FAQ_ID: local id', FAQ_ID.test('local-fullwidth'));
check('FAQ_ID: rejects capitals, spaces, empty and trailing hyphen', !['Privacy', 'max size', '', 'limits-', 'local-'].some((id) => FAQ_ID.test(id)));

// ── Lists ───────────────────────────────────────────────────────────────────
equal('S2_PENDING: 53 tools (79 after S2-0, minus 9 in S2-1, 9 in S2-2 and 8 in S2-3)', S2_PENDING.size, 53);
equal('FAQ_COUNT_MISMATCH: 17 tools (23 after S2-0, minus 3 in S2-1 and 3 in S2-2; S2-3 had none)', FAQ_COUNT_MISMATCH.size, 17);
equal('STEPS_COUNT_MISMATCH: empty (htaccess-generator aligned in S2-3)', STEPS_COUNT_MISMATCH.size, 0);
check('FAQ_COUNT_MISMATCH is inside S2_PENDING', [...FAQ_COUNT_MISMATCH].every((s) => S2_PENDING.has(s)));
check('STEPS_COUNT_MISMATCH is inside S2_PENDING', [...STEPS_COUNT_MISMATCH].every((s) => S2_PENDING.has(s)));
equal('LIMITS_EXEMPT: the three v2 samples', [...LIMITS_EXEMPT].sort(), ['color-palette-generator', 'har-file-analyzer', 'json-formatter']);

// ── Contract on fixture files ───────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'mdx-contract-'));
const LIMITS = { en: 'Limits', zh: '限制', ja: '制限', ko: '제한 사항' };
const yamlStr = (s) => JSON.stringify(s);
function writeTool(slug, perLang = {}) {
  for (const lang of LANGS) {
    const o = { steps: ['Paste the text.', 'Copy the result.'], faq: [['Q1?', 'A1.'], ['Q2?', 'A2.'], ['Q3?', 'A3.']], h2: ['Examples', LIMITS[lang]], ...(perLang.all ?? {}), ...(perLang[lang] ?? {}) };
    const fm = [`seoTitle: ${yamlStr(o.title ?? 'Title ' + lang)}`, 'seoDescription: "Description."', 'steps:', ...o.steps.map((s) => '  - ' + yamlStr(s))];
    if (o.faq.length) {
      fm.push('faqItems:');
      o.faq.forEach(([q, a, id]) => { fm.push(`  - question: ${yamlStr(q)}`, `    answer: ${yamlStr(a)}`); if (id !== undefined) fm.push(`    id: ${yamlStr(id)}`); });
    }
    const text = `---\n${fm.join('\n')}\n---\n\n${o.h2.map((h) => `<h2>${h}</h2>\n\n<p>Text.</p>`).join('\n\n')}\n${o.extra ?? ''}`;
    mkdirSync(join(root, 'src', 'content', 'tools', slug), { recursive: true });
    writeFileSync(join(root, 'src', 'content', 'tools', slug, `${lang}.mdx`), o.raw ?? text);
  }
}
const run = (slug, opts = {}) => toolMdxContract(slug, { root, pending: false, faqCountMismatch: false, ...opts });
const failed = (c, pattern) => c.problems.some((p) => pattern.test(p));

try {
  writeTool('good');
  const good = run('good');
  check('contract: a complete tool passes', good.ok, good.problems.join('; '));
  check('contract: results name the tool', good.results.every((r) => r.message.startsWith('good ')));

  writeTool('missing');
  rmSync(join(root, 'src', 'content', 'tools', 'missing', 'ko.mdx'));
  const missing = run('missing');
  check('contract: missing language file fails', failed(missing, /ko MDX file parses: missing file/));
  check('contract: stops after a missing file', missing.results.length === 4);

  writeTool('badyaml', { ja: { raw: '---\nseoTitle: [\n---\nBody\n' } });
  check('contract: bad YAML fails', failed(run('badyaml'), /ja MDX file parses/));

  writeTool('steps', { zh: { steps: [] }, ja: { steps: ['x'.repeat(281)] }, ko: { steps: ['Line\nbreak'] } });
  const steps = run('steps');
  check('contract: empty steps fail', failed(steps, /zh steps .*: steps missing or empty/));
  check('contract: long step fails', failed(steps, /ja steps .*step 1/));
  check('contract: multi-line step fails', failed(steps, /ko steps .*step 1/));
  check('contract: step counts must match', failed(steps, /steps counts match across languages: 2\/0\/1\/1/));
  writeTool('nine', { all: { steps: Array.from({ length: 9 }, (_, i) => `Step ${i}.`) } });
  check('contract: more than 8 steps fail', failed(run('nine'), /9 steps > 8/));
  writeTool('html', { en: { steps: ['Paste <b>JSON</b>.', 'Copy.'] } });
  check('contract: HTML in a step fails', failed(run('html'), /en steps .*has HTML/));
  writeTool('wide', { all: { steps: Array.from({ length: 5 }, () => 'y'.repeat(250)) } });
  check('contract: steps over 1200 characters fail', failed(run('wide'), /1250 characters > 1200/));
  check('contract: stepCount option', failed(run('good', { stepCount: 3 }), /en has 3 steps: 2/));
  check('contract: stepCounts option replaces the cross-language count rule', run('steps', { stepCounts: { en: 2, zh: 0, ja: 1, ko: 1 } }).problems.every((p) => !/counts match/.test(p)));

  writeTool('faq', { ja: { faq: [['Q1?', 'A1.'], ['Q2?', 'A2.']] }, ko: { faq: [['Q1?', ' '], ['Q2?', 'A2.'], ['Q3?', 'A3.']] } });
  const faq = run('faq');
  check('contract: FAQ count drift fails', failed(faq, /FAQ counts match across languages: 3\/3\/2\/3/));
  check('contract: blank answer fails', failed(faq, /ko FAQ items have a question and an answer: item 1/));
  const zhProblems = contractProblems('faq', 'zh', { root, pending: false, faqCountMismatch: false });
  check('contractProblems: keeps cross-language rules for every language', /FAQ counts match/.test(zhProblems), zhProblems);
  check('contractProblems: leaves out the rules of other languages', !/ko FAQ items/.test(zhProblems), zhProblems);
  check('contractProblems: reports its own language', /ko FAQ items have a question and an answer: item 1/.test(contractProblems('faq', 'ko', { root, pending: false, faqCountMismatch: false })));
  equal('contractProblems: empty string when the tool passes', contractProblems('good', 'en', { root, pending: false, faqCountMismatch: false }), '');
  check('contract: faqCountMismatch skips the count rule', run('faq', { faqCountMismatch: true }).problems.every((p) => !/FAQ counts/.test(p)));

  writeTool('seo', { zh: { title: ' ' } });
  check('contract: blank seoTitle fails', failed(run('seo'), /zh seoTitle is nonempty text/));

  writeTool('usage', { en: { h2: ['How to Use', 'Limits'] } });
  check('contract: Usage section fails', failed(run('usage'), /en has no Usage section: How to Use/));
  writeTool('usagecode', { en: { extra: '\n```md\n## Usage\n```\n' } });
  check('contract: Usage inside a code block passes', run('usagecode').ok);

  writeTool('nolimits', { ja: { h2: ['Examples'] } });
  check('contract: missing Limits fails', failed(run('nolimits'), /ja has a Limits section: Examples/));
  check('contract: limits:false skips Limits', run('nolimits', { limits: false }).ok);
  check('contract: pending tools skip Limits', run('nolimits', { pending: true }).ok);

  const ids = (seq) => seq.map((id, i) => [`Q${i}?`, `A${i}.`, id]);
  writeTool('ids', { all: { faq: ids(['privacy', 'limits', 'local-a']) }, ja: { faq: ids(['privacy', 'limits', 'local-b']) } });
  check('contract: matching ids pass (local ids match by position)', run('ids').ok, run('ids').problems.join('; '));
  writeTool('idorder', { all: { faq: ids(['privacy', 'limits', 'format']) }, ko: { faq: ids(['limits', 'privacy', 'format']) } });
  check('contract: id order drift fails', failed(run('idorder'), /FAQ id sequences match/));
  writeTool('idmissing', { all: { faq: ids(['privacy', 'limits', 'format']) }, zh: { faq: ids(['privacy', undefined, 'format']) } });
  check('contract: a missing id fails once ids are used', failed(run('idmissing'), /every FAQ item has a valid id: zh#2/));
  writeTool('iddup', { all: { faq: ids(['privacy', 'privacy', 'format']) } });
  check('contract: duplicate ids fail', failed(run('iddup'), /ids are unique within each language/));
  writeTool('idbad', { all: { faq: ids(['Privacy', 'limits', 'format']) } });
  check('contract: invalid id fails', failed(run('idbad'), /every FAQ item has a valid id/));
  check('contract: requireFaqIds fails a tool without ids', failed(run('good', { requireFaqIds: true }), /every FAQ item has a valid id/));
  check('contract: a tool without ids passes when ids are not required', run('good').ok);

  writeTool('ex', { all: { extra: '\n{/* up-check: {"in":"a"} */}\n`A`\n' }, ko: { extra: '\n{/* up-check: {"in":"b"} */}\n`A`\n' } });
  const verify = ({ spec, after }) => (after.includes('`' + spec.in.toUpperCase() + '`') ? null : `expected ${spec.in.toUpperCase()}`);
  const ex = run('ex', { annotations: [{ tag: 'up-check', min: 1, verify }] });
  check('contract: annotation that matches the engine passes', !failed(ex, /en up-check #1/));
  check('contract: annotation that does not match fails', failed(ex, /ko up-check #1 matches the engine: expected B/));
  check('contract: annotation minimum per language', failed(run('good', { annotations: [{ tag: 'up-check', min: 1, verify }] }), /en has at least 1 up-check examples: 0/));
  check('contract: verify errors become problems', failed(run('ex', { annotations: [{ tag: 'up-check', verify: () => { throw new Error('boom'); } }] }), /boom/));
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
