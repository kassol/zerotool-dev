// Chmod Calculator — symbolic string, numeric string and symbolic chmod command
//
// Read:  src/components/tools/ChmodCalculatorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers);
//        src/content/tools/chmod-calculator/{en,zh,ja,ko}.mdx; ToolLayout.astro;
//        src/content/blog/chmod-calculator-guide/{en,ja}.mdx (`chmod-check` / `chmod-ls` /
//        `chmod-umask` / `chmod-gnu-dir` annotations, see the guide section below)
// Write: a temporary directory under os.tmpdir() (removed at the end); stdout (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: ls-style strings (s/S, t/T), numeric strings with and without the special digit, and the
// "Symbolic cmd" output. Before the fix that command ignored setuid, setgid and the sticky bit
// (4755 gave chmod u=rwx,g=rx,o=rx). It now writes s after u= / g= and a separate +t; o+t is
// ignored by BSD/macOS chmod, +t works there and in GNU coreutils. The commands are run with the
// system chmod on a directory that starts at mode 00000 and the resulting mode (fs.statSync) must
// equal the numeric value, for every combination of special bits with 12 base modes. Directories
// are used because BSD lets only root set the sticky bit on a regular file. Skipped on Windows.
//
// Run: node scripts/test-chmod-calculator.mjs

import vm from 'node:vm';
import yaml from 'js-yaml';
import { readFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/ChmodCalculatorTool.astro'), 'utf8');
const a = source.indexOf('/* ── engine:start ── */');
const b = source.indexOf('/* ── engine:end ── */');
if (a < 0 || b <= a) { console.error('FAIL: engine block not found'); process.exit(1); }
const E = new Function(source.slice(a, b) + '\nreturn { buildSymbolic, buildNumericStr, buildSymCmd, stripLsDecorations };')();

let passes = 0, failures = 0;
function eq(name, got, want) {
  if (got === want) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + ' — got ' + JSON.stringify(got) + ', expected ' + JSON.stringify(want)); }
}
const digitsOf = (mode) => [(mode >> 6) & 7, (mode >> 3) & 7, mode & 7];

const table = [
  // mode, symbolic, numeric, symbolic command
  [0o755, 'rwxr-xr-x', '755', 'chmod u=rwx,g=rx,o=rx filename'],
  [0o644, 'rw-r--r--', '644', 'chmod u=rw,g=r,o=r filename'],
  [0o600, 'rw-------', '600', 'chmod u=rw,g=,o= filename'],
  [0o4755, 'rwsr-xr-x', '4755', 'chmod u=rwxs,g=rx,o=rx filename'],
  [0o2775, 'rwxrwsr-x', '2775', 'chmod u=rwx,g=rwxs,o=rx filename'],
  [0o1777, 'rwxrwxrwt', '1777', 'chmod u=rwx,g=rwx,o=rwx,+t filename'],
  [0o4644, 'rwSr--r--', '4644', 'chmod u=rws,g=r,o=r filename'],
  [0o1770, 'rwxrwx--T', '1770', 'chmod u=rwx,g=rwx,o=,+t filename'],
  [0o6755, 'rwsr-sr-x', '6755', 'chmod u=rwxs,g=rxs,o=rx filename'],
];
for (const [mode, sym, num, cmd] of table) {
  const d = digitsOf(mode), sp = mode >> 9;
  eq(num + ' symbolic', E.buildSymbolic(d, sp), sym);
  eq(num + ' numeric', E.buildNumericStr(d, sp), num);
  eq(num + ' symbolic command', E.buildSymCmd(d, sp), cmd);
}

// ls -l strings (the field had maxlength 9, so a pasted "-rwxr-xr-x" was cut to "-rwxr-xr-" and rejected)
eq('ls -l regular file', E.stripLsDecorations('-rwxr-xr-x'), 'rwxr-xr-x');
eq('ls -l directory with sticky bit', E.stripLsDecorations('drwxrwxrwt'), 'rwxrwxrwt');
eq('macOS extended attributes marker', E.stripLsDecorations('-rw-r--r--@'), 'rw-r--r--');
eq('ACL marker', E.stripLsDecorations('drwxr-xr-x+'), 'rwxr-xr-x');
eq('SELinux marker', E.stripLsDecorations('-rw-r--r--.'), 'rw-r--r--');
eq('plain 9 characters unchanged', E.stripLsDecorations('rwsr-xr-x'), 'rwsr-xr-x');
eq('unknown type letter unchanged', E.stripLsDecorations('xrwxr-xr-x'), 'xrwxr-xr-x');
check: {
  const m = source.match(/id="chmod-symbolic"[^>]*maxlength="(\d+)"/);
  eq('symbolic field accepts 11 characters', m && m[1], '11');
}

if (process.platform === 'win32') {
  console.log('SKIP system chmod (Windows)');
} else {
  const dir = mkdtempSync(join(tmpdir(), 'chmod-test-'));
  const target = join(dir, 'd');
  execFileSync('mkdir', [target]);
  try {
    const bases = [0o000, 0o644, 0o755, 0o700, 0o750, 0o775, 0o777, 0o600, 0o640, 0o711, 0o444, 0o070];
    for (const base of bases) {
      for (let sp = 0; sp < 8; sp++) {
        const mode = (sp << 9) | base;
        execFileSync('chmod', ['00000', target]);
        const cmd = E.buildSymCmd(digitsOf(mode), sp).replace(/^chmod /, '').replace(/ filename$/, '');
        execFileSync('chmod', [cmd, target]);
        const got = statSync(target).mode & 0o7777;
        eq(`system chmod ${cmd} gives ${mode.toString(8).padStart(4, '0')}`, got.toString(8), mode.toString(8));
      }
    }
  } finally {
    execFileSync('chmod', ['700', target]);
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── chmod-calculator-guide (en, ja) ────────────────────────────────────────────────────
// `chmod-check` annotations: for the octal mode, the calculator's mode string, symbolic command
// and find command equal the listed values, and the mode string appears in the guide text.
// `chmod-ls`: stripLsDecorations turns the ls -l string into the listed 9 characters.
// `chmod-umask`: a file created with 666 and a directory with 777 under that umask get the
// listed modes. `chmod-gnu-dir`: on GNU coreutils (Linux CI), each command applied to a 2775
// directory leaves the listed mode; on macOS the same commands are checked against the BSD
// column of the table (setgid cleared, `=755` rejected). The other system results quoted in
// the guides (+x under a umask, capital X, find -perm forms) are rerun on the system chmod/find.
const findExpr = "'find . -type f -perm ' + (special > 0 ? numeric : ('0' + numeric))";
eq('find command built as in the guides', source.includes(findExpr), true);
const findFor = (num, sp) => 'find . -type f -perm ' + (sp > 0 ? num : '0' + num);
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
let gnuDir = null;
for (const lang of ['en', 'ja']) {
  const guide = readFileSync(join(root, `src/content/blog/chmod-calculator-guide/${lang}.mdx`), 'utf8');
  const body = stripComments(guide);
  const checks = [...guide.matchAll(/\{\/\* chmod-check: (\{.*?\}) \*\/\}/g)].map((m) => JSON.parse(m[1]));
  eq(lang + ' guide has at least 8 chmod-check annotations', checks.length >= 8, true);
  for (const c of checks) {
    const mode = parseInt(c.mode, 8);
    const d = digitsOf(mode), sp = mode >> 9;
    const num = E.buildNumericStr(d, sp);
    eq(`${lang} guide ${c.mode} numeric`, num, c.mode);
    eq(`${lang} guide ${c.mode} symbolic`, E.buildSymbolic(d, sp), c.symbolic);
    eq(`${lang} guide ${c.mode} symbolic command`, E.buildSymCmd(d, sp), c.cmd);
    eq(`${lang} guide ${c.mode} find command`, findFor(num, sp), c.find);
    eq(`${lang} guide shows ${c.symbolic}`, body.includes(c.symbolic), true);
  }
  for (const m of guide.matchAll(/\{\/\* chmod-ls: (\{.*?\}) \*\/\}/g)) {
    const c = JSON.parse(m[1]);
    eq(`${lang} guide ls -l ${c.in}`, E.stripLsDecorations(c.in), c.out);
    eq(`${lang} guide shows ${c.in}`, body.includes(c.in), true);
  }
  const umasks = [...guide.matchAll(/\{\/\* chmod-umask: (\{.*?\}) \*\/\}/g)].map((m) => JSON.parse(m[1]));
  eq(lang + ' guide has umask annotations', umasks.length >= 3, true);
  for (const c of umasks) {
    const u = parseInt(c.umask, 8);
    eq(`${lang} umask ${c.umask} file`, (0o666 & ~u).toString(8), c.file);
    eq(`${lang} umask ${c.umask} directory`, (0o777 & ~u).toString(8), c.dir);
  }
  const g = guide.match(/\{\/\* chmod-gnu-dir: (\{.*?\}) \*\/\}/);
  eq(lang + ' guide has the GNU directory table', !!g, true);
  if (g) {
    const parsed = JSON.parse(g[1]);
    if (gnuDir) eq(lang + ' GNU directory table matches en', JSON.stringify(parsed), JSON.stringify(gnuDir));
    gnuDir = parsed;
    for (const [cmd, want] of Object.entries(parsed)) {
      eq(`${lang} table row chmod ${cmd} -> ${want}`, new RegExp('`chmod ' + cmd + ' d` \\| `' + want + '`').test(body), true);
    }
  }
}

if (process.platform !== 'win32') {
  const sh = (script, cwd) => execFileSync('sh', ['-c', script], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let version = '';
  try { version = execFileSync('chmod', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* BSD chmod has no --version */ }
  const isGnu = /GNU coreutils/.test(version);
  const isDarwin = process.platform === 'darwin';
  const modeOf = (p) => (statSync(p).mode & 0o7777).toString(8);
  const dir = mkdtempSync(join(tmpdir(), 'chmod-guide-'));
  try {
    // +x without a class follows the umask; a+x does not (POSIX chmod)
    sh('touch g', dir);
    sh('umask 077; chmod 644 g; chmod +x g', dir); eq('umask 077: chmod +x on 644 gives 744', modeOf(join(dir, 'g')), '744');
    sh('umask 077; chmod 644 g; chmod a+x g', dir); eq('umask 077: chmod a+x on 644 gives 755', modeOf(join(dir, 'g')), '755');
    sh('umask 022; chmod 600 g; chmod +w g', dir); eq('umask 022: chmod +w on 600 gives 600', modeOf(join(dir, 'g')), '600');
    sh('umask 022; chmod 600 g; chmod +x g', dir); eq('umask 022: chmod +x on 600 gives 711', modeOf(join(dir, 'g')), '711');
    // capital X
    sh('mkdir -p X/sub && touch X/plain X/sub/run && chmod 600 X/plain && chmod 700 X/sub/run X/sub X && chmod -R u=rwX,go=rX X', dir);
    eq('capital X: directory 755', modeOf(join(dir, 'X')), '755');
    eq('capital X: plain file 644', modeOf(join(dir, 'X/plain')), '644');
    eq('capital X: executable file 755', modeOf(join(dir, 'X/sub/run')), '755');
    // find -perm forms (the setuid file needs no special rights: we own it)
    sh('mkdir fp && cd fp && touch a b c d && chmod 755 a && chmod 775 b && chmod 644 c && chmod 4755 d', dir);
    const fp = join(dir, 'fp');
    const list = (args) => sh(`find . -type f ${args} | sort | tr '\\n' ' '`, fp);
    eq('find -perm 0755', list('-perm 0755'), './a');
    eq('find -perm -0755', list('-perm -0755'), './a ./b ./d');
    eq('find -perm -4000', list('-perm -4000'), './d');
    if (isGnu || !isDarwin) eq('find -perm /022 (GNU)', list('-perm /022'), './b');
    if (isDarwin) eq('find -perm +022 (macOS)', list('-perm +022'), './b');
    // setgid on a directory: GNU keeps it for short numeric and absolute symbolic modes
    for (const [cmd, gnuWant] of Object.entries(gnuDir || {})) {
      sh('rm -rf sd && mkdir sd && chmod 2775 sd', dir);
      let ok = true;
      try { execFileSync('chmod', [cmd, join(dir, 'sd')], { stdio: 'ignore' }); } catch { ok = false; }
      if (isGnu) eq(`GNU chmod ${cmd} on 2775 dir gives ${gnuWant}`, modeOf(join(dir, 'sd')), gnuWant);
      else if (isDarwin) {
        if (cmd === '=755') eq('macOS rejects chmod =755', ok, false);
        else eq(`macOS chmod ${cmd} on 2775 dir gives 755`, modeOf(join(dir, 'sd')), '755');
      }
    }
    sh('rm -rf sd && mkdir sd && chmod 2775 sd && chmod g-s sd', dir);
    eq('chmod g-s on 2775 dir gives 775', modeOf(join(dir, 'sd')), '775');
    sh('touch su && chmod 4755 su && chmod 755 su', dir);
    eq('chmod 755 clears setuid on a regular file', modeOf(join(dir, 'su')), '755');
    if (isDarwin) {
      sh('mkdir ot && chmod 755 ot && chmod o+t ot', dir);
      eq('macOS ignores chmod o+t on a directory', modeOf(join(dir, 'ot')), '755');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}


// Run the complete inline script and the actual ToolLayout shortcut in either registration
// order. DOM values/types/checked defaults come from the markup. Only the clipboard and clock
// are controlled; no internal conversion or event handler is replaced.
const shell = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = shell.slice(shell.indexOf('// ── Keyboard shortcuts:'), shell.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes("document.addEventListener('keydown'")) throw new Error('Missing shared shortcut');
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
function page({ lang = 'en', shellFirst = false } = {}) {
  const allStrings = JSON.parse(source.match(/const STRINGS = ([\s\S]*?) as const;/)[1]);
  const { tips, ...t } = allStrings[lang];
  const ids = new Map(), copies = [], clears = [], docEvents = {}, timers = new Map(), tracks = [];
  let now = 0, timerId = 0;
  const doc = { documentElement: { lang }, activeElement: null };
  function simple(e, sel) {
    const attrs = [...sel.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    sel = sel.replace(/\[[^\]]+\]/g, '');
    const tag = /^[\w-]+/.exec(sel), id = /#([\w-]+)/.exec(sel), classes = [...sel.matchAll(/\.([\w-]+)/g)];
    return (!tag || e.tagName === tag[0].toUpperCase()) && (!id || e.id === id[1]) && classes.every(m => e.classList.contains(m[1])) && attrs.every(m => m[2] === undefined ? e.getAttribute(m[1]) !== null : e.getAttribute(m[1]) === m[2]);
  }
  function matches(e, selector) {
    return selector.split(',').some(sel => {
      const parts = sel.trim().split(/\s+(?![^\[]*\])/);
      if (!simple(e, parts.pop())) return false;
      for (let n = e.parentElement; parts.length;) {
        while (n && !simple(n, parts.at(-1))) n = n.parentElement;
        if (!n) return false;
        parts.pop(); n = n.parentElement;
      }
      return true;
    });
  }
  class Element {
    constructor(tag = 'div') {
      Object.assign(this, { tagName: tag.toUpperCase(), id: '', className: '', type: tag === 'input' ? 'text' : '', value: '', textContent: '', checked: false, readOnly: false, disabled: false, attributes: {}, children: [], parentElement: null, listeners: {} });
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (['id', 'type', 'value', 'class'].includes(k)) this[k === 'class' ? 'className' : k] = String(v);
      if (k === 'readonly') this.readOnly = true;
      if (k === 'disabled') this.disabled = true;
      if (k === 'checked') this.checked = true;
    }
    getAttribute(k) { return this.attributes[k] ?? null; }
    get classList() {
      const e = this;
      return {
        contains: k => e.className.split(/\s+/).includes(k),
        add(...keys) { e.className = [...new Set([...e.className.split(/\s+/).filter(Boolean), ...keys])].join(' '); },
        remove(...keys) { e.className = e.className.split(/\s+/).filter(k => k && !keys.includes(k)).join(' '); },
        toggle(k, on) { const want = on ?? !this.contains(k); if (want) this.add(k); else this.remove(k); return want; },
      };
    }
    appendChild(e) { e.parentElement = this; this.children.push(e); return e; }
    contains(e) { return e === this || this.children.some(n => n.contains(e)); }
    querySelectorAll(s) { return this.children.flatMap(n => [...(matches(n, s) ? [n] : []), ...n.querySelectorAll(s)]); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
    dispatch(t, extra = {}) {
      const event = { type: t, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const fn of this.listeners[t] || []) fn.call(this, event);
      return event;
    }
    click() {
      if (this.disabled) return;
      if (this.type === 'checkbox') this.checked = !this.checked;
      this.dispatch('click');
      if (this.type === 'checkbox') this.dispatch('change');
    }
    focus() { doc.activeElement = this; }
  }
  const body = new Element('body'), widget = new Element();
  widget.className = 'tool-widget'; body.appendChild(widget);
  const markup = source.replace(/^---[\s\S]*?---\s*/, '').split('<script')[0]
    .replace(/<Toggletip\b[\s\S]*?<\/Toggletip>/g, '')
    .replace(/=\{T\.(\w+)\}/g, (_, key) => '="' + t[key] + '"')
    .replace(/\{T\.(\w+)\}/g, (_, key) => t[key]);
  const stack = [widget], voids = new Set(['input', 'br', 'hr', 'img']);
  for (const token of markup.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w-]*)\b([^>]*?)>|([^<]+)/g)) {
    if (token[0].startsWith('<!--')) continue;
    if (token[3] !== undefined) { stack.at(-1).textContent += token[3].trim(); continue; }
    const tag = token[1];
    if (token[0].startsWith('</')) {
      if (stack.at(-1)?.tagName !== tag.toUpperCase()) throw new Error('Markup nesting mismatch ' + tag);
      stack.pop(); continue;
    }
    const e = new Element(tag);
    for (const attr of token[2].matchAll(/([\w-]+)(?:\s*=\s*"([^"]*)")?/g)) e.setAttribute(attr[1], attr[2] ?? '');
    stack.at(-1).appendChild(e);
    if (e.id) ids.set(e.id, e);
    if (!voids.has(tag) && !token[2].endsWith('/')) stack.push(e);
  }
  for (const select of body.querySelectorAll('select')) {
    const options = select.querySelectorAll('option');
    select.value = (options.find(o => o.getAttribute('selected') !== null) || options[0])?.value || '';
  }
  const get = id => { if (!ids.has(id)) throw new Error('Missing actual ID ' + id); return ids.get(id); };
  Object.assign(doc, {
    body, activeElement: body, getElementById: get,
    querySelector: s => body.querySelector(s), querySelectorAll: s => body.querySelectorAll(s),
    addEventListener(t, fn) { (docEvents[t] ??= []).push(fn); },
    dispatch(t, extra) {
      const e = { type: t, target: this.activeElement, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const fn of docEvents[t] || []) fn.call(this, e);
      return e;
    },
  });
  const context = {
    document: doc, console, t, _slug: SLUG, ztPersist: { clear: slug => clears.push(slug) }, trackTool: (...args) => tracks.push(args),
    navigator: { clipboard: { writeText(value) {
      let resolve, reject;
      const promise = new Promise((a, b) => { resolve = a; reject = b; });
      copies.push({ value, resolve, reject }); return promise;
    } } },
    setTimeout(fn, ms = 0) { const id = ++timerId; timers.set(id, { fn, due: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1], context, { filename: SLUG + '.astro' });
  if (!shellFirst) vm.runInContext(shortcut, context);
  return {
    doc, body, get, copies, clears, tracks,
    input(id, value, type = 'input') { get(id).value = value; get(id).dispatch(type); },
    key(focus, { key = 'l', ctrlKey = true, metaKey = false } = {}) {
      (typeof focus === 'string' ? get(focus) : focus || body).focus();
      return doc.dispatch('keydown', { key, ctrlKey, metaKey });
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...timers].filter(([, t]) => t.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].due; next[1].fn();
      }
      now = until;
    },
  };
}

console.log('\nReal page controls and copy lifecycle');
const SLUG = 'chmod-calculator';
const copyIds = ['chmod-copy-numeric', 'chmod-copy-symbolic', 'chmod-copy-command', 'chmod-copy-command-sym', 'chmod-copy-find-perm'];
const commands = ['chmod-command', 'chmod-command-sym', 'chmod-find-perm'];
const same = (name, actual, expected) => eq(name, JSON.stringify(actual), JSON.stringify(expected));
function state(p) {
  return {
    values: ['chmod-numeric', 'chmod-symbolic'].map(id => p.get(id).value),
    commands: commands.map(id => p.get(id).textContent), description: p.get('chmod-description').textContent,
    errors: ['chmod-numeric', 'chmod-symbolic'].map(id => [p.get(id + '-error').textContent, p.get(id).classList.contains('chmod-input-error')]),
    checked: p.body.querySelectorAll('input[type="checkbox"]').map(e => e.checked),
    labels: copyIds.map(id => p.get(id).textContent),
  };
}
function assertEmpty(p, name) {
  const s = state(p);
  same(name + ' fields empty', s.values, ['', '']);
  same(name + ' commands empty, not 000', s.commands, ['', '', '']);
  eq(name + ' description empty', s.description, '');
  same(name + ' errors cleared', s.errors, [['', false], ['', false]]);
  eq(name + ' all 12 permission inputs cleared', s.checked.length === 12 && s.checked.every(v => !v), true);
}
const unhandled = [];
const onUnhandled = error => unhandled.push(String(error));
process.on('unhandledRejection', onUnhandled);
try {
  const p = page();
  same('source default 755 initializes both fields', state(p).values, ['755', 'rwxr-xr-x']);
  eq('source checkbox defaults initialize seven ordinary bits', state(p).checked.filter(Boolean).length, 7);
  p.input('chmod-numeric', '600');
  same('numeric entry generates all commands', state(p).commands, ['chmod 600 filename', 'chmod u=rw,g=,o= filename', 'find . -type f -perm 0600']);
  const lastValid = state(p);
  p.input('chmod-numeric', '6'); p.input('chmod-symbolic', 'rw-');
  same('incomplete entries retain last-valid commands', state(p).commands, lastValid.commands);
  same('incomplete entries retain last-valid permissions', state(p).checked, lastValid.checked);
  eq('incomplete entries report both field errors', state(p).errors.every(([text, invalid]) => text && invalid), true);
  for (const shellFirst of [false, true]) for (const focus of ['chmod-numeric', 'chmod-symbolic', 'chmod-sticky', 'chmod-copy-command']) {
    const q = page({ shellFirst }); q.input('chmod-numeric', '7777');
    q.input('chmod-numeric', '7'); q.input('chmod-symbolic', 'rw-');
    const e = q.key(focus, { key: shellFirst ? 'L' : 'l', ctrlKey: !shellFirst, metaKey: shellFirst });
    const name = `shortcut ${shellFirst ? 'shell first, Meta+L' : 'component first, Ctrl+l'} from ${focus}`;
    eq(name + ' prevents default', e.defaultPrevented, true);
    assertEmpty(q, name);
    same(name + ' retains shared persistence clear', q.clears, [SLUG]);
    for (const id of copyIds) q.get(id).click();
    eq(name + ' cannot copy old fields or commands', q.copies.length, 0);
    q.advance(5000); assertEmpty(q, name + ' after timers');
    q.get('chmod-sticky').click();
    same(name + ' checkbox recovers from empty permissions', state(q).values, ['1000', '--------T']);
    q.input('chmod-symbolic', 'rw-r--r--');
    same(name + ' valid text recovers all commands', state(q).commands, ['chmod 644 filename', 'chmod u=rw,g=r,o=r filename', 'find . -type f -perm 0644']);
  }
  const outside = page(), before = state(outside);
  eq('outside shortcut is not prevented', outside.key(null).defaultPrevented, false);
  eq('plain l is not a shortcut', outside.key('chmod-numeric', { ctrlKey: false }).defaultPrevented, false);
  eq('Enter without primary button has no action', outside.key('chmod-numeric', { key: 'Enter' }).defaultPrevented, false);
  same('outside/plain-key/Enter preserve state', state(outside), before);
  same('outside shortcut preserves saved state', outside.clears, []);
  for (const [lang, failure] of Object.entries({ en: 'Copy failed', zh: '复制失败', ja: 'コピー失敗', ko: '복사 실패' })) {
    const q = page({ lang }); q.input('chmod-numeric', '4755');
    const values = ['4755', 'rwsr-xr-x', 'chmod 4755 filename', 'chmod u=rwxs,g=rx,o=rx filename', 'find . -type f -perm 4755'];
    for (const [i, id] of copyIds.entries()) {
      const btn = q.get(id), label = btn.textContent;
      btn.click(); eq(lang + ' ' + id + ' copies current value', q.copies.at(-1).value, values[i]);
      q.copies.at(-1).resolve(); await settle();
      eq(lang + ' ' + id + ' success visible', btn.textContent !== label, true);
      q.advance(2000); eq(lang + ' ' + id + ' feedback expires', btn.textContent, label);
      btn.click(); q.copies.at(-1).reject(new Error('current copy denied')); await settle();
      eq(lang + ' ' + id + ' rejection visible', btn.textContent, failure);
      q.input('chmod-numeric', '4755'); eq(lang + ' ' + id + ' edit clears feedback', btn.textContent, label);
    }
  }
  const edits = {
    shortcut: q => q.key('chmod-copy-command'),
    numeric: q => q.input('chmod-numeric', '600'),
    incomplete: q => q.input('chmod-numeric', '6'),
    symbolic: q => q.input('chmod-symbolic', 'rw-r--r--'),
    ordinary: q => q.body.querySelector('input[data-who="owner"][data-perm="w"]').click(),
    special: q => q.get('chmod-sticky').click(),
  };
  for (const [name, edit] of Object.entries(edits)) for (const outcome of ['resolve', 'reject']) {
    const q = page(), btn = q.get('chmod-copy-command'); btn.click(); const job = q.copies.at(-1);
    edit(q); const current = state(q); job[outcome](new Error('late copy')); await settle();
    same(name + ': late copy ' + outcome + ' cannot write feedback', state(q), current); q.advance(5000);
    same(name + ': late copy ' + outcome + ' cannot change current state', state(q), current);
  }
  for (const nextId of ['chmod-copy-command', 'chmod-copy-symbolic']) {
    const q = page(), first = q.get('chmod-copy-command'); first.click(); q.copies.at(-1).resolve(); await settle(); q.advance(1000);
    const next = q.get(nextId); next.click(); q.copies.at(-1).resolve(); await settle(); const current = state(q);
    q.advance(1000); same(nextId + ' newer feedback survives older timer', state(q), current);
    q.advance(1000); eq(nextId + ' newer feedback expires on its own timer', next.textContent, 'Copy');
    first.click(); const old = q.copies.at(-1); next.click(); q.copies.at(-1).reject(new Error('new failure')); await settle();
    const failed = state(q); old.resolve(); await settle();
    same(nextId + ' old success cannot replace newer failure', state(q), failed);
  }
  await settle(); eq('all current and stale clipboard rejections are handled', unhandled.length, 0);
} finally { process.off('unhandledRejection', onUnhandled); }

// Analytics: one event per committed change. Typing sends nothing; the change event of a valid
// field sends one; an invalid or empty field sends none. Checkboxes send one per click.
console.log('\nAnalytics events and numeric input reading');
const t_en = JSON.parse(source.match(/const STRINGS = ([\s\S]*?) as const;/)[1]).en;
{
  const p = page();
  eq('GA: nothing on load', p.tracks.length, 0);
  for (const v of ['6', '64', '644']) p.input('chmod-numeric', v);
  eq('GA: typing a numeric value sends nothing', p.tracks.length, 0);
  p.get('chmod-numeric').dispatch('change');
  same('GA: committing a valid numeric value sends one numeric_input', p.tracks, [['chmod_calculator', 'numeric_input']]);
  p.input('chmod-numeric', '64'); p.get('chmod-numeric').dispatch('change');
  eq('GA: committing an incomplete numeric value sends nothing', p.tracks.length, 1);
  for (const v of ['r', 'rw-', 'rw-r--r--']) p.input('chmod-symbolic', v);
  eq('GA: typing a mode string sends nothing', p.tracks.length, 1);
  p.get('chmod-symbolic').dispatch('change');
  same('GA: committing a valid mode string sends one symbolic_input', p.tracks.at(-1), ['chmod_calculator', 'symbolic_input']);
  p.input('chmod-symbolic', 'rwz'); p.get('chmod-symbolic').dispatch('change');
  eq('GA: committing an invalid mode string sends nothing', p.tracks.length, 2);
  p.body.querySelector('input[data-who="group"][data-perm="w"]').click();
  same('GA: a checkbox sends one toggle', p.tracks.at(-1), ['chmod_calculator', 'toggle']);
  p.get('chmod-setgid').click();
  same('GA: a special bit sends one special_bit', p.tracks.at(-1), ['chmod_calculator', 'special_bit']);
  eq('GA: four events in total', p.tracks.length, 4);
}
{
  // A character that is not 0-7 used to be removed silently: "7558" became 755 and a pasted
  // Python literal "0o644" (cut to "0o64" by maxlength 4) became 064. Now a 0o / 0O prefix and
  // spaces at the ends are ignored, full-width digits from an IME are read through NFKC, and any
  // other character shows the error and keeps the last valid result.
  const p = page();
  p.input('chmod-numeric', '0o644');
  same('0o644 is read as 644', state(p).commands, ['chmod 644 filename', 'chmod u=rw,g=r,o=r filename', 'find . -type f -perm 0644']);
  p.input('chmod-numeric', ' 0O2775 ');
  same('" 0O2775 " is read as 2775', [state(p).values[1], state(p).commands[0]], ['rwxrwsr-x', 'chmod 2775 filename']);
  p.input('chmod-numeric', '７５５');
  same('full-width ７５５ is read as 755', [state(p).values[1], state(p).commands[0], state(p).errors[0]], ['rwxr-xr-x', 'chmod 755 filename', ['', false]]);
  const valid = state(p);
  for (const bad of ['7558', '758', '64 4', '0x1ED', 'chmod', '-644', '0o', '8']) {
    p.input('chmod-numeric', bad);
    const s = state(p);
    same(`${JSON.stringify(bad)} shows the error`, s.errors[0], [t_en.errInvalidOctal, true]);
    same(`${JSON.stringify(bad)} keeps the last valid commands`, s.commands, valid.commands);
    eq(`${JSON.stringify(bad)} is left as typed`, p.get('chmod-numeric').value, bad);
  }
  const m = source.match(/id="chmod-numeric"[^>]*maxlength="(\d+)"/);
  eq('numeric field accepts a 0o prefix and four digits (maxlength 6)', m && m[1], '6');
}


console.log('\nv2 page layout');
{
  const strings = JSON.parse(source.match(/const STRINGS = ([\s\S]*?) as const;/)[1]);
  const leaves = (value, prefix = '') => Object.entries(value).flatMap(([key, item]) => typeof item === 'object' ? leaves(item, prefix + key + '.') : [[prefix + key, item]]);
  const en = leaves(strings.en);
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const rows = leaves(strings[lang]);
    same(lang + ' recursive string keys match en', rows.map(([key]) => key), en.map(([key]) => key));
    for (const [key, value] of rows) {
      eq(lang + ' ' + key + ' is nonempty localized text', typeof value === 'string' && value.trim().length > 0, true);
      same(lang + ' ' + key + ' placeholders match', [...value.matchAll(/\{\w+\}/g)].map(m => m[0]).sort(), [...en.find(([k]) => k === key)[1].matchAll(/\{\w+\}/g)].map(m => m[0]).sort());
    }
    const doc = readFileSync(join(root, `src/content/tools/chmod-calculator/${lang}.mdx`), 'utf8');
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)/.exec(doc), meta = yaml.load(match[1]);
    eq(lang + ' steps are present and bounded', Array.isArray(meta.steps) && meta.steps.length > 0 && meta.steps.length <= 8 && meta.steps.every(s => typeof s === 'string' && s.length <= 280) && meta.steps.join('').length <= 1200, true);
    eq(lang + ' steps precede FAQ', match[1].indexOf('steps:') < match[1].indexOf('faqItems:'), true);
    eq(lang + ' How to Use removed', /<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(match[2]), false);
    eq(lang + ' MDX content contract', contractProblems('chmod-calculator', lang), '');
  }
  const markup = source.split('---')[2].split('<script')[0];
  eq('direct component root uses chmod-wrap', /^\s*<div class="chmod-wrap">/.test(markup), true);
  eq('five distinct tips cover controls', new Set([...markup.matchAll(/<Toggletip id="([^"]+)"/g)].map(m => m[1])).size, 5);
  eq('frontmatter removes tips from client strings', source.includes('const { tips: TIPS, ...CLIENT_T } = T;'), true);
  eq('script receives only selected client language', source.includes('define:vars={{ t: CLIENT_T }}'), true);
  eq('runtime i18n removed', /data-i18n|var STRINGS|document\.documentElement\.lang/.test(source), false);
  eq('all five real copy actions retained', (markup.match(/class="btn-copy"/g) || []).length, 5);
  eq('no new Clear or redundant calculate action', !markup.includes('btn-primary') && !markup.includes('chmod-clear'), true);
  eq('optional special bits start folded', /<details class="chmod-special-section">/.test(markup), true);
  eq('component root stays natural height', /\.chmod-wrap\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-height:\s*0;/.test(source), true);
  eq('errors have reserved scrollable space', /\.chmod-status\s*\{[^}]*height:\s*3rem;[^}]*overflow:\s*auto;/.test(source), true);
  eq('command values have fixed height and internal horizontal scrolling', /\.chmod-output\s*\{[^}]*height:\s*2\.75rem;[^}]*overflow-x:\s*auto;[^}]*white-space:\s*pre;/.test(source), true);
  eq('description height is bounded for maximum permissions', /\.chmod-description\s*\{[^}]*height:\s*4\.5em;[^}]*overflow:\s*auto;/.test(source), true);
  eq('commands are reachable by keyboard', ['chmod-command', 'chmod-command-sym', 'chmod-find-perm'].every(id => new RegExp('id="' + id + '"[^>]*tabindex="0"').test(markup)), true);
  eq('stack and phone breakpoints exist', source.includes('@media (max-width: 860px)') && source.includes('@media (max-width: 640px)'), true);
  const layouts = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
  eq('registered as compact', /['"]chmod-calculator['"]\s*:\s*['"]compact['"]/.test(layouts), true);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
