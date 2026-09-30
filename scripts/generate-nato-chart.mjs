// NATO phonetic alphabet chart image for the ja tool page
//
// Read:  nothing (the table is defined below; keep it equal to the tables in
//        src/content/tools/nato-phonetic-alphabet/ja.mdx)
// Write: public/images/nato-phonetic-alphabet-ja.png (committed; not part of npm run build)
// Exit:  0 on success, 1 on error
//
// The image is shown at 560 CSS px wide and rendered at 2x (1120 px) so the text stays sharp
// on high-density screens. Needs a Japanese font: Hiragino Sans (macOS) or Noto Sans CJK JP.
//
// Sources: code words and digit words — 無線局運用規則 別表第五号 (e-Gov 325M50080000017);
// letter katakana — JARD「和文通話表 欧文通話表」(2024-04-08); digit katakana — this page's
// rendering of the 別表第五号 pronunciation column (ZE-RO, WUN, TOO, TREE, FOW-er, FIFE, ...).
//
// Run: node scripts/generate-nato-chart.mjs

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outFile = join(root, 'public/images/nato-phonetic-alphabet-ja.png');

const LETTERS = [
  ['A', 'Alfa', 'アルファ'], ['B', 'Bravo', 'ブラボー'], ['C', 'Charlie', 'チャーリー'],
  ['D', 'Delta', 'デルタ'], ['E', 'Echo', 'エコー'], ['F', 'Foxtrot', 'フォックストロット'],
  ['G', 'Golf', 'ゴルフ'], ['H', 'Hotel', 'ホテル'], ['I', 'India', 'インディア'],
  ['J', 'Juliett', 'ジュリエット'], ['K', 'Kilo', 'キロ'], ['L', 'Lima', 'リマ'],
  ['M', 'Mike', 'マイク'], ['N', 'November', 'ノベンバー'], ['O', 'Oscar', 'オスカー'],
  ['P', 'Papa', 'パパ'], ['Q', 'Quebec', 'ケベック'], ['R', 'Romeo', 'ロメオ'],
  ['S', 'Sierra', 'シエラ'], ['T', 'Tango', 'タンゴ'], ['U', 'Uniform', 'ユニフォーム'],
  ['V', 'Victor', 'ビクター'], ['W', 'Whiskey', 'ウイスキー'], ['X', 'X-ray', 'エクスレイ'],
  ['Y', 'Yankee', 'ヤンキー'], ['Z', 'Zulu', 'ズールー'],
];
const DIGITS = [
  ['0', 'Zero', 'ゼロ'], ['1', 'One', 'ワン'], ['2', 'Two', 'トゥー'], ['3', 'Three', 'トゥリー'],
  ['4', 'Four', 'フォウアー'], ['5', 'Five', 'ファイフ'], ['6', 'Six', 'シックス'],
  ['7', 'Seven', 'セブン'], ['8', 'Eight', 'エイト'], ['9', 'Nine', 'ナイナー'],
];

const W = 560;
const PAD = 28;
const GAP = 16;
const COL = (W - PAD * 2 - GAP) / 2;
const ROW = 44;
const FONT = "'Hiragino Sans', 'Noto Sans CJK JP', sans-serif";
const C = { bg: '#fbf8f3', panel: '#fffdf9', line: '#e8dfd2', text: '#2b231c', sub: '#64574a', accent: '#8a4a1f' };

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function rows(items, x, y0) {
  return items.map(([ch, word, kana], i) => {
    const y = y0 + i * ROW;
    const sep = i ? `<line x1="${x}" y1="${y}" x2="${x + COL}" y2="${y}" stroke="${C.line}" stroke-width="1"/>` : '';
    return sep +
      `<text x="${x + 18}" y="${y + 29}" text-anchor="middle" font-size="22" font-weight="700" fill="${C.accent}">${ch}</text>` +
      `<text x="${x + 42}" y="${y + 20}" font-size="17" font-weight="700" fill="${C.text}">${esc(word)}</text>` +
      `<text x="${x + 42}" y="${y + 38}" font-size="14" fill="${C.sub}">${kana}</text>`;
  }).join('');
}

function panel(x, y, h) {
  return `<rect x="${x - 8}" y="${y}" width="${COL + 16}" height="${h}" rx="10" fill="${C.panel}" stroke="${C.line}"/>`;
}

let y = PAD;
let body = '';
body += `<text x="${PAD}" y="${y + 24}" font-size="24" font-weight="700" fill="${C.text}">NATOフォネティックコード一覧</text>`;
body += `<text x="${W - PAD}" y="${y + 22}" text-anchor="end" font-size="13" font-weight="700" fill="${C.accent}">zerotool.dev</text>`;
body += `<text x="${PAD}" y="${y + 48}" font-size="13" fill="${C.sub}">A〜Z と 0〜9 の読み方（ICAO・無線局運用規則の綴り）</text>`;
y += 66;

const letterH = 13 * ROW + 8;
body += panel(PAD, y, letterH) + panel(PAD + COL + GAP, y, letterH);
body += rows(LETTERS.slice(0, 13), PAD, y + 4) + rows(LETTERS.slice(13), PAD + COL + GAP, y + 4);
y += letterH + 26;

body += `<text x="${PAD}" y="${y}" font-size="16" font-weight="700" fill="${C.text}">数字（航空無線での発音）</text>`;
y += 12;
const digitH = 5 * ROW + 8;
body += panel(PAD, y, digitH) + panel(PAD + COL + GAP, y, digitH);
body += rows(DIGITS.slice(0, 5), PAD, y + 4) + rows(DIGITS.slice(5), PAD + COL + GAP, y + 4);
y += digitH + 24;

body += `<text x="${PAD}" y="${y}" font-size="11.5" fill="${C.sub}">綴り・発音：無線局運用規則 別表第五号　文字の仮名：JARD 欧文通話表</text>`;
body += `<text x="${PAD}" y="${y + 18}" font-size="11.5" fill="${C.sub}">数字の仮名：別表第五号の発音表記（ZE-RO、TREE、FIFE、NIN-er など）による</text>`;
const H = y + 18 + PAD;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xml:lang="ja" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">` +
  `<rect width="100%" height="100%" fill="${C.bg}"/>${body}</svg>`;

try {
  mkdirSync(dirname(outFile), { recursive: true });
  const info = await sharp(Buffer.from(svg), { density: 144 })
    .png({ palette: true, colors: 64, compressionLevel: 9 })
    .toFile(outFile);
  console.log(`${outFile} ${info.width}×${info.height} ${info.size} bytes (CSS ${W}×${H})`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
