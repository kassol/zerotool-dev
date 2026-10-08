// Word Counter — sentence count follows UAX #29 sentence boundaries
//
// Read:  src/components/tools/WordCounterTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: sentences are counted with Intl.Segmenter (granularity "sentence"), which implements
// the Unicode sentence boundary rules of UAX #29. Before the fix, 。！？ were not sentence ends
// and a "." only ended a sentence before A–Z or a Han character, so Chinese, Japanese and Korean
// paragraphs counted as 1 sentence. Expected values are worked out by hand from UAX #29 rules
// (SB4 line break, SB6 "3.14", SB7 "U.S.A", SB8 lowercase after ".", SB11 break after
// STerm / ATerm + closing punctuation + spaces). Also checks that the character, word, paragraph
// and time numbers match the rules written on the tool page.
//
// Run: node scripts/test-word-counter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/WordCounterTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in WordCounterTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { stats, formatTime };')();

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
const sentences = (t) => E.stats(t).sentences;

// ---------- the reported defect: CJK sentence ends ----------
eq('zh 。！？', sentences('今天天气很好。明天会下雨！你带伞了吗？'), 3);
eq('ja 。！？', sentences('今日は晴れです。明日は雨です！本当ですか？'), 3);
eq('ja halfwidth ｡', sentences('はい｡いいえ｡'), 2);
// SB11: STerm Close* ÷ — UAX #29 ends a sentence after 。」 even inside a quoted clause
eq('ja closing bracket after 。', sentences('「行きます。」と言った。'), 2);
eq('zh closing quote after 。 (page example)', sentences('他说：“好。”然后走了。'), 2);
eq('ko quoted period (page example)', sentences('그는 "알겠어." 하고 나갔다.'), 2);
eq('ko period + space + Hangul', sentences('안녕하세요. 반갑습니다. 좋은 하루예요.'), 3);
eq('fullwidth ！？ with Latin', sentences('Ｙｅｓ！Ｎｏ？'), 2);

// ---------- English (UAX #29) ----------
eq('two sentences', sentences('The cat sat. It ran away!'), 2);
eq('decimal is not a sentence end (SB6)', sentences('The value is 3.14. Next line.'), 2);
eq('abbreviation before a capital ends a sentence', sentences('Dr. Smith agreed.'), 2);
eq('lowercase after a period continues (SB8)', sentences('e.g. the cat sat. It ran.'), 2);
eq('U.S.A. (SB7)', sentences('The U.S.A. is big.'), 1);
eq('closing quote after terminator', sentences('He said "Stop." Then he left.'), 2);
eq('?! run is one end', sentences('Really?! Yes.'), 2);
eq('no terminator', sentences('hello world'), 1);
eq('line break ends a sentence (SB4)', sentences('Title\nBody text.'), 2);
eq('ellipsis is not a sentence end', sentences('Wait… what now?'), 1);
eq('whitespace only', sentences('  \n  '), 0);
eq('empty', sentences(''), 0);

// ---------- other numbers match the tool page ----------
{
  const s = E.stats('well-being 3.14 https://example.com/a **bold**');
  eq('words split on whitespace only', s.words, 4);
}
eq('ko words = eojeol', E.stats('안녕하세요. 반갑습니다. 좋은 하루예요.').words, 4);
eq('zh paragraph without spaces is 1 word', E.stats('今天天气很好。明天会下雨！').words, 1);
eq('characters are UTF-16 code units', E.stats('👍 a').chars, 4);
eq('characters without whitespace', E.stats('a b\tc\nd　e').charsNoSpaces, 5);
eq('paragraphs split on blank lines', E.stats('one\n\ntwo\nstill two\n\n\nthree').paragraphs, 3);
eq('reading time 1,000 words', E.formatTime(1000 / 200), '5 min');
eq('speaking time 1,000 words', E.formatTime(1000 / 130), '8 min');
eq('under a minute', E.formatTime(0.4), '< 1 min');
// round up to whole minutes first, then split into hours and minutes (was "1 hr 60 min")
eq('0 minutes', E.formatTime(0), '0 min');
eq('59.5 minutes', E.formatTime(59.5), '1 hr 0 min');
eq('119.5 minutes', E.formatTime(119.5), '2 hr 0 min');
eq('60 minutes', E.formatTime(60), '1 hr 0 min');
eq('90.2 minutes', E.formatTime(90.2), '1 hr 31 min');
eq('59 minutes', E.formatTime(59), '59 min');

// Actual page and shared keyboard handlers; DOM is the only simulated boundary.
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('      // ── Keyboard shortcuts:'), layout.indexOf('      // ── Copy button visual feedback'));
check('real shared shortcut block is available', shortcut.includes('window.ztPersist.clear(_slug)'));
function page(lang, sharedFirst) {
  const nodes = new Map(), listeners = [], clears = [], tracks = [];
  for (const [, id] of source.matchAll(/id="(wc-[^"]+)"/g)) {
    let text = id.includes('time') ? '0 min' : '0';
    nodes.set(id, { id, value: '', handlers: {}, get textContent() { return text; }, set textContent(v) { text = String(v); },
      addEventListener(type, fn) { this.handlers[type] = fn; }, focus() { document.activeElement = this; } });
  }
  let empty = 'true';
  const widget = { dataset: { get empty() { return empty; }, set empty(value) { empty = value; if (value === 'true' && document.activeElement?.id === 'wc-tip-chars') document.activeElement = {}; } }, contains: el => [...nodes.values()].includes(el), querySelectorAll: () => [nodes.get('wc-input')] };
  const document = { documentElement: { lang }, activeElement: nodes.get('wc-input'), getElementById: id => nodes.get(id),
    querySelector: s => ['.tool-widget', '.wc-wrap'].includes(s) ? widget : null, querySelectorAll: () => [], addEventListener: (type, fn) => { if (type === 'keydown') listeners.push(fn); } };
  const context = vm.createContext({ document, Intl, _slug: 'word-counter', window: { trackTool: (...args) => tracks.push(args), ztPersist: { clear: slug => clears.push(slug) } } });
  if (sharedFirst) vm.runInContext(shortcut, context);
  vm.runInContext(source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1], context);
  if (!sharedFirst) vm.runInContext(shortcut, context);
  return { nodes, clears, tracks, widget,
    input(text) { const el = nodes.get('wc-input'); el.value = text; el.handlers.input.call(el); },
    key(key, meta = false, inside = true, modifier = true, focusId = 'wc-input') { document.activeElement = inside ? nodes.get(focusId) : {}; let prevented = false; const e = { key, ctrlKey: modifier && !meta, metaKey: modifier && meta, preventDefault() { prevented = true; } }; for (const fn of listeners) fn(e); return prevented; },
    stats() { return ['chars', 'chars-no-spaces', 'words', 'sentences', 'paragraphs', 'read-time', 'speak-time'].map(id => nodes.get('wc-' + id).textContent); }
  };
}
for (const lang of ['en', 'zh', 'ja', 'ko']) for (const sharedFirst of [false, true]) {
  const h = page(lang, sharedFirst), prefix = lang + '/sharedFirst=' + sharedFirst + ': ';
  h.input('One two.'); eq(prefix + 'real full-page statistics', h.stats(), ['8', '7', '2', '1', '1', '< 1 min', '< 1 min']);
  for (const meta of [false, true]) for (const key of ['l', 'L']) {
    const before = h.stats();
    check(prefix + 'outside shortcut is inert', !h.key(key, meta, false)); eq(prefix + 'outside retains statistics', h.stats(), before);
    check(prefix + 'unmodified key is inert', !h.key(key, meta, true, false)); eq(prefix + 'unmodified retains statistics', h.stats(), before);
    const n = h.clears.length;
    check(prefix + key + '/' + meta + ' clears the tool', h.key(key, meta));
    eq(prefix + 'all seven statistics reset with input', [h.nodes.get('wc-input').value, h.stats()], ['', ['0', '0', '0', '0', '0', '0 min', '0 min']]);
    eq(prefix + 'shared persistence clear runs once', h.clears.slice(n), ['word-counter']);
    h.input('One two.'); eq(prefix + 'new input recovers', h.stats(), ['8', '7', '2', '1', '1', '< 1 min', '< 1 min']);
  }
  const beforeTipClear = h.clears.length;
  h.key('l', false, true, true, 'wc-tip-chars');
  eq(prefix + 'clearing from a statistic tip preserves shared persistence cleanup', h.clears.slice(beforeTipClear), ['word-counter']);
  h.input(''); eq(prefix + 'ordinary empty input resets statistics', h.stats(), ['0', '0', '0', '0', '0', '0 min', '0 min']);
}

// ---------- v2 page layout ----------
const v2Start = passes;
const sha = text => createHash('sha256').update(text).digest('hex');
const strings = vm.runInNewContext('(' + source.match(/const STRINGS = ([\s\S]*?);\nconst T/)[1] + ')');
const markup = source.replace(/^---[\s\S]*?---\s*/, '').split('<script')[0];
const css = source.split('<style>')[1].split('</style>')[0];
const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
eq('v2 exact protected engine bytes', [Buffer.byteLength(source.slice(startIndex, endIndex + END_MARK.length)), sha(source.slice(startIndex, endIndex + END_MARK.length))], [1683, 'ceed0fc51136f9b4b92c36f42207404f9f0554369f3d15712413735d4b1335f1']);
check('v2 direct flex root', /^<div class="wc-wrap" data-empty="true">/.test(markup) && /\.wc-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 0/.test(css));
check('v2 registered analyze', /'word-counter':\s*'analyze'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
check('v2 only actual automatic counting controls', !/<button|btn-primary|btn-copy|download/.test(markup));
check('v2 runtime language replacement removed', !/data-i18n/.test(source) && !/STRINGS|tips|pageLang/.test(script));
check('v2 labeled editable input grows and scrolls internally', /<label for="wc-input">\{T.inputText\}/.test(markup) && /#wc-input\s*\{[^}]*flex: 1 1 0;[^}]*min-height: 0;[^}]*resize: none;[^}]*overflow: auto/.test(css));
check('v2 input panel receives available height', /\.wc-row\s*\{[^}]*flex: 1 1 0;[^}]*min-width: 0;[^}]*min-height: 0/.test(css));
check('v2 result is bounded, full-width and keyboard scrollable', /\.wc-results\s*\{[^}]*flex: none;[^}]*max-height: 18rem;[^}]*overflow: auto/.test(css) && /id="wc-results"[^>]*tabindex="0"[^>]*role="region"[^>]*aria-label=\{T.results\}/.test(markup));
check('v2 all seven live metrics preserve original IDs', ['chars','chars-no-spaces','words','sentences','paragraphs','read-time','speak-time'].every(id => markup.includes('id="wc-' + id + '"')) && /id="wc-stats"[^>]*role="status"[^>]*aria-live="polite"/.test(markup));
check('v2 desktop empty result explains counts and keeps zeros hidden', markup.includes('{T.emptyResult}') && /\.wc-wrap\[data-empty="true"\] \.wc-stats, \.wc-wrap\[data-empty="false"\] \.wc-empty\s*\{ display: none; \}/.test(css));
check('v2 stacked input stays 160px and hides empty results', /@media \(max-width: 860px\)[\s\S]*#wc-input\s*\{ flex: none; height: 160px; \}/.test(css) && /\.wc-wrap\[data-empty="true"\] \.wc-results\s*\{ display: none; \}/.test(css));
check('v2 phone results use two bounded columns', /@media \(max-width: 640px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/.test(css));
const tips = [...markup.matchAll(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{T.tips\.(\w+)\}<\/Toggletip>/g)];
eq('v2 eight tips cover input and every metric', tips.map(x => x[3]).sort(), ['input','characters','charsNoSpaces','words','sentences','paragraphs','readingTime','speakingTime'].sort());
for (const lang of ['en','zh','ja','ko']) {
  const t = strings[lang];
  eq(lang + ' v2 locale keys', Object.keys(t).sort(), Object.keys(strings.en).sort());
  eq(lang + ' v2 tip keys', Object.keys(t.tips).sort(), Object.keys(strings.en.tips).sort());
  for (const tip of tips) check(lang + ' v2 actual label and plain fact ' + tip[1], typeof t[tip[2]] === 'string' && t[tip[2]].trim().length > 0 && typeof t.tips[tip[3]] === 'string' && t.tips[tip[3]].trim().length > 0);
  const mdx = readFileSync(join(root, 'src/content/tools/word-counter', lang + '.mdx'), 'utf8');
  const steps = (mdx.match(/^steps:\n([\s\S]*?)(?=^faqItems:)/m)?.[1] || '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line.trim().slice(2)));
  eq(lang + ' v2 four plain steps', steps.length, 4);
  check(lang + ' v2 step limits and actual labels', steps.every(x => [...x].length <= 280 && !/[<>]|\]\(|\*\*|`/.test(x)) && steps.reduce((n,x) => n + [...x].length, 0) <= 1200 && ['inputText','characters','words','readingTime','speakingTime'].every(key => steps.join(' ').includes(t[key])));
  eq(lang + ' MDX content contract', contractProblems('word-counter', lang), '');
  const h = page(lang, false);
  eq(lang + ' v2 initial state is empty', h.widget.dataset.empty, 'true');
  h.input(' \t\n'); eq(lang + ' v2 whitespace has meaningful character counts', [h.widget.dataset.empty, h.stats()], ['false', ['3','0','0','0','0','0 min','0 min']]);
  h.input('👍 a'); eq(lang + ' v2 unicode uses the actual engine', h.stats(), ['4','3','2','1','1','< 1 min','< 1 min']);
  const text = Array.from({ length: 1200 }, () => 'Hello world.').join('\n');
  h.input(text); eq(lang + ' v2 long content keeps every count and minute', h.stats(), ['15599','13200','2400','1200','1','12 min','19 min']);
  eq(lang + ' v2 long input is preserved', h.nodes.get('wc-input').value, text);
  h.key('l'); eq(lang + ' v2 keyboard clear restores empty layout', h.widget.dataset.empty, 'true');
}
console.log('v2 page layout: ' + (passes - v2Start) + ' passed, ' + failures + ' total failures');
console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
