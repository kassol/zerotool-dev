// Aspect Ratio Calculator — ratio display, locked ratio, presets and resize fields
//
// Read:  src/components/tools/AspectRatioTool.astro (runs the page script against a small
//        stand-in for the elements it reads)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the simplified ratio and the 4-decimal value; Lock Ratio keeps the ratio that was
// locked, so typing several widths in a row does not drift (the ratio used to be recomputed
// from each rounded height: 1920×1080 → width 1000 → 563 → width 1920 → 1081); presets set
// 120 × the ratio numbers; the resize fields round to whole pixels; the examples on the
// English page; the English guide (src/content/blog/aspect-ratio-calculator-guide/en.mdx): the
// Euclidean-algorithm listings, the resolution table (ratio and decimal as the calculator shows
// them), the resize, letterbox and pillarbox figures, and code blocks marked
// {/* ar-run: {"lang":"node|python","expect":"…"} */} are run (python3 missing: SKIP); the four tool
// pages (src/content/tools/aspect-ratio/{lang}.mdx): {/* ar-check: … */} examples are recomputed with
// the page script (at least 2 per language, see AR_CHECK); analytics: one calculate event per
// committed Width / Height change or preset click, none per input event.
//
// Run: node scripts/test-aspect-ratio.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { load as loadYaml } from 'js-yaml';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/AspectRatioTool.astro'), 'utf8');
const scriptMatch = /<script\b[^>]*>([\s\S]*?)<\/script>/.exec(source);
if (!scriptMatch) {
  console.error('FAIL: could not locate the page script in AspectRatioTool.astro');
  process.exit(1);
}
const strings = JSON.parse(/const STRINGS = ([\s\S]*?) as const;/.exec(source)[1]);

function makePage({ lang = 'en', shellFirst = false } = {}) {
  const els = {}, documentHandlers = {}, cleared = [];
  const inputTypes = Object.fromEntries([...source.matchAll(/<input\b[^>]*id="([^"]+)"[^>]*type="([^"]+)"/g)].map(m => [m[1], m[2]]));
  function el(id) {
    if (!els[id]) {
      const handlers = {};
      els[id] = {
        id, type: inputTypes[id], value: '', checked: false, textContent: '', className: '', style: {},
        addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
        fire(type) { (handlers[type] || []).forEach((fn) => fn.call(els[id], { target: els[id] })); },
        getAttribute(name) { return this.attrs ? this.attrs[name] : null; },
        get classList() {
          const e = this;
          return {
            add(name) { e.className = [...new Set([...e.className.split(/\s+/).filter(Boolean), name])].join(' '); },
            remove(name) { e.className = e.className.split(/\s+/).filter(c => c !== name).join(' '); },
            contains(name) { return e.className.split(/\s+/).includes(name); },
          };
        },
      };
    }
    return els[id];
  }
  const chips = [[16, 9], [4, 3], [21, 9], [1, 1], [9, 16], [3, 2], [2, 3]].map(([w, h]) => {
    const c = el('chip-' + w + 'x' + h);
    c.attrs = { 'data-w': String(w), 'data-h': String(h) };
    return c;
  });
  const outside = { id: 'outside' };
  const widget = {
    contains(node) { return Object.values(els).includes(node); },
    querySelectorAll(sel) { return sel === 'textarea, input[type="text"]' ? Object.values(els).filter(e => e.type === 'text') : []; },
  };
  const document = {
    documentElement: { lang }, activeElement: outside,
    getElementById: el,
    querySelectorAll(sel) { return sel === '.ar-chip' ? chips : []; },
    querySelector(sel) { return ['.tool-widget', '.ar-wrap'].includes(sel) ? widget : null; },
    addEventListener(type, fn) { (documentHandlers[type] ||= []).push(fn); },
  };
  const tracks = [];
  const window = { ztPersist: { clear(slug) { cleared.push(slug); } }, trackTool(slug, action) { tracks.push(slug + ':' + action); } };
  const shell = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
  const shortcut = shell.slice(shell.indexOf('// ── Keyboard shortcuts:'), shell.indexOf('// ── Copy button visual feedback'));
  if (!shortcut.includes("document.addEventListener('keydown'")) throw new Error('Shared shortcut not found');
  const installShortcut = () => new Function('document', 'window', '_slug', shortcut)(document, window, 'aspect-ratio');
  if (shellFirst) installShortcut();
  const { tips, ...client } = strings[lang];
  new Function('document', 'window', 't', scriptMatch[1])(document, window, client);
  if (!shellFirst) installShortcut();
  return {
    els: el, cleared, tracks,
    type(id, v) { el(id).value = String(v); el(id).fire('input'); },
    commit(id) { el(id).fire('change'); },
    lock(on) { el('ar-lock').checked = on; el('ar-lock').fire('change'); },
    preset(w, h) { el('chip-' + w + 'x' + h).fire('click'); },
    ratio() { return el('ar-ratio').textContent; },
    decimal() { return el('ar-decimal').textContent; },
    key({ key = 'l', meta = false, focus = 'ar-width', modifier = true } = {}) {
      document.activeElement = focus ? el(focus) : outside;
      const event = { key, metaKey: meta && modifier, ctrlKey: !meta && modifier, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      for (const fn of documentHandlers.keydown || []) fn(event);
      return event;
    },
    state() {
      return JSON.stringify({ inputs: ['ar-width', 'ar-height', 'ar-new-width', 'ar-new-height'].map(id => el(id).value), locked: el('ar-lock').checked,
        ratio: el('ar-ratio').textContent, decimal: el('ar-decimal').textContent, preview: el('ar-preview').style,
        status: el('ar-status').textContent, chips: chips.map(c => c.className) });
    },
  };
}

let failures = 0;
let passes = 0;
let skips = 0;
function skip(name, why) { skips++; console.log('SKIP: ' + name + ' (' + why + ')'); }
function eq(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual));
}

let p = makePage();
eq('initial ratio', p.ratio(), '16:9');
eq('initial decimal', p.decimal(), '1.7778');

// Positive fractional dimensions keep finite results when the rounded GCD is zero.
for (const lang of ['en', 'zh', 'ja', 'ko']) for (const [w, h, ratio, decimal, preview] of [
  [0.1, 0.1, '0.1:0.1', '1.0000', '200px/200px'],
  [0.1, 0.2, '0.1:0.2', '0.5000', '100px/200px'],
  [1.5, 1, '1.5:1', '1.5000', '300px/200px'],
  [1.5, 1.5, '0.75:0.75', '1.0000', '200px/200px'],
]) {
  const q = makePage({ lang }), name = `${lang} fractional ${w}x${h}`;
  q.type('ar-width', w); q.type('ar-height', h);
  eq(name + ' ratio', q.ratio(), ratio);
  eq(name + ' decimal', q.decimal(), decimal);
  eq(name + ' preview', q.els('ar-preview').style.width + '/' + q.els('ar-preview').style.height, preview);
}

for (const [w, h, r, d] of [
  [2560, 1080, '64:27', '2.3704'],
  [3440, 1440, '43:18', '2.3889'],
  [1366, 768, '683:384', '1.7786'],
  [1080, 1350, '4:5', '0.8000'],
  [1170, 2532, '195:422', '0.4621'],
]) {
  p = makePage();
  p.type('ar-width', w);
  p.type('ar-height', h);
  eq(`${w}x${h} ratio`, p.ratio(), r);
  eq(`${w}x${h} decimal`, p.decimal(), d);
}

// lock keeps the original ratio
p = makePage();
p.lock(true);
p.type('ar-width', 1000);
eq('locked: width 1000', p.els('ar-height').value, 563);
p.type('ar-width', 1920);
eq('locked: back to 1920 does not drift', p.els('ar-height').value, 1080);
p.type('ar-height', 720);
eq('locked: height 720', p.els('ar-width').value, 1280);
p.lock(false);
p.type('ar-width', 1000);
eq('unlocked: height stays', p.els('ar-height').value, '720');
eq('unlocked: ratio follows inputs', p.ratio(), '25:18');

// Analytics: one event per committed change (as in css-triangle-generator), not one per keystroke.
p = makePage();
for (const v of ['1', '12', '128', '1280']) p.type('ar-width', v);
eq('typing a width sends no analytics event per input', p.tracks.length, 0);
p.commit('ar-width');
eq('committing the width sends one calculate event', p.tracks.join(','), 'aspect_ratio:calculate');
p.type('ar-height', '0'); p.commit('ar-height');
eq('committing an unusable height sends nothing', p.tracks.length, 1);
p.type('ar-height', '720'); p.commit('ar-height');
eq('committing a usable height sends one more event', p.tracks.length, 2);
p.preset(4, 3);
eq('a preset click still sends one event', p.tracks.length, 3);
p.lock(true); p.type('ar-width', '1000');
eq('typing with Lock Ratio on sends no event', p.tracks.length, 3);

// presets
p = makePage();
p.preset(21, 9);
eq('preset 21:9 width', p.els('ar-width').value, 2520);
eq('preset 21:9 height', p.els('ar-height').value, 1080);
eq('preset 21:9 ratio', p.ratio(), '7:3');

// resize fields
p = makePage();
p.type('ar-new-width', 1280);
eq('resize 1280 wide', p.els('ar-new-height').value, 720);
p.type('ar-new-width', 1000);
eq('resize 1000 wide rounds 562.5 up', p.els('ar-new-height').value, 563);
p.type('ar-new-height', 2160);
eq('resize 2160 high', p.els('ar-new-width').value, 3840);

// guide
{
  const guide = readFileSync(join(root, 'src/content/blog/aspect-ratio-calculator-guide/en.mdx'), 'utf8');
  const has = (name, text) => eq('guide: ' + name + ' (' + text + ')', guide.includes(text), true);
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };

  // Euclidean listings
  for (const [w, h, tail] of [[1920, 1080, ', ratio 1920/120 : 1080/120 = 16:9'], [3440, 1440, ', ratio 43:18']]) {
    const lines = [];
    let a = w, b = h;
    while (b) { lines.push([a, Math.floor(a / b), b, a % b]); [a, b] = [b, a % b]; }
    const width = String(lines[0][0]).length;
    const text = lines.map(([x, q, y, r], i) => String(x).padStart(width) + ' = ' + q + ' × ' + y + ' + ' + r + (i === lines.length - 1 ? '      → gcd = ' + a + tail : '')).join('\n');
    const block = new RegExp('ar-check: euclid ' + w + ' ' + h + ' \\*/\\}\\n```text\\n([\\s\\S]*?)\\n```').exec(guide);
    eq('guide Euclid listing ' + w + 'x' + h, block && block[1], text);
  }

  // resolution table, through the calculator's own script
  const table = guide.slice(guide.indexOf('{/* ar-check: resolutions */}')).split('\n\n')[0];
  const rows = [...table.matchAll(/^\| (\d+) × (\d+) \| ([\d:]+) \| ([\d.]+) \|/gm)];
  eq('guide resolution table has 18 rows', rows.length, 18);
  for (const [, w, h, r, d] of rows) {
    const q = makePage();
    q.type('ar-width', w);
    q.type('ar-height', h);
    eq('guide table ' + w + 'x' + h + ' ratio', q.ratio(), r);
    eq('guide table ' + w + 'x' + h + ' decimal', q.decimal(), d);
  }

  // examples in the text
  const q = makePage();
  q.type('ar-width', 1366); q.type('ar-height', 768);
  eq('1366x768 shown as 683:384', q.ratio(), '683:384');
  eq('gcd(1366,768) is 2', gcd(1366, 768), 2);
  has('1366 decimal', '1366 ÷ 768 = ' + (1366 / 768).toFixed(4) + ' against ' + (16 / 9).toFixed(4));
  has('difference', 'a difference of ' + ((1366 / 768 / (16 / 9) - 1) * 100).toFixed(2) + '%');
  has('1365.33', '768 × 16 ÷ 9 = ' + (768 * 16 / 9).toFixed(2));
  has('21/9 decimal', '21 ÷ 9 = ' + (21 / 9).toFixed(4));
  let r = makePage();
  r.type('ar-new-width', 1280);
  eq('resize 1280 → 720', r.els('ar-new-height').value, 720);
  r.type('ar-new-width', 1000);
  eq('resize 1000 → 563', r.els('ar-new-height').value, 563);
  has('563 text', 'show 563');
  eq('4:5 at 1080', 1080 * 5 / 4, 1350);
  eq('9:16 at 1080', 1080 * 16 / 9, 1920);
  r = makePage();
  r.lock(true); r.type('ar-width', 1000); r.type('ar-width', 1920);
  eq('lock returns to 1080', r.els('ar-height').value, 1080);
  r = makePage();
  r.preset(21, 9);
  eq('preset 21:9 size', r.els('ar-width').value + 'x' + r.els('ar-height').value, '2520x1080');
  eq('preset 21:9 shown', r.ratio(), '7:3');
  r = makePage();
  r.type('ar-width', 1.5); r.type('ar-height', 1);
  eq('1.5 x 1 → 1.5:1', r.ratio(), '1.5:1');
  const film = 1920 / 2.39;
  has('letterbox height', '1920 ÷ 2.39 = ' + Math.round(film) + ' pixels tall');
  has('letterbox bars', 'about ' + Math.floor((1080 - film) / 2) + ' pixels of black');
  has('pillarbox', '1080 × 4 ÷ 3 = ' + 1080 * 4 / 3 + ' pixels wide, leaving ' + (1920 - 1440) / 2 + ' pixels at each side');
  has('cover crop', 'scaled to 1920 wide and ' + 1920 * 3 / 4 + ' tall, and ' + (1920 * 3 / 4 - 1080) + ' pixels of height');
  has('geometric mean', '√(1.3333 × 2.35) = ' + Math.sqrt(4 / 3 * 2.35).toFixed(4));
  has('padding 16:9', String(9 / 16 * 100) + '%');
  has('padding 4:3 and 4:5', (3 / 4 * 100) + '% for 4:3 and ' + (5 / 4 * 100) + '% for 4:5');
  has('SAR', '(4/3) ÷ (3/2) = 8:9');
  eq('720x480 is 3:2', (() => { const p2 = makePage(); p2.type('ar-width', 720); p2.type('ar-height', 480); return p2.ratio(); })(), '3:2');

  // code blocks
  let py = false;
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); py = true; } catch {}
  const re = /\{\/\* ar-run: (\{.*?\}) \*\/\}\s*```[a-z]*\n([\s\S]*?)```/g;
  let m; let runs = 0;
  while ((m = re.exec(guide))) {
    runs++;
    const spec = JSON.parse(m[1]);
    const name = 'guide ' + spec.lang + ' block ' + runs;
    if (spec.lang === 'python' && !py) { skip(name, 'python3 not installed'); continue; }
    const dir = mkdtempSync(join(tmpdir(), 'ar-run-'));
    try {
      const file = join(dir, spec.lang === 'node' ? 'main.mjs' : 'main.py');
      writeFileSync(file, m[2]);
      eq(name, execFileSync(spec.lang === 'node' ? process.execPath : 'python3', [file]).toString().trim(), spec.expect);
    } catch (e) {
      eq(name, String(e.stderr || e.message).slice(0, 300), spec.expect);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  eq('guide has 2 runnable blocks', runs, 2);
}

// The shared shortcut clears text fields only. Numeric dimensions need a page reset.
for (const lang of ['en', 'zh', 'ja', 'ko']) for (const shellFirst of [false, true]) for (const meta of [false, true]) {
  const q = makePage({ lang, shellFirst }), name = `${lang} ${shellFirst ? 'shell first' : 'page first'} ${meta ? 'Meta' : 'Ctrl'}`;
  q.preset(21, 9); q.lock(true); q.type('ar-new-width', 1000);
  eq(name + ': original dimensions are numeric controls', q.els('ar-width').type + '/' + q.els('ar-height').type, 'number/number');
  const before = q.state();
  eq(name + ': outside shortcut is not intercepted', q.key({ meta, focus: null }).defaultPrevented, false);
  eq(name + ': outside shortcut keeps inputs and result', q.state(), before);
  eq(name + ': plain L is not intercepted', q.key({ modifier: false }).defaultPrevented, false);
  eq(name + ': plain L keeps inputs and result', q.state(), before);
  eq(name + ': shortcut is intercepted inside the tool', q.key({ key: meta ? 'L' : 'l', meta, focus: 'ar-new-height' }).defaultPrevented, true);
  eq(name + ': all dimensions and resize values clear', ['ar-width', 'ar-height', 'ar-new-width', 'ar-new-height'].every(id => q.els(id).value === ''), true);
  eq(name + ': cleared input has no locked ratio', q.els('ar-lock').checked, false);
  eq(name + ': ratio and decimal clear', q.ratio() + '/' + q.decimal(), '—/—');
  eq(name + ': preview clears', q.els('ar-preview').style.width + '/' + q.els('ar-preview').style.height, '0/0');
  eq(name + ': status clears', q.els('ar-status').textContent, '');
  eq(name + ': active preset clears', q.els('chip-21x9').classList.contains('ar-chip-active'), false);
  eq(name + ': shared persistence clear runs once', q.cleared.join(','), 'aspect-ratio');
  q.type('ar-width', 16);
  eq(name + ': new width does not restore the old locked height', q.els('ar-height').value, '');
  q.type('ar-height', 9);
  eq(name + ': fresh dimensions restore the correct result', q.ratio(), '16:9');
  q.type('ar-width', ''); q.type('ar-new-width', 320);
  eq(name + ': missing original size reports an error', q.els('ar-status').className.includes('error'), true);
  q.key({ meta });
  eq(name + ': shortcut clears prior errors too', q.els('ar-status').textContent, '');
}

// ---------- worked examples on the four tool pages ----------
// {/* ar-check: {"cases":[…]} or one case {"w","h"} | {"preset":"21:9"}, then optional "lock":true, "setWidth", "setHeight",
// "newWidth", "newHeight", and "show": fields to compare (default ["ratio","decimal"]) */}: the page
// script runs these steps; each shown field (ratio, decimal, width, height, newWidth, newHeight) must
// be a <code> span (or sit in a code block) after the note and before the next note or H2.
function codeSpans(text) {
  const spans = [...text.matchAll(/<code>([^<]*)<\/code>|`([^`\n]+)`/g)].map((m) => (m[1] ?? m[2]).trim());
  const blocks = [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1]);
  return { spans, blocks };
}
const AR_FIELDS = { ratio: 'ar-ratio', decimal: 'ar-decimal', width: 'ar-width', height: 'ar-height', newWidth: 'ar-new-width', newHeight: 'ar-new-height' };
function runArSpec(spec, lang) {
  const q = makePage({ lang });
  if (spec.preset) { const [a, b] = spec.preset.split(':'); q.preset(a, b); }
  else { q.type('ar-width', spec.w); q.type('ar-height', spec.h); }
  if (spec.lock) q.lock(true);
  if (spec.setWidth !== undefined) q.type('ar-width', spec.setWidth);
  if (spec.setHeight !== undefined) q.type('ar-height', spec.setHeight);
  if (spec.newWidth !== undefined) q.type('ar-new-width', spec.newWidth);
  if (spec.newHeight !== undefined) q.type('ar-new-height', spec.newHeight);
  const out = {};
  for (const f of spec.show ?? ['ratio', 'decimal']) {
    const el = q.els(AR_FIELDS[f]);
    out[f] = String(f === 'ratio' || f === 'decimal' ? el.textContent : el.value);
  }
  return out;
}
const AR_CHECK = {
  tag: 'ar-check', min: 2,
  verify({ spec, after, lang }) {
    if (!spec || typeof spec !== 'object') return 'missing spec';
    const { spans, blocks } = codeSpans(after);
    const missing = (spec.cases ?? [spec]).flatMap((c) => Object.entries(runArSpec(c, lang))).filter(([, v]) => !spans.includes(v) && !blocks.some((b) => b.includes(v)));
    return missing.length ? 'not shown as code: ' + missing.map(([f, v]) => f + '=' + v).join(', ') : null;
  },
};

// ---------- v2 page layout ----------
{
  const before = passes;
  const template = source.slice(source.indexOf('\n---\n') + 5, source.indexOf('<script')).trim();
  const css = source.slice(source.indexOf('<style>') + 7, source.indexOf('</style>'));
  const rules = selector => [...css.matchAll(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g'))].map(m => m[1]);
  const has = (selector, pattern) => rules(selector).some(rule => pattern.test(rule));
  const layouts = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
  eq('registered compact route', /'aspect-ratio':\s*'compact'/.test(layouts), true);
  eq('direct tool root', template.startsWith('<div class="ar-wrap">'), true);
  eq('root has natural-height flex column', has('.ar-wrap', /display:\s*flex/) && has('.ar-wrap', /flex-direction:\s*column/) && has('.ar-wrap', /min-height:\s*0/) && has('.ar-wrap', /min-width:\s*0/) && !/\b(?:height|min-height):[^;]*(?:vh|svh)/.test(css), true);
  eq('options precede status, original input, result and Resize', template.indexOf('id="ar-lock"') < template.indexOf('id="ar-status"') && template.indexOf('id="ar-status"') < template.indexOf('id="ar-width"') && template.indexOf('id="ar-width"') < template.indexOf('id="ar-result"') && template.indexOf('id="ar-result"') < template.indexOf('id="ar-new-width"'), true);
  eq('desktop calculation and preview have shrinkable columns', has('.ar-work', /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/), true);
  eq('860px stacks preview and controls', /@media \(max-width: 860px\)[\s\S]*?\.ar-work \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(css), true);
  eq('640px retains accessible preset and lock targets', /@media \(max-width: 640px\)[\s\S]*?\.ar-toggle, \.ar-chip \{ min-height: 44px; \}/.test(css), true);
  eq('status has fixed scrolling height in both sizes', has('.ar-wrap #ar-status', /height:\s*3em;[\s\S]*overflow:\s*auto/) && has('.ar-wrap #ar-status', /height:\s*4\.5em/), true);
  eq('ratio and decimal stay in fixed-height scrolling boxes', has('.ar-ratio-value', /height:\s*3rem;/) && has('.ar-ratio-value', /overflow:\s*auto;/) && has('.ar-ratio-value', /white-space:\s*nowrap;/), true);
  eq('preview has a fixed bounded height', has('.ar-preview-container', /height:\s*232px;/) && has('.ar-preview-container', /overflow:\s*auto;/), true);
  for (const id of ['ar-ratio', 'ar-decimal']) eq(id + ' supports keyboard scrolling and a visible label', new RegExp('id="' + id + '"[^>]*tabindex="0"[^>]*aria-labelledby="').test(template), true);
  eq('seven preset buttons retained with no redundant primary action', (template.match(/<button\b/g) || []).length === 7 && !/btn-primary/.test(template), true);
  eq('tips are separate from input labels', !/<label\b[^>]*>(?:(?!<\/label>)[\s\S])*?<Toggletip/.test(template), true);
  eq('script takes client strings without runtime translation', /define:vars=\{\{ t: CLIENT_T \}\}/.test(source) && !/STRINGS|TIPS|data-i18n/.test(scriptMatch[1]) && !/data-i18n/.test(template), true);
  const tipKeys = ['dimensions', 'lock', 'presets', 'resize', 'preview'].sort();
  const tips = [...template.matchAll(/<Toggletip\b([^>]*)>([\s\S]*?)<\/Toggletip>/g)];
  eq('five control tips exist', tips.length, 5);
  for (const key of tipKeys) eq(key + ' tip uses localized text and name', tips.some(m => m[1].includes('id="ar-tip-' + key + '"') && /lang=\{lang\}/.test(m[1]) && /about=\{T\.\w+\}/.test(m[1]) && m[2] === '{TIPS.' + key + '}'), true);
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const entry = strings[lang];
    eq(lang + ' string keys match', Object.keys(entry).sort().join(','), Object.keys(strings.en).sort().join(','));
    eq(lang + ' five tip keys match', Object.keys(entry.tips).sort().join(','), tipKeys.join(','));
    for (const key of tipKeys) eq(lang + ' ' + key + ' is plain text', typeof entry.tips[key] === 'string' && !!entry.tips[key].trim() && !/<[^>]*>|\n/.test(entry.tips[key]), true);
    const { tips: excluded, ...client } = entry;
    eq(lang + ' inline payload excludes all tip text', Object.values(excluded).every(text => !JSON.stringify(client).includes(JSON.stringify(text))) && source.includes('const { tips: TIPS, ...CLIENT_T } = T;'), true);
    const mdx = readFileSync(join(root, 'src/content/tools/aspect-ratio', lang + '.mdx'), 'utf8');
    const [, meta, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(mdx), { steps } = loadYaml(meta);
    eq(lang + ' six steps precede FAQ', steps?.length === 6 && meta.indexOf('steps:') < meta.indexOf('faqItems:'), true);
    eq(lang + ' steps meet plain-text limits', steps.every(step => typeof step === 'string' && !!step.trim() && step.length <= 280 && !/<[^>]*>/.test(step)) && steps.join('').length <= 1200, true);
    for (const key of ['width', 'height', 'lockRatio', 'newWidth', 'newHeight', 'preview']) eq(lang + ' steps use current control ' + key, steps.some(step => step.includes(entry[key])), true);
    eq(lang + ' Usage heading removed', !/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body), true);
    eq(lang + ' MDX content contract', contractProblems('aspect-ratio', lang, { annotations: [AR_CHECK] }), '');
    const q = makePage({ lang });
    q.type('ar-width', ''); q.lock(true);
    eq(lang + ' actual error uses the build-time language', q.els('ar-status').textContent, entry.errEnterDims);
    q.preset(21, 9);
    eq(lang + ' actual preset feedback is fully in the page language', q.els('ar-status').textContent, { en: 'Preset 21:9 applied', zh: '已应用预设 21:9', ja: 'プリセット 21:9 を適用しました', ko: '프리셋 21:9 적용됨' }[lang]);
  }
  const long = makePage();
  long.type('ar-width', '9007199254740991'); long.type('ar-height', '9007199254740881');
  eq('large exact integers retain the full coprime ratio', long.ratio(), '9007199254740991:9007199254740881');
  eq('large ratio decimal remains rounded to four places', long.decimal(), '1.0000');
  const require = createRequire(import.meta.url);
  const { transform } = await import(require.resolve('@astrojs/compiler', { paths: [dirname(require.resolve('astro'))] }));
  const compiled = await transform(source, { filename: 'AspectRatioTool.astro' });
  eq('Astro compiles without errors', compiled.diagnostics.filter(d => d.severity === 1).length, 0);
  const { transform: transformJs } = await import('esbuild');
  await transformJs(compiled.code, { loader: 'ts', format: 'esm' });
  eq('compiled script serializes only client strings', compiled.code.includes('$$defineScriptVars({ t: CLIENT_T })'), true);
  console.log('v2 page layout: ' + (passes - before) + ' passed');
}

console.log(passes + ' passed, ' + failures + ' failed' + (skips ? ', ' + skips + ' skipped' : ''));
process.exit(failures ? 1 : 0);
