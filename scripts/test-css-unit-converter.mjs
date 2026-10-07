// CSS Unit Converter — complete page conversion, copy and shared shortcut regression.
// Read: CssUnitConverterTool.astro and ToolLayout.astro. Write: stdout only.
// The source-parsed DOM preserves number/text distinctions and actual default settings.
// No network or system clipboard. Run: node scripts/test-css-unit-converter.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CssUnitConverterTool.astro'), 'utf8');
const SLUG = 'css-unit-converter';
let passes = 0, failures = 0;
function eq(name, got, want) {
  if (got === want) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + ' — got ' + JSON.stringify(got) + ', expected ' + JSON.stringify(want)); }
}
const same = (name, actual, expected) => eq(name, JSON.stringify(actual), JSON.stringify(expected));

// Run the complete inline script and the actual ToolLayout shortcut in either registration
// order. DOM values/types/checked defaults come from the markup. Only the clipboard and clock
// are controlled; no internal conversion or event handler is replaced.
const shell = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = shell.slice(shell.indexOf('// ── Keyboard shortcuts:'), shell.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes("document.addEventListener('keydown'")) throw new Error('Missing shared shortcut');
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
function page({ lang = 'en', shellFirst = false } = {}) {
  const allStrings = JSON.parse(source.match(/const STRINGS = ([\s\S]*?) as const;/)[1]);
  const { tips, ...t } = allStrings[lang];
  const ids = new Map(), copies = [], clears = [], docEvents = {}, timers = new Map();
  let now = 0, timerId = 0;
  const doc = { documentElement: { lang }, activeElement: null };
  function simple(e, sel) {
    const attrs = [...sel.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    sel = sel.replace(/\[[^\]]+\]/g, '');
    const tag = /^[\w-]+/.exec(sel), id = /#([\w-]+)/.exec(sel), classes = [...sel.matchAll(/\.([\w-]+)/g)];
    return (!tag || e.tagName === tag[0].toUpperCase()) && (!id || e.id === id[1]) && classes.every(m => e.classList.contains(m[1])) && attrs.every(m => m[2] === undefined ? e.getAttribute(m[1]) !== null : e.getAttribute(m[1]) === m[2]);
  }
  function matches(e, selector) {
    return selector.split(',').some(sel => {
      const parts = sel.trim().split(/\s+(?![^\[]*\])/);
      if (!simple(e, parts.pop())) return false;
      for (let n = e.parentElement; parts.length;) {
        while (n && !simple(n, parts.at(-1))) n = n.parentElement;
        if (!n) return false;
        parts.pop(); n = n.parentElement;
      }
      return true;
    });
  }
  class Element {
    constructor(tag = 'div') {
      Object.assign(this, { tagName: tag.toUpperCase(), id: '', className: '', type: tag === 'input' ? 'text' : '', value: '', textContent: '', checked: false, readOnly: false, disabled: false, attributes: {}, children: [], parentElement: null, listeners: {} });
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (['id', 'type', 'value', 'class'].includes(k)) this[k === 'class' ? 'className' : k] = String(v);
      if (k === 'readonly') this.readOnly = true;
      if (k === 'disabled') this.disabled = true;
      if (k === 'checked') this.checked = true;
    }
    getAttribute(k) { return this.attributes[k] ?? null; }
    get classList() {
      const e = this;
      return {
        contains: k => e.className.split(/\s+/).includes(k),
        add(...keys) { e.className = [...new Set([...e.className.split(/\s+/).filter(Boolean), ...keys])].join(' '); },
        remove(...keys) { e.className = e.className.split(/\s+/).filter(k => k && !keys.includes(k)).join(' '); },
        toggle(k, on) { const want = on ?? !this.contains(k); if (want) this.add(k); else this.remove(k); return want; },
      };
    }
    appendChild(e) { e.parentElement = this; this.children.push(e); return e; }
    contains(e) { return e === this || this.children.some(n => n.contains(e)); }
    querySelectorAll(s) { return this.children.flatMap(n => [...(matches(n, s) ? [n] : []), ...n.querySelectorAll(s)]); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
    dispatch(t, extra = {}) {
      const event = { type: t, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const fn of this.listeners[t] || []) fn.call(this, event);
      return event;
    }
    click() {
      if (this.disabled) return;
      if (this.type === 'checkbox') this.checked = !this.checked;
      this.dispatch('click');
      if (this.type === 'checkbox') this.dispatch('change');
    }
    focus() { doc.activeElement = this; }
  }
  const body = new Element('body'), widget = new Element();
  widget.className = 'tool-widget'; body.appendChild(widget);
  const markup = source.replace(/^---[\s\S]*?---\s*/, '').split('<script')[0]
    .replace(/<Toggletip\b[\s\S]*?<\/Toggletip>/g, '')
    .replace(/=\{T\.(\w+)\}/g, (_, key) => '="' + t[key] + '"')
    .replace(/\{T\.(\w+)\}/g, (_, key) => t[key]);
  const stack = [widget], voids = new Set(['input', 'br', 'hr', 'img']);
  for (const token of markup.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w-]*)\b([^>]*?)>|([^<]+)/g)) {
    if (token[0].startsWith('<!--')) continue;
    if (token[3] !== undefined) { stack.at(-1).textContent += token[3].trim(); continue; }
    const tag = token[1];
    if (token[0].startsWith('</')) {
      if (stack.at(-1)?.tagName !== tag.toUpperCase()) throw new Error('Markup nesting mismatch ' + tag);
      stack.pop(); continue;
    }
    const e = new Element(tag);
    for (const attr of token[2].matchAll(/([\w-]+)(?:\s*=\s*"([^"]*)")?/g)) e.setAttribute(attr[1], attr[2] ?? '');
    stack.at(-1).appendChild(e);
    if (e.id) ids.set(e.id, e);
    if (!voids.has(tag) && !token[2].endsWith('/')) stack.push(e);
  }
  for (const select of body.querySelectorAll('select')) {
    const options = select.querySelectorAll('option');
    select.value = (options.find(o => o.getAttribute('selected') !== null) || options[0])?.value || '';
  }
  const get = id => { if (!ids.has(id)) throw new Error('Missing actual ID ' + id); return ids.get(id); };
  Object.assign(doc, {
    body, activeElement: body, getElementById: get,
    querySelector: s => body.querySelector(s), querySelectorAll: s => body.querySelectorAll(s),
    addEventListener(t, fn) { (docEvents[t] ??= []).push(fn); },
    dispatch(t, extra) {
      const e = { type: t, target: this.activeElement, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const fn of docEvents[t] || []) fn.call(this, e);
      return e;
    },
  });
  const context = {
    document: doc, console, t, _slug: SLUG, ztPersist: { clear: slug => clears.push(slug) },
    navigator: { clipboard: { writeText(value) {
      let resolve, reject;
      const promise = new Promise((a, b) => { resolve = a; reject = b; });
      copies.push({ value, resolve, reject }); return promise;
    } } },
    setTimeout(fn, ms = 0) { const id = ++timerId; timers.set(id, { fn, due: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1], context, { filename: SLUG + '.astro' });
  if (!shellFirst) vm.runInContext(shortcut, context);
  return {
    doc, body, get, copies, clears,
    input(id, value, type = 'input') { get(id).value = value; get(id).dispatch(type); },
    key(focus, { key = 'l', ctrlKey = true, metaKey = false } = {}) {
      (typeof focus === 'string' ? get(focus) : focus || body).focus();
      return doc.dispatch('keydown', { key, ctrlKey, metaKey });
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...timers].filter(([, t]) => t.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].due; next[1].fn();
      }
      now = until;
    },
  };
}

const outputIds = ['cu-out-px', 'cu-out-rem', 'cu-out-em', 'cu-out-vw'];
const copy = (p, id = 'cu-out-px') => p.body.querySelector('[data-copy="' + id + '"]');
const outputs = p => outputIds.map(id => p.get(id).value);
function state(p) {
  return { value: p.get('cu-value').value, outputs: outputs(p), status: p.get('cu-status').textContent, statusClass: p.get('cu-status').className, labels: outputIds.map(id => copy(p, id).textContent) };
}
const settings = p => ['cu-unit', 'cu-root-size', 'cu-viewport'].map(id => p.get(id).value);
function assertEmpty(p, name) {
  eq(name + ' input empty', p.get('cu-value').value, '');
  same(name + ' all results empty', outputs(p), ['', '', '', '']);
  eq(name + ' status empty', p.get('cu-status').textContent, '');
  eq(name + ' status neutral', p.get('cu-status').className, 'cu-status');
}
const unhandled = [], onUnhandled = error => unhandled.push(String(error));
process.on('unhandledRejection', onUnhandled);
try {
  const p = page();
  same('source default settings retained', settings(p), ['px', '16', '1920']);
  eq('source main input is number', p.get('cu-value').type, 'number');
  eq('source results are readonly text', outputIds.every(id => p.get(id).type === 'text' && p.get(id).readOnly), true);
  assertEmpty(p, 'initial');
  for (const id of outputIds) copy(p, id).click();
  eq('empty results cannot copy', p.copies.length, 0);
  p.input('cu-value', '16'); same('16px at defaults', outputs(p), ['16px', '1rem', '1em', '0.833333vw']);
  p.input('cu-unit', 'rem', 'change'); p.input('cu-value', '2'); p.input('cu-root-size', '20');
  same('configured root changes rem conversion', outputs(p), ['40px', '2rem', '2em', '2.08333vw']);
  p.input('cu-unit', 'em', 'change'); same('em uses configured size', outputs(p), ['40px', '2rem', '2em', '2.08333vw']);
  p.input('cu-unit', 'vw', 'change'); p.input('cu-viewport', '1000'); p.input('cu-value', '5');
  same('configured viewport changes vw conversion', outputs(p), ['50px', '2.5rem', '2.5em', '5vw']);
  eq('active unit highlight changes with selection', p.body.querySelector('.cu-active').querySelector('label').textContent, 'vw');
  p.input('cu-value', '-2.5'); same('negative fractional value', outputs(p), ['-25px', '-1.25rem', '-1.25em', '-2.5vw']);
  p.input('cu-value', '0'); same('zero is a real result', outputs(p), ['0px', '0rem', '0em', '0vw']);
  p.input('cu-unit', 'px', 'change'); p.input('cu-root-size', ''); p.input('cu-viewport', ''); p.input('cu-value', '16');
  same('empty numeric settings keep existing defaults', outputs(p), ['16px', '1rem', '1em', '0.833333vw']);
  // A browser number input sanitizes an incomplete/invalid entry to an empty value.
  p.input('cu-value', ''); assertEmpty(p, 'sanitized empty numeric input');
  for (const shellFirst of [false, true]) for (const focus of ['cu-value', 'cu-unit', 'cu-root-size', 'cu-viewport', 'cu-out-rem', 'cu-clear']) {
    const q = page({ shellFirst }); q.input('cu-root-size', '20'); q.input('cu-viewport', '1000'); q.input('cu-unit', 'vw', 'change'); q.input('cu-value', '5');
    const before = settings(q), name = `shortcut ${shellFirst ? 'shell first, Meta+L' : 'component first, Ctrl+l'} from ${focus}`;
    const e = q.key(focus, { key: shellFirst ? 'L' : 'l', ctrlKey: !shellFirst, metaKey: shellFirst });
    eq(name + ' prevents default', e.defaultPrevented, true); assertEmpty(q, name);
    same(name + ' keeps conversion settings', settings(q), before);
    same(name + ' retains shared persistence clear', q.clears, [SLUG]);
    for (const id of outputIds) copy(q, id).click(); eq(name + ' cannot copy old results', q.copies.length, 0);
    q.advance(5000); assertEmpty(q, name + ' after timers');
    q.input('cu-value', '2'); same(name + ' recovers using retained settings', outputs(q), ['20px', '1rem', '1em', '2vw']);
  }
  const explicit = page(); explicit.input('cu-unit', 'em', 'change'); explicit.input('cu-root-size', '24'); explicit.input('cu-viewport', '1440'); explicit.input('cu-value', '3');
  explicit.get('cu-clear').click(); assertEmpty(explicit, 'explicit Clear');
  same('explicit Clear retains settings', settings(explicit), ['em', '24', '1440']);
  eq('explicit Clear focuses main number input', explicit.doc.activeElement, explicit.get('cu-value'));
  const outside = page(); outside.input('cu-value', '16'); const before = state(outside);
  eq('outside shortcut is not prevented', outside.key(null).defaultPrevented, false);
  eq('plain l is not a shortcut', outside.key('cu-value', { ctrlKey: false }).defaultPrevented, false);
  eq('Enter does not invoke Clear as primary action', outside.key('cu-value', { key: 'Enter' }).defaultPrevented, false);
  same('outside/plain-key/Enter preserve current conversion', state(outside), before);
  same('outside shortcut preserves saved state', outside.clears, []);
  for (const [lang, failure] of Object.entries({ en: 'Copy failed.', zh: '复制失败。', ja: 'コピーに失敗しました。', ko: '복사에 실패했습니다.' })) {
    const q = page({ lang }); q.input('cu-value', '16');
    for (const [i, id] of outputIds.entries()) {
      const btn = copy(q, id), label = btn.textContent;
      btn.click(); eq(lang + ' ' + id + ' copies exact unit text', q.copies.at(-1).value, ['16px', '1rem', '1em', '0.833333vw'][i]);
      q.copies.at(-1).resolve(); await settle(); eq(lang + ' ' + id + ' success visible', btn.textContent !== label, true);
      q.advance(1500); eq(lang + ' ' + id + ' success expires', btn.textContent, label);
      btn.click(); q.copies.at(-1).reject(new Error('current copy denied')); await settle();
      eq(lang + ' ' + id + ' current copy failure visible', q.get('cu-status').textContent, failure);
      eq(lang + ' ' + id + ' failure has error style', q.get('cu-status').classList.contains('error'), true);
      q.input('cu-value', '16'); eq(lang + ' ' + id + ' input recovers from copy error', q.get('cu-status').classList.contains('success'), true);
    }
  }
  const retry = page(); retry.input('cu-value', '16'); copy(retry).click();
  retry.copies.at(-1).reject(new Error('retryable failure')); await settle();
  copy(retry).click(); retry.copies.at(-1).resolve(); await settle();
  eq('successful retry replaces prior copy failure status', retry.get('cu-status').textContent, 'Converted.');
  eq('successful retry restores neutral success style', retry.get('cu-status').className, 'cu-status success');
  const edits = {
    clear: q => q.get('cu-clear').click(), shortcut: q => q.key('cu-value'),
    input: q => q.input('cu-value', '32'), empty: q => q.input('cu-value', ''),
    unit: q => q.input('cu-unit', 'rem', 'change'), root: q => q.input('cu-root-size', '20'), viewport: q => q.input('cu-viewport', '1000'),
  };
  for (const [name, edit] of Object.entries(edits)) for (const outcome of ['resolve', 'reject']) {
    const q = page(); q.input('cu-value', '16'); copy(q).click(); const job = q.copies.at(-1);
    edit(q); const current = state(q); job[outcome](new Error('late copy')); await settle();
    same(name + ': late copy ' + outcome + ' cannot write feedback', state(q), current); q.advance(5000);
    same(name + ': late copy ' + outcome + ' cannot change current state', state(q), current);
  }
  for (const nextId of ['cu-out-px', 'cu-out-rem']) {
    const q = page(); q.input('cu-value', '16'); copy(q).click(); q.copies.at(-1).resolve(); await settle(); q.advance(750);
    const next = copy(q, nextId); next.click(); q.copies.at(-1).resolve(); await settle(); const current = state(q);
    q.advance(750); same(nextId + ' newer feedback survives older timer', state(q), current);
    q.advance(750); eq(nextId + ' newer feedback expires on its own timer', next.textContent, 'Copy');
    copy(q).click(); const old = q.copies.at(-1); next.click(); q.copies.at(-1).reject(new Error('new failure')); await settle();
    const failed = state(q); old.resolve(); await settle(); same(nextId + ' old success cannot replace newer failure', state(q), failed);
  }
  await settle(); eq('all current and stale clipboard rejections are handled', unhandled.length, 0);
} finally { process.off('unhandledRejection', onUnhandled); }
console.log('\nv2 page layout');
{
  const preserved = {
  "en": {
    "body": "0dce96cb37e20e84f2f7faee0862a1a872e9b9fa08c91559f4c0402f235df171",
    "front": "c7b0bcbafcbeed43998daf5daa36dc225e3d69b6c3b4d995960395d414afb6fa"
  },
  "zh": {
    "body": "646522953672f4745dd844d40c1b2cb64f7e88a8c98abb4c6e05d7f218121506",
    "front": "06151b11a668dac8d758cf1546fe84706056a9f015202f3c1e44913955097b4a"
  },
  "ja": {
    "body": "728e4e3ee2d3a8b49078081afec9c9f6a379c46bc7f779e5bd5bf91383b8b4f3",
    "front": "5c30f74ad4d52dd36324207ddf99fc39df63dd3faa35e30338dc73ecead72ed2"
  },
  "ko": {
    "body": "0ce30006896227c75c9476a532110d6fbb3bc2837b6e476f4233527881421a33",
    "front": "a03caa808b0a2ce9a5e477468bdd4754b49735473e4a44eb6961395e9d71d22c"
  }
};
  const strings = JSON.parse(source.match(/const STRINGS = ([\s\S]*?) as const;/)[1]);
  const leaves = (value, prefix = '') => Object.entries(value).flatMap(([key, item]) => typeof item === 'object' ? leaves(item, prefix + key + '.') : [[prefix + key, item]]);
  const en = leaves(strings.en);
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const rows = leaves(strings[lang]);
    same(lang + ' recursive string keys match en', rows.map(([key]) => key), en.map(([key]) => key));
    for (const [key, value] of rows) {
      eq(lang + ' ' + key + ' is nonempty localized text', typeof value === 'string' && value.trim().length > 0, true);
      same(lang + ' ' + key + ' placeholders match', [...value.matchAll(/\{\w+\}/g)].map(m => m[0]).sort(), [...en.find(([k]) => k === key)[1].matchAll(/\{\w+\}/g)].map(m => m[0]).sort());
    }
    const doc = readFileSync(join(root, `src/content/tools/css-unit-converter/${lang}.mdx`), 'utf8');
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)/.exec(doc), meta = yaml.load(match[1]);
    eq(lang + ' steps are present and bounded', Array.isArray(meta.steps) && meta.steps.length > 0 && meta.steps.length <= 8 && meta.steps.every(s => typeof s === 'string' && s.length <= 280) && meta.steps.join('').length <= 1200, true);
    eq(lang + ' steps precede FAQ', match[1].indexOf('steps:') < match[1].indexOf('faqItems:'), true);
    eq(lang + ' How to Use removed', /<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(match[2]), false);
    const hash = value => createHash('sha256').update(value).digest('hex');
    eq(lang + ' all remaining body sections unchanged', hash(match[2]), preserved[lang].body);
    eq(lang + ' SEO and FAQ frontmatter unchanged', hash(match[1].replace(/\nsteps:\n(?:  - .*\n)+/, '\n')), preserved[lang].front);
  }
  const markup = source.split('---')[2].split('<script')[0];
  eq('direct component root uses cu-wrap', /^\s*<div class="cu-wrap">/.test(markup), true);
  eq('six distinct tips cover controls', new Set([...markup.matchAll(/<Toggletip id="([^"]+)"/g)].map(m => m[1])).size, 6);
  eq('frontmatter removes tips from client strings', source.includes('const { tips: TIPS, ...CLIENT_T } = T;'), true);
  eq('script receives only selected client language', source.includes('define:vars={{ t: CLIENT_T }}'), true);
  eq('runtime i18n removed', /data-i18n|var STRINGS|document\.documentElement\.lang/.test(source), false);
  eq('four copy actions and the existing Clear retained', (markup.match(/class="btn-copy"/g) || []).length === 4 && (markup.match(/id="cu-clear"/g) || []).length === 1, true);
  eq('no redundant convert action', !markup.includes('btn-primary'), true);
  eq('optional numeric settings start folded', /<details class="cu-settings">/.test(markup), true);
  eq('component root stays natural height', /\.cu-wrap\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-height:\s*0;/.test(source), true);
  eq('status has reserved scrollable space', /\.cu-status\s*\{[^}]*height:\s*3em;[^}]*overflow:\s*auto;/.test(source), true);
  eq('numeric results have fixed height and horizontal scrolling', /\.cu-output\s*\{[^}]*height:\s*2\.75rem;[^}]*overflow-x:\s*auto;[^}]*white-space:\s*nowrap;/.test(source), true);
  eq('settings and Clear precede status then primary input and results', markup.indexOf('class="cu-toolbar"') < markup.indexOf('id="cu-status"') && markup.indexOf('class="cu-settings"') < markup.indexOf('id="cu-status"') && markup.indexOf('id="cu-status"') < markup.indexOf('id="cu-value"') && markup.indexOf('id="cu-value"') < markup.indexOf('class="cu-results"'), true);
  eq('stack and phone breakpoints exist', source.includes('@media (max-width: 860px)') && source.includes('@media (max-width: 640px)'), true);
  const layouts = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
  eq('registered as compact', /['"]css-unit-converter['"]\s*:\s*['"]compact['"]/.test(layouts), true);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
