// Base64 — built page localization test
//
// Read:  dist/{,zh/,ja/,ko/}tools/base64/index.html (run `npm run build` first)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the first HTML a visitor receives already has the page language in the
// input and output labels, their placeholders, the Encode button and the file drop
// zone, so non-English pages do not show English text before the script runs.
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

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
