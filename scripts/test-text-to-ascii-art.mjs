// Text to ASCII Art — characters the FIGlet font cannot draw are reported, not dropped silently
//
// Read:  src/components/tools/TextToAsciiArtTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers and the STRINGS table),
//        public/figlet-fonts/*.flf (the fonts the page loads), node_modules/figlet (the library
//        the page bundles)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// figlet.js looks up each UTF-16 code unit of the text in the parsed font and skips the ones
// the font does not define (dist/figlet-*.js, generateFigTextLines). Covers: CJK, kana, Hangul,
// emoji (one entry per code point), tab and other whitespace / control characters written as
// U+XXXX, each skipped character listed once in input order, Latin-1 letters that the fonts do
// define (Ä Ö Ü ä ö ü ß) not reported, glyphs whose rows are all empty (3D-ASCII: ( ) _ { } ~
// and others) reported because they draw nothing; against every font on the page and every
// printable ASCII character plus CJK / emoji / Latin-1 probes: a character reported as
// skipped really renders nothing (rendering A?B equals AB), a character not reported really
// renders something; Standard supports all printable ASCII; the message in 4 languages names
// the font and the characters.
//
// Run: node scripts/test-text-to-ascii-art.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import figlet from 'figlet';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/TextToAsciiArtTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in TextToAsciiArtTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { unsupportedChars, skippedMessage };')();

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

// Load the page's fonts into figlet exactly as the browser build parses them.
const fontDir = join(root, 'public/figlet-fonts');
const fontNames = readdirSync(fontDir).filter((f) => f.endsWith('.flf')).map((f) => f.slice(0, -4));
const optionValues = [...source.matchAll(/<option value="([^"]+)">/g)].map((m) => m[1]);
eq('every font in the menu is served from public/figlet-fonts', optionValues.filter((f) => !fontNames.includes(f)), []);
for (const name of fontNames) figlet.parseFont(name, readFileSync(join(fontDir, name + '.flf'), 'utf8'));
const font = (name) => figlet.figFonts[name];
const render = (text, name) => figlet.textSync(text, { font: name });

const std = font('Standard');

// ---------- the reported defect ----------
eq('CJK characters reported', E.unsupportedChars('Hi 中文', std), ['中', '文']);
eq('kana and Hangul reported', E.unsupportedChars('カナ한글', std), ['カ', 'ナ', '한', '글']);
eq('each character once, in input order', E.unsupportedChars('中a中b文中', std), ['中', '文']);
eq('emoji is one entry', E.unsupportedChars('ok 😀', std), ['😀']);
eq('ASCII text has nothing to report', E.unsupportedChars('Hello, World! 123', std), []);
eq('Latin-1 letters defined by the font are not reported', E.unsupportedChars('ÄÖÜäöüß', std), []);
eq('é is in Standard, Ω is not', E.unsupportedChars('café Ω', std), ['Ω']);
eq('3D-ASCII draws nothing for ( ) _ { } and ~', E.unsupportedChars('f(x) a_b {~}', font('3D-ASCII')), ['(', ')', '_', '{', '~', '}']);
eq('tab reported', E.unsupportedChars('a\tb', std), ['\t']);

// ---------- message ----------
eq('message lists characters', E.skippedMessage('Skipped in {font}: {chars}', 'Standard', ['中', '文']),
  'Skipped in Standard: 中 文');
eq('whitespace and control characters written as U+XXXX',
  E.skippedMessage('{chars}', 'Standard', ['\t', '\u00a0', '\u200b', 'é']), 'U+0009 U+00A0 U+200B é');
eq('astral code point written in full', E.skippedMessage('{chars}', 'x', ['\u{E0041}']), 'U+E0041');

const stringsStart = source.indexOf('const STRINGS');
const stringsEnd = source.indexOf('\n    };', stringsStart);
const STRINGS = new Function(source.slice(stringsStart, stringsEnd + 7).replace(/^const STRINGS[^=]*=/, 'var STRINGS =') + '\nreturn STRINGS;')();
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const tpl = STRINGS[lang] && STRINGS[lang].skipped;
  check(lang + ' has a skipped message with {font} and {chars}',
    typeof tpl === 'string' && tpl.includes('{font}') && tpl.includes('{chars}'));
}

// ---------- page claims ----------
const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
eq('page (en): 你好 OK', E.skippedMessage(STRINGS.en.skipped, 'Standard', E.unsupportedChars('你好 OK', std)),
  'Skipped — the Standard font has no glyph for: 你 好');
eq('page (zh)', E.skippedMessage(STRINGS.zh.skipped, 'Standard', E.unsupportedChars('你好 OK', std)),
  '已跳过：Standard 字体里没有这些字符：你 好');
eq('page (ja)', E.skippedMessage(STRINGS.ja.skipped, 'Standard', E.unsupportedChars('こんにちは OK', std)),
  'スキップしました：Standard フォントにない文字：こ ん に ち は');
eq('page (ko)', E.skippedMessage(STRINGS.ko.skipped, 'Standard', E.unsupportedChars('안녕 OK', std)),
  '건너뜀: Standard 글꼴에 없는 문자: 안 녕');
eq('page: 你好 OK renders only OK', render('你好 OK', 'Standard'), render(' OK', 'Standard'));
eq('page: 3D-ASCII skips 14 punctuation marks', E.unsupportedChars(ascii, font('3D-ASCII')).join(''),
  '"\'()+=@\\_`{|}~');
eq('page: 3D-ASCII skips the umlauts', E.unsupportedChars('ÄÖÜäöüß', font('3D-ASCII')).join(''), 'ÄÖÜäöüß');
eq('page: CJK, kana, Hangul and emoji are in none of the 12 fonts',
  fontNames.filter((n) => E.unsupportedChars('你こ안😀', font(n)).length !== 4), []);
eq('page: 12 fonts', fontNames.length, 12);

// ---------- against every font on the page ----------
eq('Standard: printable ASCII supported', E.unsupportedChars(ascii, std), []);
const probes = [...ascii.slice(1), '中', 'カ', '한', '😀', 'é', 'Ä', 'ß', '\t', '€', '©', 'Ω'];
for (const name of fontNames) {
  for (const ch of probes) {
    const skipped = E.unsupportedChars(ch, font(name)).length === 1;
    const withChar = render('A' + ch + 'B', name);
    const without = render('AB', name);
    if (skipped) {
      eq(name + ': reported ' + JSON.stringify(ch) + ' renders nothing', withChar, without);
    } else {
      check(name + ': unreported ' + JSON.stringify(ch) + ' renders something', withChar !== without);
    }
  }
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
