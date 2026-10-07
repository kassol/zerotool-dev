// CSR decoder: run the actual page and ToolLayout shortcut scripts with Web Crypto.
// Read: component + ToolLayout. Write: stdout only. No network or filesystem fixtures.
import { readFileSync } from 'node:fs';
import { webcrypto, createHash } from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(root + 'src/components/tools/CsrDecoderTool.astro', 'utf8');
const STRINGS = new Function('return ' + source.match(/const STRINGS = (\{[\s\S]*?\n\}) as const;/)[1])();
const layout = readFileSync(root + 'src/layouts/ToolLayout.astro', 'utf8');
const shortcut = [...layout.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('// ── Keyboard shortcuts:'));
let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) passed++; else { failed++; console.log('FAIL: ' + name); } };
const tick = () => new Promise(r => setTimeout(r, 5));
async function until(fn) { for (let i = 0; i < 400; i++) { if (fn()) return; await tick(); } throw new Error('Timed out waiting for page'); }
function page(lang = 'en', defer = false, deferFirstDigest = false) {
  const nodes = new Map(), listeners = {}, pending = [], digests = [], clipboard = [], tasks = [], timers = [];
  let digestIntercepted = false;
  let calls = 0, document;
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const events = {};
    const e = { id, value: '', textContent: '', innerHTML: '', className: '', hidden: false, disabled: false, style: {}, dataset: {},
      addEventListener: (type, f) => (events[type] ||= []).push(f),
      querySelectorAll: s => s.includes('textarea') ? [node('csrd-input')] : [],
      contains: el => el?.id?.startsWith('csrd-'), closest: () => null,
      getAttribute: () => null, setAttribute() {}, removeAttribute() {},
      classList: { add() {}, remove() {}, toggle() {} },
      focus() { document.activeElement = e; },
      dispatch(type, init = {}) {
        const ev = { target: e, currentTarget: e, preventDefault() {}, stopPropagation() { this.stopped = true; }, ...init };
        for (const f of events[type] || []) { const r = f(ev); if (r?.then) tasks.push(r); }
        if (!ev.stopped) for (const f of listeners[type] || []) { const r = f(ev); if (r?.then) tasks.push(r); }
        return ev;
      },
      click() { if (!e.disabled) e.dispatch('click'); },
    };
    nodes.set(id, e); return e;
  }
  for (const m of source.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) node(m[1]).hidden = /\bhidden\b/.test(m[0]);
  const widget = node('widget');
  document = { documentElement: { lang }, activeElement: node('csrd-input'),
    getElementById: node, querySelectorAll: () => [],
    querySelector: s => s === '.tool-widget .btn-primary' ? node('csrd-decode') : widget,
    addEventListener: (type, f) => (listeners[type] ||= []).push(f),
  };
  const subtle = {
    importKey: (...args) => webcrypto.subtle.importKey(...args),
    digest: (...args) => {
      if (deferFirstDigest && !digestIntercepted) {
        digestIntercepted = true;
        return new Promise((resolve, reject) => digests.push({
          resolve: async () => resolve(await webcrypto.subtle.digest(...args)), reject,
        }));
      }
      return webcrypto.subtle.digest(...args);
    },
    verify: (...args) => {
      calls++;
      if (defer) return new Promise((resolve, reject) => pending.push({ resolve, reject, args }));
      return webcrypto.subtle.verify(...args);
    },
  };
  const sandbox = { document, t: Object.fromEntries(Object.entries(STRINGS[lang]).filter(([key]) => key !== 'tips')), crypto: { subtle }, Uint8Array, ArrayBuffer, TextDecoder, TextEncoder,
    atob, btoa, console, location: { pathname: '/tools/csr-decoder/' },
    localStorage: { getItem: () => null, setItem() {} }, ztPersist: { clear() {} },
    navigator: { clipboard: { writeText: async t => { clipboard.push(t); } } },
    setTimeout: f => { timers.push(f); return timers.length; }, clearTimeout() {},
    MutationObserver: class { observe() {} disconnect() {} },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const m of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) vm.runInContext(m[1], context);
  vm.runInContext(shortcut, context);
  return { node, pending, digests, clipboard, get calls() { return calls; },
    example() { node('csrd-example').click(); }, decode() { node('csrd-decode').click(); },
    input(text) { node('csrd-input').value = text; node('csrd-input').dispatch('input'); },
    key(key, mod = 'ctrlKey') { node('csrd-input').focus(); node('csrd-input').dispatch('keydown', { key, [mod]: true }); },
    async settle() { await Promise.all(tasks); while (timers.length) timers.shift()(); await tick(); },
    async resolveAll() { for (const p of pending) p.resolve(true); await this.settle(); },
  };
}
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const p = page(lang); p.example();
  const pem = p.node('csrd-input').value;
  check(lang + ' example is a PEM request', pem.includes('BEGIN CERTIFICATE REQUEST'));
  p.decode(); await p.settle();
  const html = p.node('csrd-results').innerHTML;
  check(lang + ' example decodes', !p.node('csrd-results').hidden && p.node('csrd-status').className.includes('success'));
  check(lang + ' example has subject and SAN', html.includes('example.com') && html.includes('api.example.com'));
  check(lang + ' example has RSA 2048 key', html.includes('2048'));
  check(lang + ' verification uses Web Crypto once', p.calls === 1);
  const der = Buffer.from(pem.replace(/-----[^\n]+-----/g, '').replace(/\s/g, ''), 'base64');
  const fingerprint = createHash('sha256').update(der).digest('hex').match(/../g).join(':').toUpperCase();
  check(lang + ' displayed fingerprint matches original DER', html.includes(fingerprint));
  p.input('-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----'); p.decode(); await p.settle();
  check(lang + ' private key is rejected without retaining result', p.node('csrd-results').hidden && p.node('csrd-results').innerHTML === '' && p.node('csrd-status').className.includes('error'));
  p.node('csrd-clear').click();
  check(lang + ' clear resets fields', !p.node('csrd-input').value && !p.node('csrd-status').textContent && p.node('csrd-results').hidden);
}
for (const action of ['clear', 'shortcut', 'typing', 'example', 'new-invalid']) {
  const p = page('en', true); p.example(); p.decode(); await until(() => p.pending.length === 1);
  if (action === 'clear') p.node('csrd-clear').click();
  if (action === 'shortcut') p.key('l');
  if (action === 'typing') p.input('new input');
  if (action === 'example') p.example();
  if (action === 'new-invalid') { p.input('invalid'); p.decode(); }
  await p.resolveAll();
  check('late verification cannot restore result after ' + action, p.node('csrd-results').hidden && p.node('csrd-results').innerHTML === '');
  check('late verification cannot replace status after ' + action, action === 'new-invalid' ? p.node('csrd-status').className.includes('error') : !p.node('csrd-status').textContent);
}
for (const mod of ['ctrlKey', 'metaKey']) {
  const p = page('en', true); p.example(); p.key('Enter', mod); await until(() => p.pending.length >= 1); await tick();
  check(mod + '+Enter invokes one decode with ToolLayout loaded', p.calls === 1);
  await p.resolveAll(); p.key('l', mod); await p.settle();
  check(mod + '+L clears the rendered result', p.node('csrd-results').hidden && p.node('csrd-results').innerHTML === '' && !p.node('csrd-status').textContent);
}

// Preserve the DER lengths while changing the displayed names. Its signature becomes invalid,
// which the real decoder can report; this makes an old and a new result distinguishable.
function newerPem(pem) {
  const body = Buffer.from(pem.replace(/-----[^\n]+-----/g, '').replace(/\s/g, ''), 'base64');
  const fresh = Buffer.from(body.toString('latin1').replaceAll('example.com', 'another.com'), 'latin1');
  return '-----BEGIN CERTIFICATE REQUEST-----\n' + fresh.toString('base64') + '\n-----END CERTIFICATE REQUEST-----';
}
for (const action of ['clear', 'shortcut', 'typing', 'example', 'new-invalid', 'new-decode', 'late-error']) {
  const p = page('en', false, true); p.example();
  const pem = p.node('csrd-input').value;
  p.decode(); await until(() => p.digests.length === 1);
  if (action === 'clear' || action === 'late-error') p.node('csrd-clear').click();
  if (action === 'shortcut') p.key('l');
  if (action === 'typing') p.input('new input');
  if (action === 'example') p.example();
  if (action === 'new-invalid') { p.input('invalid'); p.decode(); }
  let freshHtml;
  if (action === 'new-decode') {
    p.input(newerPem(pem)); p.decode();
    await until(() => !p.node('csrd-results').hidden);
    freshHtml = p.node('csrd-results').innerHTML;
    check('newer CSR is rendered before the old digest finishes', freshHtml.includes('another.com'));
  }
  if (action === 'late-error') p.digests[0].reject(new Error('old digest failure'));
  else await p.digests[0].resolve();
  await p.settle();
  check('late digest cannot overwrite ' + action, action === 'new-decode'
    ? p.node('csrd-results').innerHTML === freshHtml
    : p.node('csrd-results').hidden && p.node('csrd-results').innerHTML === '');
  check('late digest cannot change status after ' + action, action === 'new-decode'
    ? p.node('csrd-status').className.includes('success')
    : action === 'new-invalid' ? p.node('csrd-status').className.includes('error') : !p.node('csrd-status').textContent);
}
{
  const p = page('en', true); p.example();
  const pem = p.node('csrd-input').value;
  p.decode(); await until(() => p.pending.length === 1);
  p.input(newerPem(pem)); p.decode(); await until(() => p.pending.length === 2);
  p.pending[1].resolve(true); await until(() => !p.node('csrd-results').hidden);
  const freshHtml = p.node('csrd-results').innerHTML;
  p.pending[0].resolve(true); await p.settle();
  check('late verification cannot overwrite a newer completed decode', freshHtml.includes('another.com') && p.node('csrd-results').innerHTML === freshHtml);
}

// v2 page layout
{
  const markup = source.slice(source.indexOf('\n---', 3) + 4, source.indexOf('<script is:inline'));
  const style = source.match(/<style is:global>([\s\S]*?)<\/style>/)[1];
  check('tool root is the direct element', /^\s*<div class="csrd-wrap">/.test(markup));
  check('registered as analyze', readFileSync(root + 'src/data/tool-layouts.ts', 'utf8').includes("'csr-decoder': 'analyze'"));
  check('runtime i18n removed', !source.includes('data-i18n'));
  check('tips do not enter the script payload', source.includes('const { tips: TIPS, ...CLIENT_T } = T;') && source.includes('define:vars={{ t: CLIENT_T }}'));
  check('manual Decode retained', markup.includes('id="csrd-decode" class="btn-primary"'));
  check('three contextual tips rendered', [...markup.matchAll(/<Toggletip id="csrd-tip-/g)].length === 3);
  check('hidden result stays hidden', style.includes('.csrd-wrap [hidden] { display: none !important; }'));
  check('result scrolls within its allocated space', /\.csrd-results \{[^}]*flex: 1 1 0;[^}]*min-height: 0;[^}]*overflow: auto;/.test(style));
  check('860px stacking and 640px phone details', style.includes('@media (max-width: 860px)') && style.includes('@media (max-width: 640px)'));
  check('controls and reserved status precede input', markup.indexOf('id="csrd-decode"') < markup.indexOf('id="csrd-input"') && markup.indexOf('id="csrd-status"') < markup.indexOf('id="csrd-input"') && style.includes('min-height: 66px'));
  for (const lang of ['en','zh','ja','ko']) {
    check(lang + ' UI keys complete', Object.keys(STRINGS[lang]).sort().join() === Object.keys(STRINGS.en).sort().join());
    check(lang + ' three matching tips', Object.keys(STRINGS[lang].tips).join() === 'input,decode,results');
    for (const key of ['input','decode','results']) check(lang + ' ' + key + ' tip text', STRINGS[lang].tips[key].length > 15);
    const mdx = readFileSync(root + 'src/content/tools/csr-decoder/' + lang + '.mdx','utf8');
    const stepBlock = mdx.match(/steps:\n([\s\S]*?)faqItems:/)?.[1] || '';
    const steps = [...stepBlock.matchAll(/^  - (".*")$/gm)].map(m => JSON.parse(m[1]));
    check(lang + ' four bounded steps', steps.length === 4 && steps.every(v => v.length <= 280) && steps.join('').length <= 1200);
    check(lang + ' no old usage list', !/<h2>(?:How to check a CSR|检查 CSR 的步骤|CSR を点検する手順|CSR 점검 절차)<\/h2>/.test(mdx));
    check(lang + ' scope retained', /<h2>(?:Scope|能力范围|対応範囲|지원 범위)<\/h2>/.test(mdx));
  }
}

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
