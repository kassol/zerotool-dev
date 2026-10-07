// Docker run to Compose — every docker run option is parsed with its value, named volumes are declared
//
// Read:  src/components/tools/DockerToComposeTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); src/content/tools/docker-to-compose/{en,zh,ja,ko}.mdx
//        (each ```bash block that is followed by a ```yaml block must convert to that YAML)
// Write: stdout; temporary compose projects under os.tmpdir() (removed at the end)
// Exit:  0 if all PASS, 1 if any FAIL
//
// The option table follows `docker run --help` of Docker CLI 29.4: options that take a value
// consume the next token (or the text after `=`, or the rest of a short-option group), so a
// value is never read as the image name. Options with a Compose service key are converted
// (Compose Specification, services reference); the rest are listed as not converted. Named
// volumes in -v are declared in a top-level `volumes:` section. When `docker compose` is
// installed (local Docker Desktop, GitHub ubuntu runners), every generated file is checked
// with `docker compose config`; without it those checks are SKIP.
//
// Run: node scripts/test-docker-to-compose.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

import vm from 'node:vm';
import { createHash } from 'node:crypto';

import { createRequire } from 'node:module';
import { transform as esbuildTransform } from 'esbuild';
import { compile as compileMdx } from '@mdx-js/mdx';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/DockerToComposeTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in DockerToComposeTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { parseDockerRun, generateCompose };')();

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

function convert(cmd) {
  const parsed = E.parseDockerRun(cmd);
  if (!parsed || parsed.error) return { parsed, yaml: null, doc: null };
  const text = E.generateCompose(parsed);
  return { parsed, yaml: text, doc: yaml.load(text) };
}
function service(doc) {
  const names = Object.keys(doc.services);
  return doc.services[names[0]];
}

// ---------- docker compose config ----------
const compose = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
const haveCompose = compose.status === 0;
if (!haveCompose) console.log('SKIP: docker compose not installed; generated files are only parsed with js-yaml');
const tmp = mkdtempSync(join(tmpdir(), 'dtc-test-'));
writeFileSync(join(tmp, '.env'), 'A=1\n');
writeFileSync(join(tmp, 'app.env'), 'B=2\n');
let projectCount = 0;
function composeAccepts(name, text) {
  if (!haveCompose) { skips++; return; }
  const file = join(tmp, 'compose-' + (++projectCount) + '.yaml');
  writeFileSync(file, text);
  const r = spawnSync('docker', ['compose', '-f', file, '--project-directory', tmp, 'config', '--quiet'], { encoding: 'utf8' });
  check('docker compose config accepts: ' + name, r.status === 0, (r.stderr || r.stdout).trim() + '\n' + text);
}

// ---------- the reported defect: a value read as the image name ----------
{
  const r = convert('docker run --env-file .env nginx');
  eq('--env-file value is not the image', r.doc && service(r.doc).image, 'nginx');
  eq('--env-file becomes env_file', r.doc && service(r.doc).env_file, ['.env']);
  composeAccepts('--env-file', r.yaml);
}
{
  const r = convert('docker run -d --name web --entrypoint /bin/sh -u 1000 -w /app nginx -c "echo hello"');
  const s = r.doc && service(r.doc);
  eq('--entrypoint value is not the image', s && s.image, 'nginx');
  eq('--entrypoint becomes a one-item list', s && s.entrypoint, ['/bin/sh']);
  eq('-u becomes user', s && s.user, '1000');
  eq('-w becomes working_dir', s && s.working_dir, '/app');
  eq('arguments after the image become command', s && s.command, ['-c', 'echo hello']);
  check('--name is the service key', r.doc && 'web' in r.doc.services);
  composeAccepts('entrypoint / user / workdir', r.yaml);
}
{
  const r = convert('docker run --gpus all --log-opt max-size=10m --sig-proxy=false nginx:1.27');
  const s = r.doc && service(r.doc);
  eq('an option without a Compose key still consumes its value', s && s.image, 'nginx:1.27');
  eq('options without a Compose key are listed', r.parsed && r.parsed.unconverted, ['--gpus all', '--log-opt max-size=10m', '--sig-proxy=false']);
  check('the YAML lists them in a comment', r.yaml && r.yaml.startsWith('# Not converted: --gpus all, --log-opt max-size=10m, --sig-proxy=false\n'), r.yaml);
  composeAccepts('unconverted options', r.yaml);
}
for (const flag of ['--cpu-shares', '--hostname', '-h', '--label', '-l', '--add-host', '--pull', '--platform', '--mount', '--ulimit', '--health-cmd', '--network-alias', '--ip', '--link', '--log-driver', '--stop-timeout']) {
  const r = convert('docker run ' + flag + ' x=1 alpine echo hi');
  eq('value of ' + flag + ' is consumed', r.doc && service(r.doc).image, 'alpine');
}
{
  const r = E.parseDockerRun('docker run --no-such-flag value nginx');
  eq('an unknown option is an error, as in docker', r && r.error, 'unknownFlag');
  eq('the error names the option', r && r.flag, '--no-such-flag');
  eq('unknown short option', E.parseDockerRun('docker run -Z nginx').flag, '-Z');
  eq('missing value at the end', E.parseDockerRun('docker run nginx --name').error, undefined);
  eq('option value missing', E.parseDockerRun('docker run --name').error, 'missingValue');
  eq('no image', E.parseDockerRun('docker run -d'), null);
}

// ---------- the reported defect: named volumes not declared ----------
{
  const r = convert('docker run -d --name postgres -e POSTGRES_PASSWORD=secret -v pgdata:/var/lib/postgresql/data postgres:16-alpine');
  eq('named volume is declared at the top level', r.doc && r.doc.volumes, { pgdata: null });
  composeAccepts('named volume', r.yaml);
}
{
  const r = convert('docker run -v ./site:/usr/share/nginx/html:ro -v /etc/hosts:/etc/hosts -v ~/cfg:/cfg -v /cache -v logs:/var/log/nginx -v logs:/backup:ro -v my.vol_2:/m nginx');
  eq('only named volumes are declared, once each', r.doc && r.doc.volumes, { logs: null, 'my.vol_2': null });
  eq('all mounts are kept on the service', r.doc && service(r.doc).volumes.length, 7);
  composeAccepts('bind, anonymous and named volumes', r.yaml.replace('~/cfg', './cfg'));
}
{
  const r = convert('docker run --volume=data:/d --volumes-from other nginx');
  eq('--volume= form is declared too', r.doc && r.doc.volumes, { data: null });
  eq('--volumes-from becomes volumes_from', r.doc && service(r.doc).volumes_from, ['other']);
}

// ---------- command forms ----------
eq('docker container run is accepted', convert('docker container run -d nginx').doc && service(convert('docker container run -d nginx').doc).image, 'nginx');
eq('bare run is accepted', service(convert('run nginx').doc).image, 'nginx');
eq('backslash continuations', service(convert('docker run \\\n  -p 80:80 \\\n  nginx').doc).ports, ['80:80']);
{
  const s = service(convert('docker run -dit --rm ubuntu bash').doc);
  eq('-dit: -i and -t become stdin_open and tty', [s.stdin_open, s.tty], [true, true]);
  eq('-dit: image and command', [s.image, s.command], ['ubuntu', ['bash']]);
}
{
  const s = service(convert('docker run -dp 8080:80 -p80:81 -e=A=1 -eB=2 nginx').doc);
  eq('a short option at the end of a group takes the next token', s.ports, ['8080:80', '80:81']);
  eq('-e=A=1 and -eB=2', s.environment, ['A=1', 'B=2']);
}
{
  const s = service(convert('docker run --privileged --init --read-only --tmpfs /run --cap-drop ALL --cap-add=NET_BIND_SERVICE --shm-size 1g --pids-limit 100 --security-opt no-new-privileges --dns 1.1.1.1 --add-host db:10.0.0.2 -l app=web --label=tier=front --expose 9000 --device /dev/fuse --stop-signal SIGINT --platform linux/amd64 --pull always -h box --restart no busybox').doc);
  eq('booleans', [s.privileged, s.init, s.read_only], [true, true, true]);
  eq('lists', [s.tmpfs, s.cap_drop, s.cap_add, s.security_opt, s.dns, s.extra_hosts, s.labels, s.expose, s.devices],
    [['/run'], ['ALL'], ['NET_BIND_SERVICE'], ['no-new-privileges'], ['1.1.1.1'], ['db:10.0.0.2'], ['app=web', 'tier=front'], ['9000'], ['/dev/fuse']]);
  eq('scalars', [s.shm_size, s.pids_limit, s.stop_signal, s.platform, s.pull_policy, s.hostname, s.restart],
    ['1g', 100, 'SIGINT', 'linux/amd64', 'always', 'box', 'no']);
}
{
  const r = convert('docker run --privileged --init --read-only --tmpfs /run --cap-drop ALL --shm-size 1g --pids-limit 100 --security-opt no-new-privileges --dns 1.1.1.1 --add-host db:10.0.0.2 -l app=web --expose 9000 --stop-signal SIGINT --platform linux/amd64 --pull always -h box --restart no busybox');
  composeAccepts('booleans, lists and scalars', r.yaml);
}

// ---------- networks ----------
{
  const r = convert('docker run --network host nginx');
  eq('--network host becomes network_mode', service(r.doc).network_mode, 'host');
  eq('no top-level network for host', r.doc.networks, undefined);
  composeAccepts('network_mode host', r.yaml);
  eq('--network none', service(convert('docker run --network=none nginx').doc).network_mode, 'none');
  eq('--network container:x', service(convert('docker run --net container:db nginx').doc).network_mode, 'container:db');
}
{
  const r = convert('docker run --network app-net nginx');
  eq('user network', [service(r.doc).networks, r.doc.networks], [['app-net'], { 'app-net': { external: true } }]);
  composeAccepts('external network', r.yaml);
}

// ---------- YAML values that need quotes ----------
{
  const r = convert('docker run -e FLAG=yes -h 123 --restart no -l "note=a: b # c" --entrypoint "" nginx echo "\\"quoted\\""');
  const s = service(r.doc);
  eq('hostname of digits stays a string', s.hostname, '123');
  eq('restart no stays a string', s.restart, 'no');
  eq('label with ": " and " #"', s.labels, ['note=a: b # c']);
  eq('empty entrypoint', s.entrypoint, ['']);
  eq('quotes inside a command argument', s.command, ['echo', '"quoted"']);
  composeAccepts('values that need quotes', r.yaml);
}

// ---------- the examples on the tool pages ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/docker-to-compose/' + lang + '.mdx'), 'utf8');
  const re = /```bash\n([\s\S]*?)\n```\s*\n(?:[^`]*\n)?```yaml\n([\s\S]*?)\n```/g;
  let m;
  let count = 0;
  while ((m = re.exec(mdx))) {
    count++;
    const out = E.generateCompose(E.parseDockerRun(m[1]));
    eq(lang + ': example ' + count + ' output matches the page', out, m[2]);
    composeAccepts(lang + ' example ' + count, out);
  }
  check(lang + ': page has at least two examples', count >= 2, String(count));
}

// ---------- status messages ----------
{
  const m = source.match(/const STRINGS = (\{[\s\S]*?\n\});/);
  check('STRINGS block found', !!m);
  if (m) {
    const S = new Function('return ' + m[1])();
    const keys = Object.keys(S.en).sort().join();
    for (const lang of ['zh', 'ja', 'ko']) eq(lang + ': same STRINGS keys as en', Object.keys(S[lang]).sort().join(), keys);
    for (const lang of ['en', 'zh', 'ja', 'ko']) {
      check(lang + ': unknown-option message has {flag}', S[lang].msgUnknownFlag.includes('{flag}') && S[lang].msgMissingValue.includes('{flag}'));
      check(lang + ': not-converted message has {flags}', S[lang].msgNotConverted.includes('{flags}'));
    }
  }
}


// ---------- real complete page lifecycle; controlled DOM, clipboard and clock boundaries ----------
const pageScript = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const pageLabels = vm.runInNewContext('(' + source.match(/const STRINGS = (\{[\s\S]*?\n\});/)[1] + ')');
const runtimeLabels = lang => vm.runInNewContext('(' + source.match(/const CLIENT_T = (\{[\s\S]*?\n\});/)[1] + ')', { L: pageLabels[lang] });
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes("document.addEventListener('keydown'")) throw Error('Shared shortcut not found');
const engineLines = source.slice(source.lastIndexOf('\n', startIndex) + 1, endIndex + END_MARK.length);
eq('protected engine byte count', Buffer.byteLength(engineLines), 16287);
eq('protected engine SHA256', createHash('sha256').update(engineLines).digest('hex'), "61b2e713a602523f30353f475b068618fca0f867fbe02cff2cd297ef28a802c8");
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
  const tipAbout = JSON.parse(readFileSync(join(root, 'src/i18n/' + lang + '.json'), 'utf8'))['tool.tipAbout'];
  // Render the shared component's actual button/panel boundary; browser QA checks popover geometry.
  const markup = source.split('\n---')[1].split('<script')[0]
    .replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{L\.(\w+)\}>\{L\.tips\.(\w+)\}<\/Toggletip>/g, (_, id, about, tip) =>
      '<span class="zt-tip"><button type="button" data-zt-tip="' + id + '" aria-label="' + escape(tipAbout.replace('{name}', pageLabels[lang][about])) + '"></button><span id="' + id + '" role="note">' + escape(pageLabels[lang].tips[tip]) + '</span></span>')
    .replace(/=\{JSON\.stringify\(CLIENT_T\)\}/g, () => '="' + escape(JSON.stringify(runtimeLabels(lang))) + '"')
    .replace(/=\{L\.(\w+)\}/g, (_, key) => '="' + escape(pageLabels[lang][key]) + '"')
    .replace(/\{L\.(\w+)\}/g, (_, key) => escape(pageLabels[lang][key]));
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
  const context = { document: doc, _slug: 'docker-to-compose', console,
    trackTool: (...args) => tracks.push(args), ztPersist: { clear: slug => clears.push(slug) },
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); copies.push({ value, resolve, reject }); return promise; } } },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, due: now + ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
  };
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(pageScript, context, { filename: 'DockerToComposeTool.astro' });
  if (!shellFirst) vm.runInContext(shortcut, context);
  return { get, context, copies, tracks, clears, timers, doc,
    input(value) { get('dtc-input').value = value; get('dtc-input').dispatch('input'); },
    key(id = 'dtc-input', key = 'l', modifier = 'ctrlKey') { (typeof id === 'string' ? get(id) : id || body).focus(); const e = { key, [modifier]: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; for (const fn of docEvents.keydown || []) fn(e); return e; },
    advance(ms) { const end = now + ms; for (;;) { const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0]; if (!next) break; timers.delete(next[0]); now = next[1].due; next[1].fn(); } now = end; },
  };
}
const output = p => p.get('dtc-output-code').textContent;
const status = p => p.get('dtc-status');
const snapshot = p => JSON.stringify(["dtc-input", "dtc-output-code", "dtc-status", "dtc-copy"].map(id => { const e = p.get(id); return [e.value, e.checked, e.textContent, e.className, e.hidden]; }));
const goldenInput = "docker run --name web -p 8080:80 nginx:latest", nextInput = "docker run --name worker alpine:latest", invalidInput = "not docker";
const run = (p, value = goldenInput) => { p.input(value); p.get('dtc-convert').click(); };
const goldenCode = "services:\n  web:\n    image: \"nginx:latest\"\n    ports:\n      - \"8080:80\"";
const copy = p => { p.get('dtc-copy').click(); return p.copies.at(-1); };
const copyFailure = {
  en: 'Copy failed. Please copy the output manually.', zh: '复制失败，请手动复制输出。',
  ja: 'コピーに失敗しました。出力を手動でコピーしてください。', ko: '복사하지 못했습니다. 출력을 직접 복사하세요.',
};
try {
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const L = pageLabels[lang], p = page(lang);
    run(p); eq(lang + ': real page golden bytes', output(p), goldenCode);
    p.input(nextInput); p.advance(500); eq(lang + ': typing remains manual', output(p), goldenCode);
    const converted = p.tracks.length; p.key('dtc-input', 'Enter'); eq(lang + ': shared Enter converts once', p.tracks.length, converted + 1); check(lang + ': new manual output', output(p) !== goldenCode);
    for (const shellFirst of [false, true]) for (const modifier of ['ctrlKey', 'metaKey']) {
      const q = page(lang, shellFirst); run(q);
      const prefix = lang + ': shared clear ' + shellFirst + '/' + modifier;
      const outside = snapshot(q); q.key(null, 'l', modifier); eq(prefix + ' outside unchanged', snapshot(q), outside);
      q.input(invalidInput); q.key('dtc-copy', 'L', modifier);
      check(prefix + ' clears input/output/status/error', !q.get('dtc-input').value && !output(q) && !status(q).textContent && !q.get('dtc-input').classList.contains('error'));
      check(prefix + ' restores input focus', q.doc.activeElement === q.get('dtc-input'));
      eq(prefix + ' cancels timers', q.timers.size, 0);
      eq(prefix + ' shared storage clear once', q.clears.join(','), 'docker-to-compose');

      const cleared = snapshot(q); q.advance(1600); eq(prefix + ' remains clear', snapshot(q), cleared);
    }
    const invalid = page(lang); run(invalid); run(invalid, invalidInput);
    check(lang + ': invalid input positive control', !!status(invalid).textContent && !status(invalid).hidden);
    eq(lang + ': invalid input clears previous output', output(invalid), '');
    run(invalid, '');
    check(lang + ': empty removes error/output/status', !invalid.get('dtc-input').classList.contains('error') && !output(invalid) && !status(invalid).textContent);
    run(invalid, invalidInput); invalid.get('dtc-clear').click();
    check(lang + ': Clear removes invalid state', !status(invalid).textContent && !output(invalid) && !invalid.get('dtc-input').classList.contains('error'));
    check(lang + ': Clear focuses input', invalid.doc.activeElement === invalid.get('dtc-input'));
    const q = page(lang); run(q);
    const good = copy(q); eq(lang + ': Copy exact output bytes', good.value, goldenCode); good.resolve(); await settle();
    eq(lang + ': current copy succeeds', q.get('dtc-copy').textContent, L.copied); q.advance(1500); eq(lang + ': current timer restores Copy', q.get('dtc-copy').textContent, L.copy);
    const failuresBefore = unhandled.length; copy(q).reject(Error('denied')); await settle();
    eq(lang + ': localized current rejection', status(q).textContent, copyFailure[lang]);
    check(lang + ': copy failure visible', !status(q).hidden);
    eq(lang + ': rejection handled', unhandled.length, failuresBefore);
    const retry = copy(q); eq(lang + ': retry identical output', retry.value, goldenCode); retry.resolve(); await settle();
    eq(lang + ': direct retry succeeds', q.get('dtc-copy').textContent, L.copied);
    check(lang + ': direct retry clears copy failure', status(q).textContent !== copyFailure[lang]);
    for (const missing of ['clipboard', 'writeText', 'throw']) {
      const r = page(lang); run(r);
      r.context.navigator.clipboard = missing === 'clipboard' ? undefined : missing === 'writeText' ? {} : { writeText() { throw Error('unavailable'); } };
      let thrown; try { r.get('dtc-copy').click(); } catch (e) { thrown = e; }
      check(lang + ': unavailable API handled ' + missing, !thrown);
      eq(lang + ': unavailable API visible ' + missing, status(r).textContent, copyFailure[lang]);
      eq(lang + ': unavailable API never claims copied ' + missing, r.get('dtc-copy').textContent, L.copy);
    }
    for (const action of ["input", "clear", "shortcut", "result", "error", "example"]) for (const outcome of ['resolve', 'reject', 'timer']) {
      const r = page(lang); run(r); const old = copy(r); let oldTimer;
      if (outcome === 'timer') { old.resolve(); await settle(); oldTimer = [...r.timers.values()].find(t => t.due === 1500)?.fn; }
      if (action === 'input') r.input(nextInput);
      if (action === 'clear') r.get('dtc-clear').click();
      if (action === 'shortcut') r.key();
      if (action === 'result') run(r, nextInput);
      if (action === 'error') run(r, invalidInput);
      if (action === 'example') r.get('dtc-example').click();
      const before = snapshot(r), rejectedBefore = unhandled.length;
      // Replay a captured callback even after cancellation to verify obsolete work cannot write.
      if (outcome === 'timer') { check(lang + ': real feedback timer captured ' + action, !!oldTimer); oldTimer?.(); }
      else { old[outcome](Error('late')); await settle(); }
      eq(lang + ': stale ' + action + '/' + outcome, snapshot(r), before);
      eq(lang + ': stale rejection handled ' + action + '/' + outcome, unhandled.length, rejectedBefore);
    }
    const t = page(lang); run(t); copy(t).resolve(); await settle(); t.advance(1000); copy(t).resolve(); await settle(); t.advance(500);
    eq(lang + ': old timer cannot overwrite newer Copied', t.get('dtc-copy').textContent, L.copied);
    t.advance(1000); eq(lang + ': latest timer expires normally', t.get('dtc-copy').textContent, L.copy);
    const order = page(lang); run(order); const first = copy(order), second = copy(order); second.reject(Error('current')); await settle(); first.resolve(); await settle();
    eq(lang + ': older success preserves newer error', status(order).textContent, copyFailure[lang]);
    eq(lang + ': older success cannot claim copied', order.get('dtc-copy').textContent, L.copy);
    const reverse = page(lang); run(reverse); const older = copy(reverse), newer = copy(reverse); newer.resolve(); await settle(); const fresh = snapshot(reverse); older.reject(Error('late')); await settle();
    eq(lang + ': older rejection preserves newer success', snapshot(reverse), fresh);
  }
} finally { await settle(); process.removeListener('unhandledRejection', onUnhandled); }
eq('no unhandled clipboard rejections', unhandled.length, 0);


// ---------- v2 page layout ----------
const layoutMarkup = source.split('\n---')[1].split('<script')[0];
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const hash = value => createHash('sha256').update(value).digest('hex');
check('v2 registered as convert', /'docker-to-compose':\s*'convert'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
check('v2 direct flex root with zero minimum size', /^\s*<div\s+class="dtc-wrap"/.test(layoutMarkup) && /\.dtc-wrap\s*\{[^}]*display:\s*flex;[^}]*min-width:\s*0;[^}]*min-height:\s*0;/.test(css));
check('v2 controls/status precede panels', layoutMarkup.indexOf('class="dtc-actions"') < layoutMarkup.indexOf('id="dtc-status"') && layoutMarkup.indexOf('id="dtc-status"') < layoutMarkup.indexOf('zt-io"'));
eq('v2 two shared panels', (layoutMarkup.match(/\bzt-io-pane\b/g) || []).length, 2);
check('v2 input uses shared fill', /id="dtc-input"\s+class="zt-io-fill"/.test(layoutMarkup));
check('v2 output is a labelled keyboard scroller', /id="dtc-output"[^>]*tabindex="0"[^>]*aria-labelledby="dtc-output-label"/.test(layoutMarkup) && /\.dtc-output\s*\{[^}]*overflow:\s*auto;/.test(css) && /\.dtc-output:focus-visible\s*\{[^}]*outline:/.test(css));
check('v2 status space is reserved', /\.dtc-status\s*\{[^}]*min-height:\s*2\.4rem;/.test(css));
check('v2 long status cannot grow the panels', /\.dtc-status\s*\{[^}]*height:\s*2\.4rem;[^}]*overflow:\s*auto;/.test(css));
check('v2 mobile input is bounded', /@media \(max-width: 860px\)/.test(css) && /height:\s*144px;\s*min-height:\s*144px;/.test(css));
check('v2 mobile output has fixed height', /\.dtc-output\s*\{[^}]*height:\s*22rem;/.test(css));
check('v2 phone controls remain reachable', /@media \(max-width: 640px\)/.test(css) && /min-height:\s*44px/.test(css));
check('v2 empty state tracks actual code', css.includes('.dtc-output-pane:has(#dtc-output-code:empty) .dtc-output { display: none; }') && css.includes('.dtc-output-pane:has(#dtc-output-code:empty) .dtc-empty { display: flex; }') && css.includes('.dtc-output-pane:has(#dtc-output-code:empty) { display: none; }'));
check('v2 four-language build-time text, tips excluded from script', !/data-i18n/.test(source) && !/STRINGS|L\.tips|\.tips\b/.test(pageScript));
eq('v2 original action buttons retained', [...layoutMarkup.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map(m => m[1]).sort().join(','), "dtc-clear,dtc-convert,dtc-copy,dtc-example");
const tipMap = [["convert", "convert", "convert"], ["example", "example", "example"], ["clear", "clear", "clear"], ["input", "inputLabel", "input"], ["copy", "copy", "copy"]];
eq('v2 actual Toggletip count', (layoutMarkup.match(/<Toggletip\b/g) || []).length, tipMap.length);
for (const [id, about, key] of tipMap) check('v2 tip binding ' + id, layoutMarkup.includes('<Toggletip id="dtc-tip-' + id + '" lang={lang} about={L.' + about + '}>{L.tips.' + key + '}</Toggletip>'));
// Hashes captured before migrating Usage; all other frontmatter and body are protected.
const protectedContent = {
  "en": [
    "78e92cbc69a1c86d542d318080bf560f06d82bc18448c30fc6b36d830e4507c9",
    "e29dd9f19af785ee19aeb271e05cab6a769766e02cf8f3713afc396158df8bd0"
  ],
  "zh": [
    "aa0683e274a3be3e5a883c531def3bd839f709e1de06b1e84873d514d9171814",
    "ab9b602996dc20cdaa523f517d60fc1fdeb95a48a2c6f0519a5dac72bebdcac9"
  ],
  "ja": [
    "a003e834214235d74f345a2fccdcc6f90eaac9b4ce9fada3a208970052a70e06",
    "ac6285f76d6b6a33a834bdf251e15c697737fa1ad19e65138c88cf2894d859cc"
  ],
  "ko": [
    "f2265a1a6cc45645ab73587a0560f69521e28e79f98fba2d62af61fd197bf9b1",
    "3e3a835c1baab5bb147781854bedae3dce0fc925240403cb5ee359cff17e12a5"
  ]
};
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const L = pageLabels[lang], p = page(lang);
  eq(lang + ': v2 same tip keys', Object.keys(L.tips).sort().join(','), tipMap.map(x => x[2]).sort().join(','));
  for (const [id, about, key] of tipMap) {
    check(lang + ': v2 plain localized tip ' + id, typeof L[about] === 'string' && !!L[about].trim() && !/[<>]/.test(L[about]) && typeof L.tips[key] === 'string' && !!L.tips[key].trim() && !/[<>]/.test(L.tips[key]));
    eq(lang + ': v2 rendered tip ' + id, p.get('dtc-tip-' + id).textContent, L.tips[key]);
  }
  check(lang + ': v2 localized empty state', !!L.empty && layoutMarkup.includes('{L.empty}'));
  check(lang + ': v2 serialized data excludes all tips', !('tips' in runtimeLabels(lang)) && !('empty' in runtimeLabels(lang)) && Object.values(L.tips).every(tip => !p.doc.querySelector('.dtc-wrap').dataset.strings.includes(tip)));
  const mdx = readFileSync(join(root, 'src/content/tools/docker-to-compose/' + lang + '.mdx'), 'utf8');
  const [, fm, body] = mdx.match(/^---\n([\s\S]*?\n)---\n([\s\S]*)$/);
  const stepsText = fm.match(/^steps:\n((?:  - .*\n)+)/m)[1];
  const steps = stepsText.trimEnd().split('\n').map(line => JSON.parse(line.slice(4)));
  check(lang + ': v2 steps bounds/order', steps.length > 0 && steps.length <= 8 && steps.every(x => [...x].length <= 280 && !/[<>]/.test(x)) && steps.reduce((n, x) => n + [...x].length, 0) <= 1200 && fm.indexOf('steps:') < fm.indexOf('faqItems:'));
  for (const key of ["inputLabel", "convert", "example", "clear", "copy"]) check(lang + ': v2 steps use actual ' + key, steps.join('\n').includes(L[key]));
  eq(lang + ': v2 original SEO/FAQ exact', hash(fm.replace(/^steps:\n(?:  - .*\n)+/m, '')), protectedContent[lang][0]);
  eq(lang + ': v2 non-Usage body/limits/examples exact', hash(body), protectedContent[lang][1]);
  check(lang + ': v2 no duplicate Usage', !/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>|^## How to/m.test(body));
  try { await compileMdx(body); check(lang + ': v2 MDX compiles', true); } catch (e) { check(lang + ': v2 MDX compiles', false, e.message); }
  for (const shellFirst of [false, true]) for (const focus of ['output', 'copy-tip']) {
    const q = page(lang, shellFirst); run(q);
    q.key(focus === 'output' ? q.get('dtc-output') : q.doc.querySelector('[data-zt-tip="dtc-tip-copy"]'));
    check(lang + ': v2 result CtrlL focus ' + shellFirst + '/' + focus, q.doc.activeElement === q.get('dtc-input') && !q.get('dtc-input').value && !output(q) && !status(q).textContent && q.clears.length === 1);
  }
}
try {
  const require = createRequire(import.meta.url);
  const { transform: astroTransform } = await import(require.resolve('@astrojs/compiler', { paths: [dirname(require.resolve('astro'))] }));
  const compiled = await astroTransform(source, { filename: 'DockerToComposeTool.astro' });
  check('v2 Astro compiler has no error diagnostics', !compiled.diagnostics.some(d => d.severity === 1), JSON.stringify(compiled.diagnostics));
  await esbuildTransform(compiled.code, { loader: 'ts' }); check('v2 generated Astro module parses', true);
} catch (e) { check('v2 Astro compilation', false, e.message); }
check('v2 dark status ancestors are global', css.includes(':global(:root:not([data-theme="light"]))') && css.includes(':global([data-theme="dark"])'));

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passes} passed, ${failures} failed` + (skips ? `, ${skips} skipped` : ''));
process.exit(failures ? 1 : 0);
