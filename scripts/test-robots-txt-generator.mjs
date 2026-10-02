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
// - `rtg-parse` annotations: a robots.txt body, a user agent, a path and the expected answer
//   from Python's urllib.robotparser and from Protego (the RFC 9309 parser used by Scrapy).
//   urllib.robotparser runs whenever python3 is available; Protego checks are skipped (SKIP)
//   unless `python3 -c "import protego"` works (set PYTHON to another interpreter if needed);
// - the guides are indexable and have no template headings.
//
// Run: node scripts/test-robots-txt-generator.mjs

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/RobotsTxtGeneratorTool.astro'), 'utf8');

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
function makeEl(tag) {
  const handlers = {};
  const el = {
    tagName: tag, children: [], parent: null, classes: [], dataset: {}, style: {}, value: '',
    textContent: '', disabled: false, placeholder: '', _html: '',
    get className() { return this.classes.join(' '); },
    set className(v) { this.classes = v.split(/\s+/).filter(Boolean); },
    classList: null,
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    fire(type) { (handlers[type] || []).forEach((fn) => fn.call(el, {})); },
    appendChild(c) { c.parent = this; this.children.push(c); return c; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; },
    focus() {},
    get innerHTML() { return this._html; },
    set innerHTML(html) {
      this._html = html;
      this.children = [];
      const re = /<(\w+)([^>]*)class="([^"]+)"([^>]*)>([^<]*)/g;
      let m;
      while ((m = re.exec(html))) {
        const cls = m[3].split(/\s+/);
        if (!cls.some((c) => KNOWN.includes(c))) continue;
        const child = makeEl(m[1]);
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
      const cls = sel.replace(/^\./, '');
      const out = [];
      const walk = (n) => { for (const c of n.children) { if (c.classes.includes(cls)) out.push(c); walk(c); } };
      walk(this);
      return out;
    },
  };
  el.classList = { add: (c) => el.classes.push(c), remove: (c) => { el.classes = el.classes.filter((x) => x !== c); } };
  return el;
}

function runTool() {
  const scriptMatch = /<script is:inline>([\s\S]*?)<\/script>/.exec(source);
  const byId = {};
  for (const id of ['rt-blocks', 'rt-add-block', 'rt-sitemap', 'rt-output', 'rt-copy', 'rt-status']) byId[id] = makeEl('div');
  const document = {
    documentElement: { lang: 'en' },
    querySelectorAll: () => [],
    getElementById: (id) => byId[id],
    createElement: (tag) => makeEl(tag),
  };
  new Function('document', 'window', 'navigator', 'setTimeout', scriptMatch[1])(document, {}, {}, () => {});
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
  for (const c of cases) for (const p of c.paths) flat.push({ txt: c.txt, ua: c.ua, path: p[0], urllib: p[1], protego: p[2] });
  const res = JSON.parse(execFileSync(PY, ['-c', PARSE], { input: JSON.stringify(flat) }).toString());
  flat.forEach((c, i) => {
    check(`${lang}: urllib.robotparser ${c.ua} ${c.path}`, res[i].urllib === c.urllib, `got ${res[i].urllib}`);
    if (hasProtego) check(`${lang}: Protego ${c.ua} ${c.path}`, res[i].protego === c.protego, `got ${res[i].protego}`);
    else skips++;
  });
}

if (skips) console.log(`SKIP: ${skips} parser checks (python3${hasPython ? ' without protego' : ' not found'})`);
console.log(`\n${passes} passed, ${failures} failed${skips ? `, ${skips} skipped` : ''}`);
process.exit(failures ? 1 : 0);
