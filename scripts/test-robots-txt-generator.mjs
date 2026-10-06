// Robots.txt Generator — tool output and the robots.txt guide examples
//
// Read:  src/components/tools/RobotsTxtGeneratorTool.astro (runs the page script against a
//        stand-in DOM, so the outputs quoted in the guides come from the shipped code);
//        src/content/blog/robots-txt-generator-guide/{en,ja,ko}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers:
// - the output on load (one `*` block with `Disallow: /`, the state the tool page warns about);
// - `rtg-build` annotations: a list of blocks ({ua, custom?, rules: [[type, path], ...]}) and a
//   sitemap URL; the generated file must appear verbatim in a code block of the guide;
// - `rtg-parse` annotations: a robots.txt body, a user agent and paths. Each path is
//   [path, urllib.robotparser before RFC 9309, Protego 0.7.0, urllib.robotparser with RFC 9309].
//   CPython rewrote urllib.robotparser for RFC 9309 in gh-138907 (3.13.14 and 3.14.5; 3.12 and
//   older keep the first-match rules). The test probes which rules the interpreter's module
//   follows, checks that this agrees with its version, and compares against the matching column.
//   The RFC 9309 column was recorded with Python 3.14.7, the old column with 3.12.11.
//   urllib.robotparser runs whenever python3 is available; Protego checks are skipped (SKIP)
//   unless `python3 -c "import protego"` works (set PYTHON to another interpreter if needed);
// - the guides are indexable and have no template headings.
//
// Run: node scripts/test-robots-txt-generator.mjs

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = process.env.ZT_TEST_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(process.env.ZT_ROBOTS_SOURCE || join(root, 'src/components/tools/RobotsTxtGeneratorTool.astro'), 'utf8');

let failures = 0;
let passes = 0;
let skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}

// ---------- stand-in DOM ----------
// The page script builds each block with innerHTML and then queries it by class name. The
// stand-in parses only what the script needs: elements carrying one of the known classes.
const KNOWN = ['rt-remove-block', 'rt-ua-select', 'rt-ua-custom', 'rt-rules-list', 'rt-add-allow',
  'rt-add-disallow', 'rt-rule-type', 'rt-rule-path', 'rt-remove-rule'];
function makeEl(tag, docState = {}) {
  const handlers = {};
  const el = {
    tagName: tag, type: '', attributes: {}, children: [], parent: null, classes: [], dataset: {}, style: {}, value: '',
    textContent: '', disabled: false, placeholder: '', _html: '',
    get className() { return this.classes.join(' '); },
    set className(v) { this.classes = v.split(/\s+/).filter(Boolean); },
    classList: null,
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    fire(type, init = {}) {
      const event = { type, target: el, preventDefault() {}, stopPropagation() {}, ...init };
      (handlers[type] || []).forEach((fn) => fn.call(el, event));
    },
    appendChild(c) { c.parent = this; this.children.push(c); return c; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; },
    focus() { if (docState.document) docState.document.activeElement = el; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    contains(node) { while (node) { if (node === this) return true; node = node.parent; } return false; },
    closest(sel) { let node = this; while (node) { if (node.classes.includes(sel.slice(1))) return node; node = node.parent; } return null; },
    get innerHTML() { return this._html; },
    set innerHTML(html) {
      this._html = html;
      this.children = [];
      const re = /<(\w+)([^>]*)class="([^"]+)"([^>]*)>([^<]*)/g;
      let m;
      while ((m = re.exec(html))) {
        const cls = m[3].split(/\s+/);
        if (!cls.some((c) => KNOWN.includes(c))) continue;
        const child = makeEl(m[1], docState);
        child.type = /type="([^"]+)"/.exec(m[2] + m[4])?.[1] || (m[1] === 'input' ? 'text' : '');
        child.classes = cls;
        child.textContent = m[5];
        if (m[1] === 'select') {
          const opt = /<option value="([^"]+)"/.exec(html.slice(m.index));
          child.value = opt ? opt[1] : '';
        }
        this.appendChild(child);
      }
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const selectors = sel.split(',').map((x) => x.trim());
      const matches = (node, selector) => {
        if (selector.startsWith('.')) return node.classes.includes(selector.slice(1));
        if (selector.startsWith('[')) return selector.slice(1, -1) in node.attributes;
        const field = /^(\w+)(?:\[type="([^"]+)"\])?$/.exec(selector);
        return !!field && node.tagName === field[1] && (!field[2] || node.type === field[2]);
      };
      const out = [];
      const walk = (node) => { for (const child of node.children) { if (selectors.some((s) => matches(child, s))) out.push(child); walk(child); } };
      walk(this);
      return out;
    },
  };
  el.classList = {
    add: (c) => { if (!el.classes.includes(c)) el.classes.push(c); },
    remove: (c) => { el.classes = el.classes.filter((x) => x !== c); },
    contains: (c) => el.classes.includes(c),
  };
  return el;
}

const layoutSource = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const sharedShortcuts = layoutSource.slice(layoutSource.indexOf('      // ── Keyboard shortcuts:'), layoutSource.indexOf('      // ── Copy button visual feedback'));

function runTool({ lang = 'en', sharedFirst = false } = {}) {
  const scriptMatch = /<script is:inline>([\s\S]*?)<\/script>/.exec(source);
  const docState = {}, byId = {}, handlers = {}, requests = [], timers = [];
  const widget = makeEl('div', docState), wrap = makeEl('div', docState);
  widget.className = 'tool-widget'; wrap.className = 'rt-wrap'; widget.appendChild(wrap);
  for (const id of ['rt-blocks', 'rt-add-block', 'rt-sitemap', 'rt-output', 'rt-copy', 'rt-status']) {
    byId[id] = makeEl(id === 'rt-sitemap' ? 'input' : id === 'rt-copy' || id === 'rt-add-block' ? 'button' : 'div', docState);
    wrap.appendChild(byId[id]);
  }
  byId['rt-sitemap'].type = 'url';
  byId['rt-copy'].textContent = 'Copy'; byId['rt-copy'].attributes['data-i18n'] = 'copy';
  const document = {
    documentElement: { lang }, activeElement: null,
    querySelector: (sel) => sel === '.tool-widget' ? widget : widget.querySelector(sel),
    querySelectorAll: (sel) => widget.querySelectorAll(sel),
    getElementById: (id) => byId[id],
    createElement: (tag) => makeEl(tag, docState),
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    dispatch(type, event) { for (const fn of handlers[type] || []) fn(event); },
  };
  docState.document = document;
  let now = 0, sequence = 0;
  const window = { generated: 0, cleared: [], trackTool() { this.generated++; }, ztPersist: { clear(slug) { window.cleared.push(slug); } } };
  const navigator = { clipboard: { writeText: (text) => new Promise((resolve, reject) => requests.push({ text, resolve, reject })) } };
  const setTimeout = (fn, ms) => { const id = ++sequence; timers.push({ id, fn, ms, due: now + ms, cancelled: false, ran: false }); return id; };
  const clearTimeout = (id) => { const timer = timers.find((t) => t.id === id); if (timer) timer.cancelled = true; };
  const runShared = () => new Function('document', 'window', 'var _slug="robots-txt-generator";\n' + sharedShortcuts)(document, window);
  if (sharedFirst) runShared();
  new Function('document', 'window', 'navigator', 'setTimeout', 'clearTimeout', scriptMatch[1])(document, window, navigator, setTimeout, clearTimeout);
  if (!sharedFirst) runShared();
  byId.lifecycle = {
    document, window, navigator, requests, timers, wrap,
    advance(ms) { now += ms; for (const timer of timers.filter((t) => !t.cancelled && !t.ran && t.due <= now)) { timer.ran = true; timer.fn(); } },
    key(key, meta = false, target = byId['rt-sitemap']) {
      document.activeElement = target;
      const event = { key, ctrlKey: !meta, metaKey: meta, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
      document.dispatch('keydown', event); return event;
    },
  };
  return byId;
}

// Builds a file the way a user would: start from the page as loaded, delete the default
// block, then add blocks, pick a user agent, add rules and type paths, then the sitemap.
function build(spec) {
  const ids = runTool();
  const blocksEl = ids['rt-blocks'];
  for (const b of [...blocksEl.children]) b.querySelector('.rt-remove-block').fire('click');
  for (const block of spec.blocks) {
    ids['rt-add-block'].fire('click');
    const el = blocksEl.children[blocksEl.children.length - 1];
    const select = el.querySelector('.rt-ua-select');
    if (block.custom !== undefined) {
      select.value = '__custom__';
      select.fire('change');
      const custom = el.querySelector('.rt-ua-custom');
      custom.value = block.custom;
      custom.fire('input');
    } else {
      select.value = block.ua || '*';
      select.fire('change');
    }
    for (const [type, path] of block.rules || []) {
      el.querySelector(type === 'Allow' ? '.rt-add-allow' : '.rt-add-disallow').fire('click');
      const rows = el.querySelector('.rt-rules-list').children;
      const input = rows[rows.length - 1].querySelector('.rt-rule-path');
      input.value = path;
      input.fire('input');
    }
  }
  if (spec.sitemap) {
    ids['rt-sitemap'].value = spec.sitemap;
    ids['rt-sitemap'].fire('input');
  }
  return ids['rt-output'].textContent;
}

// ---------- output on load ----------
const initial = runTool()['rt-output'].textContent;
check('output on load is the whole-site block', initial === 'User-agent: *\nDisallow: /', JSON.stringify(initial));
check('a block with no rules writes an empty Disallow', build({ blocks: [{ ua: 'Googlebot' }] }) === 'User-agent: Googlebot\nDisallow:');
check('custom user agent is written as typed', build({ blocks: [{ custom: 'GPTBot', rules: [['Disallow', '/']] }] }) === 'User-agent: GPTBot\nDisallow: /');

// ---------- python helpers ----------
const PY = process.env.PYTHON || 'python3';
function pyOk(code) {
  try { execFileSync(PY, ['-c', code], { stdio: 'ignore' }); return true; } catch { return false; }
}
const hasPython = pyOk('import urllib.robotparser');
// Expected Protego results were recorded with 0.7.0; only that release is compared.
const hasProtego = hasPython && pyOk('import importlib.metadata as m, sys; sys.exit(0 if m.version("protego") == "0.7.0" else 1)');
// Which rules does this interpreter's urllib.robotparser follow? Under the old first-match rules
// `Disallow: /a` above `Allow: /a/b` blocks /a/b; under RFC 9309 the longer Allow wins.
const PROBE = `
import json, sys, platform, urllib.robotparser as rp
u = rp.RobotFileParser(); u.parse(['User-agent: *', 'Disallow: /a', 'Allow: /a/b'])
v = sys.version_info[:3]
print(json.dumps({'rfc': u.can_fetch('x', 'https://example.com/a/b'), 'version': platform.python_version(),
  'impl': platform.python_implementation(),
  'expectRfc': v >= (3, 14, 5) or (3, 13, 14) <= v < (3, 14)}))
`;
let urllibMode = null;
if (hasPython) {
  urllibMode = JSON.parse(execFileSync(PY, ['-c', PROBE]).toString());
  console.log(`urllib.robotparser: Python ${urllibMode.version} (${urllibMode.impl}), ${urllibMode.rfc ? 'RFC 9309 rules' : 'first-match rules'}`);
  // A distribution may backport gh-138907 to an older patch release, so a mismatch is only reported.
  if (urllibMode.impl === 'CPython' && urllibMode.rfc !== urllibMode.expectRfc) {
    console.log(`WARN: Python ${urllibMode.version} follows ${urllibMode.rfc ? 'RFC 9309' : 'first-match'} rules; upstream CPython changed in 3.13.14 / 3.14.5 (gh-138907)`);
  }
}
const PARSE = `
import json, sys, urllib.robotparser as rp
cases = json.load(sys.stdin)
try:
    from protego import Protego
except ImportError:
    Protego = None
out = []
for c in cases:
    u = rp.RobotFileParser(); u.parse(c['txt'].splitlines())
    url = 'https://example.com' + c['path']
    r = {'urllib': u.can_fetch(c['ua'], url)}
    if Protego is not None:
        r['protego'] = Protego.parse(c['txt']).can_fetch(url, c['ua'])
    out.append(r)
print(json.dumps(out))
`;

// ---------- guides ----------
const guideDir = join(root, 'src/content/blog/robots-txt-generator-guide');
for (const lang of ['en', 'ja', 'ko']) {
  const text = readFileSync(join(guideDir, lang + '.mdx'), 'utf8');
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)[1];
  check(lang + ': guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
  const h2 = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  check(lang + ': no What-is / Online / in-Code headings', !h2.some((h) => /^what (is|are)\b|online|\bin code\b/i.test(h)), h2.join(' | '));
  check(lang + ': does not end with a summary heading', !/summary|conclusion|まとめ|요약|결론/i.test(h2[h2.length - 1] || ''));

  const codeBlocks = [...text.matchAll(/```(?:text|robots)?\n([\s\S]*?)```/g)].map((m) => m[1].replace(/\n$/, ''));
  let builds = 0;
  for (const m of text.matchAll(/\{\/\* rtg-build: (.+?) \*\/\}/g)) {
    builds++;
    const spec = JSON.parse(m[1]);
    const out = build(spec);
    check(lang + ': rtg-build output appears in a code block', codeBlocks.includes(out), out);
  }
  check(lang + ': has rtg-build examples', builds > 0);

  const cases = [...text.matchAll(/\{\/\* rtg-parse: (.+?) \*\/\}/g)].map((m) => JSON.parse(m[1]));
  check(lang + ': has rtg-parse examples', cases.length > 0);
  if (!hasPython) { skips += cases.length; continue; }
  const flat = [];
  for (const c of cases) {
    for (const p of c.paths) {
      check(`${lang}: rtg-parse ${c.ua} ${p[0]} has 4 answers`, p.length === 4 && p.slice(1).every((x) => typeof x === 'boolean'), JSON.stringify(p));
      flat.push({ txt: c.txt, ua: c.ua, path: p[0], urllib: urllibMode.rfc ? p[3] : p[1], protego: p[2] });
    }
  }
  const res = JSON.parse(execFileSync(PY, ['-c', PARSE], { input: JSON.stringify(flat) }).toString());
  const rules = urllibMode.rfc ? 'RFC 9309' : 'first match';
  flat.forEach((c, i) => {
    check(`${lang}: urllib.robotparser (${rules}) ${c.ua} ${c.path}`, res[i].urllib === c.urllib, `got ${res[i].urllib}`);
    if (hasProtego) check(`${lang}: Protego ${c.ua} ${c.path}`, res[i].protego === c.protego, `got ${res[i].protego}`);
    else skips++;
  });
}

// ---------- copy failure and direct retry ----------
const settleCopy = () => new Promise((resolve) => setImmediate(resolve));
const copyLabels = {
  en: ['Copy', 'Copied!', 'Copy failed. Try again.'],
  zh: ['复制', '已复制！', '复制失败，请重试。'],
  ja: ['コピー', 'コピー済み！', 'コピーに失敗しました。もう一度お試しください。'],
  ko: ['복사', '복사됨!', '복사에 실패했습니다. 다시 시도하세요.'],
};
for (const [lang, [copy, copied, failed]] of Object.entries(copyLabels)) {
  const ids = runTool({ lang }), h = ids.lifecycle;
  ids['rt-copy'].fire('click');
  check(lang + ': copy sends complete current text', h.requests[0].text === 'User-agent: *\nDisallow: /');
  h.requests[0].reject(new Error('controlled clipboard rejection'));
  await settleCopy();
  check(lang + ': rejected copy remains retryable and reports failure', ids['rt-copy'].textContent === copy && !ids['rt-copy'].disabled && !ids['rt-copy'].classList.contains('copied') && ids['rt-status'].textContent === failed);
  ids['rt-copy'].fire('click'); h.requests[1].resolve(); await settleCopy();
  check(lang + ': same-result retry clears failure and reports success', ids['rt-copy'].textContent === copied && ids['rt-status'].textContent === '' && ids['rt-copy'].classList.contains('copied'));
  h.advance(1500);
  check(lang + ': success feedback returns to original label', ids['rt-copy'].textContent === copy && !ids['rt-copy'].classList.contains('copied'));
}

// ---------- real shared shortcuts and copy lifecycle ----------
function copyState(ids) {
  return { output: ids['rt-output'].textContent, label: ids['rt-copy'].textContent, disabled: ids['rt-copy'].disabled, copied: ids['rt-copy'].classList.contains('copied'), status: ids['rt-status'].textContent };
}
function clickCopy(ids) {
  try { ids['rt-copy'].fire('click'); return ''; } catch (error) { return String(error); }
}
function typeSitemap(ids, text = 'https://example.test/sitemap.xml') {
  ids['rt-sitemap'].value = text; ids['rt-sitemap'].fire('input');
}
for (const [lang, [copy, copied, failed]] of Object.entries(copyLabels)) {
  for (const mode of ['missing', 'sync throw', 'invalid method']) {
    const ids = runTool({ lang }), h = ids.lifecycle;
    let nativeCalls = 0;
    if (mode === 'missing') {
      Object.setPrototypeOf(h.navigator, { clipboard: { writeText() { nativeCalls++; throw new Error('prototype native clipboard must remain blocked'); } } });
      Object.defineProperty(h.navigator, 'clipboard', { configurable: true, value: undefined });
    } else if (mode === 'sync throw') {
      h.navigator.clipboard.writeText = () => { throw new Error('controlled synchronous clipboard failure'); };
    } else h.navigator.clipboard.writeText = null;
    check(lang + ': ' + mode + ' is handled without synchronous escape', clickCopy(ids) === '');
    await settleCopy();
    check(lang + ': ' + mode + ' shows honest failure and keeps original label', ids['rt-status'].textContent === failed && ids['rt-copy'].textContent === copy && !ids['rt-copy'].disabled && !ids['rt-copy'].classList.contains('copied'));
    check(lang + ': ' + mode + ' never reaches prototype/native clipboard', nativeCalls === 0);
    Object.defineProperty(h.navigator, 'clipboard', { configurable: true, value: { writeText: (text) => new Promise((resolve, reject) => h.requests.push({ text, resolve, reject })) } });
    clickCopy(ids); h.requests[0].resolve(); await settleCopy();
    check(lang + ': ' + mode + ' permits direct retry without editing', ids['rt-copy'].textContent === copied && ids['rt-status'].textContent === '');
  }
}

for (const sharedFirst of [false, true]) for (const meta of [false, true]) {
  const ids = runTool({ sharedFirst }), h = ids.lifecycle;
  const first = ids['rt-blocks'].children[0];
  first.querySelector('.rt-ua-select').value = 'Googlebot'; first.querySelector('.rt-ua-select').fire('change');
  first.querySelector('.rt-rule-path').value = '/private/'; first.querySelector('.rt-rule-path').fire('input');
  first.querySelector('.rt-add-allow').fire('click'); first.querySelectorAll('.rt-rule-path')[1].value = '/public/'; first.querySelectorAll('.rt-rule-path')[1].fire('input');
  ids['rt-add-block'].fire('click');
  const second = ids['rt-blocks'].children[1];
  second.querySelector('.rt-ua-select').value = '__custom__'; second.querySelector('.rt-ua-select').fire('change');
  second.querySelector('.rt-ua-custom').value = 'GPTBot'; second.querySelector('.rt-ua-custom').fire('input');
  typeSitemap(ids);
  const prefix = (sharedFirst ? 'shared first ' : 'component first ') + (meta ? 'MetaL' : 'CtrlL');
  const groupCount = ids['rt-blocks'].children.length, ruleCount = h.wrap.querySelectorAll('.rt-rule-row').length;
  const generated = h.window.generated;
  h.key('Enter', meta);
  check(prefix + ': shared modified Enter has no primary action', h.window.generated === generated && h.requests.length === 0);
  const event = h.key(meta ? 'L' : 'l', meta, first.querySelector('.rt-rule-path'));
  check(prefix + ': clears text and URL synchronously', h.wrap.querySelectorAll('input[type="text"], input[type="url"]').every((el) => el.value === ''));
  check(prefix + ': clears result/status and disables copy synchronously', JSON.stringify(copyState(ids)) === JSON.stringify({ output: '', label: 'Copy', disabled: true, copied: false, status: '' }));
  check(prefix + ': preserves groups/rules/types/User-agent selections', ids['rt-blocks'].children.length === groupCount && h.wrap.querySelectorAll('.rt-rule-row').length === ruleCount && first.querySelector('.rt-ua-select').value === 'Googlebot' && second.querySelector('.rt-ua-select').value === '__custom__' && first.querySelectorAll('.rt-rule-type').map((el) => el.textContent).join('|') === 'Disallow|Allow');
  check(prefix + ': shared persistence clear runs exactly once', event.defaultPrevented && h.window.cleared.length === 1 && h.window.cleared[0] === 'robots-txt-generator');
  check(prefix + ': clearing never generates a new result', h.window.generated === generated);
  clickCopy(ids); check(prefix + ': cleared output cannot send clipboard text', h.requests.length === 0);
  first.querySelector('.rt-rule-path').value = '/again/'; first.querySelector('.rt-rule-path').fire('input');
  check(prefix + ': next input resumes generation with retained configuration', ids['rt-output'].textContent === 'User-agent: Googlebot\nDisallow: /again/\nAllow: \n\nUser-agent: *\nDisallow:' && !ids['rt-copy'].disabled);
  const before = copyState(ids), cleared = h.window.cleared.length;
  h.key('l', meta, makeEl('input'));
  check(prefix + ': shortcut outside tool leaves this tool unchanged', JSON.stringify(copyState(ids)) === JSON.stringify(before) && h.window.cleared.length === cleared);
  h.document.activeElement = first.querySelector('.rt-rule-path');
  h.document.dispatch('keydown', { key: 'l', ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} });
  check(prefix + ': ordinary L leaves result unchanged', JSON.stringify(copyState(ids)) === JSON.stringify(before));
}

const mutations = {
  'Sitemap input': (ids) => typeSitemap(ids),
  'path input': (ids) => { const el = ids['rt-blocks'].querySelector('.rt-rule-path'); el.value = '/new/'; el.fire('input'); },
  'same path input': (ids) => ids['rt-blocks'].querySelector('.rt-rule-path').fire('input'),
  'User-agent change': (ids) => { const el = ids['rt-blocks'].querySelector('.rt-ua-select'); el.value = 'Bingbot'; el.fire('change'); },
  'custom bot input': (ids) => { const block = ids['rt-blocks'].children[0]; block.querySelector('.rt-ua-select').value = '__custom__'; block.querySelector('.rt-ua-select').fire('change'); const el = block.querySelector('.rt-ua-custom'); el.value = 'GPTBot'; el.fire('input'); },
  'add Allow': (ids) => ids['rt-blocks'].querySelector('.rt-add-allow').fire('click'),
  'add Disallow': (ids) => ids['rt-blocks'].querySelector('.rt-add-disallow').fire('click'),
  'remove rule': (ids) => ids['rt-blocks'].querySelector('.rt-remove-rule').fire('click'),
  'add group': (ids) => ids['rt-add-block'].fire('click'),
  'remove all groups': (ids) => ids['rt-blocks'].querySelector('.rt-remove-block').fire('click'),
  'CtrlL': (ids) => ids.lifecycle.key('l'),
  'MetaL': (ids) => ids.lifecycle.key('L', true),
};
for (const [name, mutate] of Object.entries(mutations)) for (const outcome of ['resolve', 'reject']) {
  const ids = runTool(), h = ids.lifecycle;
  clickCopy(ids); mutate(ids); const current = copyState(ids);
  check(name + ': cancels original copy feedback immediately', current.label === 'Copy' && !current.copied && current.status === '');
  h.requests[0][outcome](outcome === 'reject' ? new Error('controlled stale rejection') : undefined); await settleCopy();
  check(name + ': late ' + outcome + ' cannot alter current result/feedback', JSON.stringify(copyState(ids)) === JSON.stringify(current));
}
for (const oldOutcome of ['resolve', 'reject']) for (const newOutcome of ['resolve', 'reject']) {
  const ids = runTool(), h = ids.lifecycle;
  clickCopy(ids); clickCopy(ids);
  h.requests[1][newOutcome](newOutcome === 'reject' ? new Error('controlled current rejection') : undefined); await settleCopy();
  const current = copyState(ids);
  check(oldOutcome + '/' + newOutcome + ': newest request determines feedback', current.label === (newOutcome === 'resolve' ? 'Copied!' : 'Copy') && current.status === (newOutcome === 'resolve' ? '' : 'Copy failed. Try again.'));
  h.requests[0][oldOutcome](oldOutcome === 'reject' ? new Error('controlled previous rejection') : undefined); await settleCopy();
  check(oldOutcome + '/' + newOutcome + ': old request cannot replace newer feedback', JSON.stringify(copyState(ids)) === JSON.stringify(current));
}
for (const [name, mutate] of Object.entries(mutations)) {
  const ids = runTool(), h = ids.lifecycle;
  clickCopy(ids); h.requests[0].resolve(); await settleCopy();
  const previousTimer = h.timers.at(-1); mutate(ids); const current = copyState(ids);
  check(name + ': cancels active copied timer and restores feedback', previousTimer.cancelled && current.label === 'Copy' && !current.copied);
  previousTimer.fn();
  check(name + ': forcibly delivered old timer stays inert', JSON.stringify(copyState(ids)) === JSON.stringify(current));
}
{
  const ids = runTool(), h = ids.lifecycle;
  clickCopy(ids); h.requests[0].resolve(); await settleCopy(); const oldTimer = h.timers.at(-1);
  h.advance(1499); clickCopy(ids); h.requests[1].resolve(); await settleCopy();
  check('same-button retry cancels old timer and starts one current timer', oldTimer.cancelled && h.timers.filter((timer) => !timer.cancelled && !timer.ran).length === 1);
  h.advance(1); oldTimer.fn();
  check('old 1500ms deadline cannot erase second success', ids['rt-copy'].textContent === 'Copied!' && ids['rt-copy'].classList.contains('copied'));
  h.advance(1499);
  check('current 1500ms deadline restores original label exactly', ids['rt-copy'].textContent === 'Copy' && !ids['rt-copy'].classList.contains('copied'));
}

if (skips) console.log(`SKIP: ${skips} parser checks (python3${hasPython ? ' without protego' : ' not found'})`);
console.log(`\n${passes} passed, ${failures} failed${skips ? `, ${skips} skipped` : ''}`);
process.exit(failures ? 1 : 0);
