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
import { createRequire } from 'node:module';
import { annotations, fencedBlocks, reportContract } from './lib/tool-mdx-contract.mjs';

const root = process.env.ZT_TEST_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const requireRoot = createRequire(join(root, 'package.json'));
const { parseFragment } = requireRoot('parse5');
const ts = requireRoot('typescript');
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
      if (tag === 'template') return;
      function fromNode(node) {
        const child = makeEl(node.tagName, docState);
        child.attributes = Object.fromEntries((node.attrs || []).map((attr) => [attr.name, attr.value]));
        child.className = child.attributes.class || '';
        child.type = child.attributes.type || (node.tagName === 'input' ? 'text' : '');
        child.value = child.attributes.value || '';
        child.disabled = Object.hasOwn(child.attributes, 'disabled');
        child.hidden = Object.hasOwn(child.attributes, 'hidden');
        child.textContent = (node.childNodes || []).filter((n) => n.nodeName === '#text').map((n) => n.value).join('');
        if (node.tagName === 'select') child.value = node.childNodes.find((n) => n.tagName === 'option')?.attrs.find((a) => a.name === 'value')?.value || '';
        for (const nested of node.childNodes || []) if (nested.tagName) child.appendChild(fromNode(nested));
        return child;
      }
      for (const node of parseFragment(html).childNodes) if (node.tagName) this.appendChild(fromNode(node));
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

function serverData(lang = 'en') {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(source)?.[1];
  if (!frontmatter || !frontmatter.includes('// strings:start')) return null;
  const server = frontmatter.replace(/^import .*;\n/gm, '');
  const js = ts.transpileModule(server, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function('Astro', js + '\nreturn { STRINGS, L, CLIENT_T, RULE_HTML, BLOCK_HTML, RULE_BODY_HTML, blockHtml };')({ props: { lang } });
}

function runTool({ lang = 'en', sharedFirst = false } = {}) {
  const scriptMatch = /<script is:inline(?:\s[^>]*)?>([\s\S]*?)<\/script>/.exec(source);
  const docState = {}, byId = {}, handlers = {}, requests = [], timers = [];
  const widget = makeEl('div', docState), wrap = makeEl('div', docState);
  widget.className = 'tool-widget'; wrap.className = 'rt-wrap'; widget.appendChild(wrap);
  for (const id of ['rt-blocks', 'rt-add-block', 'rt-sitemap', 'rt-output', 'rt-copy', 'rt-status']) {
    byId[id] = makeEl(id === 'rt-sitemap' ? 'input' : id === 'rt-copy' || id === 'rt-add-block' ? 'button' : 'div', docState);
    wrap.appendChild(byId[id]);
  }
  byId['rt-sitemap'].type = 'url';
  const data = serverData(lang);
  if (data) {
    byId['rt-copy'].textContent = data.L.copy;
    byId['rt-result'] = makeEl('div', docState); wrap.appendChild(byId['rt-result']);
    byId['rt-empty'] = makeEl('p', docState); byId['rt-empty'].hidden = true; wrap.appendChild(byId['rt-empty']);
    byId['rt-block-template'] = makeEl('template', docState); byId['rt-block-template'].innerHTML = data.BLOCK_HTML;
    byId['rt-rule-template'] = makeEl('template', docState); byId['rt-rule-template'].innerHTML = data.RULE_BODY_HTML;
    const initial = makeEl('div', docState); initial.innerHTML = data.blockHtml('rt-block-1', true);
    byId['rt-blocks'].appendChild(initial.children[0]);
  }
  byId['rt-copy'].textContent = data ? data.L.copy : 'Copy'; byId['rt-copy'].attributes['data-i18n'] = 'copy';
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
  new Function('document', 'window', 'navigator', 'setTimeout', 'clearTimeout', 't', scriptMatch[1])(document, window, navigator, setTimeout, clearTimeout, data?.CLIENT_T);
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

// ---------- analytics: one event per committed change ----------
// The page used to call trackTool from generate(), so loading the page and every input
// event (each typed character) sent a GA event. It now sends one event when a change is
// committed: a change event on a text field or select, or a button that adds or removes a
// block or rule.
{
  const ids = runTool(), w = ids.lifecycle.window;
  check('analytics: loading the page sends no event', w.generated === 0, String(w.generated));
  const path = ids['rt-blocks'].querySelector('.rt-rule-path');
  for (const text of ['/a', '/ad', '/adm', '/admin/']) { path.value = text; path.fire('input'); }
  ids['rt-sitemap'].value = 'https://example.com/sitemap.xml'; ids['rt-sitemap'].fire('input');
  check('analytics: input events send no event', w.generated === 0, String(w.generated));
  path.fire('change');
  check('analytics: committing a path sends one event', w.generated === 1, String(w.generated));
  ids['rt-sitemap'].fire('change');
  const select = ids['rt-blocks'].querySelector('.rt-ua-select'); select.value = 'Bingbot'; select.fire('change');
  check('analytics: sitemap change and User-agent change send one event each', w.generated === 3, String(w.generated));
  ids['rt-blocks'].querySelector('.rt-add-allow').fire('click');
  ids['rt-add-block'].fire('click');
  check('analytics: adding a rule or a block sends one event each', w.generated === 5, String(w.generated));
  for (const b of [...ids['rt-blocks'].children]) b.querySelector('.rt-remove-block').fire('click');
  check('analytics: removing blocks until the output is empty does not send for the empty result', w.generated === 6, String(w.generated));
}

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

// ---------- tool page: `rtg-tool` examples (src/content/tools/robots-txt-generator/{lang}.mdx) ----------
// `{/* rtg-tool: {"blocks":[…],"sitemap"?:…,"rfc"?:[{"ua":…,"paths":[[path, allowed], …]}]} */}`
// builds the file like `rtg-build` (the output must appear verbatim in a code block after the
// annotation, before the next annotation or H2), then reads it with rfcAllowed(), a small
// reading of RFC 9309 §2.2: groups start at User-agent lines and other records (Sitemap) do not
// end them; the crawler takes the groups whose product token matches case-insensitively, else
// the `*` group, else no rules; a rule path must start with "/"; non-ASCII octets are
// percent-encoded on both sides; `*` and a final `$` are special; the match with the most octets
// wins, Allow on a tie, and no match means allowed. When python3's urllib.robotparser follows
// RFC 9309 rules (CPython 3.13.14 / 3.14.5 and later), its answers are compared too.
function pctNonAscii(s) {
  return [...s].map((c) => (c.codePointAt(0) < 0x80 ? c : [...new TextEncoder().encode(c)].map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join(''))).join('');
}
function rfcAllowed(txt, ua, path) {
  if (path === '/robots.txt') return true;
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/.exec(raw.replace(/#.*$/, ''));
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) groups.push(cur = { agents: [], rules: [] });
      cur.agents.push(m[2].toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (cur && m[2].startsWith('/')) cur.rules.push({ allow: key === 'allow', pattern: pctNonAscii(m[2]) });
    }
  }
  const token = ua.toLowerCase();
  let chosen = groups.filter((g) => g.agents.includes(token));
  if (!chosen.length) chosen = groups.filter((g) => g.agents.includes('*'));
  const target = pctNonAscii(path);
  let best = null;
  for (const r of chosen.flatMap((g) => g.rules)) {
    const anchored = r.pattern.endsWith('$');
    const body = anchored ? r.pattern.slice(0, -1) : r.pattern;
    const re = new RegExp('^' + body.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
    if (!re.test(target)) continue;
    const len = r.pattern.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
  }
  return best ? best.allow : true;
}
check('rfcAllowed: RFC 9309 §2.2.2 percent-encoding example (/foo/bar/ツ)', rfcAllowed('User-agent: *\nDisallow: /foo/bar/ツ\n', 'x', '/foo/bar/%E3%83%84') === false && rfcAllowed('User-agent: *\nDisallow: /foo/bar/%E3%83%84\n', 'x', '/foo/bar/ツ') === false);
check('rfcAllowed: longest match wins over line order', rfcAllowed('User-agent: *\nDisallow: /a\nAllow: /a/b\n', 'x', '/a/b') === true && rfcAllowed('User-agent: *\nDisallow: /a\nAllow: /a/b\n', 'x', '/a/c') === false);
check('rfcAllowed: Allow wins a tie', rfcAllowed('User-agent: *\nDisallow: /p\nAllow: /p\n', 'x', '/p') === true);
check('rfcAllowed: a named group replaces the * group', rfcAllowed('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow:\n', 'googlebot', '/x') === true);
check('rfcAllowed: no matching group and no * group means no rules', rfcAllowed('User-agent: Yeti\nDisallow: /\n', 'Bingbot', '/x') === true);

const toolCases = [];
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const toolPath = join(root, 'src/content/tools/robots-txt-generator', lang + '.mdx');
  const body = readFileSync(toolPath, 'utf8');
  for (const note of annotations(body, 'rtg-tool')) {
    for (const r of note.spec?.rfc || []) {
      const out = build(note.spec);
      for (const [p, want] of r.paths) toolCases.push({ lang, txt: out, ua: r.ua, path: p, want });
    }
  }
}
reportContract(check, 'robots-txt-generator', {
  annotations: [{
    tag: 'rtg-tool', min: 2,
    verify({ spec, after }) {
      const out = build(spec);
      if (!fencedBlocks(after).some((b) => b.text === out)) return 'generated file not quoted verbatim:\n' + out;
      for (const r of spec.rfc || []) for (const [p, want] of r.paths) {
        if (rfcAllowed(out, r.ua, p) !== want) return `RFC 9309 reading of ${r.ua} ${p} is ${!want}`;
      }
      return null;
    },
  }],
});
if (hasPython && urllibMode.rfc && toolCases.length) {
  const res = JSON.parse(execFileSync(PY, ['-c', PARSE], { input: JSON.stringify(toolCases) }).toString());
  toolCases.forEach((c, i) => check(`${c.lang} tool page: urllib.robotparser (RFC 9309) agrees for ${c.ua} ${c.path}`, res[i].urllib === c.want, `got ${res[i].urllib}`));
} else skips += toolCases.length;

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

// ---------- v2 page layout (DESIGN.md, kind: generate) ----------
{
  const markup = source.slice(source.indexOf('\n---\n', 4) + 5, source.indexOf('<script'));
  const scripts = source.match(/<script is:inline(?:\s[^>]*)?>([\s\S]*?)<\/script>/)?.[1] || '';
  const data = serverData();
  check('v2: the tool root receives the first-screen height directly', /^\s*<div class="rt-wrap">/.test(markup) && /\.rt-wrap[^}]*min-height: 0/.test(source));
  check('v2: shared generate rail and bounded result are siblings', markup.includes('class="rt-rail zt-rail"') && markup.includes('id="rt-result" class="rt-result"') && source.includes('grid-template-columns: 300px minmax(0, 1fr)') && /\.rt-output[\s\S]*?overflow: auto;[\s\S]*?flex: 1 1 0;/.test(source));
  check('v2: primary actions and reserved status precede form panels', markup.indexOf('id="rt-add-block"') < markup.indexOf('id="rt-status"') && markup.indexOf('id="rt-copy"') < markup.indexOf('id="rt-status"') && markup.indexOf('id="rt-status"') < markup.indexOf('id="rt-sitemap"') && markup.indexOf('id="rt-sitemap"') < markup.indexOf('id="rt-blocks"') && source.includes('min-height: 2.8em'));
  const tips = [...markup.matchAll(/<Toggletip id="(rt-tip-[a-z]+)"/g)].map(m => m[1]);
  check('v2: five unique SSR explanation controls', tips.join('|') === 'rt-tip-block|rt-tip-copy|rt-tip-sitemap|rt-tip-ua|rt-tip-rules' && new Set(tips).size === 5);
  check('v2: client gets only copy wording, with no tips/runtime translation', !!data && Object.keys(data.CLIENT_T).sort().join('|') === 'copied|copy|copyFailed' && source.includes('define:vars={{ t: CLIENT_T }}') && !/data-i18n|var STRINGS|tips|pageLang/.test(scripts));
  check('v2: 860px stack and empty result hide, 640px touch targets', source.includes('@media (max-width: 860px)') && source.includes('.rt-result[data-empty="true"] { display: none; }') && source.includes('@media (max-width: 640px)') && source.includes('.rt-add-btn, #rt-copy, .rt-field input, .rt-ua-select, .rt-ua-custom, .rt-rule-path { min-height: 44px; }') && source.includes('.rt-add-rule { min-height: 24px; }'));
  if (data) {
    for (const lang of ['en', 'zh', 'ja', 'ko']) {
      const local = serverData(lang), ids = runTool({ lang });
      check(lang + ': SSR shapes and client boundary match', JSON.stringify(Object.keys(local.L).sort()) === JSON.stringify(Object.keys(data.L).sort()) && Object.keys(local.L.tips).sort().join('|') === 'block|copy|rules|sitemap|ua');
      const initial = local.blockHtml('rt-block-1', true);
      check(lang + ': initial SSR controls contain localized labels and default blocking rule', initial.includes(local.L.blockTitle) && initial.includes(local.L.userAgent) && initial.includes(local.L.customBot) && initial.includes(local.L.addAllow) && initial.includes(local.L.addDisallow) && initial.includes('value="/"') && initial.includes('>Disallow</span>') && local.L.initialNotice.includes('Disallow: /'));
      ids['rt-add-block'].fire('click'); const newBlock = ids['rt-blocks'].children[1];
      check(lang + ': SSR template produces localized new controls with matching label IDs', newBlock.querySelector('.rt-block-title').textContent === local.L.blockTitle && newBlock.querySelector('.rt-add-allow').textContent === local.L.addAllow && newBlock.querySelector('.rt-ua-select').getAttribute('id') === 'rt-block-2-ua');
      ids.lifecycle.key('L', true);
      check(lang + ': shortcut reveals desktop empty sentence and marks stacked result hidden', ids['rt-result'].dataset.empty === 'true' && !ids['rt-empty'].hidden && ids['rt-output'].hidden);
      newBlock.querySelector('.rt-add-allow').fire('click');
      check(lang + ': real subsequent operation restores result', ids['rt-result'].dataset.empty === 'false' && ids['rt-empty'].hidden && !ids['rt-output'].hidden);
      const facts = runTool({ lang });
      const block = facts['rt-blocks'].children[0], select = block.querySelector('.rt-ua-select');
      select.value = '__custom__'; select.fire('change');
      block.querySelector('.rt-rule-path').value = '  admin/  '; block.querySelector('.rt-rule-path').fire('input');
      typeSitemap(facts, '  invalid-url  ');
      check(lang + ': tooltip facts use real trim/fallback/no-validation behavior', facts['rt-output'].textContent === 'User-agent: *\nDisallow: admin/\n\nSitemap: invalid-url');
      block.querySelector('.rt-remove-rule').fire('click');
      check(lang + ': a rule-free block keeps the actual empty Disallow line', facts['rt-output'].textContent === 'User-agent: *\nDisallow:\n\nSitemap: invalid-url');
      block.querySelector('.rt-add-allow').fire('click');
      check(lang + ': empty added Allow path is preserved', facts['rt-output'].textContent === 'User-agent: *\nAllow: \n\nSitemap: invalid-url');
      block.querySelector('.rt-remove-block').fire('click');
      check(lang + ': remove-all reveals empty result and retains optional sitemap field', facts['rt-output'].textContent === '' && facts['rt-result'].dataset.empty === 'true' && facts['rt-sitemap'].value === '  invalid-url  ' && facts['rt-copy'].disabled);
      const mdx = readFileSync(process.env.ZT_ROBOTS_MDX_PREFIX ? process.env.ZT_ROBOTS_MDX_PREFIX + lang + '.mdx' : join(root, 'src/content/tools/robots-txt-generator', lang + '.mdx'), 'utf8');
      const fm = /^---\n([\s\S]*?)\n---/.exec(mdx)?.[1] || '', body = mdx.slice(mdx.indexOf('\n---\n', 4) + 5);
      const steps = [...fm.slice(fm.indexOf('steps:\n'), fm.indexOf('faqItems:')).matchAll(/^  - (".*")$/gm)].map(m => JSON.parse(m[1]));
      check(lang + ': five bounded plain-text steps replace Usage', steps.length === 5 && steps.every(x => x.length <= 280 && !/<\/?[a-z]/i.test(x)) && steps.join('').length <= 1200 && !/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body));
      check(lang + ': steps use current Copy and Add Block labels', steps.join('').includes(local.L.copy) && steps.join('').includes(local.L.addBlock));
    }
    check('SSR unknown language safely falls back to English', JSON.stringify(serverData('invalid').L) === JSON.stringify(data.L));
  }
  const layouts = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
  if (process.env.ZT_ROBOTS_REGISTRATION_PENDING === '1') console.log('PENDING: generate registration is reserved for root adoption; not counted as PASS');
  else check('v2: registered with the implemented generate page', layouts.includes("'robots-txt-generator': 'generate'"));
}

if (skips) console.log(`SKIP: ${skips} parser checks (python3${hasPython ? ' without protego' : ' not found'})`);
console.log(`\n${passes} passed, ${failures} failed${skips ? `, ${skips} skipped` : ''}`);
process.exit(failures ? 1 : 0);
