// cURL to Code — the generated code sends the same request as curl
//
// Read:  src/components/tools/CurlToCodeTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); src/content/tools/curl-to-code/{en,zh,ja,ko}.mdx
//        (the Python and Go examples must be what the engine generates)
// Write: stdout; a temporary directory under os.tmpdir() with the upload files and the
//        generated programs (removed at the end)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Oracle: curl itself. Each case is sent once with the real `curl` binary and once with each
// generated program to a local HTTP server on 127.0.0.1 (no outside network). The server
// records method, path with query, headers and body; multipart bodies are compared part by
// part (name, filename, explicit type, bytes) because the boundary differs. Runtimes:
//   Python  python3 with requests      (SKIP if missing)
//   Go      go run                      (SKIP if missing)
//   JS      the fetch code, run in this Node process with a stub `document` for file inputs
//   Node.js `node --check` as an ES module (axios is not installed, so it is not run)
//   PHP     `php -l` when php is installed (SKIP otherwise)
// Parser rules checked against the curl manual (curl.1, curl 8.x): several -d pieces are
// joined with "&", -G moves them to the query string, --json sets Content-Type and Accept and
// joins pieces without a separator, --data-urlencode encodes the content, -F name=@file uploads
// the file, name=<file sends its text, -d @file drops CR and LF, options that take a value
// never become the URL.
//
// Run: node scripts/test-curl-to-code.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';

import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { transformSync } from 'esbuild';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import php from 'highlight.js/lib/languages/php';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CurlToCodeTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in CurlToCodeTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { tokenize, parseCurl, genPython, genJavaScript, genGo, genPhp, genNodejs };')();

let failures = 0;
let passes = 0;
let skips = 0;
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
function skip(name) { skips++; if (process.env.VERBOSE) console.log('SKIP: ' + name); }

// ---------- tokenizer: bash quoting as written by "Copy as cURL (bash)" ----------
eq('adjacent quoted and unquoted parts are one word', E.tokenize(`curl 'it'\\''s' "a"b`), ['curl', "it's", 'ab']);
eq("$'...' ANSI-C quoting", E.tokenize(`curl --data-raw $'{"a":"x\\u00e9\\n\\'"}'`), ['curl', '--data-raw', '{"a":"xé\n\'"}']);
eq('backslash outside quotes', E.tokenize('curl a\\ b'), ['curl', 'a b']);
eq('double quotes keep backslash before other characters', E.tokenize('curl "a\\nb\\"c\\$"'), ['curl', 'a\\nb"c$']);
eq('line continuation', E.tokenize('curl \\\n  -s \\\r\n  x'), ['curl', '-s', 'x']);

// ---------- parser ----------
const P = (cmd) => E.parseCurl(cmd);
eq('several -d pieces are joined with &', P('curl -d a=1 -d b=2 http://h/').body, { kind: 'text', text: 'a=1&b=2' });
eq('-d sets the urlencoded Content-Type', P('curl -d a=1 http://h/').headers, ['Content-Type: application/x-www-form-urlencoded']);
eq('a Content-Type given with -H wins', P('curl -H "content-type: text/plain" -d a=1 http://h/').headers, ['content-type: text/plain']);
{
  const p = P('curl -G -d q=hello -d page=2 http://h/search?x=1');
  eq('-G moves data to the query string', [p.method, p.url, p.body], ['GET', 'http://h/search?x=1&q=hello&page=2', null]);
}
{
  const p = P(`curl --json '{"a":1}' --json '{"b":2}' https://h/api`);
  eq('--json: POST, body joined without &', [p.method, p.body], ['POST', { kind: 'text', text: '{"a":1}{"b":2}' }]);
  eq('--json: headers', p.headers, ['Content-Type: application/json', 'Accept: application/json']);
  eq('--json: the URL is not the JSON', p.url, 'https://h/api');
}
eq('--data-urlencode forms', P('curl --data-urlencode "q=a b&c" --data-urlencode "=x y" --data-urlencode "é" http://h/').body.text, 'q=a+b%26c&x+y&%C3%A9');
eq('--data-raw keeps a leading @', P('curl --data-raw @x http://h/').body, { kind: 'text', text: '@x' });
eq('-d @file reads the file and drops CR / LF', P('curl -d @body.txt http://h/').body, { kind: 'file', path: 'body.txt', strip: true });
eq('--data-binary @file keeps the bytes', P('curl --data-binary @b.bin http://h/').body, { kind: 'file', path: 'b.bin', strip: false });
{
  const p = P('curl -F title="Q1 Report" -F "file=@report.pdf;type=application/pdf" -F "note=<note.txt" --form-string "raw=@x" http://h/up');
  eq('-F parts', p.form, [
    { name: 'title', value: 'Q1 Report' },
    { name: 'file', file: 'report.pdf', filename: 'report.pdf', type: 'application/pdf' },
    { name: 'note', textFile: 'note.txt' },
    { name: 'raw', value: '@x' },
  ]);
  check('-F: no Content-Type header without a boundary', !p.headers.some((h) => /^content-type/i.test(h)), JSON.stringify(p.headers));
  eq('-F: method POST', p.method, 'POST');
}
eq('-F filename= overrides the name', P('curl -F "f=@a/b.txt;filename=c.txt" http://h/').form[0], { name: 'f', file: 'a/b.txt', filename: 'c.txt', type: null });
eq('-F quoted value keeps ;', P(`curl -F 'k="a;b"' http://h/`).form[0], { name: 'k', value: 'a;b' });
{
  const p = P('curl --connect-timeout 5 -m 10 -o out.json --retry 3 https://api.example.com/x');
  eq('values of unconverted options are not the URL', p.url, 'https://api.example.com/x');
  eq('unconverted options are listed', p.notes, ['--connect-timeout 5', '-m 10', '--retry 3']);
}
eq('-sSL is three options', [P('curl -sSL http://h/').followRedirects, P('curl -sSL http://h/').url], [true, 'http://h/']);
eq('-XPUT attached value', P('curl -XPUT http://h/').method, 'PUT');
eq("-H'X: y' attached value", P("curl -H'X: y' http://h/").headers, ['X: y']);
eq('-I is HEAD', P('curl -I http://h/').method, 'HEAD');
eq('URL without a scheme gets http://', P('curl example.com/a').url, 'http://example.com/a');
eq('-u with UTF-8', P('curl -u "jörg:pä ss" http://h/').headers, ['Authorization: Basic ' + Buffer.from('jörg:pä ss').toString('base64')]);
eq('-A and -e', P('curl -A ua/1 -e https://r/ http://h/').headers, ['User-Agent: ua/1', 'Referer: https://r/']);
eq('--oauth2-bearer', P('curl --oauth2-bearer T http://h/').headers, ['Authorization: Bearer T']);
eq('-b with name=value is a Cookie header', P('curl -b "a=1; b=2" http://h/').headers, ['Cookie: a=1; b=2']);
eq('-b without = is a cookie file, not converted', P('curl -b cookies.txt http://h/').notes, ['-b cookies.txt']);
eq('unknown option is an error', P('curl --no-such-option http://h/').error, 'unknownOption');
eq('-d with -F is an error, as in curl', P('curl -d a=1 -F b=2 http://h/').error, 'dataAndForm');
eq('missing value is an error', P('curl http://h/ -H').error, 'missingValue');
eq('no URL', P('curl -s'), null);
eq('not curl', P('wget http://h/'), null);
eq('--no-progress-meter is a known boolean', P('curl --no-progress-meter http://h/').url, 'http://h/');
eq('--url-query', P('curl --url-query "q=a b" --url-query +r=%20 http://h/p').url, 'http://h/p?q=a+b&r=%20');

// ---------- end-to-end against curl ----------
const tmp = mkdtempSync(join(tmpdir(), 'ctc-test-'));
writeFileSync(join(tmp, 'report.pdf'), Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0d, 0x0a, 0x41]));
writeFileSync(join(tmp, 'note.txt'), 'line one\nline two');
writeFileSync(join(tmp, 'body.txt'), 'a=1\r\n&b=2\n');
writeFileSync(join(tmp, 'b.bin'), Buffer.from([0, 1, 2, 13, 10, 255]));

const received = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    received.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    if (req.url.startsWith('/redirect')) { res.writeHead(302, { Location: '/target' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(req.method === 'HEAD' ? undefined : 'ok');
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: tmp, ...opts });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ status: -1, out, err: String(e) }));
    child.on('close', (status) => resolve({ status, out, err }));
  });
}
async function capture(fn) {
  const before = received.length;
  const r = await fn();
  return { result: r, requests: received.slice(before) };
}

function multipartParts(req) {
  const m = /boundary=("?)([^";]+)\1/.exec(req.headers['content-type'] || '');
  if (!m) return null;
  const sep = Buffer.from('--' + m[2]);
  const parts = [];
  let pos = req.body.indexOf(sep);
  while (pos >= 0) {
    const start = pos + sep.length;
    if (req.body.slice(start, start + 2).toString() === '--') break;
    const next = req.body.indexOf(sep, start);
    const raw = req.body.slice(start + 2, next - 2);
    const headEnd = raw.indexOf('\r\n\r\n');
    const head = raw.slice(0, headEnd).toString();
    const disp = /content-disposition:[^\r\n]*/i.exec(head)[0];
    const name = /name="([^"]*)"/.exec(disp)[1];
    const fn = /filename="([^"]*)"/.exec(disp);
    parts.push({ name, filename: fn ? fn[1] : null, data: raw.slice(headEnd + 4).toString('base64') });
    pos = next;
  }
  return parts;
}
function summary(req, keyHeaders) {
  const s = { method: req.method, url: req.url };
  const ct = req.headers['content-type'] || null;
  s.contentType = ct && ct.split(';')[0].trim().toLowerCase();
  const parts = multipartParts(req);
  if (parts) s.parts = parts; else s.body = req.body.toString('base64');
  for (const h of keyHeaders) s[h] = req.headers[h] || null;
  return s;
}

const haveCurl = spawnSync('curl', ['--version']).status === 0;
const havePython = spawnSync('python3', ['-c', 'import requests']).status === 0;
const haveGo = spawnSync('go', ['version']).status === 0;
const havePhp = spawnSync('php', ['-v']).status === 0;
if (!haveCurl) console.log('SKIP: curl not installed; end-to-end checks need it as the reference');

// A stub `document` for the browser fetch code: the file input returns the named files.
function runFetchCode(code, fileNames) {
  const files = fileNames.map((n) => new File([readFileSync(join(tmp, n))], n));
  const document = { querySelector: () => ({ files }) };
  const fn = new Function('document', 'fetch', 'FormData', 'console', 'return (async () => {\n' + code + '\n})();');
  return fn(document, fetch, FormData, { log() {} });
}

let programCount = 0;
async function endToEnd(name, curlArgs, opts = {}) {
  const cmd = 'curl ' + curlArgs;
  const parsed = E.parseCurl(cmd);
  check(name + ': parses', parsed && !parsed.error, JSON.stringify(parsed));
  if (!parsed || parsed.error) return;
  if (!haveCurl) { skip(name); return; }
  const keyHeaders = opts.headers || [];
  // `bash -c` so the command is split by a real shell as a user would run it (bash, not sh:
  // Ubuntu's sh is dash, which does not read the $'...' quoting that DevTools writes).
  const ref = await capture(() => run('bash', ['-c', cmd + ' -s -o /dev/null']));
  check(name + ': curl ran', ref.result.status === 0, ref.result.err);
  const expected = ref.requests.map((r) => summary(r, keyHeaders));

  const compare = (lang, got) => eq(name + ': ' + lang + ' sends the same request(s) as curl', got.requests.map((r) => summary(r, keyHeaders)), expected);

  if (havePython) {
    const f = join(tmp, 'p' + (++programCount) + '.py');
    writeFileSync(f, E.genPython(parsed));
    const got = await capture(() => run('python3', ['-W', 'ignore', f]));
    check(name + ': Python ran', got.result.status === 0, got.result.err + '\n' + readFileSync(f, 'utf8'));
    compare('Python', got);
  } else skip(name + ' Python');

  if (haveGo) {
    const f = join(tmp, 'g' + (++programCount) + '.go');
    writeFileSync(f, E.genGo(parsed));
    const got = await capture(() => run('go', ['run', f], { env: { ...process.env, GOFLAGS: '-mod=mod', GO111MODULE: 'off' } }));
    check(name + ': Go ran', got.result.status === 0, got.result.err + '\n' + readFileSync(f, 'utf8'));
    compare('Go', got);
  } else skip(name + ' Go');

  if (!opts.noFetch) {
    const before = received.length;
    let err = null;
    try { await runFetchCode(E.genJavaScript(parsed), opts.files || []); } catch (e) { err = e; }
    check(name + ': JavaScript ran', !err, String(err) + '\n' + E.genJavaScript(parsed));
    // FormData sends text values with CRLF line breaks (HTML multipart/form-data encoding
    // algorithm), so a field read with name=<file differs from curl there and only there.
    const got = received.slice(before).map((r) => summary(r, keyHeaders));
    const want = opts.fetchCrlf ? expected.map((x) => ({ ...x, parts: x.parts.map((pt) => pt.filename === null
      ? { ...pt, data: Buffer.from(Buffer.from(pt.data, 'base64').toString('latin1').replace(/\r?\n/g, '\r\n'), 'latin1').toString('base64') }
      : pt) })) : expected;
    eq(name + ': JavaScript sends the same request(s) as curl', got, want);
  }

  const nodeFile = join(tmp, 'n' + (++programCount) + '.mjs');
  writeFileSync(nodeFile, E.genNodejs(parsed));
  const nodeCheck = spawnSync(process.execPath, ['--check', nodeFile], { encoding: 'utf8' });
  check(name + ': Node.js output is a valid ES module', nodeCheck.status === 0, nodeCheck.stderr + '\n' + readFileSync(nodeFile, 'utf8'));
  check(name + ': Node.js output imports axios as an ES module', /^import axios from 'axios';/m.test(E.genNodejs(parsed)) && !/require\(/.test(E.genNodejs(parsed)));

  if (havePhp) {
    const f = join(tmp, 'h' + (++programCount) + '.php');
    writeFileSync(f, E.genPhp(parsed));
    const lint = spawnSync('php', ['-l', f], { encoding: 'utf8' });
    check(name + ': PHP lint', lint.status === 0, lint.stdout + lint.stderr);
  } else skip(name + ' PHP');
}

await endToEnd('JSON POST', `-X POST ${base}/users -H "Content-Type: application/json" -H "Authorization: Bearer TOKEN" -d '{"name": "Alice", "email": "alice@example.com"}'`, { headers: ['authorization'] });
await endToEnd('several -d', `${base}/form -d a=1 -d 'b=two words' -d c=é`);
await endToEnd('-G', `-G ${base}/search -d q=hello -d page=2`);
await endToEnd('--json', `--json '{"a":1}' --json '{"b":"é"}' ${base}/api`, { headers: ['accept'] });
await endToEnd('--data-urlencode', `${base}/e --data-urlencode "q=a b&c=d" --data-urlencode "=x/y"`);
await endToEnd('-F with files', `${base}/upload -F title="Q1 Report" -F "file=@report.pdf;type=application/pdf" -F "note=<note.txt"`, { files: ['report.pdf', 'note.txt'], fetchCrlf: true });
await endToEnd('-d @file', `${base}/f -d @body.txt`, { files: ['body.txt'] });
await endToEnd('--data-binary @file', `${base}/b --data-binary @b.bin -H "Content-Type: application/octet-stream"`, { files: ['b.bin'] });
await endToEnd('-u, -A, -b', `-u 'alice:s3cret' -A 'ua/1.0' -b 'sid=abc; x=1' ${base}/auth`, { headers: ['authorization', 'user-agent', 'cookie'] });
await endToEnd('PUT with a custom header', `-XPUT -H'X-Trace: 42' ${base}/items/7 --data-raw '@not-a-file'`, { headers: ['x-trace'] });
await endToEnd('HEAD', `-I ${base}/h`);
await endToEnd('no -L: the redirect is not followed', `${base}/redirect`, { noFetch: true });
await endToEnd('-L: the redirect is followed', `-sSL ${base}/redirect`);
await endToEnd('unconverted options', `--connect-timeout 5 --retry 2 -o /dev/null ${base}/t`);
await endToEnd('Chrome bash quoting', `'${base}/c?x=1' -H 'accept: */*' -H $'x-q: it\\'s' --data-raw $'{"s":"line\\nnext"}'`, { headers: ['x-q'] });

server.close();

// ---------- tool page examples ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/curl-to-code/' + lang + '.mdx'), 'utf8');
  const input = /```bash\n([\s\S]*?)\n```/.exec(mdx);
  const py = /```python\n([\s\S]*?)\n```/.exec(mdx);
  const go = /```go\n([\s\S]*?)\n```/.exec(mdx);
  check(lang + ': page has the example', !!(input && py && go));
  if (input && py && go) {
    const p = E.parseCurl(input[1]);
    eq(lang + ': Python example matches the engine', py[1], E.genPython(p));
    eq(lang + ': Go example matches the engine', go[1], E.genGo(p));
  }
}

// ---------- STRINGS ----------
{
  const m = source.match(/var STRINGS = (\{[\s\S]*?\n    \});/);
  check('STRINGS block found', !!m);
  if (m) {
    const S = new Function('return ' + m[1])();
    const keys = Object.keys(S.en).sort().join();
    for (const lang of ['zh', 'ja', 'ko']) eq(lang + ': same STRINGS keys as en', Object.keys(S[lang]).sort().join(), keys);
  }
}


// ---------- real complete page lifecycle; controlled DOM, clipboard and clock boundaries ----------
const pageScript = transformSync(source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1].replace(/^\s*import .* from .*;$/gm, ''), { loader: 'ts' }).code;
const pageLabels = vm.runInNewContext('(' + source.match(/var STRINGS = (\{[\s\S]*?\n\s*\});/)[1] + ')');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes("document.addEventListener('keydown'")) throw Error('Shared shortcut not found');
const engineLines = source.slice(source.lastIndexOf('\n', startIndex) + 1, endIndex + END_MARK.length);
eq('protected engine byte count', Buffer.byteLength(engineLines), 33988);
eq('protected engine SHA256', createHash('sha256').update(engineLines).digest('hex'), "0e32cab3837ffc02517b55d10e461dae190d0a55b39baebb392e64cf04b9e62e");
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const onUnhandled = reason => unhandled.push(String(reason));
process.on('unhandledRejection', onUnhandled);
function page(lang, shellFirst = false) {
  const copies = [], tracks = [], clears = [], timers = new Map(), docEvents = {};
  let now = 0, timerId = 0, doc;
  const decode = s => s.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const descendants = el => el.children.flatMap(c => [c, ...descendants(c)]);
  function matches(el, selector) {
    return selector.split(',').some(part => {
      const words = part.trim().split(/\s+/);
      if (words.length > 1) {
        if (!matches(el, words.pop())) return false;
        for (let p = el.parentElement; p; p = p.parentElement) if (matches(p, words.join(' '))) return true;
        return false;
      }
      const tag = /^[a-z][\w-]*/i.exec(part)?.[0], id = /#([\w-]+)/.exec(part)?.[1];
      return (!tag || el.tagName === tag.toUpperCase()) && (!id || el.id === id)
        && [...part.matchAll(/\.([\w-]+)/g)].every(m => el.classList.contains(m[1]))
        && [...part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(m => m[2] === undefined ? m[1] in el.attributes : el.attributes[m[1]] === m[2]);
    });
  }
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), attributes: {}, dataset: {}, listeners: {}, children: [], parentElement: null, className: '', value: '', textContent: '', checked: false, hidden: false }); }
    setAttribute(key, value) {
      this.attributes[key] = value;
      if (['id', 'type', 'value'].includes(key)) this[key] = value;
      if (key === 'class') this.className = value;
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    getAttribute(key) { return this.attributes[key] ?? null; }
    removeAttribute(key) { delete this.attributes[key]; if (key.startsWith('data-')) delete this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; }
    get parentNode() { return this.parentElement; }
    set innerHTML(value) { this.renderedHTML = value; }
    get innerHTML() { return this.renderedHTML ?? ''; }
    get classList() { const e = this; return { contains(c) { return e.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) e.className += ' ' + c; }, remove(c) { e.className = e.className.split(/\s+/).filter(v => v !== c).join(' '); } }; }
    appendChild(e) { this.children.push(e); e.parentElement = this; }
    querySelectorAll(s) { return descendants(this).filter(e => matches(e, s)); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    contains(e) { return this === e || descendants(this).includes(e); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type) { for (const fn of this.listeners[type] || []) fn.call(this, { target: this, type, preventDefault() {} }); }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { doc.activeElement = this; }
  }
  const body = new Element('body'), widget = new Element('section'); widget.className = 'tool-widget'; body.appendChild(widget);
  const markup = source.split('\n---')[1].split('<script')[0];
  const stack = [widget];
  for (const token of markup.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>|([^<]+)/g)) {
    if (token[3] !== undefined) { stack.at(-1).textContent += decode(token[3]).trim(); continue; }
    if (token[0].startsWith('</')) { if (stack.at(-1).tagName !== token[1].toUpperCase()) throw Error('Unbalanced real markup'); stack.pop(); continue; }
    const el = new Element(token[1]);
    for (const a of token[2].matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)) el.setAttribute(a[1], decode(a[2] ?? a[3]));
    el.hidden = /(?:^|\s)hidden(?:\s|$)/.test(token[2]);
    stack.at(-1).appendChild(el);
    if (!['input', 'br', 'hr'].includes(token[1]) && !token[2].endsWith('/')) stack.push(el);
  }
  const get = id => { const el = descendants(body).find(e => e.id === id); if (!el) throw Error('Missing real ID ' + id); return el; };
  doc = { body, documentElement: { lang }, activeElement: body, getElementById: get, querySelector: s => body.querySelector(s), querySelectorAll: s => body.querySelectorAll(s), addEventListener(type, fn) { (docEvents[type] ||= []).push(fn); } };
  const context = { document: doc, _slug: 'curl-to-code', console, hljs, javascript, python, go, php,
    trackTool: (...args) => tracks.push(args), ztPersist: { clear: slug => clears.push(slug) },
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); copies.push({ value, resolve, reject }); return promise; } } },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, due: now + ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
  };
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(pageScript, context, { filename: 'CurlToCodeTool.astro' });
  if (!shellFirst) vm.runInContext(shortcut, context);
  return { get, context, copies, tracks, clears, timers, doc,
    input(value) { get('ctc-input').value = value; get('ctc-input').dispatch('input'); },
    key(id = 'ctc-input', key = 'l', modifier = 'ctrlKey') { (typeof id === 'string' ? get(id) : id || body).focus(); const e = { key, [modifier]: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; for (const fn of docEvents.keydown || []) fn(e); return e; },
    advance(ms) { const end = now + ms; for (;;) { const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0]; if (!next) break; timers.delete(next[0]); now = next[1].due; next[1].fn(); } now = end; },
  };
}
const output = p => p.get('ctc-output-code').textContent;
const status = p => p.get('ctc-status');
const snapshot = p => JSON.stringify(["ctc-input", "ctc-output-code", "ctc-status", "ctc-copy"].map(id => { const e = p.get(id); return [e.value, e.checked, e.textContent, e.className, e.hidden]; }));
const goldenInput = "curl https://example.com/api", nextInput = "curl https://example.com/next", invalidInput = "not curl";
const runPage = (p, value = goldenInput) => { p.input(value); p.get('ctc-convert').click(); };
const goldenCode = "import requests\n\nresponse = requests.get(\n    \"https://example.com/api\",\n    allow_redirects=False,\n)\nprint(response.text)";
const copy = p => { p.get('ctc-copy').click(); return p.copies.at(-1); };
const copyFailure = {
  en: 'Copy failed. Please copy the output manually.', zh: '复制失败，请手动复制输出。',
  ja: 'コピーに失敗しました。出力を手動でコピーしてください。', ko: '복사하지 못했습니다. 출력을 직접 복사하세요.',
};
try {
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const L = pageLabels[lang], p = page(lang);
    runPage(p); eq(lang + ': real page golden bytes', output(p), goldenCode);
    p.input(nextInput); p.advance(500); eq(lang + ': typing remains manual', output(p), goldenCode);
    const converted = p.tracks.length; p.key('ctc-input', 'Enter'); eq(lang + ': shared Enter converts once', p.tracks.length, converted + 1); check(lang + ': new manual output', output(p) !== goldenCode);
    for (const shellFirst of [false, true]) for (const modifier of ['ctrlKey', 'metaKey']) {
      const q = page(lang, shellFirst); runPage(q);
      const prefix = lang + ': shared clear ' + shellFirst + '/' + modifier;
      const outside = snapshot(q); q.key(null, 'l', modifier); eq(prefix + ' outside unchanged', snapshot(q), outside);
      q.input(invalidInput); q.key('ctc-copy', 'L', modifier);
      check(prefix + ' clears input/output/status/error', !q.get('ctc-input').value && !output(q) && !status(q).textContent && !q.get('ctc-input').classList.contains('error'));
      check(prefix + ' restores input focus', q.doc.activeElement === q.get('ctc-input'));
      eq(prefix + ' cancels timers', q.timers.size, 0);
      eq(prefix + ' shared storage clear once', q.clears.join(','), 'curl-to-code');
      q.doc.querySelector('[data-lang="javascript"]').click(); eq(prefix + ' tab cannot revive cache', output(q), '');
      const cleared = snapshot(q); q.advance(1600); eq(prefix + ' remains clear', snapshot(q), cleared);
    }
    const invalid = page(lang); runPage(invalid); runPage(invalid, invalidInput);
    check(lang + ': invalid input positive control', !!status(invalid).textContent && !status(invalid).hidden);
    eq(lang + ': invalid input clears previous output', output(invalid), '');
    runPage(invalid, '');
    check(lang + ': empty removes error/output/status', !invalid.get('ctc-input').classList.contains('error') && !output(invalid) && !status(invalid).textContent);
    runPage(invalid, invalidInput); invalid.get('ctc-clear').click();
    check(lang + ': Clear removes invalid state', !status(invalid).textContent && !output(invalid) && !invalid.get('ctc-input').classList.contains('error'));
    check(lang + ': Clear focuses input', invalid.doc.activeElement === invalid.get('ctc-input'));
    const q = page(lang); runPage(q);
    const good = copy(q); eq(lang + ': Copy exact output bytes', good.value, goldenCode); good.resolve(); await settle();
    eq(lang + ': current copy succeeds', q.get('ctc-copy').textContent, L.copied); q.advance(1500); eq(lang + ': current timer restores Copy', q.get('ctc-copy').textContent, L.copy);
    const failuresBefore = unhandled.length; copy(q).reject(Error('denied')); await settle();
    eq(lang + ': localized current rejection', status(q).textContent, copyFailure[lang]);
    check(lang + ': copy failure visible', !status(q).hidden);
    eq(lang + ': rejection handled', unhandled.length, failuresBefore);
    const retry = copy(q); eq(lang + ': retry identical output', retry.value, goldenCode); retry.resolve(); await settle();
    eq(lang + ': direct retry succeeds', q.get('ctc-copy').textContent, L.copied);
    check(lang + ': direct retry clears copy failure', status(q).textContent !== copyFailure[lang]);
    for (const missing of ['clipboard', 'writeText', 'throw']) {
      const r = page(lang); runPage(r);
      r.context.navigator.clipboard = missing === 'clipboard' ? undefined : missing === 'writeText' ? {} : { writeText() { throw Error('unavailable'); } };
      let thrown; try { r.get('ctc-copy').click(); } catch (e) { thrown = e; }
      check(lang + ': unavailable API handled ' + missing, !thrown);
      eq(lang + ': unavailable API visible ' + missing, status(r).textContent, copyFailure[lang]);
      eq(lang + ': unavailable API never claims copied ' + missing, r.get('ctc-copy').textContent, L.copy);
    }
    for (const action of ["input", "clear", "shortcut", "result", "error", "example", "tab"]) for (const outcome of ['resolve', 'reject', 'timer']) {
      const r = page(lang); runPage(r); const old = copy(r); let oldTimer;
      if (outcome === 'timer') { old.resolve(); await settle(); oldTimer = [...r.timers.values()].find(t => t.due === 1500)?.fn; }
      if (action === 'input') r.input(nextInput);
      if (action === 'clear') r.get('ctc-clear').click();
      if (action === 'shortcut') r.key();
      if (action === 'result') runPage(r, nextInput);
      if (action === 'error') runPage(r, invalidInput);
      if (action === 'example') r.get('ctc-example').click();
      if (action === 'tab') r.doc.querySelector('[data-lang="javascript"]').click();
      const before = snapshot(r), rejectedBefore = unhandled.length;
      // Replay a captured callback even after cancellation to verify obsolete work cannot write.
      if (outcome === 'timer') { check(lang + ': real feedback timer captured ' + action, !!oldTimer); oldTimer?.(); }
      else { old[outcome](Error('late')); await settle(); }
      eq(lang + ': stale ' + action + '/' + outcome, snapshot(r), before);
      eq(lang + ': stale rejection handled ' + action + '/' + outcome, unhandled.length, rejectedBefore);
    }
    const t = page(lang); runPage(t); copy(t).resolve(); await settle(); t.advance(1000); copy(t).resolve(); await settle(); t.advance(500);
    eq(lang + ': old timer cannot overwrite newer Copied', t.get('ctc-copy').textContent, L.copied);
    t.advance(1000); eq(lang + ': latest timer expires normally', t.get('ctc-copy').textContent, L.copy);
    const order = page(lang); runPage(order); const first = copy(order), second = copy(order); second.reject(Error('current')); await settle(); first.resolve(); await settle();
    eq(lang + ': older success preserves newer error', status(order).textContent, copyFailure[lang]);
    eq(lang + ': older success cannot claim copied', order.get('ctc-copy').textContent, L.copy);
    const reverse = page(lang); runPage(reverse); const older = copy(reverse), newer = copy(reverse); newer.resolve(); await settle(); const fresh = snapshot(reverse); older.reject(Error('late')); await settle();
    eq(lang + ': older rejection preserves newer success', snapshot(reverse), fresh);
  }
} finally { await settle(); process.removeListener('unhandledRejection', onUnhandled); }
eq('no unhandled clipboard rejections', unhandled.length, 0);

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passes} passed, ${failures} failed` + (skips ? `, ${skips} skipped` : ''));
process.exit(failures ? 1 : 0);
