// Early input — text that is already in a field when the tool script starts is handled
//
// Read:  src/components/tools/{TomlJson,YamlToml,YamlJson,YamlValidator,JsonFormatter,
//        AiTokenCounter}Tool.astro, run with scripts/astro-page-harness.mjs
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Astro bundles a tool's <script> as a module, and module scripts run only after the page is
// parsed. Text typed during that time (or restored by the browser on reload) fires input events
// that no listener receives. Each case puts the text into the field before the page scripts run
// (harness `preset`, with `active` for the focused field), then checks that the script converts
// it once in the focused direction, keeps it (no example or saved text written over it), leaves
// no second conversion pending, and that later typing still converts.
//
// Run: node scripts/test-early-input.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadPage } from './astro-page-harness.mjs';

let passes = 0, failures = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + (detail !== undefined ? '\n  ' + detail : '')); }
}

/* ── Two-panel converters ── */
const CONVERTERS = {
  'toml-json': { file: 'src/components/tools/TomlJsonTool.astro', wrap: '.tj-wrap', left: 'tj-toml', right: 'tj-json', status: 'tj-status', copyLeft: 'tj-copy-toml', copyRight: 'tj-copy-json',
    leftText: 'a = 1', leftOut: '{\n  "a": 1\n}', rightText: '{"b":2}', rightOut: 'b = 2\n', lossy: 'x = inf' },
  'yaml-json': { file: 'src/components/tools/YamlJsonTool.astro', wrap: '.yj-wrap', left: 'yj-yaml', right: 'yj-json', status: 'yj-status', copyLeft: 'yj-copy-yaml', copyRight: 'yj-copy-json',
    leftText: 'a: 1', leftOut: '{\n  "a": 1\n}', rightText: '{"b":2}', rightOut: 'b: 2\n', lossy: 'x: .inf' },
  'yaml-toml': { file: 'src/components/tools/YamlTomlTool.astro', wrap: '.yt-wrap', left: 'yt-yaml', right: 'yt-toml', status: 'yt-status', copyLeft: 'yt-copy-yaml', copyRight: 'yt-copy-toml',
    leftText: 'a: 1', leftOut: 'a = 1\n', rightText: 'b = 2', rightOut: 'b: 2\n', lossy: 'x: ~' },
};
const EXAMPLE_YAML = 'database:\n  host: localhost\n  port: 5432\n  enabled: true';

for (const [tool, t] of Object.entries(CONVERTERS)) {
  const open = (preset, active) => loadPage(t.file, { stringsSelector: t.wrap, preset, active });
  const el = (p, id) => p.el(id);
  const ok = (p) => /\bsuccess\b/.test(el(p, t.status).className);

  // typed into the left panel before the script ran
  let p = open({ [t.left]: t.leftText }, t.left);
  check(`${tool}: early left text converts on load`, el(p, t.right).value === t.leftOut && ok(p) && !el(p, t.copyRight).disabled, JSON.stringify(el(p, t.right).value));
  check(`${tool}: early left text is kept`, el(p, t.left).value === t.leftText, JSON.stringify(el(p, t.left).value));
  el(p, t.right).value = 'MARK'; p.flush();
  check(`${tool}: no second conversion is pending`, el(p, t.right).value === 'MARK');
  p.type(t.left, t.leftText + '\nlater' + (tool === 'toml-json' ? ' = 2' : ': 2'));
  check(`${tool}: later typing converts the new text`, el(p, t.right).value.includes('later') && ok(p), JSON.stringify(el(p, t.right).value));

  // typed into the right panel only
  p = open({ [t.right]: t.rightText }, t.right);
  check(`${tool}: early right text converts on load`, el(p, t.left).value === t.rightOut && ok(p) && !el(p, t.copyLeft).disabled, JSON.stringify(el(p, t.left).value));

  // both panels have text (browser restore after a reload): the focused panel decides
  p = open({ [t.left]: t.leftText, [t.right]: t.rightText }, t.right);
  check(`${tool}: both filled, right focused → right is the input`, el(p, t.left).value === t.rightOut && el(p, t.right).value === t.rightText, JSON.stringify([el(p, t.left).value, el(p, t.right).value]));
  p = open({ [t.left]: t.leftText, [t.right]: t.rightText });
  check(`${tool}: both filled, nothing focused → left is the input`, el(p, t.right).value === t.leftOut && el(p, t.left).value === t.leftText, JSON.stringify([el(p, t.left).value, el(p, t.right).value]));

  // a value the target cannot hold stops as usual
  p = open({ [t.left]: t.lossy }, t.left);
  check(`${tool}: early lossy text stops with copy disabled`, el(p, t.right).value === '' && /\berror\b/.test(el(p, t.status).className) && el(p, t.copyRight).disabled, el(p, t.status).textContent);

  // whitespace only is empty
  p = open({ [t.left]: '  \n ' }, t.left);
  check(`${tool}: whitespace only does not convert`, !/\b(success|error)\b/.test(el(p, t.status).className) || tool === 'yaml-toml', el(p, t.status).className);
}

// yaml-toml: the example fills the page only when both panels are empty
{
  const t = CONVERTERS['yaml-toml'];
  let p = loadPage(t.file, { stringsSelector: t.wrap });
  check('yaml-toml: empty page still shows the example', p.el('yt-yaml').value === EXAMPLE_YAML && p.el('yt-toml').value.startsWith('[database]'));
  p = loadPage(t.file, { stringsSelector: t.wrap, preset: { 'yt-toml': 'b = 2' } });
  check('yaml-toml: early TOML is not replaced by the example', p.el('yt-toml').value === 'b = 2' && p.el('yt-yaml').value === 'b: 2\n', JSON.stringify([p.el('yt-yaml').value, p.el('yt-toml').value]));
  p = loadPage(t.file, { stringsSelector: t.wrap, preset: { 'yt-yaml': '  ' } });
  check('yaml-toml: whitespace only counts as empty and shows the example', p.el('yt-yaml').value === EXAMPLE_YAML);
}

/* ── yaml-validator: already validates text that is present on load ── */
{
  const p = loadPage('src/components/tools/YamlValidatorTool.astro', { dataset: { '.yv-wrap': { lang: 'en', msgValid: 'Valid' } }, preset: { 'yv-input': 'a: 1' } });
  check('yaml-validator: early text is validated on load', p.el('yv-status').textContent === 'Valid' && p.el('yv-preview-content').textContent === '{\n  "a": 1\n}');
}

/* ── Tools that restore saved text (ztPersist) must not write it over early input ── */
function frontStrings(file, start, end) {
  const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const a = src.indexOf(start), b = src.indexOf(end, a);
  return vm.runInNewContext(src.slice(a, b) + '\n;STRINGS');
}
const persist = (saved) => {
  const writes = [];
  return { writes, ztPersist: { load: () => saved, save: (_slug, v) => writes.push(v), clear() {} } };
};
// Browser globals the two scripts touch while booting; rendering details are not checked here.
const BROWSER = {
  Blob, TextEncoder, TextDecoder, URL, Uint8Array, Uint32Array, Int32Array, ArrayBuffer, DataView,
  requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: () => {},
  requestIdleCallback: () => 0, matchMedia: () => ({ matches: false, addEventListener() {} }),
  performance: { now: () => 0 }, location: { href: 'http://localhost/', search: '', hash: '' },
  addEventListener() {}, removeEventListener() {},
};
{
  const file = 'src/components/tools/JsonFormatterTool.astro';
  const S = frontStrings(file, 'const STRINGS = {', 'const S = STRINGS');
  const open = (preset, saved) => {
    const ps = persist(saved);
    const p = loadPage(file, { dataset: { 'jf-wrap': { strings: JSON.stringify(S.en) } }, preset, active: 'jf-input', globals: { ...BROWSER, ztPersist: ps.ztPersist } });
    return p;
  };
  let p = open({ 'jf-input': '{"typed":1}' }, { input: '{"saved":1}' });
  check('json-formatter: early input is not replaced by the saved input', p.el('jf-input').value === '{"typed":1}', JSON.stringify(p.el('jf-input').value));
  p = open({}, { input: '{"saved":1}' });
  check('json-formatter: an empty field still gets the saved input', p.el('jf-input').value === '{"saved":1}', JSON.stringify(p.el('jf-input').value));
}
{
  const file = 'src/components/tools/AiTokenCounterTool.astro';
  const S = frontStrings(file, 'const STRINGS = {', '/* ── strings:end ── */');
  const open = (preset, saved) => {
    const ps = persist(saved);
    return loadPage(file, { dataset: { '.atc-wrap': { lang: 'en', strings: JSON.stringify(S.en), sample: 'x' } }, preset, active: 'atc-input', globals: { ...BROWSER, ztPersist: ps.ztPersist } });
  };
  let p = open({ 'atc-input': 'typed text' }, { text: 'saved text' });
  check('ai-token-counter: early input is not replaced by the saved text', p.el('atc-input').value === 'typed text', JSON.stringify(p.el('atc-input').value));
  p = open({}, { text: 'saved text' });
  check('ai-token-counter: an empty field still gets the saved text', p.el('atc-input').value === 'saved text', JSON.stringify(p.el('atc-input').value));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
