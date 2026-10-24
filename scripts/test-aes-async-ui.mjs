// Read: AES's complete page script and markup, STRINGS, and ToolLayout's actual shortcuts.
// Write: stdout only. Synthetic inputs; no network, storage, or system clipboard access.
// Real Node Web Crypto runs unchanged behind controllable asynchronous boundaries.
// Run: node scripts/test-aes-async-ui.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import domino from '@mixmark-io/domino';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('src/components/tools/AesEncryptDecryptTool.astro', root), 'utf8');
const layout = readFileSync(new URL('src/layouts/ToolLayout.astro', root), 'utf8');
const script = source.match(/<script is:inline define:vars=\{\{ S: CLIENT_S \}\}>([\s\S]*?)<\/script>/)[1];
const stringsStart = source.indexOf('const STRINGS = {');
const strings = vm.runInNewContext(source.slice(stringsStart, source.indexOf('\n};', stringsStart) + 3) + ';STRINGS');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
let passes = 0, failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) passes++;
  else { failures++; console.log('FAIL: ' + label + (detail ? ' — ' + detail : '')); }
};
const eq = (label, actual, expected) => check(label, JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify({ actual, expected }));
const settle = () => new Promise(setImmediate);
const ORIGINAL = 'ORIGINAL_SYNTHETIC_MESSAGE';
const PASSWORD = 'synthetic-work-grade-password';
const te = new TextEncoder();

function open(lang = 'en', order = 'after', hold = 'deriveKey') {
  const S = strings[lang];
  const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  const markup = source.slice(source.indexOf('\n---\n', 4) + 5, source.indexOf('<script'))
    .replace(/<Toggletip\b[\s\S]*?<\/Toggletip>/g, '')
    .replace(/=\{L\.(\w+)\}/g, (_, key) => '="' + esc(S[key]) + '"')
    .replace(/\{L\.(\w+)\}/g, (_, key) => esc(S[key]));
  const document = domino.createWindow('<html lang="' + lang + '"><body><div class="tool-widget">' + markup + '</div></body></html>').document;
  const dispatch = (el, type, init = {}) => {
    const event = document.createEvent('Event');
    event.initEvent(type, true, true);
    for (const [key, value] of Object.entries(init)) Object.defineProperty(event, key, { value });
    el.dispatchEvent(event);
  };
  let active = document.body;
  Object.defineProperty(document, 'activeElement', { get: () => active });
  for (const el of document.querySelectorAll('*')) {
    Object.defineProperty(el, 'focus', { value: () => { active = el; } });
    Object.defineProperty(el, 'hidden', { configurable: true, get: () => el.hasAttribute('hidden'), set: value => value ? el.setAttribute('hidden', '') : el.removeAttribute('hidden') });
    Object.defineProperty(el, 'dataset', { configurable: true, value: new Proxy({}, {
      get: (_, key) => el.getAttribute('data-' + String(key).replace(/[A-Z]/g, c => '-' + c.toLowerCase())),
      set: (_, key, value) => { el.setAttribute('data-' + String(key).replace(/[A-Z]/g, c => '-' + c.toLowerCase()), value); return true; },
    }) });
    if (el.tagName === 'BUTTON') Object.defineProperty(el, 'click', { value: () => { if (!el.disabled) dispatch(el, 'click'); } });
  }
  const jobs = [], cryptoCalls = new Set(), downloads = [], revoked = [], tracks = [], clipboard = [], windowListeners = {};
  const subtle = {};
  for (const method of ['importKey', 'deriveKey', 'encrypt', 'decrypt']) {
    subtle[method] = (...args) => {
      let release, reject;
      const call = { held: method === hold };
      const gate = call.held ? new Promise((yes, no) => { release = yes; reject = no; }) : Promise.resolve();
      call.promise = gate.then(() => crypto.subtle[method](...args));
      cryptoCalls.add(call);
      call.promise.finally(() => cryptoCalls.delete(call)).catch(() => {});
      if (call.held) jobs.push({ call, release, reject });
      return call.promise;
    };
  }
  async function drain() {
    for (let i = 0; i < 50; i++) {
      await settle();
      const running = [...cryptoCalls].filter(call => !call.held);
      if (!running.length) { await settle(); return; }
      await Promise.allSettled(running.map(call => call.promise));
    }
    throw Error('Crypto did not settle');
  }
  const el = id => {
    const found = document.getElementById(id);
    if (!found) throw Error('Missing actual markup: ' + id);
    return found;
  };
  const context = {
    document, S, console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Blob, btoa, atob,
    crypto: { subtle, getRandomValues: crypto.getRandomValues.bind(crypto) },
    URL: {
      createObjectURL(blob) { const url = 'blob:synthetic/' + downloads.length; downloads.push({ url, blob }); return url; },
      revokeObjectURL(url) { revoked.push(url); },
    },
    navigator: { clipboard: { writeText(text) { clipboard.push(text); return Promise.resolve(); } } },
    trackTool: (...args) => tracks.push(args),
    ztPersist: { clear() {} },
    addEventListener: (type, fn) => { (windowListeners[type] ||= []).push(fn); },
    setTimeout: () => 1, clearTimeout() {},
  };
  context.window = context;
  vm.createContext(context);
  const shared = 'var _slug="aes-encrypt-decrypt";\n' + shortcut;
  if (order === 'before') vm.runInContext(shared, context);
  vm.runInContext(script, context, { filename: fileURLToPath(new URL('src/components/tools/AesEncryptDecryptTool.astro', root)) });
  if (order === 'after') vm.runInContext(shared, context);
  function input(id, value, type = 'input') { el(id).value = value; dispatch(el(id), type); }
  input('aes-password', PASSWORD);
  input('aes-plaintext', ORIGINAL);
  return {
    el, S, jobs, downloads, revoked, tracks, clipboard, drain,
    input, click: id => el(id).click(),
    key(meta = false) { el('aes-plaintext').focus(); dispatch(document, 'keydown', { key: 'l', ctrlKey: !meta, metaKey: meta }); },
    file(side, file) {
      const inputEl = el('aes-' + side + '-file-input');
      Object.defineProperty(inputEl, 'files', { configurable: true, value: [file] });
      dispatch(inputEl, 'change');
    },
    pagehide() { for (const fn of windowListeners.pagehide || []) fn(); },
    async waitJob(index = 0) {
      for (let i = 0; i < 100 && jobs.length <= index; i++) await settle();
      if (!jobs[index]) throw Error('Expected crypto boundary ' + index);
      return jobs[index];
    },
    async release(index = 0, error = null) {
      const job = await this.waitJob(index);
      job.call.held = false;
      if (error) job.reject(error); else job.release();
      await drain();
    },
  };
}
const state = p => ({
  plain: p.el('aes-plaintext').value,
  cipher: p.el('aes-ciphertext').value,
  status: p.el('aes-status').textContent,
  download: p.el('aes-download').hidden,
  busy: p.el('aes-encrypt').disabled,
  copyDisabled: p.el('aes-copy').disabled,
  tracks: p.tracks.length,
});

// The original browser repro, including both real listener orders for shared clear.
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  for (const order of ['before', 'after']) {
    const tag = lang + '/' + order;
    for (const mutation of ['edit', 'clear']) {
      const p = open(lang, order);
      p.click('aes-encrypt'); await p.waitJob();
      if (mutation === 'edit') p.input('aes-plaintext', 'REPLACEMENT_INPUT');
      else p.key(order === 'after');
      check(tag + '/' + mutation + ' immediately releases controls', !p.el('aes-encrypt').disabled);
      const expected = state(p);
      await p.release();
      eq(tag + '/' + mutation + ' stale completion changes nothing', state(p), expected);
      eq(tag + '/' + mutation + ' no stale ciphertext', p.el('aes-ciphertext').value, '');
      check(tag + '/' + mutation + ' empty ciphertext cannot be copied', p.el('aes-copy').disabled);
      if (mutation === 'clear') {
        eq(tag + ' clear plaintext', p.el('aes-plaintext').value, '');
        eq(tag + ' clear password', p.el('aes-password').value, '');
      }
    }
    const p = open(lang, order);
    p.click('aes-encrypt'); await p.release();
    check(tag + ' current encryption commits real ciphertext', p.el('aes-ciphertext').value.startsWith('v2:'));
    eq(tag + ' byte count is for the encrypted snapshot', p.el('aes-status').textContent, p.S.encrypted.replace('{n}', (te.encode(ORIGINAL).length).toLocaleString(lang)));
    eq(tag + ' successful encryption tracks once', p.tracks, [['aes-encrypt-decrypt', 'encrypt']]);
    p.click('aes-copy'); await settle();
    eq(tag + ' copy contains complete current ciphertext', p.clipboard, [p.el('aes-ciphertext').value]);
    p.input('aes-plaintext', '');
    p.click('aes-decrypt'); await p.release(1);
    eq(tag + ' real decryption round trip', p.el('aes-plaintext').value, ORIGINAL);
    eq(tag + ' successful decryption tracks once', p.tracks.at(-1), ['aes-encrypt-decrypt', 'decrypt']);
  }
}

// All settings that affect interpretation invalidate a pending operation.
for (const [id, value, type] of [
  ['aes-password', PASSWORD + '2', 'input'], ['aes-password', PASSWORD + '2', 'change'],
  ['aes-plaintext', 'edited', 'change'], ['aes-ciphertext', 'pasted ciphertext', 'input'],
  ['aes-rawkey', '00'.repeat(32), 'input'], ['aes-iv', '00'.repeat(12), 'input'],
  ['aes-aad', 'new context', 'input'], ['aes-mode', 'raw', 'change'],
  ['aes-keyfmt', 'text', 'change'], ['aes-encoding', 'hex', 'change'],
]) {
  const p = open();
  p.click('aes-encrypt'); await p.waitJob();
  p.input(id, value, type);
  const expected = state(p);
  await p.release();
  eq(id + '/' + type + ' old completion cannot commit', state(p), expected);
  check(id + '/' + type + ' controls available after edit', !p.el('aes-encrypt').disabled);
}

// Raw key modes keep the actual status/IV warning contract as well as the bytes.
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  for (const suppliedIv of [false, true]) {
    const p = open(lang, 'after', 'encrypt');
    p.input('aes-mode', 'raw', 'change');
    p.input('aes-rawkey', '01'.repeat(32));
    if (suppliedIv) { p.input('aes-iv', '02'.repeat(12)); p.input('aes-aad', 'synthetic context'); }
    p.click('aes-encrypt'); await p.release();
    const status = (suppliedIv ? p.S.encryptedIv : p.S.encryptedRaw).replace('{n}', te.encode(ORIGINAL).length.toLocaleString(lang))
      + (suppliedIv ? ' ' + p.S.ivWarning : '');
    eq(lang + '/raw/' + suppliedIv + ' actual success text', p.el('aes-status').textContent, status);
    p.input('aes-plaintext', '');
    p.click('aes-decrypt'); await p.drain();
    eq(lang + '/raw/' + suppliedIv + ' actual ciphertext round trip', p.el('aes-plaintext').value, ORIGINAL);
    p.key();
    check(lang + '/raw clear removes all secrets and state', ['aes-password', 'aes-rawkey', 'aes-iv', 'aes-aad', 'aes-plaintext', 'aes-ciphertext'].every(id => p.el(id).value === '') && p.el('aes-download').hidden && p.el('aes-status').hidden);
  }
}
{
  const p = open('en', 'after', 'encrypt');
  p.input('aes-mode', 'raw', 'change'); p.input('aes-rawkey', '01'.repeat(32));
  p.click('aes-encrypt'); await p.waitJob();
  p.click('aes-genkey');
  const expected = state(p);
  await p.release();
  eq('generating a new key invalidates pending work', state(p), expected);
}

// An old success or rejection may arrive while the replacement operation is waiting.
for (const lateError of [false, true]) {
  const p = open();
  p.click('aes-encrypt'); await p.waitJob();
  p.input('aes-plaintext', 'NEW_OPERATION');
  p.click('aes-encrypt');
  await p.drain();
  if (p.jobs.length < 2) {
    check('replacement operation starts while obsolete work waits', false);
    await p.release(); continue;
  }
  await p.waitJob(1);
  const expected = state(p);
  await p.release(0, lateError ? Error('obsolete failure') : null);
  eq('late ' + (lateError ? 'error' : 'success') + ' preserves new busy state', state(p), expected);
  await p.release(1);
  check('replacement ciphertext appears', p.el('aes-ciphertext').value.startsWith('v2:'));
  eq('only replacement success is tracked', p.tracks, [['aes-encrypt-decrypt', 'encrypt']]);
  p.input('aes-plaintext', '');
  p.click('aes-decrypt'); await p.release(2);
  eq('replacement ciphertext decrypts to replacement input', p.el('aes-plaintext').value, 'NEW_OPERATION');
}

// Decryption must not replace an edited plaintext/ciphertext, expose old binary
// downloads, or show an obsolete authentication error.
for (const mutation of ['plain', 'cipher', 'clear', 'password', 'pagehide']) {
  const p = open();
  p.click('aes-encrypt'); await p.release();
  p.input('aes-plaintext', '');
  p.click('aes-decrypt'); await p.waitJob(1);
  if (mutation === 'plain') p.input('aes-plaintext', 'keep my edit');
  if (mutation === 'cipher') p.input('aes-ciphertext', 'new ciphertext');
  if (mutation === 'clear') p.key();
  if (mutation === 'password') p.input('aes-password', 'new password');
  if (mutation === 'pagehide') p.pagehide();
  const expected = state(p);
  await p.release(1);
  eq('decrypt/' + mutation + ' stale completion changes nothing', state(p), expected);
}
{
  const p = open();
  p.click('aes-encrypt'); await p.waitJob();
  p.key();
  const expected = state(p);
  await p.release(0, Error('obsolete authentication failure'));
  eq('clear discards a late rejection', state(p), expected);
}
{
  const keyBytes = new Uint8Array(32).fill(1), iv = new Uint8Array(12).fill(2);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const binary = new Uint8Array([0xff, 0x00, 0x80, 0xfe]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, binary));
  const ciphertext = Buffer.concat([iv, encrypted]).toString('base64');
  for (const clear of [false, true]) {
    const p = open('en', 'after', 'decrypt');
    p.input('aes-mode', 'raw', 'change'); p.input('aes-rawkey', '01'.repeat(32));
    p.input('aes-ciphertext', ciphertext);
    p.click('aes-decrypt'); await p.waitJob();
    if (clear) p.key();
    const expected = state(p);
    await p.release();
    if (clear) {
      eq('cleared non-UTF-8 decrypt cannot recreate a download', state(p), expected);
      eq('no obsolete decrypted binary Blob', p.downloads.length, 0);
    } else {
      eq('current non-UTF-8 decrypt downloads real bytes', [...new Uint8Array(await p.downloads[0].blob.arrayBuffer())], [...binary]);
      eq('current non-UTF-8 decrypt shows localized byte count', p.el('aes-status').textContent, p.S.err_utf8.replace('{n}', String(binary.length)));
    }
  }
}

// File read is a second asynchronous boundary, preceding Web Crypto. Replacing
// the file must discard its bytes and retain the replacement's own name.
for (const kind of ['encrypt', 'decrypt']) {
  const p = open();
  let finishRead;
  const first = { name: 'original.bin' + (kind === 'decrypt' ? '.enc' : ''), size: 3, arrayBuffer: () => new Promise(resolve => { finishRead = resolve; }) };
  const side = kind === 'encrypt' ? 'plain' : 'cipher';
  p.file(side, first); p.click('aes-' + kind);
  p.file(side, { name: 'replacement.bin', size: 4, arrayBuffer: async () => te.encode('next').buffer });
  const expected = state(p);
  finishRead(te.encode('old').buffer); await p.drain();
  for (let i = 0; i < p.jobs.length; i++) await p.release(i);
  eq(kind + ' stale file read changes nothing', state(p), expected);
  eq(kind + ' stale file does not offer download', p.downloads.length, 0);
}
{
  const p = open();
  let rejectRead;
  p.file('plain', { name: 'unreadable.bin', size: 1, arrayBuffer: () => new Promise((_, reject) => { rejectRead = reject; }) });
  p.click('aes-encrypt'); p.key();
  const expected = state(p);
  rejectRead(Error('obsolete file read failure')); await p.drain();
  eq('late file read failure cannot change cleared page', state(p), expected);
}
{
  const p = open();
  p.file('plain', { name: 'original.bin', size: 3, arrayBuffer: async () => te.encode('old').buffer });
  p.click('aes-encrypt'); await p.waitJob();
  p.file('plain', { name: 'replacement.bin', size: 4, arrayBuffer: async () => te.encode('next').buffer });
  const expected = state(p);
  await p.release();
  eq('file change during crypto discards old result', state(p), expected);
  p.click('aes-encrypt'); await p.waitJob(1); await p.release(1);
  eq('download uses the processed file name', p.el('aes-download').dataset.name, 'replacement.bin.enc');
  eq('only current file action is tracked', p.tracks, [['aes-encrypt-decrypt', 'encrypt-file']]);
  const bytes = new Uint8Array(await p.downloads.at(-1).blob.arrayBuffer());
  p.file('cipher', { name: 'replacement.bin.enc', size: bytes.length, arrayBuffer: async () => bytes.buffer });
  p.click('aes-decrypt'); await p.waitJob(2); await p.release(2);
  eq('decrypted download restores the file name', p.el('aes-download').dataset.name, 'replacement.bin');
  eq('real decrypted download bytes', new TextDecoder().decode(await p.downloads.at(-1).blob.arrayBuffer()), 'next');
  p.key();
  check('clear revokes the existing download', p.revoked.includes(p.downloads.at(-1).url));
  check('clear hides download and disables empty copy', p.el('aes-download').hidden && p.el('aes-copy').disabled);
}

console.log(`AES async UI: ${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
