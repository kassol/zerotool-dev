// Unicode Text Converter (fancy text) — style tables and reverse conversion regression test
//
// Read:  src/components/tools/UnicodeTextConverterTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers and the STRINGS table between
//        `strings:start` / `strings:end`, so this test cannot drift from the shipped source);
//        src/content/tools/unicode-text-converter/{en,zh,ja,ko}.mdx (examples quoted on the pages)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Expected values come from the Unicode code charts and UnicodeData.txt 18.0 (code points,
// <super> / <sub> / <circle> / <square> / <font> decompositions, character names), typed in
// below as literals, and from String.prototype.normalize('NFKC') as an independent check.
// Before this test: circled lower-case letters came out as circled capitals (a → Ⓐ);
// "Squared" used NEGATIVE SQUARED letters (🅰) for both cases; subscript b c d f g w y z
// were a Greek beta, Chinese tone marks, superscript d and g, superscript v and script y z;
// small caps q was ǫ (o with ogonek) and s stayed s; strikethrough and underline split
// emoji into lone surrogates; accented letters (é, ü) were left unstyled; user text was
// written into the cards with innerHTML.
//
// Run: node scripts/test-unicode-text-converter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// Timing limits catch order-of-magnitude regressions; CI runners are several times slower than a dev machine.
const PERF_SLACK = process.env.CI ? 4 : 1;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/UnicodeTextConverterTool.astro'), 'utf8');

function between(text, a, b, what) {
  const i = text.indexOf(a);
  const j = text.indexOf(b);
  if (i < 0 || j <= i) {
    console.error('FAIL: could not locate the ' + what + ' block in UnicodeTextConverterTool.astro');
    process.exit(1);
  }
  return text.slice(i + a.length, j);
}

const block = between(source, '/* ── engine:start ── */', '/* ── engine:end ── */', 'engine');
const E = new Function(block + '\nreturn { STYLE_IDS, convert, toPlain, analyze, fill, graphemes };')();
const stringsSrc = between(source, '/* ── strings:start ── */', '/* ── strings:end ── */', 'strings')
  .replace(/^\s*const STRINGS = /, 'return ')
  .replace(/\}\s*as const;\s*$/, '}');
const STRINGS = new Function(stringsSrc)();

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
const conv = (text, id) => E.convert(text, id).text;
const cps = (s) => Array.from(s).map((c) => c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
const hasLoneSurrogate = (s) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

// ---------- style list ----------
eq('23 styles in page order', E.STYLE_IDS.length, 23);
eq('style ids are unique', new Set(E.STYLE_IDS).size, E.STYLE_IDS.length);

// ---------- literal outputs from the Unicode code charts ----------
const LITERALS = [
  ['bold', 'Hello 42', '𝐇𝐞𝐥𝐥𝐨 𝟒𝟐'],
  ['boldSans', 'Hello 42', '𝗛𝗲𝗹𝗹𝗼 𝟰𝟮'],
  ['sans', 'Hello 42', '𝖧𝖾𝗅𝗅𝗈 𝟦𝟤'],
  ['italic', 'hello', 'ℎ𝑒𝑙𝑙𝑜'],
  ['boldItalic', 'Hello', '𝑯𝒆𝒍𝒍𝒐'],
  ['italicSans', 'Hello', '𝘏𝘦𝘭𝘭𝘰'],
  ['boldItalicSans', 'Hello', '𝙃𝙚𝙡𝙡𝙤'],
  ['script', 'Hello Bergen', 'ℋℯ𝓁𝓁ℴ ℬℯ𝓇ℊℯ𝓃'],
  ['boldScript', 'Hello', '𝓗𝓮𝓵𝓵𝓸'],
  ['fraktur', 'Hello Zurich', 'ℌ𝔢𝔩𝔩𝔬 ℨ𝔲𝔯𝔦𝔠𝔥'],
  ['boldFraktur', 'Hello', '𝕳𝖊𝖑𝖑𝖔'],
  ['doubleStruck', 'CHNPQRZ 2026', 'ℂℍℕℙℚℝℤ 𝟚𝟘𝟚𝟞'],
  ['monospace', 'Hello 42', '𝙷𝚎𝚕𝚕𝚘 𝟺𝟸'],
  ['circled', 'abc ABC 0129', 'ⓐⓑⓒ ⒶⒷⒸ ⓪①②⑨'],
  ['negativeCircled', 'ab 0 9', '🅐🅑 ⓿ ❾'],
  ['squared', 'AbC', '🄰🄱🄲'],
  ['negativeSquared', 'AbC', '🅰🅱🅲'],
  ['fullwidth', 'Hi, 1! (a+b)', 'Ｈｉ，　１！　（ａ＋ｂ）'],
  ['smallCaps', 'Hello quiz box', 'Hᴇʟʟᴏ ꞯᴜɪᴢ ʙᴏx'],
  ['superscript', 'x2+1 (n)', 'ˣ²⁺¹ ⁽ⁿ⁾'],
  ['superscript', 'TM DVD', 'ᵀᴹ ᴰⱽᴰ'],
  ['subscript', 'H2O x=(a+e)', 'H₂O ₓ₌₍ₐ₊ₑ₎'],
  ['strikethrough', 'ab', 'a\u0336b\u0336'],
  ['underline', 'a b', 'a\u0332 \u0332b\u0332'],
];
for (const [id, input, want] of LITERALS) eq('chart: ' + id + ' ' + input, conv(input, id), want);

// ---------- every styled character, checked against NFKC ----------
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const NFKC_TO_SELF = ['bold', 'boldSans', 'sans', 'italic', 'boldItalic', 'italicSans', 'boldItalicSans',
  'script', 'boldScript', 'fraktur', 'boldFraktur', 'doubleStruck', 'monospace', 'circled',
  'fullwidth', 'superscript', 'subscript'];
for (const id of NFKC_TO_SELF) {
  const bad = [];
  for (const ch of ALNUM) {
    const r = E.convert(ch, id);
    if (r.missing.length) continue;
    if (Array.from(r.text).length !== 1 || r.text === ch || r.text.normalize('NFKC') !== ch) bad.push(ch + '→' + r.text);
  }
  eq('NFKC(styled) is the typed character: ' + id, bad, []);
}
{
  const bad = [];
  for (const ch of ALNUM.slice(0, 52)) {
    const r = conv(ch, 'squared');
    if (r.normalize('NFKC') !== ch.toUpperCase()) bad.push(ch + '→' + r);
  }
  eq('squared: <square> capitals for both cases (U+1F130..U+1F149)', bad, []);
}
// Styles whose characters have no decomposition: check code points by offset.
{
  const bad = [];
  for (let i = 0; i < 26; i++) {
    const up = String.fromCharCode(65 + i);
    const lo = String.fromCharCode(97 + i);
    if (conv(up, 'negativeCircled') !== String.fromCodePoint(0x1F150 + i)) bad.push('nc ' + up);
    if (conv(lo, 'negativeCircled') !== String.fromCodePoint(0x1F150 + i)) bad.push('nc ' + lo);
    if (conv(up, 'negativeSquared') !== String.fromCodePoint(0x1F170 + i)) bad.push('ns ' + up);
    if (conv(lo, 'negativeSquared') !== String.fromCodePoint(0x1F170 + i)) bad.push('ns ' + lo);
  }
  eq('negative circled U+1F150.. and negative squared U+1F170.. by offset', bad, []);
}

// Small capitals: names from UnicodeData.txt 18.0 ("LATIN LETTER SMALL CAPITAL X").
// No SMALL CAPITAL X is encoded, so x is left as typed and reported.
const SMALL_CAPS = {
  a: '1D00', b: '0299', c: '1D04', d: '1D05', e: '1D07', f: 'A730', g: '0262', h: '029C', i: '026A',
  j: '1D0A', k: '1D0B', l: '029F', m: '1D0D', n: '0274', o: '1D0F', p: '1D18', q: 'A7AF', r: '0280',
  s: 'A731', t: '1D1B', u: '1D1C', v: '1D20', w: '1D21', y: '028F', z: '1D22',
};
{
  const got = {};
  for (const ch of 'abcdefghijklmnopqrstuvwyz') got[ch] = cps(conv(ch, 'smallCaps'))[0];
  eq('small caps code points (UnicodeData 18.0 LATIN LETTER SMALL CAPITAL *)', got, SMALL_CAPS);
  eq('small caps: x has no small capital', E.convert('x', 'smallCaps').missing, ['x']);
  eq('small caps: capitals stay capitals and are not reported', E.convert('ABC', 'smallCaps'), { text: 'ABC', missing: [] });
}

// Superscript and subscript: every output must carry a <super> / <sub> decomposition in
// UnicodeData.txt 18.0. Letters first encoded in Unicode 14.0 or later (superscript C F Q S q,
// subscript w y z added in 18.0) are left out because common fonts do not have them yet.
const SUPER = {
  A: '1D2C', B: '1D2E', D: '1D30', E: '1D31', G: '1D33', H: '1D34', I: '1D35', J: '1D36', K: '1D37',
  L: '1D38', M: '1D39', N: '1D3A', O: '1D3C', P: '1D3E', R: '1D3F', T: '1D40', U: '1D41', V: '2C7D',
  W: '1D42', a: '1D43', b: '1D47', c: '1D9C', d: '1D48', e: '1D49', f: '1DA0', g: '1D4D', h: '02B0',
  i: '2071', j: '02B2', k: '1D4F', l: '02E1', m: '1D50', n: '207F', o: '1D52', p: '1D56', r: '02B3',
  s: '02E2', t: '1D57', u: '1D58', v: '1D5B', w: '02B7', x: '02E3', y: '02B8', z: '1DBB',
  0: '2070', 1: '00B9', 2: '00B2', 3: '00B3', 4: '2074', 5: '2075', 6: '2076', 7: '2077', 8: '2078',
  9: '2079', '+': '207A', '-': '207B', '=': '207C', '(': '207D', ')': '207E',
};
const SUB = {
  a: '2090', e: '2091', h: '2095', i: '1D62', j: '2C7C', k: '2096', l: '2097', m: '2098', n: '2099',
  o: '2092', p: '209A', r: '1D63', s: '209B', t: '209C', u: '1D64', v: '1D65', x: '2093',
  0: '2080', 1: '2081', 2: '2082', 3: '2083', 4: '2084', 5: '2085', 6: '2086', 7: '2087', 8: '2088',
  9: '2089', '+': '208A', '-': '208B', '=': '208C', '(': '208D', ')': '208E',
};
for (const [id, table, label] of [['superscript', SUPER, '<super>'], ['subscript', SUB, '<sub>']]) {
  const got = {};
  const missing = [];
  for (const ch of ALNUM + '+-=()') {
    const r = E.convert(ch, id);
    if (r.missing.length) missing.push(ch);
    else if (r.text !== ch) got[ch] = cps(r.text)[0];
  }
  const want = {};
  for (const ch of ALNUM + '+-=()') if (table[ch]) want[ch] = table[ch];
  eq(id + ' table equals the ' + label + ' forms encoded before Unicode 14.0', got, want);
  eq(id + ': letters without a form are reported', missing,
    Array.from(ALNUM).filter((c) => !table[c]));
}
eq('subscript b c d f g q w y z stay as typed (no Greek, tone marks or script letters)',
  conv('bcdfgqwyz', 'subscript'), 'bcdfgqwyz');

// ---------- grapheme clusters: accents, emoji, line breaks ----------
eq('accented letters keep their marks on the styled base (NFC input)',
  conv('Café Müller', 'bold'), '𝐂𝐚𝐟𝐞\u0301 𝐌𝐮\u0308𝐥𝐥𝐞𝐫');
eq('NFD input gives the same result as NFC input',
  conv('Ñandú Façade'.normalize('NFD'), 'boldSans'), conv('Ñandú Façade'.normalize('NFC'), 'boldSans'));
eq('a letter with no styled base is reported once', E.convert('ßß ø', 'bold').missing, ['ß', 'ø']);
eq('styles without accent support keep é as typed and report it',
  E.convert('Café', 'circled'), { text: 'Ⓒⓐⓕé', missing: ['é'] });
eq('fullwidth keeps é as typed (no fullwidth accented letters)', conv('é', 'fullwidth'), 'é');
eq('digits without a script form are reported', E.convert('2026', 'script').missing, ['2', '0', '6']);
{
  const text = 'Hi 👋🏽 👨‍👩‍👧 🇯🇵';
  for (const id of ['strikethrough', 'underline']) {
    const out = conv(text, id);
    check(id + ': no lone surrogates', !hasLoneSurrogate(out), JSON.stringify(out));
    const mark = id === 'strikethrough' ? '\u0336' : '\u0332';
    eq(id + ': one mark after each grapheme cluster', out,
      'H' + mark + 'i' + mark + ' ' + mark + '👋🏽' + mark + ' ' + mark + '👨‍👩‍👧' + mark + ' ' + mark + '🇯🇵' + mark);
  }
  eq('emoji sequences pass through letter styles untouched', conv(text, 'bold'), '𝐇𝐢 👋🏽 👨‍👩‍👧 🇯🇵');
}
eq('line breaks get no overlay mark', conv('a\nb\r\nc', 'strikethrough'), 'a\u0336\nb\u0336\r\nc\u0336');
eq('CJK and Hangul are kept as typed', conv('你好 한글 カナ', 'bold'), '你好 한글 カナ');
eq('CJK is not reported per card', E.convert('你好', 'bold').missing, []);

// ---------- reverse: styled text back to plain text ----------
const PANGRAM = 'The Quick Brown Fox Jumps Over The Lazy Dog 0123456789 abcdefghijklmnopqrstuvwxyz';
for (const id of E.STYLE_IDS) {
  if (id === 'squared' || id === 'negativeCircled' || id === 'negativeSquared') continue;
  eq('round trip plain → ' + id + ' → plain', E.toPlain(conv(PANGRAM, id)).text, PANGRAM);
}
for (const id of ['squared', 'negativeCircled', 'negativeSquared']) {
  const caps = 'THE QUICK BROWN FOX 0123456789';
  eq('round trip capitals → ' + id + ' → plain', E.toPlain(conv(caps, id)).text, caps);
}
eq('toPlain counts changed characters', E.toPlain('𝐁𝐨𝐥𝐝 text').changed, 4);
eq('toPlain removes VS16 after an emoji-capable letter (🅰️)', E.toPlain('🅰\uFE0F🅱\uFE0F').text, 'AB');
eq('toPlain removes overlay marks added by other generators', E.toPlain('t\u0335e\u0337s\u0338t\u0333').text, 'test');
eq('toPlain keeps Japanese text and folds ideographic space only for the plain card',
  E.toPlain('ｈｅｌｌｏ\u3000世界').text, 'hello 世界');
eq('toPlain keeps regional indicators (flags)', E.toPlain('🇯🇵🇰🇷').text, '🇯🇵🇰🇷');
eq('toPlain keeps ™ ℃ № (letterlike symbols outside the style tables)', E.toPlain('™ ℃ №').text, '™ ℃ №');

// NFKC parity: in the ranges toPlain normalises, the result equals String.prototype.normalize('NFKC'),
// except NEGATIVE CIRCLED / NEGATIVE SQUARED letters and digits, which have no decomposition and
// are mapped by code point offset, and the superscript / subscript minus (see below).
{
  const ranges = [[0x1D400, 0x1D7FF], [0x2460, 0x24FF], [0x1F100, 0x1F1E5], [0xFF01, 0xFF5E],
    [0x2070, 0x209C], [0x1D2C, 0x1D6A], [0x1D9B, 0x1DBF], [0x02B0, 0x02B8], [0x02E0, 0x02E4]];
  const negative = {};
  for (let i = 0; i < 26; i++) {
    negative[String.fromCodePoint(0x1F150 + i)] = String.fromCharCode(65 + i);
    negative[String.fromCodePoint(0x1F170 + i)] = String.fromCharCode(65 + i);
  }
  negative['\u24FF'] = '0';
  // NFKC maps superscript and subscript minus to U+2212 MINUS SIGN; the tool maps them back
  // to the hyphen-minus it converted from, so a round trip returns the typed text.
  negative['\u207B'] = '-';
  negative['\u208B'] = '-';
  const bad = [];
  let n = 0;
  for (const [a, b] of ranges) {
    for (let cp = a; cp <= b; cp++) {
      const ch = String.fromCodePoint(cp);
      if (!/\p{Assigned}/u.test(ch)) continue;
      n++;
      const want = negative[ch] || ch.normalize('NFKC');
      const got = E.toPlain(ch).text;
      if (got !== want) bad.push(cp.toString(16) + ':' + got + '≠' + want);
    }
  }
  eq('toPlain equals NFKC across ' + n + ' assigned code points', bad.slice(0, 10), []);
}

// ---------- analyze: what the styles start from ----------
eq('analyze folds styled input back to plain letters', E.analyze('𝐁𝐨𝐥𝐝 & 𝒾𝓉𝒶𝓁𝒾𝒸'),
  { source: 'Bold & italic', styled: 10, others: [] });
eq('analyze keeps m², ① and the ideographic space', E.analyze('m² ①\u3000x').source, 'm² ①\u3000x');
eq('analyze folds fullwidth letters typed with a Japanese IME', E.analyze('ＺｅｒｏＴｏｏｌ').source, 'ZeroTool');
eq('restyling fullwidth input', conv(E.analyze('ＡＢＣ').source, 'boldSans'), '𝗔𝗕𝗖');
eq('analyze lists letters from other scripts once', E.analyze('你好你 Hi 한 α').others, ['你', '好', '한', 'α']);
eq('analyze: Latin letters with accents are not "other scripts"', E.analyze('Ærø café').others, []);

// ---------- examples quoted on the tool pages ----------
// Each row: page language, input, style (or 'plain'), output as printed on the page.
const PAGE_EXAMPLES = [
  ['en', 'Café Müller · Est. 2026', 'boldSans', '𝗖𝗮𝗳𝗲́ 𝗠𝘂̈𝗹𝗹𝗲𝗿 · 𝗘𝘀𝘁. 𝟮𝟬𝟮𝟲'],
  ['en', 'Café Müller · Est. 2026', 'script', '𝒞𝒶𝒻ℯ́ ℳ𝓊̈𝓁𝓁ℯ𝓇 · ℰ𝓈𝓉. 2026'],
  ['en', '𝓙𝓾𝓵𝓲𝓪 𝓒𝓸𝓼𝓽𝓪', 'plain', 'Julia Costa'],
  ['en', '𝓙𝓾𝓵𝓲𝓪 𝓒𝓸𝓼𝓽𝓪', 'boldFraktur', '𝕵𝖚𝖑𝖎𝖆 𝕮𝖔𝖘𝖙𝖆'],
  ['en', '𝓙𝓾𝓵𝓲𝓪 𝓒𝓸𝓼𝓽𝓪', 'smallCaps', 'Jᴜʟɪᴀ Cᴏꜱᴛᴀ'],
  ['en', 'CO2 and x2+1', 'subscript', 'CO₂ ₐₙd ₓ₂₊₁'],
  ['en', 'CO2 and x2+1', 'superscript', 'Cᴼ² ᵃⁿᵈ ˣ²⁺¹'],
  ['en', 'Hi 👋🏽 SALE 50%', 'strikethrough', 'H̶i̶ ̶👋🏽̶ ̶S̶A̶L̶E̶ ̶5̶0̶%̶'],
  ['zh', '小王 Wang Lei 2026', 'boldSans', '小王 𝗪𝗮𝗻𝗴 𝗟𝗲𝗶 𝟮𝟬𝟮𝟲'],
  ['zh', '小王 Wang Lei 2026', 'doubleStruck', '小王 𝕎𝕒𝕟𝕘 𝕃𝕖𝕚 𝟚𝟘𝟚𝟞'],
  ['zh', '小王 Wang Lei 2026', 'circled', '小王 Ⓦⓐⓝⓖ Ⓛⓔⓘ ②⓪②⑥'],
  ['zh', 'ｚｅｒｏ　ｔｏｏｌ', 'plain', 'zero tool'],
  ['zh', 'ｚｅｒｏ　ｔｏｏｌ', 'boldSans', '𝘇𝗲𝗿𝗼　𝘁𝗼𝗼𝗹'],
  ['ja', 'カフェ Tokyo 2026', 'boldItalicSans', 'カフェ 𝙏𝙤𝙠𝙮𝙤 2026'],
  ['ja', 'カフェ Tokyo 2026', 'doubleStruck', 'カフェ 𝕋𝕠𝕜𝕪𝕠 𝟚𝟘𝟚𝟞'],
  ['ja', 'ＳＡＫＵＲＡ　２０２６', 'plain', 'SAKURA 2026'],
  ['ja', 'ＳＡＫＵＲＡ　２０２６', 'boldSans', '𝗦𝗔𝗞𝗨𝗥𝗔　𝟮𝟬𝟮𝟲'],
  ['ja', '𝓜𝓮𝓻𝓻𝔂 𝓧𝓶𝓪𝓼', 'plain', 'Merry Xmas'],
  ['ja', '𝓜𝓮𝓻𝓻𝔂 𝓧𝓶𝓪𝓼', 'smallCaps', 'Mᴇʀʀʏ Xᴍᴀꜱ'],
  ['ko', '서울 Seoul Night', 'script', '서울 𝒮ℯℴ𝓊𝓁 𝒩𝒾ℊ𝒽𝓉'],
  ['ko', '서울 Seoul Night', 'boldScript', '서울 𝓢𝓮𝓸𝓾𝓵 𝓝𝓲𝓰𝓱𝓽'],
  ['ko', '서울 Seoul Night', 'negativeSquared', '서울 🆂🅴🅾🆄🅻 🅽🅸🅶🅷🆃'],
  ['ko', 'ｈｅｌｌｏ', 'plain', 'hello'],
  ['ko', 'ｈｅｌｌｏ', 'boldSans', '𝗵𝗲𝗹𝗹𝗼'],
  ['ko', '𝓗𝓪𝓹𝓹𝔂 𝓓𝓪𝔂', 'bold', '𝐇𝐚𝐩𝐩𝐲 𝐃𝐚𝐲'],
  ['ko', '𝓗𝓪𝓹𝓹𝔂 𝓓𝓪𝔂', 'circled', 'Ⓗⓐⓟⓟⓨ Ⓓⓐⓨ'],
];
const pages = {};
for (const l of ['en', 'zh', 'ja', 'ko']) {
  pages[l] = readFileSync(join(root, 'src/content/tools/unicode-text-converter/' + l + '.mdx'), 'utf8');
}
for (const [l, input, id, want] of PAGE_EXAMPLES) {
  const got = id === 'plain' ? E.toPlain(input).text : conv(E.analyze(input).source, id);
  eq('page ' + l + ': ' + input + ' → ' + id, got, want);
  check('page ' + l + ' prints ' + JSON.stringify(want), pages[l].includes(want));
}

// The JavaScript snippet on the English page runs and matches the tool.
{
  const m = pages.en.match(/```js\n([\s\S]*?)```/);
  check('en page has the toBold snippet', !!m);
  if (m) {
    const toBold = new Function(m[1].replace(/toBold\('Hello 42'\);.*\n?/, '') + '\nreturn toBold;')();
    eq('en page toBold("Hello 42")', toBold('Hello 42'), '𝐇𝐞𝐥𝐥𝐨 𝟒𝟐');
    eq('en page toBold equals the Bold style on the pangram', toBold(PANGRAM), conv(PANGRAM, 'bold'));
    check('en page snippet comment shows the same output', m[1].includes("// '𝐇𝐞𝐥𝐥𝐨 𝟒𝟐'"));
  }
}

// ---------- size ----------
{
  const big = ('Fancy text 123 ').repeat(7000);
  const t0 = performance.now();
  for (const id of E.STYLE_IDS) E.convert(E.analyze(big).source, id);
  const ms = performance.now() - t0;
  check('105,000 characters × 23 styles in under 3 s (' + Math.round(ms) + ' ms)', ms < 3000 * PERF_SLACK);
}

// ---------- strings ----------
const langs = ['en', 'zh', 'ja', 'ko'];
const keysOf = (o) => Object.keys(o).sort().join(',');
for (const l of langs.slice(1)) {
  eq('STRINGS ' + l + ' has the same keys as en', keysOf(STRINGS[l]), keysOf(STRINGS.en));
}
for (const l of langs) {
  eq('STRINGS ' + l + ' names every style', keysOf(STRINGS[l].styles), E.STYLE_IDS.slice().sort().join(','));
  check('STRINGS ' + l + ' placeholders', STRINGS[l].copyAria.includes('{style}') && STRINGS[l].copiedStatus.includes('{style}') &&
    STRINGS[l].preview.includes('{sample}') && STRINGS[l].styledNote.includes('{n}') &&
    STRINGS[l].othersNote.includes('{chars}') && STRINGS[l].missing.includes('{chars}'));
}

// ---------- page script: no user text through innerHTML ----------
const script = source.slice(source.indexOf('/* ── engine:end ── */'), source.indexOf('</script>'));
check('page script does not use innerHTML / outerHTML / insertAdjacentHTML', !/innerHTML|outerHTML|insertAdjacentHTML/.test(script));
check('page script writes card text with textContent', /c\.text\.textContent = r\.text/.test(script));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
