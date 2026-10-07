// Image Compressor — the output file name follows the format the browser actually produced
//
// Read:  src/components/tools/ImageCompressorTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers; also reads the STRINGS table and <style>),
//        src/content/tools/image-compressor/{en,zh,ja,ko}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// HTML canvas toBlob() / OffscreenCanvas convertToBlob() fall back to image/png when the
// browser has no encoder for the requested type (HTML standard, "serialization of a bitmap as
// a file"); no browser encodes GIF. Before the fix the file was still named after the
// requested type (photo.webp holding PNG bytes, anim.gif holding PNG bytes). Also covers the
// fallback note in 4 languages, and that result-card classes created with innerHTML are
// styled through :global (scoped Astro styles do not reach them).
//
// Run: node scripts/test-image-compressor.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/ImageCompressorTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in ImageCompressorTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { resultFormat, renameOut };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}

eq('WebP encoded as requested', E.resultFormat('photo.jpg', 'image/webp', 'image/webp'), { outName: 'photo.webp', mime: 'image/webp', fellBack: false });
eq('no WebP encoder: PNG named .png', E.resultFormat('photo.jpg', 'image/webp', 'image/png'), { outName: 'photo.png', mime: 'image/png', fellBack: true });
eq('GIF kept: canvas gives PNG', E.resultFormat('anim.gif', 'image/gif', 'image/png'), { outName: 'anim.png', mime: 'image/png', fellBack: true });
eq('JPEG', E.resultFormat('a.b.png', 'image/jpeg', 'image/jpeg'), { outName: 'a.b.jpg', mime: 'image/jpeg', fellBack: false });
eq('blob without a type keeps the requested name', E.resultFormat('x.png', 'image/png', ''), { outName: 'x.png', mime: 'image/png', fellBack: false });

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const strings = new Function(source.slice(source.indexOf('const STRINGS = '), source.indexOf('/* ── strings:end ── */')) + 'return STRINGS;')();
  check(lang + ': fellBack string with {req} and {got}', strings[lang].fellBack.includes('{req}') && strings[lang].fellBack.includes('{got}'), lang);
  const mdx = readFileSync(join(root, 'src/content/tools/image-compressor', lang + '.mdx'), 'utf8');
  check(lang + ': page no longer says the name keeps the chosen format', !/still names the file after the format you picked|仍按你选的格式命名|ファイル名は選んだ形式のまま|파일 이름은 선택한 형식대로/.test(mdx), lang);
}

const style = source.slice(source.indexOf('<style'), source.indexOf('</style>'));
for (const cls of ['ic-card', 'ic-card-name', 'ic-card-sizes', 'ic-card-note', 'ic-thumb', 'ic-dl', 'ic-saved', 'ic-larger']) {
  check('.' + cls + ' is styled through :global', new RegExp(':global\\(\\.' + cls + '\\)').test(style), cls);
  check('.' + cls + ' has no scoped rule', !new RegExp('^\\s*\\.' + cls + '\\b', 'm').test(style), cls);
}

// ---------- batch lifecycle: complete page script + actual shared keyboard handler ----------
// Image decode and canvas encoding are controlled boundaries; all result writes and shortcuts
// execute the production script. No browser, file dialog, or system clipboard is used.
{
  const { createContext, runInContext } = await import('node:vm');
  const pageSource = source;
  const prefix = 'ic';
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
  const pageSource = source, prefix = 'ic', slug = 'image-compressor';
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
        "69cca5b2aa6ece31bbcb34e435abfabcb615a092246d07c720a7bb4ae54b8d7f",
        "9cab4c9d7bf8ebedf8901a80747c56d4bc95671cd69f22a624d78b768f13a544"
    ],
    "zh": [
        "a79f8868b73ecc52a18ae2d74ecd22fe3f0f3dc23299d2fef3d38139495416b1",
        "498c366d1cabfd17add7e159e43d290bb4768729e8d88c1dd842a812ca0f5784"
    ],
    "ja": [
        "89c3590f91aa0ffc8a0f5feab7af7bdb34802dfe7ed7d1317f19803dfbf47d33",
        "472912a5864fc5ac67aac03b3193aee477bdbeff4ac75ebccd07a98d1ceac6ca"
    ],
    "ko": [
        "187a35df0c29986a500d10eeb0767cfa6ef3b4f08bc0d0b9702123249642116c",
        "ef38fbfdf030047be27f021a84df0161f3dfc0c8a9401d33d3f0989a02f31235"
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
  try { const result = await compileAstro(pageSource, { filename: 'ImageCompressorTool.astro' }); await checkJs(result.code, { loader: 'ts', format: 'esm' }); }
  catch (error) { compileError = error.message; }
  check('Astro generated JavaScript is valid', compileError === null, compileError);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
