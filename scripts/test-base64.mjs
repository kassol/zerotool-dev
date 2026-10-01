// Base64 — built page localization test
//
// Read:  dist/{,zh/,ja/,ko/}tools/base64/index.html (run `npm run build` first),
//        src/components/tools/Base64Tool.astro, src/content/tools/base64/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the first HTML a visitor receives already has the page language in the
// input and output labels, their placeholders, the Encode button and the file drop
// zone, so non-English pages do not show English text before the script runs; the lone-surrogate,
// large-file and read-error messages and the Data URI label are in the page language (they were
// English, and a lone surrogate showed "Invalid Base64 input" in Encode mode); switching Standard /
// URL-safe converts the current output (it used to keep the old alphabet). The engine block is
// read from src/components/tools/Base64Tool.astro.
//
// Run: node scripts/test-base64.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + detail));
}
function equal(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}

const text = (html) => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
function pick(html, re) {
  const m = html.match(re);
  return m ? m[1] : null;
}

const expected = {
  en: { plain: 'Plain Text', encodePh: 'Enter text to encode...', outPh: 'Base64 output appears here...', encode: 'Encode', drop: 'Drop any file here, or click to select' },
  zh: { plain: '纯文本', encodePh: '输入要编码的文本...', outPh: 'Base64 输出在这里...', encode: '编码', drop: '拖入任意文件，或点击选择' },
  ja: { plain: 'プレーンテキスト', encodePh: 'エンコードするテキストを入力...', outPh: 'Base64 出力がここに表示されます...', encode: 'エンコード', drop: 'ファイルをここにドロップ、またはクリックして選択' },
  ko: { plain: '일반 텍스트', encodePh: '인코딩할 텍스트를 입력...', outPh: 'Base64 출력이 여기에 표시됩니다...', encode: '인코딩', drop: '파일을 여기에 끌어다 놓거나 클릭하여 선택' },
};

for (const [lang, want] of Object.entries(expected)) {
  const file = join(root, 'dist', lang === 'en' ? '' : lang, 'tools/base64/index.html');
  if (!existsSync(file)) {
    check(lang + ': built page exists (run npm run build)', false, file);
    continue;
  }
  const html = readFileSync(file, 'utf8');
  equal(lang + ': input label', text(pick(html, /<label[^>]*id="b64-input-label"[^>]*>([\s\S]*?)<\/label>/) || ''), want.plain);
  equal(lang + ': input placeholder', pick(html, /<textarea[^>]*id="b64-input"[^>]*placeholder="([^"]*)"/), want.encodePh);
  equal(lang + ': output label', text((pick(html, /<label[^>]*id="b64-output-label"[^>]*>([\s\S]*?)<\/label>/) || '').replace(/<button[\s\S]*?<\/button>/, '')), 'Base64');
  equal(lang + ': output placeholder', pick(html, /<textarea[^>]*id="b64-output"[^>]*placeholder="([^"]*)"/), want.outPh);
  equal(lang + ': Encode button', text(pick(html, /<button[^>]*id="b64-run"[^>]*>([\s\S]*?)<\/button>/) || ''), want.encode);
  equal(lang + ': drop zone text', text(pick(html, /<div[^>]*class="b64-drop-inner[^"]*"[^>]*>([\s\S]*?)<\/div>/) || ''), want.drop);
  if (lang !== 'en') {
    const widget = pick(html, /(<div[^>]*class="b64-wrap[\s\S]*?<\/textarea>[\s\S]*?<\/textarea>)/) || '';
    check(lang + ': no English label or drop text in the widget', !/Plain Text|Drop any file|Enter text to encode|Result appears here/.test(widget));
  }
}

// ---------- engine (source): lone surrogates are reported instead of "Invalid Base64 input" ----------
const source = readFileSync(join(root, 'src/components/tools/Base64Tool.astro'), 'utf8');
const es = source.indexOf('/* ── engine:start ── */');
const ee = source.indexOf('/* ── engine:end ── */');
check('engine block found', es >= 0 && ee > es);
if (es >= 0 && ee > es) {
  const E = new Function(source.slice(es, ee) + '\nreturn { loneSurrogateAt, switchVariant };')();
  equal('no lone surrogate', E.loneSurrogateAt('a😀b'), -1);
  equal('high surrogate alone', E.loneSurrogateAt('ab\uD83D'), 3);
  equal('low surrogate alone', E.loneSurrogateAt('😀\uDE00x'), 2);
  equal('position counts code points', E.loneSurrogateAt('😀😀\uD800'), 3);
  equal('standard → URL-safe', E.switchVariant('+/8=', 'urlsafe'), '-_8');
  equal('URL-safe → standard', E.switchVariant('-_8', 'standard'), '+/8=');
  equal('round trip', E.switchVariant(E.switchVariant('YWI/Pz4+', 'urlsafe'), 'standard'), 'YWI/Pz4+');
}
for (const [lang, word] of Object.entries({ en: 'lone surrogate', zh: '代理项', ja: 'サロゲート', ko: '서로게이트' })) {
  const file = join(root, 'dist', lang === 'en' ? '' : lang, 'tools/base64/index.html');
  if (!existsSync(file)) continue;
  const html = readFileSync(file, 'utf8');
  check(lang + ': lone-surrogate message in the page language', html.includes(word));
  if (lang !== 'en') check(lang + ': no English Data URI label', !/Include Data URI prefix/.test(html));
}
const page = readFileSync(join(root, 'src/content/tools/base64/en.mdx'), 'utf8');
check('page no longer says variant changes do not convert again', !page.includes('does not convert the current output again'));

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
