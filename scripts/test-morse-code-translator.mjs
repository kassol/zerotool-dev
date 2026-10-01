// Morse Code Translator — decoding accepts ASCII dots and hyphens; skipped and unknown input is reported
//
// Read:  src/components/tools/MorseCodeTranslatorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); src/content/tools/morse-code-translator/*.mdx (chart rows)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: Morse typed with ASCII `.` and `-` decodes (before the fix it gave `?????`), as do
// other common dot / dash characters (• ∙ ・ ． _ – — ー －) and mixes of them; letters split by
// whitespace, words by `/` or `|`, lines by line breaks; codes not in the table decode to `[?]`
// and are reported (before: a bare `?`, the same as the code for the question mark);
// encoding reports characters without a code (before: dropped silently); É / é is the ITU-R
// M.1677-1 accented e `··−··`; full-width letters go through NFKC; the ITU-R M.1677-1 letter,
// figure and punctuation codes (expected values typed from the recommendation, part I §1.1);
// every chart row on the 4 tool pages matches the engine; round trip of the whole table;
// 4-language STRINGS keys.
//
// Run: node scripts/test-morse-code-translator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/MorseCodeTranslatorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in MorseCodeTranslatorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { CHAR_TO_MORSE, textToMorse, morseToText };')();

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
const enc = (s) => E.textToMorse(s);
const dec = (s) => E.morseToText(s);

// ---------- ITU-R M.1677-1 part I §1.1 (written here with ASCII . and -) ----------
const ITU = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', 'É': '..-..', F: '..-.', G: '--.', H: '....', I: '..',
  J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
  S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', 0: '-----',
  '.': '.-.-.-', ',': '--..--', ':': '---...', '?': '..--..', "'": '.----.', '-': '-....-', '/': '-..-.',
  '(': '-.--.', ')': '-.--.-', '"': '.-..-.', '=': '-...-', '+': '.-.-.', '@': '.--.-.',
};
const toUni = (s) => s.replace(/\./g, '·').replace(/-/g, '−');
for (const [ch, code] of Object.entries(ITU)) {
  eq('ITU code for ' + ch, E.CHAR_TO_MORSE[ch], toUni(code));
}

// ---------- the reported defect: ASCII dots and hyphens ----------
eq('ASCII HELLO WORLD', dec('.... . .-.. .-.. --- / .-- --- .-. .-.. -..').text, 'HELLO WORLD');
eq('ASCII decode reports nothing unknown', dec('.... . .-.. .-.. ---').unknown, []);
eq('Unicode HELLO WORLD still works', dec('···· · ·−·· ·−·· −−− / ·−− −−− ·−· ·−·· −··').text, 'HELLO WORLD');
eq('mixed · and - in one input', dec('··· --- ...').text, 'SOS');
eq('bullet dots and en dashes', dec('•–•–•– / ∙∙∙').text, '. S');
eq('underscore as dash', dec('.__. _').text, 'PT');
eq('em dash and minus sign', dec('—— −').text, 'MT');
eq('full-width dot and dash', dec('．－ －．．．').text, 'AB');
eq('katakana middle dot and long vowel mark', dec('・ー ー・・・').text, 'AB');
eq('| as word separator', dec('... | ---').text, 'S O');
eq('line breaks keep lines', dec('...\n---').text, 'S\nO');
eq('extra spaces and slashes', dec('  ...   ---  /  / ...  ').text, 'SO S');

// ---------- unknown codes and stray characters ----------
{
  const r = dec('... ........ ---');
  eq('8 dots (ITU "error" signal) is not in the table', r.text, 'S[?]O');
  eq('unknown code reported', r.unknown, ['········']);
}
{
  const r = dec('... abc ---');
  eq('group with letters decodes to [?]', r.text, 'S[?]O');
  eq('group with letters reported as typed', r.unknown, ['abc']);
}
eq('question mark code decodes to ?', dec('..--..').text, '?');
eq('repeated unknown reported once', dec('........ ........').unknown, ['········']);

// ---------- encoding ----------
eq('SOS', enc('SOS').morse, '··· −−− ···');
eq('words separated by " / "', enc('hi you').morse, '···· ·· / −·−− −−− ··−');
eq('lower case', enc('sos').morse, '··· −−− ···');
eq('é is the ITU accented e', enc('Café').morse, '−·−· ·− ··−· ··−··');
eq('É decodes', dec('..-..').text, 'É');
{
  const r = enc('Grüße 中文 😀 ok');
  eq('skipped characters reported once each, in order', r.skipped, ['Ü', 'ß', '中', '文', '😀']);
  eq('known characters still encoded (ß is not expanded to SS)', r.morse, '−−· ·−· · / −−− −·−');
}
eq('nothing skipped for plain text', enc('CQ DE N0CALL K').skipped, []);
eq('CQ call', enc('CQ DE N0CALL K').morse, '−·−· −−·− / −·· · / −· −−−−− −·−· ·− ·−·· ·−·· / −·−');
eq('full-width letters via NFKC', enc('ＳＯＳ').morse, '··· −−− ···');
eq('multiple spaces and newlines are one word gap', enc('a  b\nc').morse, '·− / −··· / −·−·');

// ---------- round trip ----------
{
  const chars = Object.keys(E.CHAR_TO_MORSE).join('');
  eq('round trip of every character', dec(enc(chars).morse).text, chars);
  const codes = Object.values(E.CHAR_TO_MORSE);
  check('codes are unique', new Set(codes).size === codes.length);
}

// ---------- chart rows on the tool pages ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/morse-code-translator', lang + '.mdx'), 'utf8');
  const re = /<td><code>\{"((?:[^"\\]|\\.)+)"\}<\/code><\/td><td><code>\{"([·−]+)"\}<\/code><\/td>/g;
  let m, n = 0, bad = [];
  while ((m = re.exec(mdx))) {
    n++;
    const ch = JSON.parse('"' + m[1] + '"');
    if (E.CHAR_TO_MORSE[ch] !== m[2]) bad.push(ch + '=' + m[2]);
  }
  check(lang + ' chart rows match the engine (' + n + ')', bad.length === 0 && n >= 55, bad.join(', ') + ' n=' + n);
  // worked examples quoted in the Timing and Format section
  for (const [input, fn, key] of [['Café 9:30, ok?', enc, 'morse'], ['Grüße ok', enc, 'morse'],
    ['.... . .-.. .-.. --- / .-- --- .-. .-.. -..', dec, 'text']]) {
    check(lang + ' page quotes ' + JSON.stringify(input), mdx.includes('{' + JSON.stringify(input) + '}'));
    check(lang + ' page shows the output of ' + JSON.stringify(input), mdx.includes('{' + JSON.stringify(fn(input)[key]) + '}'), fn(input)[key]);
  }
}

// ---------- 4-language STRINGS ----------
{
  const m = source.match(/var STRINGS = (\{[\s\S]*?\n\s{6}\});/);
  check('STRINGS block found', !!m);
  if (m) {
    const S = new Function('return ' + m[1])();
    const keys = Object.keys(S.en).sort();
    for (const l of ['zh', 'ja', 'ko']) eq('STRINGS keys ' + l, Object.keys(S[l]).sort(), keys);
    for (const k of ['skipped', 'unknown']) check('STRINGS has ' + k, k in S.en && S.en[k].includes('{list}'));
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
