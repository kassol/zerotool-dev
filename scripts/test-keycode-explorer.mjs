// Keycode Explorer — the mobile input fallback does not invent a `code` value
//
// Read:  src/components/tools/KeycodeExplorerTool.astro (extracts the real `captureFromMobileInput`
//        between the `engine:start` / `engine:end` markers and runs it with stub DOM helpers),
//        src/content/tools/keycode-explorer/{en,zh,ja,ko}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// An input event only carries the inserted text (InputEvent.data). Before the fix the fallback
// showed code "KeyA" for the letter "a", which is the physical key only on QWERTY-like
// layouts (UI Events KeyboardEvent code spec: on AZERTY the key that types "a" is "KeyQ"), and
// charCode as the first UTF-16 code unit. Now code / keyCode / which / charCode are shown as
// "—" and only `key` (the typed text) is filled.
//
// Run: node scripts/test-keycode-explorer.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/KeycodeExplorerTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in KeycodeExplorerTool.astro');
  process.exit(1);
}

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}

function runCapture(text) {
  const shown = {};
  const fields = new Proxy({}, { get: (_, k) => k });
  const env = {
    capturedCount: 0,
    padCount: {}, padKey: {}, padGlyph: { classList: { add() {}, remove() {} } },
    fields,
    setText: (k, v) => { shown[k] = v; },
    setMods() {}, buildSnippet() {}, pushHistory() {},
    mobileInput: { value: text },
    window: { setTimeout() {} },
  };
  const fn = new Function(...Object.keys(env), source.slice(startIndex, endIndex) + '\nreturn captureFromMobileInput;')(...Object.values(env));
  fn({ data: text });
  return shown;
}

for (const ch of ['a', 'Q', 'é', '😀', '中']) {
  const shown = runCapture(ch);
  check('key for ' + ch, shown.key === JSON.stringify(ch), shown.key);
  for (const f of ['code', 'keyCode', 'which', 'charCode', 'location']) {
    check(f + ' is not guessed for ' + ch, shown[f] === '—', String(shown[f]));
  }
}

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const block = source.slice(source.indexOf('\n        ' + lang + ': {'));
  const note = /mobileNote:\s*'([^']*)'/.exec(block);
  check(lang + ': mobile note says code is not available', note && /code/.test(note[1]) && /keyCode/.test(note[1]), note && note[1]);
  const mdx = readFileSync(join(root, 'src/content/tools/keycode-explorer', lang + '.mdx'), 'utf8');
  check(lang + ': page explains code on non-QWERTY layouts (KeyQ on AZERTY)', mdx.includes('KeyQ'), lang);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
