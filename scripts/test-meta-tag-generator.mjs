// Meta Tag Generator — generated <head> block
//
// Read:  src/components/tools/MetaTagGeneratorTool.astro (runs the real buildHead() and its escape
//        helpers between the `engine:start` / `engine:end` markers),
//        src/content/blog/meta-tag-generator-guide/{en,ja}.mdx (`mtg-check` examples, `mtg-live` tag
//        lists), dist/{,ja/}tools/meta-tag-generator/index.html (SKIP without a build)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// The output is parsed with parse5 as the <head> of a page, the way a site would use it. Before the
// fix the JSON-LD block was written with plain JSON.stringify, so a title or description containing
// a closing script tag ended the script element early and the rest became markup. `<` is now written
// as \u003c inside JSON-LD; JSON.parse reads it back to the same string. The default case is the
// example quoted on the English tool page.
//
// Run: node scripts/test-meta-tag-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'parse5';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/MetaTagGeneratorTool.astro'), 'utf8');
const s = source.indexOf('/* ── engine:start ── */');
const e = source.indexOf('/* ── engine:end ── */');
if (s < 0 || e <= s) { console.error('FAIL: engine block not found'); process.exit(1); }
const { buildHead } = new Function('fields', source.slice(s, e) + '\nreturn { buildHead };')({});

let passes = 0, failures = 0;
function check(name, ok, detail) { if (ok) passes++; else { failures++; console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : '')); } }
function walk(n, f) { f(n); (n.childNodes || []).forEach((c) => walk(c, f)); }
function headOf(html) {
  const doc = parse('<!doctype html><html><head>' + html + '</head><body></body></html>');
  const out = { meta: {}, scripts: [], title: null, bodyNodes: 0 };
  walk(doc, (n) => {
    if (n.tagName === 'meta') {
      const a = Object.fromEntries(n.attrs.map((x) => [x.name, x.value]));
      out.meta[a.property || a.name] = a.content;
    }
    if (n.tagName === 'title') out.title = n.childNodes.map((c) => c.value).join('');
    if (n.tagName === 'script') out.scripts.push(n.childNodes.map((c) => c.value).join(''));
    if (n.tagName === 'body') out.bodyNodes = n.childNodes.length;
  });
  return out;
}

const base = {
  title: 'ZeroTool — Free browser-based dev utilities', description: 'A growing library of one-task tools that run entirely in your browser. No accounts, no uploads.',
  canonical: 'https://zerotool.dev/', siteName: 'ZeroTool', author: 'ZeroTool Workshop', keywords: 'dev tools, meta tags, open graph, twitter card',
  language: 'en', themeColor: '#5b3d20', robotsIndex: 'index', robotsFollow: 'follow', viewport: true, ogType: 'website', ogLocale: 'en_US',
  ogImage: 'https://zerotool.dev/og/json-formatter.png', ogImageWidth: '1200', ogImageHeight: '630', ogImageAlt: 'ZeroTool cover image',
  twCard: 'summary_large_image', twSite: '@zerotooldev', twCreator: '@zerotooldev', twImage: '', schemaType: '',
};

const d = headOf(buildHead(base));
check('og:url equals the canonical field', d.meta['og:url'] === 'https://zerotool.dev/');
check('twitter:image falls back to og:image', d.meta['twitter:image'] === base.ogImage);
check('robots always written', d.meta.robots === 'index, follow');
check('no JSON-LD without a schema type', d.scripts.length === 0);

const tricky = { ...base, title: 'Build "Notes" & <tips>', description: 'x</script><img src=x onerror=alert(1)>y', schemaType: 'Article', author: 'Jane Doe' };
const out = buildHead(tricky);
const h = headOf(out);
check('title text survives', h.title === tricky.title, h.title);
check('og:description attribute survives', h.meta['og:description'] === tricky.description, h.meta['og:description']);
check('JSON-LD stays one script element', h.scripts.length === 1, h.scripts.length);
check('nothing leaks into <body>', h.bodyNodes === 0, h.bodyNodes);
let ld = null;
try { ld = JSON.parse(h.scripts[0]); } catch (err) { check('JSON-LD parses', false, err.message); }
if (ld) {
  check('JSON-LD description round-trips', ld.description === tricky.description, ld.description);
  check('JSON-LD name round-trips', ld.name === tricky.title, ld.name);
  check('Article gets a Person author', ld.author && ld.author['@type'] === 'Person' && ld.author.name === 'Jane Doe');
}

// ---------- the Open Graph guide (en) and the OGP guide (ja) ----------
// `mtg-check: {json}` → the next html block equals buildHead() for those fields on top of an empty
// form (viewport off, robots index/follow, card summary_large_image). `mtg-live: path` → the next text
// block equals the og:/twitter: tag names in that dist page, extracted with the regex the guides give
// for the curl command (needs `npm run build`; SKIP without dist).
{
  const empty = {
    title: '', description: '', canonical: '', siteName: '', author: '', keywords: '', language: 'en', themeColor: '',
    robotsIndex: 'index', robotsFollow: 'follow', viewport: false, ogType: 'website', ogLocale: '', ogImage: '',
    ogImageWidth: '', ogImageHeight: '', ogImageAlt: '', twCard: 'summary_large_image', twSite: '', twCreator: '', twImage: '', schemaType: '',
  };
  const tagRe = /(property|name)="(og|twitter):[a-z_:]+"/g;
  for (const lang of ['en', 'ja']) {
    const guide = readFileSync(join(root, 'src/content/blog/meta-tag-generator-guide', lang + '.mdx'), 'utf8');
    const fm = guide.match(/^---\n([\s\S]*?)\n---/)[1];
    check(lang + ' guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
    const tpl = [/^## What (is|are) /m, /^## .*Online/m, /^## .* in Code/m, /^## (Summary|Conclusion)/m].filter((re) => re.test(guide));
    check(lang + ' guide has no template headings', tpl.length === 0, tpl.map(String).join(' '));
    const checks = [...guide.matchAll(/\{\/\* mtg-check: (\{.*?\}) \*\/\}\s*```html\n([\s\S]*?)```/g)];
    check(lang + ' guide has mtg-check blocks', checks.length >= 1, checks.length);
    for (const m of checks) {
      const v = { ...empty, ...JSON.parse(m[1]) };
      const out = buildHead(v);
      check(lang + ' mtg-check output: ' + v.title.slice(0, 20), m[2].trimEnd() === out, '\n' + out);
      check(lang + ' mtg-check output parses as one head', headOf(out).bodyNodes === 0);
      if (lang === 'ja') {
        check('ja guide quotes the title and description counter values',
          guide.includes(`タイトルは ${v.title.length} 文字、説明は ${v.description.length} 文字`), v.title.length + '/' + v.description.length);
      }
    }
    const lives = [...guide.matchAll(/\{\/\* mtg-live: (\S+) \*\/\}\s*```text\n([\s\S]*?)```/g)];
    check(lang + ' guide has an mtg-live block', lives.length === 1, lives.length);
    for (const m of lives) {
      let page = null;
      try { page = readFileSync(join(root, 'dist', m[1]), 'utf8'); } catch {}
      if (!page) { console.log('SKIP: ' + lang + ' mtg-live (no dist/' + m[1] + ')'); continue; }
      const head = page.slice(0, page.indexOf('</head>'));
      const names = (head.match(tagRe) || []).join('\n');
      check(lang + ' mtg-live tag list matches dist/' + m[1], m[2].trimEnd() === names, '\n' + names);
    }
    check(lang + ' guide gives the curl regex the test uses', guide.includes(`grep -oE '(property|name)="(og|twitter):[a-z_:]+"'`));
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
