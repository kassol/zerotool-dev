// jq Playground engine: pure functions shared by JqPlaygroundTool.astro and
// scripts/test-jq-playground.mjs. No DOM, no jq; the worker (jq-playground.worker.js) runs jq.
//
// The page runs jq 1.7.1 (jq-web 0.6.2, patched by scripts/jq-web-patch.mjs). A run is the same
// as `jq FLAGS FILTER input.json` where input.json holds the input text plus a final newline,
// so stdout, stderr and the exit code can be compared byte for byte with the jq CLI.

export const JQ_VERSION = '1.7.1';
export const INPUT_FILE = 'input.json';

// Output and input options in the order the command line is written.
export const BOOL_OPTIONS = [
  { key: 'n', short: '-n', long: '--null-input' },
  { key: 'R', short: '-R', long: '--raw-input' },
  { key: 's', short: '-s', long: '--slurp' },
  { key: 'r', short: '-r', long: '--raw-output' },
  { key: 'j', short: '-j', long: '--join-output' },
  { key: 'a', short: '-a', long: '--ascii-output' },
  { key: 'S', short: '-S', long: '--sort-keys' },
  { key: 'c', short: '-c', long: '--compact-output' },
  { key: 'e', short: '-e', long: '--exit-status' },
  { key: 'seq', short: null, long: '--seq' },
  { key: 'stream', short: null, long: '--stream' },
];

export function defaultOptions() {
  const o = { indent: '2' };
  for (const d of BOOL_OPTIONS) o[d.key] = false;
  return o;
}

export const INDENT_VALUES = ['2', '4', 'tab', '0', '1', '3', '5', '6', '7'];

export function normalizeOptions(raw) {
  const o = defaultOptions();
  if (!raw || typeof raw !== 'object') return o;
  for (const d of BOOL_OPTIONS) o[d.key] = raw[d.key] === true;
  if (INDENT_VALUES.includes(String(raw.indent))) o.indent = String(raw.indent);
  return o;
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function isValidArgName(name) { return NAME_RE.test(name); }

export function normalizeArgs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => a && typeof a === 'object')
    .map((a) => ({ type: a.type === 'json' ? 'json' : 'string', name: String(a.name || ''), value: String(a.value ?? '') }));
}

// Flags passed to jq, in command-line order. Args with an empty name are left out.
export function buildFlags(opts, args) {
  const o = normalizeOptions(opts);
  const out = [];
  for (const d of BOOL_OPTIONS) if (o[d.key]) out.push(d.short || d.long);
  if (o.indent === 'tab') out.push('--tab');
  else if (o.indent !== '2') out.push('--indent', o.indent);
  for (const a of normalizeArgs(args)) {
    if (!a.name) continue;
    out.push(a.type === 'json' ? '--argjson' : '--arg', a.name, a.value);
  }
  return out;
}

// Problems jq would report for the arguments, checked before running so the message can say
// which row is wrong. jq itself only says "invalid JSON text passed to --argjson".
export function checkArgs(args) {
  const problems = [];
  const seen = new Set();
  normalizeArgs(args).forEach((a, i) => {
    if (!a.name) { if (a.value) problems.push({ row: i, code: 'argNoName' }); return; }
    if (!isValidArgName(a.name)) problems.push({ row: i, code: 'argBadName', name: a.name });
    if (seen.has(a.name)) problems.push({ row: i, code: 'argDuplicate', name: a.name });
    seen.add(a.name);
    if (a.type === 'json') {
      try { JSON.parse(a.value); } catch { problems.push({ row: i, code: 'argBadJson', name: a.name }); }
    }
  });
  return problems;
}

// ── shell ───────────────────────────────────────────────────────────────────

export function shellQuote(s) {
  s = String(s);
  if (s !== '' && /^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// The command a reader can paste into a POSIX shell (bash, zsh) to get the same output.
export function buildCommand(filter, opts, args, file = INPUT_FILE) {
  const words = ['jq', ...buildFlags(opts, args).map(shellQuote)];
  words.push(shellQuote(filter === '' ? '.' : filter));
  words.push(shellQuote(file));
  return words.join(' ');
}

// Split a POSIX shell command line into words and control operators. Supports '...', "..."
// (with \" \\ \$ \` and line continuation), $'...' (ANSI-C escapes), backslash escapes and
// comments. Variables and command substitution are kept as literal text.
export function tokenizeShell(text) {
  const tokens = [];
  let i = 0;
  const n = text.length;
  let word = null;
  const push = () => { if (word !== null) { tokens.push({ type: 'word', value: word }); word = null; } };
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { push(); i++; continue; }
    if (c === '#' && word === null) { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '\\') {
      if (text[i + 1] === '\n') { i += 2; continue; }
      if (i + 1 < n) { word = (word ?? '') + text[i + 1]; i += 2; continue; }
      word = (word ?? '') + '\\'; i++; continue;
    }
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return { tokens, error: 'unclosedSingle' };
      word = (word ?? '') + text.slice(i + 1, end);
      i = end + 1; continue;
    }
    if (c === '$' && text[i + 1] === "'") {
      let j = i + 2; let s = '';
      const esc = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', e: '\x1b', f: '\f', v: '\v', '0': '\0' };
      while (j < n && text[j] !== "'") {
        if (text[j] === '\\' && j + 1 < n) {
          const e = text[j + 1];
          if (e === 'x' && /^[0-9a-fA-F]{1,2}/.test(text.slice(j + 2))) {
            const h = text.slice(j + 2).match(/^[0-9a-fA-F]{1,2}/)[0];
            s += String.fromCharCode(parseInt(h, 16)); j += 2 + h.length; continue;
          }
          if (e === 'u' && /^[0-9a-fA-F]{1,4}/.test(text.slice(j + 2))) {
            const h = text.slice(j + 2).match(/^[0-9a-fA-F]{1,4}/)[0];
            s += String.fromCharCode(parseInt(h, 16)); j += 2 + h.length; continue;
          }
          s += e in esc ? esc[e] : '\\' + e; j += 2; continue;
        }
        s += text[j]; j++;
      }
      if (j >= n) return { tokens, error: 'unclosedSingle' };
      word = (word ?? '') + s; i = j + 1; continue;
    }
    if (c === '"') {
      let j = i + 1; let s = '';
      while (j < n && text[j] !== '"') {
        if (text[j] === '\\' && j + 1 < n) {
          const e = text[j + 1];
          if (e === '\n') { j += 2; continue; }
          if (e === '"' || e === '\\' || e === '$' || e === '`') { s += e; j += 2; continue; }
          s += '\\'; j++; continue;
        }
        s += text[j]; j++;
      }
      if (j >= n) return { tokens, error: 'unclosedDouble' };
      word = (word ?? '') + s; i = j + 1; continue;
    }
    const two = text.slice(i, i + 2);
    if (two === '&&' || two === '||' || two === '>>' || two === '<<') { push(); tokens.push({ type: 'op', value: two }); i += 2; continue; }
    if ('|;&<>()'.includes(c)) { push(); tokens.push({ type: 'op', value: c }); i++; continue; }
    word = (word ?? '') + c; i++;
  }
  push();
  return { tokens, error: null };
}

const LONG_BOOL = new Map(BOOL_OPTIONS.map((d) => [d.long, d.key]));
const SHORT_BOOL = new Map(BOOL_OPTIONS.filter((d) => d.short).map((d) => [d.short[1], d.key]));
// Options that change only colour or buffering; the output text is the same.
const IGNORED = new Set(['-C', '-M', '--color-output', '--monochrome-output', '--unbuffered', '-h', '--help']);
const IGNORED_SHORT = new Set(['C', 'M']);
// Options jq 1.7.1 has but this page cannot run (no extra files, no module path).
const UNSUPPORTED_WITH_VALUE = new Map([
  ['--slurpfile', 2], ['--rawfile', 2],
]);
const UNSUPPORTED = new Set(['--args', '--jsonargs', '--raw-output0', '--binary', '--stream-errors', '--debug-dump-disasm', '--debug-trace', '--debug-trace=all', '--run-tests', '--version', '--build-configuration']);
// jq's main.c: a word is an option when it starts with "--" or with "-" and a letter.
const isOptish = (w) => /^-(-|[A-Za-z])/.test(w);

// Find the jq invocation in a pasted command (`curl … | jq -r '.a' file.json`) and read its
// options as jq 1.7.1 does. Returns null when there is no `jq` word.
export function parseJqCommand(text) {
  const { tokens, error } = tokenizeShell(String(text));
  if (error) return { ok: false, error };
  // Take the last simple command whose first word is jq (or a path ending in /jq).
  let start = -1;
  let cmdStart = 0;
  for (let i = 0; i <= tokens.length; i++) {
    const t = tokens[i];
    if (i === tokens.length || (t.type === 'op' && ['|', '||', '&&', ';', '&', '(', ')'].includes(t.value))) {
      const first = tokens[cmdStart];
      if (first && first.type === 'word' && /(^|\/)jq(\.exe)?$/.test(first.value)) start = cmdStart;
      cmdStart = i + 1;
    }
  }
  if (start < 0) return null;
  const words = [];
  const redirects = [];
  for (let i = start + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'op') {
      if (['<', '>', '>>'].includes(t.value)) { redirects.push(t.value + ' ' + (tokens[i + 1]?.value ?? '')); i++; continue; }
      if (t.value === '<<') { redirects.push('<<'); i++; continue; }
      break;
    }
    words.push(t.value);
  }
  const opts = defaultOptions();
  const args = [];
  const files = [];
  const ignored = [];
  const unsupported = [];
  let filter = null;
  let endOfOptions = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!endOfOptions && w === '--') { endOfOptions = true; continue; }
    if (!endOfOptions && w.startsWith('--') && w.length > 2) {
      if (LONG_BOOL.has(w)) { opts[LONG_BOOL.get(w)] = true; continue; }
      if (w === '--tab') { opts.indent = 'tab'; continue; }
      if (w === '--indent') {
        const v = words[i + 1];
        if (v !== undefined && /^[0-7]$/.test(v)) { opts.indent = v; i++; continue; }
        return { ok: false, error: 'badIndent', value: v ?? '' };
      }
      if (w === '--arg' || w === '--argjson') {
        if (i + 2 >= words.length) return { ok: false, error: 'argMissing', option: w };
        args.push({ type: w === '--argjson' ? 'json' : 'string', name: words[i + 1], value: words[i + 2] });
        i += 2; continue;
      }
      if (IGNORED.has(w)) { ignored.push(w); continue; }
      if (w === '--from-file') return { ok: false, error: 'fromFile' };
      if (UNSUPPORTED_WITH_VALUE.has(w)) { const k = UNSUPPORTED_WITH_VALUE.get(w); unsupported.push([w, ...words.slice(i + 1, i + 1 + k)].join(' ')); i += k; continue; }
      if (UNSUPPORTED.has(w)) { unsupported.push(w); if (w === '--args' || w === '--jsonargs') { endOfOptions = true; } continue; }
      return { ok: false, error: 'unknownOption', option: w };
    }
    if (!endOfOptions && isOptish(w)) {
      if (w[1] === 'L') { unsupported.push(w.length > 2 ? w : w + (words[i + 1] !== undefined ? ' ' + words[i + 1] : '')); if (w.length === 2) i++; continue; }
      for (const ch of w.slice(1)) {
        if (SHORT_BOOL.has(ch)) opts[SHORT_BOOL.get(ch)] = true;
        else if (IGNORED_SHORT.has(ch) || ch === 'h') ignored.push('-' + ch);
        else if (ch === 'f') return { ok: false, error: 'fromFile' };
        else if (ch === 'b' || ch === 'V') unsupported.push('-' + ch);
        else return { ok: false, error: 'unknownOption', option: w };
      }
      continue;
    }
    if (filter === null) filter = w; else files.push(w);
  }
  if (filter === null) return { ok: false, error: 'noFilter' };
  return { ok: true, filter, opts, args, files, ignored, unsupported, redirects };
}

// A filter box that holds a shell command or a quoted filter instead of a jq program.
export function detectPastedCommand(filter) {
  const f = String(filter).trim();
  if (/^(\S*\/)?jq(\.exe)?\s/.test(f) || /\|\s*(\S*\/)?jq(\s|$)/.test(f)) {
    const parsed = parseJqCommand(f);
    if (parsed && parsed.ok) return { kind: 'command', parsed };
  }
  if (f.length >= 2 && ((f[0] === "'" && f[f.length - 1] === "'") || (f[0] === '"' && f[f.length - 1] === '"' && /^"\s*[.[{|$]/.test(f)))) {
    return { kind: 'quoted', filter: f.slice(1, -1) };
  }
  return null;
}

// ── input and output ───────────────────────────────────────────────────────

// jq reads the input as a file that ends with a newline, like `echo '…' | jq` or a saved file.
export function prepareInput(text) {
  text = String(text);
  return text === '' || text.endsWith('\n') ? text : text + '\n';
}

// Number of top-level JSON values in jq's output (one per output; --seq adds RS characters).
export function countJsonValues(text) {
  let n = 0, i = 0;
  const len = text.length;
  const ws = (c) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\x1e';
  while (i < len) {
    const c = text.charAt(i);
    if (ws(c)) { i++; continue; }
    n++;
    if (c === '"') {
      i++;
      while (i < len && text.charAt(i) !== '"') i += text.charAt(i) === '\\' ? 2 : 1;
      i++;
    } else if (c === '[' || c === '{') {
      let depth = 0;
      for (; i < len; i++) {
        const d = text.charAt(i);
        if (d === '"') {
          i++;
          while (i < len && text.charAt(i) !== '"') i += text.charAt(i) === '\\' ? 2 : 1;
        } else if (d === '[' || d === '{') depth++;
        else if (d === ']' || d === '}') { depth--; if (depth === 0) { i++; break; } }
      }
    } else {
      while (i < len && !ws(text.charAt(i)) && !/[\[\]{}"]/.test(text.charAt(i))) i++;
    }
  }
  return n;
}

// Raw output (-r / -j) is not a JSON stream; the page counts lines instead.
export function outputIsJson(opts) {
  const o = normalizeOptions(opts);
  return !o.r && !o.j;
}

// Escapes text for element content (quotes stay, so the highlighter can see JSON strings).
export function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

// JSON syntax highlight for jq's pretty or compact output; everything is escaped first.
export function highlightJson(str) {
  return escapeHtml(str).replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (m) => {
      if (m[0] === '"') return '<span class="' + (/:$/.test(m) ? 'jqp-hl-key' : 'jqp-hl-str') + '">' + m + '</span>';
      if (m === 'true' || m === 'false') return '<span class="jqp-hl-bool">' + m + '</span>';
      if (m === 'null') return '<span class="jqp-hl-null">' + m + '</span>';
      return '<span class="jqp-hl-num">' + m + '</span>';
    },
  );
}

export function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1000 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

// The part of a long output that the page renders: whole lines up to `limit` characters.
export function clipOutput(text, limit) {
  if (text.length <= limit) return { shown: text, clipped: false };
  const cut = text.lastIndexOf('\n', limit);
  return { shown: text.slice(0, cut > 0 ? cut + 1 : limit), clipped: true };
}

export function countLines(text) {
  if (!text) return 0;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

// ── errors ─────────────────────────────────────────────────────────────────

// Split jq's stderr into messages. jq 1.7.1 writes:
//   jq: parse error: MESSAGE at line L, column C            (input is not valid JSON)
//   jq: error: MESSAGE at <top-level>, line L:\nPROGRAM\njq: N compile error(s)
//   jq: error (at input.json:L): MESSAGE                    (runtime error)
//   ["DEBUG:",VALUE]                                        (debug)
export function parseStderr(stderr) {
  const out = [];
  const lines = String(stderr || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;
    let m;
    if ((m = line.match(/^jq: (?:ignoring )?parse error: (.*) at line (\d+), column (\d+)$/))) {
      out.push({ kind: 'parse', message: m[1], line: +m[2], col: +m[3], atEof: / at EOF$/.test(m[1]), text: line });
      continue;
    }
    if ((m = line.match(/^jq: error: (.*) at <top-level>, line (\d+):$/))) {
      const block = [line];
      while (i + 1 < lines.length && !/^jq: (error|\d+ compile error)/.test(lines[i + 1])) block.push(lines[++i]);
      out.push({ kind: 'compile', message: m[1], line: +m[2], text: block.join('\n') });
      continue;
    }
    if ((m = line.match(/^jq: error: (.*)$/))) { out.push({ kind: 'compile', message: m[1], line: null, text: line }); continue; }
    if ((m = line.match(/^jq: \d+ compile errors?$/))) { out.push({ kind: 'summary', text: line }); continue; }
    if ((m = line.match(/^jq: error \(at ([^)]*):(\d+)\): (.*)$/))) {
      out.push({ kind: 'runtime', message: m[3], inputLine: +m[2], text: line });
      continue;
    }
    if (/^\["DEBUG:",/.test(line)) { out.push({ kind: 'debug', text: line }); continue; }
    out.push({ kind: 'other', text: line });
  }
  return out;
}

function utf8Len(cp) { return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4; }

// Character offset in `text` of jq's (line, column). Lines start at 1; the column counts
// UTF-8 bytes from the start of the line, as jq's parser does.
export function offsetOfLineColumn(text, line, col) {
  let pos = 0;
  for (let l = 1; l < line; l++) {
    const nl = text.indexOf('\n', pos);
    if (nl < 0) return text.length;
    pos = nl + 1;
  }
  let bytes = 0;
  while (pos < text.length && bytes < col) {
    const cp = text.codePointAt(pos);
    bytes += utf8Len(cp);
    pos += cp > 0xffff ? 2 : 1;
  }
  return pos;
}

// The part of the input to select for a parse error. jq reports the position just after the
// character that ended the bad token, so select that token, or that character when the token
// before it is empty. Errors "at EOF" point at the end.
export function inputErrorRange(text, err) {
  const sent = prepareInput(text);
  const p = offsetOfLineColumn(sent, err.line, err.col);
  if (err.atEof) {
    const end = text.replace(/\s+$/, '').length;
    return { start: Math.max(0, end - 1), end };
  }
  const term = Math.max(0, p - 1);
  const isTokenChar = (ch) => ch !== undefined && !/[\s{}\[\],:]/.test(ch);
  let s = term;
  while (s > 0 && isTokenChar(sent[s - 1])) s--;
  if (s < term) return { start: s, end: Math.min(term, text.length) };
  return { start: Math.min(term, text.length), end: Math.min(term + 1, text.length) };
}

export function lineRange(text, line) {
  let start = 0;
  for (let l = 1; l < line; l++) {
    const nl = text.indexOf('\n', start);
    if (nl < 0) return { start: text.length, end: text.length };
    start = nl + 1;
  }
  const nl = text.indexOf('\n', start);
  return { start, end: nl < 0 ? text.length : nl };
}

// Characters that an input method or a word processor puts into a filter, outside string
// literals and comments. jq reports them only as "syntax error, unexpected INVALID_CHARACTER".
const SUSPICIOUS = {
  '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u2018': "'", '\u2019': "'",
  '\u00a0': ' ', '\u3000': ' ', '\u200b': '',
  '\uff5c': '|', '\uff0e': '.', '\uff3b': '[', '\uff3d': ']', '\uff5b': '{', '\uff5d': '}',
  '\uff08': '(', '\uff09': ')', '\uff0c': ',', '\uff1a': ':', '\uff1b': ';', '\uff1d': '=',
  '\uff02': '"', '\uff04': '$', '\uff03': '#', '\uff0b': '+', '\uff0d': '-', '\uff0a': '*',
  '\uff0f': '/', '\uff1c': '<', '\uff1e': '>', '\uff1f': '?', '\uff3f': '_', '\uff20': '@',
  '\u3002': '.', '\u3001': ',', '\uff64': ',', '\uff61': '.', '\u2212': '-', '\u2014': '-', '\u2013': '-',
  '\u300c': '"', '\u300d': '"',
};

export function findSuspiciousChars(filter) {
  const found = [];
  const s = String(filter);
  let i = 0;
  // Stack of string interpolation depths: inside "…\( … )…" the code part counts parens.
  const stack = [];
  let inString = false;
  let parens = 0;
  while (i < s.length) {
    const c = s[i];
    if (inString) {
      if (c === '\\') {
        if (s[i + 1] === '(') { stack.push(parens); parens = 0; inString = false; i += 2; continue; }
        i += 2; continue;
      }
      if (c === '"') { inString = false; i++; continue; }
      i++; continue;
    }
    if (c === '"') { inString = true; i++; continue; }
    if (c === '#') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '(') { parens++; i++; continue; }
    if (c === ')') {
      if (parens === 0 && stack.length) { parens = stack.pop(); inString = true; i++; continue; }
      parens--; i++; continue;
    }
    // Fullwidth ASCII letters and digits also come from an input method.
    const cp = c.charCodeAt(0);
    if (c in SUSPICIOUS) found.push({ index: i, ch: c, replacement: SUSPICIOUS[c] });
    else if (cp >= 0xff10 && cp <= 0xff5e) found.push({ index: i, ch: c, replacement: String.fromCharCode(cp - 0xfee0) });
    i++;
  }
  return found;
}

export function fixSuspiciousChars(filter) {
  const found = findSuspiciousChars(filter);
  let out = String(filter);
  for (let k = found.length - 1; k >= 0; k--) {
    const f = found[k];
    out = out.slice(0, f.index) + f.replacement + out.slice(f.index + 1);
  }
  return out;
}

// Builtins added in jq 1.8.0 (NEWS.md); jq 1.7.1 reports them as "NAME/ARITY is not defined".
export const JQ18_BUILTINS = ['trim/0', 'ltrim/0', 'rtrim/0', 'trimstr/1', 'add/1', 'skip/2', 'toboolean/0'];

// Explanations for common jq messages. Each hint is { code, params }; the page has the text.
export function hintsFor(result, ctx = {}) {
  const hints = [];
  const msgs = parseStderr(result && result.stderr);
  const input = String(ctx.input ?? '');
  const opts = normalizeOptions(ctx.opts);
  const add = (code, params = {}) => { if (!hints.some((h) => h.code === code)) hints.push({ code, params }); };
  for (const m of msgs) {
    if (m.kind === 'parse') {
      if (/^\s*$/.test(input)) continue;
      // Look for keys and comments outside JSON strings only.
      const bare = input.replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
      if (/'[^'\n]*'\s*:/.test(input)) add('inputSingleQuotes');
      else if (/[{,]\s*[A-Za-z_$][\w$]*\s*:/.test(bare)) add('inputUnquotedKeys');
      else if (/[:\[,]\s*(True|False|None)\b/.test(input)) add('inputPython');
      else if (/\/\/|\/\*/.test(bare)) add('inputComments');
      else if (/,\s*[}\]]/.test(input)) add('inputTrailingComma');
      else if (/^[^\[{"\d\-tfn\s]/.test(input.trimStart()) && !opts.R) add('inputNotJson');
    } else if (m.kind === 'compile') {
      let mm;
      if ((mm = m.message.match(/^([A-Za-z_][A-Za-z0-9_]*\/\d+) is not defined/)) && JQ18_BUILTINS.includes(mm[1])) add('jq18', { name: mm[1] });
      else if (/^@urid is not a valid format/.test(m.message)) add('jq18', { name: '@urid' });
      else if ((mm = m.message.match(/^\$([A-Za-z_][A-Za-z0-9_]*) is not defined/)) && mm[1] !== '__prog_args') add('undefinedVar', { name: mm[1] });
      else if (/^module not found/.test(m.message) || /^import/.test(m.message)) add('noModules');
      // Input-method characters and pasted commands get their own note under the filter.
      else if (/Unix shell quoting issues|INVALID_CHARACTER/.test(m.message) && !findSuspiciousChars(ctx.filter || '').length && !detectPastedCommand(ctx.filter || '')) add('shellQuoting');
    } else if (m.kind === 'runtime') {
      let mm;
      if ((mm = m.message.match(/^Cannot index array with string "(.*)"$/))) add('indexArray', { key: mm[1] });
      else if ((mm = m.message.match(/^Cannot index string with string "(.*)"$/))) add('indexString', { key: mm[1] });
      else if (/^Cannot iterate over null/.test(m.message)) add('iterateNull');
      else if (/^Cannot iterate over (number|string|boolean)/.test(m.message)) add('iterateScalar');
      else if ((mm = m.message.match(/^Cannot index (number|boolean|null) with/))) add('indexScalar', { type: mm[1] });
      else if (/cannot be added|cannot be subtracted/.test(m.message)) add('typeMismatch');
      else if (/cannot be parsed as a number|\(while parsing '/.test(m.message)) add('notNumber');
      else if (/^Cannot use .* as object key/.test(m.message)) add('objectKey');
    }
  }
  if (result && result.exitCode === 1 && opts.e && !msgs.length) add('exitStatus');
  return hints;
}

// ── share link ─────────────────────────────────────────────────────────────

// The link carries the filter, the options and the --arg names. Input JSON and --arg values
// stay on this device. The fragment (#…) is not sent to the server.
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function encodeShare(filter, opts, args) {
  const o = normalizeOptions(opts);
  const flags = BOOL_OPTIONS.filter((d) => o[d.key]).map((d) => d.key);
  const payload = { v: 1, f: String(filter) };
  if (flags.length) payload.o = flags;
  if (o.indent !== '2') payload.i = o.indent;
  const names = normalizeArgs(args).filter((a) => a.name).map((a) => (a.type === 'json' ? 'j:' : 's:') + a.name);
  if (names.length) payload.a = names;
  return 'jq=' + b64urlEncode(JSON.stringify(payload));
}

export function decodeShare(hash) {
  const m = String(hash || '').replace(/^#/, '').match(/(?:^|&)jq=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  let p;
  try { p = JSON.parse(b64urlDecode(m[1])); } catch { return { error: true }; }
  if (!p || p.v !== 1 || typeof p.f !== 'string') return { error: true };
  const opts = defaultOptions();
  if (Array.isArray(p.o)) for (const k of p.o) if (BOOL_OPTIONS.some((d) => d.key === k)) opts[k] = true;
  if (INDENT_VALUES.includes(String(p.i))) opts.indent = String(p.i);
  const args = Array.isArray(p.a) ? p.a.map(String).filter((s) => /^[sj]:/.test(s)).map((s) => ({ type: s[0] === 'j' ? 'json' : 'string', name: s.slice(2), value: s[0] === 'j' ? 'null' : '' })) : [];
  return { filter: p.f, opts, args };
}

// ── sample and examples ────────────────────────────────────────────────────

export const SAMPLE_INPUT = `{
  "orders": [
    {"id": "A-1001", "customer": "Alice", "status": "paid",     "total": 42.5, "items": ["book", "pen"]},
    {"id": "A-1002", "customer": "Bob",   "status": "pending",  "total": 18,   "items": ["mug"]},
    {"id": "A-1003", "customer": "Alice", "status": "paid",     "total": 7.25, "items": []},
    {"id": "A-1004", "customer": "Carol", "status": "refunded", "total": 30,   "items": ["lamp"]}
  ]
}`;

export const DEFAULT_FILTER = '.orders[] | select(.status == "paid") | .id';

// jq 1.7.1 output for SAMPLE_INPUT and DEFAULT_FILTER (checked by the test); shown before the
// engine has loaded, so the page does not download jq.wasm until it is used.
export const SAMPLE_OUTPUT = '"A-1001"\n"A-1003"\n';

// Examples. `manual` is the anchor in the jq 1.7 manual (https://jqlang.org/manual/v1.7/);
// examples with a manual anchor use that entry's program and input, and the test checks the
// output against the manual. The others use SAMPLE_INPUT or their own input.
export const EXAMPLES = [
  { id: 'paid-ids', group: 'basics', filter: DEFAULT_FILTER },
  { id: 'field', group: 'basics', filter: '.foo', input: '{"foo": 42, "bar": "less interesting data"}', manual: 'object-identifier-index' },
  { id: 'optional', group: 'basics', filter: '[.[] | .a?]', input: '[{}, true, {"a":1}]', manual: 'optional-object-identifier-index' },
  { id: 'slice', group: 'basics', filter: '.[2:4]', input: '["a","b","c","d","e"]', manual: 'array-string-slice' },
  { id: 'iterate', group: 'basics', filter: '.[]', input: '[{"name":"JSON", "good":true}, {"name":"XML", "good":false}]', manual: 'array-object-value-iterator' },
  { id: 'comma', group: 'basics', filter: '.user, .projects[]', input: '{"user":"stedolan", "projects": ["jq", "wikiflow"]}', manual: 'comma' },
  { id: 'alt', group: 'basics', filter: '.foo // 42', input: '{}', manual: 'alternative-operator' },
  { id: 'object', group: 'build', filter: '{user, title: .titles[]}', input: '{"user":"stedolan","titles":["JQ Primer", "More JQ"]}', manual: 'object-construction' },
  { id: 'pick', group: 'build', filter: 'pick(.a, .b.c, .x)', input: '{"a": 1, "b": {"c": 2, "d": 3}, "e": 4}', manual: 'pick-pathexps' },
  { id: 'map', group: 'build', filter: 'map(.+1)', input: '[1,2,3]', manual: 'map-f-map_values-f' },
  { id: 'to-entries', group: 'build', filter: 'with_entries(.key |= "KEY_" + .)', input: '{"a": 1, "b": 2}', manual: 'to_entries-from_entries-with_entries-f' },
  { id: 'select', group: 'filter', filter: 'map(select(. >= 2))', input: '[1,5,3,0,7]', manual: 'select-boolean_expression' },
  { id: 'select-sample', group: 'filter', filter: '[.orders[] | select(.total > 20) | {id, total}]' },
  { id: 'has', group: 'filter', filter: 'map(has("foo"))', input: '[{"foo": 42}, {}]', manual: 'has-key' },
  { id: 'unique', group: 'filter', filter: 'unique_by(length)', input: '["chunky", "bacon", "kitten", "cicada", "asparagus"]', manual: 'unique-unique_by-path_exp' },
  { id: 'group-by', group: 'aggregate', filter: '.orders | group_by(.customer) | map({customer: .[0].customer, orders: length, total: (map(.total) | add)})' },
  { id: 'sort-by', group: 'aggregate', filter: 'sort_by(.foo, .bar)', input: '[{"foo":4, "bar":10}, {"foo":3, "bar":20}, {"foo":2, "bar":1}, {"foo":3, "bar":10}]', manual: 'sort-sort_by-path_expression' },
  { id: 'reduce', group: 'aggregate', filter: 'reduce .[] as [$i,$j] (0; . + $i * $j)', input: '[[1,2],[3,4],[5,6]]', manual: 'reduce' },
  { id: 'add', group: 'aggregate', filter: 'add', input: '["a","b","c"]', manual: 'add' },
  { id: 'paths', group: 'paths', filter: '[paths]', input: '[1,[[],{"a":2}]]', manual: 'paths-paths-node_filter' },
  { id: 'getpath', group: 'paths', filter: '[getpath(["a","b"], ["a","c"])]', input: '{"a":{"b":0, "c":1}}', manual: 'getpath-path_expression' },
  { id: 'del', group: 'paths', filter: 'del(.[1, 2])', input: '["foo", "bar", "baz"]', manual: 'del-path_expression' },
  { id: 'update', group: 'paths', filter: '(..|select(type=="boolean")) |= if . then 1 else 0 end', input: '[true,false,[5,true,[true,[false]],false]]', manual: 'complex-assignments' },
  { id: 'split', group: 'strings', filter: 'split(", ")', input: '"a, b,c,d, e, "', manual: 'split-str' },
  { id: 'test', group: 'strings', filter: '.[] | test("a b c # spaces are ignored"; "ix")', input: '["xabcd", "ABC"]', manual: 'test-val-test-regex-flags' },
  { id: 'capture', group: 'strings', filter: 'capture("(?<a>[a-z]+)-(?<n>[0-9]+)")', input: '"xyzzy-14"', manual: 'capture-val-capture-regex-flags' },
  { id: 'interpolation', group: 'strings', filter: '"The input was \\(.), which is one less than \\(.+1)"', input: '42', manual: 'string-interpolation' },
  { id: 'csv', group: 'formats', filter: '@csv', input: '[1, "one", "with \\"quotes\\""]', flags: { r: true } },
  { id: 'tsv', group: 'formats', filter: '.orders[] | [.id, .customer, .total] | @tsv', flags: { r: true } },
  { id: 'base64', group: 'formats', filter: '@base64', input: '"This is a message"', manual: 'format-strings-and-escaping' },
  { id: 'dates', group: 'formats', filter: 'fromdate', input: '"2015-03-05T23:51:47Z"', manual: 'dates' },
  { id: 'arg', group: 'options', filter: '.orders[] | select(.customer == $name) | .id', args: [{ type: 'string', name: 'name', value: 'Alice' }] },
  { id: 'argjson', group: 'options', filter: '.orders | map(select(.total >= $min.total)) | length', args: [{ type: 'json', name: 'min', value: '{"total": 20}' }] },
  { id: 'jsonl-slurp', group: 'options', filter: 'map(.ms) | add / length', input: '{"path": "/", "ms": 12}\n{"path": "/api", "ms": 48}\n{"path": "/", "ms": 9}', flags: { s: true } },
  { id: 'jsonl-n', group: 'options', filter: 'reduce inputs as $r ({}; .[$r.path] += 1)', input: '{"path": "/", "ms": 12}\n{"path": "/api", "ms": 48}\n{"path": "/", "ms": 9}', flags: { n: true } },
  { id: 'raw-in', group: 'options', filter: '[splits("\\n")] | map(select(length > 0) | split("=") | {(.[0]): .[1]}) | add', input: 'HOST=example.com\nPORT=8080\nDEBUG=true', flags: { R: true, s: true } },
  { id: 'compact', group: 'options', filter: '.orders[] | {id, items}', flags: { c: true } },
  { id: 'def', group: 'functions', filter: 'def addvalue(f): f as $x | map(. + $x); addvalue(.[0])', input: '[[1,2],[10,20]]', manual: 'defining-functions' },
  { id: 'limit', group: 'functions', filter: '[limit(3;.[])]', input: '[0,1,2,3,4,5,6,7,8,9]', manual: 'limit-n-exp' },
  { id: 'try', group: 'functions', filter: '.[] | try error("\\(.)") catch .', input: '["a", 1]' },
];
export const EXAMPLE_GROUPS = ['basics', 'build', 'filter', 'aggregate', 'paths', 'strings', 'formats', 'options', 'functions'];

export function exampleState(ex) {
  const opts = defaultOptions();
  if (ex.flags) for (const k of Object.keys(ex.flags)) opts[k] = ex.flags[k];
  return { filter: ex.filter, input: ex.input ?? SAMPLE_INPUT, opts, args: normalizeArgs(ex.args || []) };
}
