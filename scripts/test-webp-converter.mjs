// WebP Converter — generated result cards, download label, encoder fallback
//
// Read:  src/components/tools/WebpConverterTool.astro
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Static checks on the component source:
// - The result cards are built with innerHTML / createElement, so they do not get Astro's scope
//   attribute. Every rule for a class the script creates must be written as
//   `.wc-results :global(.class)` (AGENTS.md rule 11). Before the fix none of them were, so in the
//   built page the thumbnails were full size, the sizes had no color and error cards had no style.
// - "Download All" starts one download per file; the label no longer says ZIP (it never made one).
// - canvas.toBlob falls back to PNG when the browser has no encoder for the requested type
//   (HTML spec; Safari has no WebP encoder). The result is rejected instead of being saved as .webp.
// - Errors, hints, the drop-zone text, the quality label and the status line come from the 4-language
//   STRINGS (they were English on every page).
// - Error cards use textContent with the raw file name (before the fix the name was HTML-escaped
//   first, so "a&b.png" showed as "a&amp;b.png").
//
// - Guide (src/content/blog/webp-converter-guide/{en,ja}.mdx): the text-chart sizes are re-encoded
//   with sharp and (when cwebp 1.6.0 is installed) cwebp; the Node chunk-reader block is run.
//
// Run: node scripts/test-webp-converter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'src/components/tools/WebpConverterTool.astro'), 'utf8');
const style = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
const script = src.slice(src.indexOf('<script'), src.indexOf('</script>'));

let passes = 0, failures = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('PASS ' + name); return; }
  failures++;
  console.log('FAIL ' + name + (detail !== undefined ? ' — ' + detail : ''));
}

const generated = new Set();
for (const m of script.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) if (c.startsWith('wc-')) generated.add(c);
for (const m of script.matchAll(/className = '([^']+)'/g)) for (const c of m[1].split(/\s+/)) if (c.startsWith('wc-')) generated.add(c);
check('script creates wc- classes', generated.size >= 8, [...generated].join(' '));
for (const cls of generated) {
  if (cls === 'wc-status') continue; // set on a template element
  const uses = [...style.matchAll(new RegExp('(\\.wc-results :global\\()?\\.' + cls + '(?![\\w-])', 'g'))];
  if (uses.length === 0) continue;
  const bare = uses.filter((m) => !m[1]);
  check(`.${cls} rules are .wc-results :global(...)`, bare.length === 0, `${bare.length} scoped selector(s)`);
}

check('rejects a blob whose type differs from the requested type', /blob\.type !== outMime/.test(script));
check('error card shows the raw file name', /errEl\.textContent = r\.name/.test(script) && !/errEl\.textContent = esc\(/.test(script));

const sm = src.match(/const STRINGS = (\{[\s\S]*?\n\});/);
check('STRINGS found', !!sm);
if (sm) {
  const S = new Function('return ' + sm[1])();
  check('Download All labels do not promise a ZIP', Object.values(S).every((t) => !/ZIP/i.test(t.downloadAll)));
  const keys = Object.keys(S.en).sort().join(',');
  for (const l of ['zh', 'ja', 'ko']) check(`STRINGS ${l} keys match en`, Object.keys(S[l]).sort().join(',') === keys);
  for (const k of ['hintTo', 'hintFrom', 'dropText', 'dropAction', 'errFormat', 'errNotWebp', 'errFailed', 'errEncoder', 'errLoad', 'statusOk', 'statusFail']) check('STRINGS has ' + k, typeof S.en[k] === 'string');
}
// Errors, hints and the status line were English on every page
check('no English error literals in the script', !/error: '[A-Z]/.test(script));
check('no English hint literals', !/hintEl\.textContent = '/.test(script));
check('status line from STRINGS', !/' file\(s\) converted'/.test(script));
check('quality label rendered from STRINGS', /<span>\{T\.qualityLabel\}<\/span>/.test(src));

// ---------- guide examples (src/content/blog/webp-converter-guide/{en,ja}.mdx) ----------
// {/* webp-check: {"tool":"cwebp"|"sharp", "args":[…] | "options":{…}, "bytes":N} */} annotations
// re-encode public/images/nato-phonetic-alphabet-ja.png (a file in this repository): with sharp
// (devDependency, bundles libwebp 1.6.0) always, with cwebp only when `cwebp -version` is 1.6.0
// (other versions give other sizes; SKIP). The byte count, written with thousands separators, must
// appear in the page within 2500 characters after the annotation. The Node block preceded by
// {/* webp-run: {"expect":"…"} */} is run; stdout must equal "expect" and its "// …" comments.
// Photo and screenshot rows in the guides need inputs that are not in the repository and a browser,
// so they are not recomputed here.
{
  const { existsSync, writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  const sharp = (await import('sharp')).default;
  const chart = join(root, 'public/images/nato-phonetic-alphabet-ja.png');
  let cwebp = null;
  try { cwebp = execFileSync('cwebp', ['-version']).toString().trim().split('\n')[0]; } catch { cwebp = null; }
  const tmp = mkdtempSync(join(tmpdir(), 'webp-guide-'));
  const fmt = (n) => n.toLocaleString('en-US');
  const cache = new Map();
  async function encode(spec) {
    const key = JSON.stringify([spec.tool, spec.args, spec.options]);
    if (cache.has(key)) return cache.get(key);
    let bytes;
    if (spec.tool === 'sharp') bytes = (await sharp(chart).webp(spec.options).toBuffer()).length;
    else {
      const out = join(tmp, cache.size + '.webp');
      execFileSync('cwebp', ['-quiet', ...spec.args, chart, '-o', out]);
      bytes = readFileSync(out).length;
    }
    cache.set(key, bytes);
    return bytes;
  }
  try {
    for (const lang of ['en', 'ja']) {
      const rel = 'src/content/blog/webp-converter-guide/' + lang + '.mdx';
      const path = join(root, rel);
      if (!existsSync(path)) { check(rel + ' exists', false); continue; }
      const text = readFileSync(path, 'utf8');
      let count = 0;
      for (const m of text.matchAll(/\{\/\* webp-check: (\{.*?\}) \*\/\}/g)) {
        count++;
        const spec = JSON.parse(m[1]);
        const label = rel + ' ' + spec.tool + ' ' + JSON.stringify(spec.args || spec.options);
        check(label + ' quotes ' + fmt(spec.bytes), text.slice(m.index, m.index + 2500).includes(fmt(spec.bytes)));
        if (spec.tool === 'cwebp' && cwebp !== '1.6.0') { console.log('SKIP ' + label + ' (cwebp ' + (cwebp || 'missing') + ')'); continue; }
        const got = await encode(spec);
        check(label + ' = ' + spec.bytes + ' bytes', got === spec.bytes, got);
      }
      check(rel + ' has webp-check annotations', count >= 5, count);
      const tpl = [/^## What (is|are) /mi, /^## .*Online/mi, /^## .* in Code$/mi, /^## (Summary|Conclusion|まとめ)/mi].filter((re) => re.test(text));
      check(rel + ' has no template headings', tpl.length === 0, tpl.map(String));
      check(rel + ' cites Google 26% and 25–34%', /26\s?%/.test(text) && /25[–〜~]34\s?%/.test(text));
    }
    const en = readFileSync(join(root, 'src/content/blog/webp-converter-guide/en.mdx'), 'utf8');
    let runs = 0;
    for (const m of en.matchAll(/\{\/\* webp-run: (\{.*?\}) \*\/\}\s*```js\n([\s\S]*?)```/g)) {
      runs++;
      const spec = JSON.parse(m[1]);
      writeFileSync(join(tmp, 'kind.mjs'), m[2]);
      const out = execFileSync(process.execPath, [join(tmp, 'kind.mjs')]).toString().trim();
      check('en.mdx webp-run output', out === spec.expect, out);
      const shown = [...m[2].matchAll(/^\/\/ (.+)$/gm)].map((x) => x[1]).filter((l) => !l.startsWith('webp-kind.mjs')).join('\n');
      check('en.mdx webp-run output comments', shown === out, shown);
    }
    check('en.mdx has a runnable code block', runs === 1, runs);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------- batch lifecycle: complete page script + actual shared keyboard handler ----------
// Image decode and canvas encoding are controlled boundaries; all result writes and shortcuts
// execute the production script. No browser, file dialog, or system clipboard is used.
{
  const { createContext, runInContext } = await import('node:vm');
  const pageSource = src;
  const prefix = 'wc';
  const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  const file = (name) => ({ name, type: 'image/png', size: 500 });
  function page() {
    const nodes = [], byId = new Map(), images = [], encodes = [], downloads = [], urls = new Map(), revoked = new Set();
    let document, wrap, serial = 0, persistenceClears = 0;
    function matches(el, selector) {
      return selector.split(',').some((part) => {
        const attrs = [...part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
        const simple = part.replace(/\[[^\]]+\]/g, '').trim(), tag = /^[\w-]+/.exec(simple), cls = /\.([\w-]+)/.exec(simple);
        return (!tag || el.tagName === tag[0].toUpperCase()) && (!cls || el.className.split(/\s+/).includes(cls[1])) && attrs.every((a) => a[2] === undefined ? el.getAttribute(a[1]) !== null : el.getAttribute(a[1]) === a[2]);
      });
    }
    class Element {
      constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), attrs: {}, className: '', children: [], listeners: {}, value: '', style: {}, checked: false, hidden: false, disabled: false, files: [] }); }
      set textContent(value) { this.text = String(value); this.html = null; this.children = []; }
      get textContent() { return (this.text || '') + this.children.map((c) => c.textContent).join(''); }
      set innerHTML(value) {
        if (this.children.some((child) => child.contains(document?.activeElement))) document.activeElement = document.body;
        this.html = String(value); this.text = ''; this.children = [];
        for (const m of String(value).matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)) { const el = new Element(m[1]); attributes(el, m[2]); this.appendChild(el); }
      }
      get innerHTML() { return this.html ?? this.textContent.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
      setAttribute(key, value) { this.attrs[key] = String(value); if (['id', 'class', 'type', 'name', 'value'].includes(key)) this[key === 'class' ? 'className' : key] = String(value); }
      getAttribute(key) { return key === 'class' ? this.className : this.attrs[key] ?? null; }
      get classList() { const el = this; return { add(c) { el.className += ' ' + c; }, remove(c) { el.className = el.className.split(/\s+/).filter((x) => x !== c).join(' '); } }; }
      addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
      dispatch(type, extra = {}) { const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...extra }; for (const callback of this.listeners[type] || []) callback.call(this, event); return event; }
      appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
      removeChild(child) { this.children = this.children.filter((c) => c !== child); }
      contains(el) { return this === el || (this === wrap && nodes.some((n) => n !== wrap && n.contains(el))) || this.children.some((c) => c.contains(el)); }
      closest() { return wrap; }
      focus() { document.activeElement = this; }
      querySelectorAll(selector) { return this.children.flatMap((c) => [c, ...c.querySelectorAll('*')]).filter((c) => matches(c, selector)); }
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
      click() { if (this.disabled) return; if (this.tagName === 'A') downloads.push({ name: this.download || this.getAttribute('download'), url: this.href || this.getAttribute('href') }); this.dispatch('click'); }
      getContext() { return { drawImage() {}, fillRect() {} }; }
      toBlob(callback, type) { encodes.push({ callback, type, done: false }); }
    }
    function attributes(el, text) {
      for (const a of text.matchAll(/([\w-]+)="([^"]*)"/g)) el.setAttribute(a[1], a[2]);
      for (const key of ['checked', 'hidden', 'disabled']) el[key] = new RegExp('\\b' + key + '(?:\\s|/|$)').test(text);
    }
    const inline = [...pageSource.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find((m) => m[1].includes('(function'));
    for (const m of pageSource.slice(0, inline.index).matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)) {
      const el = new Element(m[1]); attributes(el, m[2]); nodes.push(el); if (el.id) byId.set(el.id, el);
    }
    wrap = nodes.find((el) => el.className.split(/\s+/).includes(prefix + '-wrap'));
    const get = (id) => { const el = byId.get(id); if (!el) throw new Error('Missing source ID: ' + id); return el; };
    document = new Element('document'); document.body = new Element('body'); document.documentElement = { lang: 'en' }; document.activeElement = document.body;
    document.createElement = (tag) => new Element(tag); document.getElementById = get; document.getElementsByName = (name) => nodes.filter((el) => el.name === name);
    document.querySelectorAll = (selector) => nodes.filter((el) => matches(el, selector)); document.querySelector = (selector) => selector === '.tool-widget' ? wrap : document.querySelectorAll(selector)[0];
    wrap.querySelectorAll = document.querySelectorAll;
    const sandbox = { document, Blob, console, URL: { createObjectURL(blob) { const url = 'blob:test-' + ++serial; urls.set(url, blob); return url; }, revokeObjectURL(url) { revoked.add(url); } },
      Image: class { constructor() { this.naturalWidth = 64; this.naturalHeight = 48; images.push(this); } },
      setTimeout() {}, window: { ztPersist: { clear() { persistenceClears++; } } }, _slug: prefix === 'wc' ? 'webp-converter' : 'image-compressor' };
    sandbox.t = new Function(pageSource.slice(pageSource.indexOf('const STRINGS = '), pageSource.indexOf('/* ── strings:end ── */')) + 'return STRINGS.en;')();
    const context = createContext(sandbox);
    runInContext(inline[1], context);
    const keyStart = layout.indexOf("document.addEventListener('keydown'", layout.indexOf('// ── Keyboard shortcuts:'));
    runInContext(layout.slice(keyStart, layout.indexOf('// ── Copy button visual feedback', keyStart)), context);
    return { get, images, encodes, downloads, urls, revoked, document,
      get persistenceClears() { return persistenceClears; },
      drop(names) { get(prefix + '-drop').dispatch('drop', { dataTransfer: { files: names.map(file) } }); },
      key(target = get(prefix + '-drop')) { target.focus(); return document.dispatch('keydown', { ctrlKey: true, key: 'l' }); },
      async decode(index) { images[index].onload(); await flush(); },
      async encode(index) { const job = encodes[index]; job.done = true; job.callback(new Blob(['encoded fixture'], { type: job.type })); await flush(); },
      async ready(names) { const start = images.length, encodeStart = encodes.length; this.drop(names); for (let i = start; i < images.length; i++) await this.decode(i); for (let i = encodeStart; i < encodes.length; i++) if (!encodes[i].done) await this.encode(i); },
      rows() { return get(prefix + '-results').children.map((card) => card.querySelector('.' + prefix + '-dl')?.getAttribute('download')); }
    };
  }
  {
    const p = page(); await p.ready(['first.png', 'second.png']);
    check('batch lifecycle: two real result cards', p.rows().length === 2);
    p.get(prefix + '-download-all').click(); check('batch lifecycle: Download All uses both current names', p.downloads.length === 2 && p.downloads[0].name.startsWith('first.') && p.downloads[1].name.startsWith('second.'));
    p.key(p.document.body); check('batch lifecycle: CtrlL outside tool leaves results', p.rows().length === 2 && p.persistenceClears === 0);
    const oldQuality = p.get(prefix + '-quality').value, event = p.key();
    check('batch lifecycle: CtrlL clears result cards', p.rows().length === 0 && p.get(prefix + '-results').hidden);
    check('batch lifecycle: CtrlL clears actions and status', p.get(prefix + '-actions').hidden && p.get(prefix + '-status').textContent === '');
    check('batch lifecycle: CtrlL keeps quality and runs shared shortcut', p.get(prefix + '-quality').value === oldQuality && event.defaultPrevented && p.persistenceClears === 1);
    await p.ready(['recovered.png']); check('batch lifecycle: new batch works after CtrlL', p.rows().length === 1 && p.rows()[0].startsWith('recovered.'));
    const link = p.get(prefix + '-results').children[0].querySelector('.' + prefix + '-dl'); p.key(link);
    check('batch lifecycle: focused result CtrlL preserves shared cleanup', p.rows().length === 0 && p.persistenceClears === 2);
  }
  {
    const p = page(); p.drop(['slow-a.png', 'slow-b.png']); p.drop(['new.png']); await p.decode(2); await p.encode(0); const status = p.get(prefix + '-status').textContent;
    await p.decode(0); await p.decode(1); for (let i = 1; i < p.encodes.length; i++) await p.encode(i);
    check('batch lifecycle: old decode cannot append to new batch', p.rows().length === 1 && p.rows()[0].startsWith('new.'));
    check('batch lifecycle: old decode cannot replace current status', p.get(prefix + '-status').textContent === status);
  }
  {
    const p = page(); p.drop(['pending-decode.png']); p.key(); await p.decode(0);
    for (let i = 0; i < p.encodes.length; i++) await p.encode(i);
    check('batch lifecycle: CtrlL ignores old image decode', p.rows().length === 0 && p.get(prefix + '-results').hidden && p.get(prefix + '-status').textContent === '');
  }
  for (const cancel of ['shortcut', 'clear']) {
    const p = page(); p.drop(['pending.png']); await p.decode(0);
    if (cancel === 'shortcut') p.key();
    else { await p.ready(['current.png']); p.get(prefix + '-clear').click(); }
    for (let i = 0; i < p.encodes.length; i++) if (!p.encodes[i].done) await p.encode(i);
    check('batch lifecycle: ' + cancel + ' ignores old encoding', p.rows().length === 0 && p.get(prefix + '-results').hidden && p.get(prefix + '-actions').hidden && p.get(prefix + '-status').textContent === '');
  }
  {
    const p = page(); await p.ready(['settings.png']); const imageCount = p.images.length;
    p.get(prefix + '-quality').value = '42'; p.get(prefix + '-quality').dispatch('input');
    check('batch lifecycle: quality changes label without recompressing', p.images.length === imageCount && p.get(prefix + '-quality-val').textContent === '42' && p.rows().length === 1);
  }
}

// ---------- v2 page layout ----------
{
  const { createHash } = await import('node:crypto');
  const { createRequire } = await import('node:module');
  const { load: loadYaml } = await import('js-yaml');
  const pageSource = src, prefix = 'wc', slug = 'webp-converter';
  const markup = pageSource.slice(pageSource.indexOf('\n---\n') + 5, pageSource.indexOf('<script is:inline')).trim();
  const table = new Function(pageSource.slice(pageSource.indexOf('const STRINGS = '), pageSource.indexOf('/* ── strings:end ── */')) + 'return STRINGS;')();
  const css = pageSource.slice(pageSource.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/<\/?style\b[^>]*>/g, '');
  const rules = (selector) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(',').some((s) => s.trim() === selector)).map((m) => m[2]);
  const property = (body, name, value) => new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*' + value + '\\s*(?:;|$)').test(body);
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  check('analyze layout registered', new RegExp("'" + slug + "':\\s*'analyze'").test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
  check('tool root is the direct first element', markup.startsWith('<div class="' + prefix + '-wrap" id="' + prefix + '-wrap">'));
  check('root can shrink with available height', rules('.' + prefix + '-wrap').some((r) => property(r, 'display', 'flex') && property(r, 'flex-direction', 'column') && property(r, 'min-height', '0')));
  check('empty state uses shared drop fill', markup.includes('class="' + prefix + '-drop zt-empty-drop"'));
  check('results have zero-basis flex and internal scrolling', rules('.' + prefix + '-results').some((r) => property(r, 'flex', '1\\s+1\\s+0') && property(r, 'overflow', 'auto') && property(r, 'min-width', '0')));
  check('result cards keep their height inside the scroll area', rules('.' + prefix + '-results :global(.' + prefix + '-card)').some((r) => property(r, 'flex', 'none')));
  check('mobile results have a bounded height', rules('.' + prefix + '-results').some((r) => property(r, 'flex', 'none') && property(r, 'height', '[1-9][\\d.]*rem') && property(r, 'min-height', '0')));
  for (const selector of ['.' + prefix + '-actions[hidden]', '.' + prefix + '-results[hidden]', '#' + prefix + '-download-all[hidden]']) check(selector + ' honors hidden', rules(selector).some((r) => property(r, 'display', 'none')));
  check('status reserves two lines and scrolls', rules(prefix === 'wc' ? '.wc-status' : '#ic-status').some((r) => property(r, 'height', '3em') && property(r, 'overflow', 'auto') && property(r, 'flex', 'none')));
  check('completed import compacts the drop target', rules('.' + prefix + '-wrap:has(.' + prefix + '-results:not([hidden])) .' + prefix + '-drop').some((r) => property(r, 'flex', 'none') && property(r, 'min-height', '0')));
  check('860px stacks controls and 640px adjusts phone layout', /@media\s*\(max-width:\s*860px\)/.test(css) && /@media\s*\(max-width:\s*640px\)/.test(css));
  check('download and clear remain explicit actions before status', ['download-all', 'clear'].every((key) => markup.indexOf('id="' + prefix + '-' + key + '"') < markup.indexOf('id="' + prefix + '-status"')));
  check('status precedes the drop target and results', markup.indexOf('id="' + prefix + '-status"') < markup.indexOf('id="' + prefix + '-drop"') && markup.indexOf('id="' + prefix + '-drop"') < markup.indexOf('id="' + prefix + '-results"'));
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  check('template IDs are unique', ids.length === new Set(ids).size);
  check('no runtime i18n rewrite remains', !pageSource.includes('data-i18n'));
  check('tips excluded from serialized strings', /const \{ tips: TIPS, \.\.\.CLIENT_T \} = T/.test(pageSource) && /define:vars=\{\{ t: CLIENT_T \}\}/.test(pageSource));
  const keys = prefix === 'wc' ? ['mode', 'quality', 'files', 'download'] : ['format', 'quality', 'resize', 'files', 'download'];
  check('each control tip appears once', JSON.stringify([...markup.matchAll(/<Toggletip id="[a-z]+-tip-([^"]+)"/g)].map((m) => m[1]).sort()) === JSON.stringify([...keys].sort()));
  check('file tips are outside the file-input overlay', !/<div id="[a-z]+-drop"[\s\S]*?<Toggletip/.test(markup.slice(markup.indexOf('<div id="' + prefix + '-drop"'))));
  const retained = {
    "en": [
        "921c1bf82d898ea7d7cff1f3a50cca323df05d6f5d4fc620467f9d0751d117a2",
        "f20215fbec222bab485bfb117efcf964ac6b55b93490aae95d1267725e378b53"
    ],
    "zh": [
        "f701082b074e9687191781b0fcbe97bddee154f204ff1dbfa1b59d13cf5569b6",
        "ccfcac01c778ee815b15d227e6161ff99205b83469e7262af26846732faae328"
    ],
    "ja": [
        "754a939478e3154335132fb61febffb873b445d207856333d54f44d6f61f8e85",
        "40762cd04d4a3b82cb22af2539964cf496cefa3197a5da78d5303fcb55fb7f61"
    ],
    "ko": [
        "150aa07c946615398765acc0eba0fee69329af0a060d237bfac1bc1534971fcb",
        "ac5d9787fbc95547095b239507e96c0a7c1b1f059e1da1fe52fcf5376a07a7cd"
    ]
};
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    check(lang + ' same string keys', JSON.stringify(Object.keys(table[lang]).sort()) === JSON.stringify(Object.keys(table.en).sort()));
    check(lang + ' complete control tips', JSON.stringify(Object.keys(table[lang].tips).sort()) === JSON.stringify([...keys].sort()) && keys.every((key) => table[lang].tips[key].length > 20));
    const { tips, ...client } = table[lang];
    check(lang + ' tip text is absent from client payload', keys.every((key) => !JSON.stringify(client).includes(tips[key])));
    const mdx = readFileSync(join(root, 'src/content/tools', slug, lang + '.mdx'), 'utf8');
    const [, metadata, body] = mdx.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const fm = loadYaml(metadata), steps = fm.steps || [];
    check(lang + ' bounded plain-text steps', steps.length > 0 && steps.length <= 8 && steps.every((s) => typeof s === 'string' && s.length <= 280 && !/<[^>]+>|\*\*/.test(s)) && steps.join('').length <= 1200);
    check(lang + ' steps name current download actions', steps.some((s) => s.includes(table[lang].downloadAll)) && steps.some((s) => s.includes(table[lang].download)));
    check(lang + ' usage heading removed', !/<h2>(?:How to Use|使用方法|使用步骤|使い方|사용 방법)<\/h2>/.test(body));
    check(lang + ' SEO and FAQ unchanged', hash(metadata.replace(/^steps:\n(?:  .*\n)*/m, '')) === retained[lang][0]);
    check(lang + ' all non-usage body content unchanged', hash(body) === retained[lang][1]);
  }
  const require = createRequire(import.meta.url);
  const { transform: compileAstro } = await import(require.resolve('@astrojs/compiler', { paths: [dirname(require.resolve('astro'))] }));
  const { transform: checkJs } = await import('esbuild');
  let compileError = null;
  try { const result = await compileAstro(pageSource, { filename: 'WebpConverterTool.astro' }); await checkJs(result.code, { loader: 'ts', format: 'esm' }); }
  catch (error) { compileError = error.message; }
  check('Astro generated JavaScript is valid', compileError === null, compileError);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
