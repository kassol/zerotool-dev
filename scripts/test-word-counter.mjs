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

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
