// URL Encode / Decode — page script against a stand-in DOM
//
// Read:  src/components/tools/UrlEncodeTool.astro (runs the inline page script against a small
//        stand-in for the elements it reads), src/content/tools/url-encode/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: encode / decode through the action button; Swap moves the result into the input box
// and switches the mode (it used to keep the mode, so pressing the button again encoded the
// result a second time); a decode error clears the old result instead of leaving it next to the
// error; every example row on the English page is the output of the same built-ins.
//
// Run: node scripts/test-url-encode.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/UrlEncodeTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/url-encode/en.mdx'), 'utf8');
const scriptMatch = /<script is:inline>([\s\S]*?)<\/script>/.exec(source);
if (!scriptMatch) {
  console.error('FAIL: could not locate the page script in UrlEncodeTool.astro');
  process.exit(1);
}

function makePage() {
  const els = {};
  function el(id) {
    if (!els[id]) {
      const handlers = {};
      els[id] = {
        id, value: '', checked: false, textContent: '', className: '', placeholder: '',
        addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
        fire(type) { (handlers[type] || []).forEach((fn) => fn.call(els[id], { target: els[id] })); },
        getAttribute() { return null; },
      };
    }
    return els[id];
  }
  // a radio group: checking one unchecks the others, as in the browser
  let checkedValue = 'encode';
  const radios = ['encode', 'decode'].map((v) => {
    const r = el('radio-' + v);
    r.value = v;
    Object.defineProperty(r, 'checked', {
      get() { return checkedValue === v; },
      set(on) { if (on) checkedValue = v; else if (checkedValue === v) checkedValue = null; },
    });
    return r;
  });
  const document = {
    documentElement: { lang: 'en' },
    getElementById: el,
    querySelectorAll(sel) { return sel === 'input[name="urlmode"]' ? radios : []; },
    querySelector(sel) {
      if (sel === 'input[name="urlmode"]:checked') return radios.find((r) => r.checked) || null;
      const m = /\[value="(\w+)"\]/.exec(sel);
      return m ? radios.find((r) => r.value === m[1]) : null;
    },
  };
  new Function('document', 'window', 'navigator', 'setTimeout', 'clearTimeout', scriptMatch[1])(
    document, {}, {}, () => 0, () => {});
  return {
    el,
    run(text) { el('url-input').value = text; el('url-run').fire('click'); return el('url-output').value; },
    setMode(m) { radios.forEach((r) => { r.checked = r.value === m; }); radios.find((r) => r.value === m).fire('change'); },
    mode() { return radios.find((r) => r.checked).value; },
  };
}

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual));
}

// encode and decode through the button
let p = makePage();
eq('encode café', p.run('café & tea'), 'caf%C3%A9%20%26%20tea');
p.setMode('decode');
eq('decode', p.run('a%2Bb'), 'a+b');
eq('decode leaves +', p.run('a+b%20c'), 'a+b c');

// swap switches the mode
p = makePage();
const encoded = p.run('東京 2026');
p.el('url-swap').fire('click');
eq('swap: mode switches to decode', p.mode(), 'decode');
eq('swap: input holds the result', p.el('url-input').value, encoded);
eq('swap: run label follows the mode', p.el('url-run').textContent, 'Decode');
p.el('url-run').fire('click');
eq('swap then run decodes back', p.el('url-output').value, '東京 2026');
p.el('url-swap').fire('click');
eq('swap again: mode back to encode', p.mode(), 'encode');

// decode error clears the old result
p = makePage();
p.setMode('decode');
p.run('a%20b');
eq('decode before error', p.el('url-output').value, 'a b');
p.run('100%');
eq('error clears output', p.el('url-output').value, '');
eq('error status', p.el('url-status').textContent, 'Error: URI malformed');
for (const bad of ['%zz', '%E4%B8', '%C4%E3']) {
  p.run(bad);
  eq('error for ' + bad, p.el('url-status').textContent, 'Error: URI malformed');
}

// English page examples
const rows = [
  ['encode', 'https://example.com/search?q=café & tea#top'],
  ['encode', '東京 2026'],
  ['encode', '😀'],
  ['encode', "Zoë O'Brien (admin)!*~"],
  ['decode', 'a%2Bb'],
  ['decode', 'a+b%20c'],
];
for (const [mode, input] of rows) {
  const out = mode === 'encode' ? encodeURIComponent(input) : decodeURIComponent(input);
  p = makePage();
  p.setMode(mode);
  eq('page example ' + input, p.run(input), out);
  const shown = (s) => page.includes('<code>' + s.replace(/&/g, '&amp;') + '</code>') || page.includes('<code>{"' + s + '"}</code>');
  eq('page shows input ' + input, shown(input), true);
  eq('page shows output ' + out, shown(out), true);
}
eq('page double-encoding example', encodeURIComponent(encodeURIComponent('a b')), 'a%2520b');

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
