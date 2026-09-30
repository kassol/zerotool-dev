// NATO Phonetic Alphabet — code word table and text conversion regression test
//
// Read:  src/components/tools/NatoPhoneticAlphabetTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the 26 letter code words equal the ICAO Annex 10 list (Alfa and Juliett, as on
// icao.int "Alphabet – Radiotelephony" and in 無線局運用規則 別表第五号); digits 0–9; case-insensitive
// lookup; spaces become "/", do not count as characters and use the localized space label in table rows; full-width letters, digits and the
// ideographic space (U+3000) match after NFKC; symbols and kana give the unknown marker; an
// emoji outside the BMP is one row; the ja page examples; 4-language STRINGS have the same keys.
//
// Run: node scripts/test-nato-phonetic-alphabet.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/NatoPhoneticAlphabetTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in NatoPhoneticAlphabetTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { NATO, convert };')();

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
const conv = (text) => E.convert(text, '[?]', '(space)');
const words = (text) => conv(text).codes.join(' ');

// ---------- code word table ----------
const ICAO = ['Alfa', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India',
  'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra',
  'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu'];
ICAO.forEach((word, i) => eq('letter ' + String.fromCharCode(65 + i), E.NATO[String.fromCharCode(65 + i)], word));
eq('digits 0–9', '0123456789'.split('').map((d) => E.NATO[d]),
  ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Niner']);
eq('table has 36 entries', Object.keys(E.NATO).length, 36);

// ---------- conversion ----------
eq('lower case', words('hello'), 'Hotel Echo Lima Lima Oscar');
eq('mixed case', words('HeLLo'), 'Hotel Echo Lima Lima Oscar');
eq('space → /', words('a b'), 'Alfa / Bravo');
eq('space not counted', conv('a b').chars, 2);
eq('space row uses the caller\'s label', E.convert(' ', '[?]', '（スペース）').rows, [{ ch: '（スペース）', code: '—' }]);
eq('unknown marker is the caller\'s', words('@'), '[?]');
eq('symbols', words('a.b@c'), 'Alfa [?] Bravo [?] Charlie');
eq('kana is unknown', words('あ'), '[?]');
eq('empty text', conv(''), { rows: [], codes: [], chars: 0 });
eq('prototype keys are unknown', words('_'), '[?]');

// ---------- full-width input (Japanese IME) ----------
eq('full-width letters', words('ＪＡ'), 'Juliett Alfa');
eq('full-width lower case', words('ｊａ'), 'Juliett Alfa');
eq('full-width digits', words('１２３'), 'One Two Three');
eq('ideographic space', words('Ａ　Ｂ'), 'Alfa / Bravo');
eq('full-width row keeps the typed character', conv('Ａ').rows, [{ ch: 'Ａ', code: 'Alfa' }]);

// ---------- code points ----------
eq('emoji outside the BMP is one row', conv('a😀').rows.length, 2);
eq('emoji counted once', conv('😀').chars, 1);

// ---------- ja page examples ----------
eq('ja example: JA73AB', words('JA73AB'), 'Juliett Alfa Seven Three Alfa Bravo');
eq('ja example: 予約番号 K7Q9 X2', words('K7Q9 X2'), 'Kilo Seven Quebec Niner / X-ray Two');
eq('ja example: e-mail', words('sato.k@example.jp'),
  'Sierra Alfa Tango Oscar [?] Kilo [?] Echo X-ray Alfa Mike Papa Lima Echo [?] Juliett Papa');

// ---------- 4-language STRINGS ----------
const stringsMatch = source.match(/var STRINGS = \{([\s\S]*?)\n      \};/);
check('STRINGS block found', !!stringsMatch);
if (stringsMatch) {
  const STRINGS = new Function('return {' + stringsMatch[1] + '};')();
  const keys = Object.keys(STRINGS.en).sort().join(',');
  ['zh', 'ja', 'ko'].forEach((lang) => eq('STRINGS ' + lang + ' keys', Object.keys(STRINGS[lang]).sort().join(','), keys));
  const i18nKeys = [...source.matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)].map((m) => m[1]);
  i18nKeys.forEach((k) => check('STRINGS.en has ' + k, k in STRINGS.en));
  eq('space label per language', ['en', 'zh', 'ja', 'ko'].map((l) => STRINGS[l].space), ['(space)', '（空格）', '（スペース）', '(공백)']);
  check('render passes the localized space label', source.includes('convert(text, t.unknown, t.space)'));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
