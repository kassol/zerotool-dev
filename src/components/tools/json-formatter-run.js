import { analyze, serialize, highlight, codeFrame, decodeBytes, kindOf, orderOf, scalarOut, pointerOf } from './json-formatter-engine.js';

// The shipped worker and the tests both call this runner. It keeps the last parsed document
// and returns only what the page shows: the full output text (Copy / Download), the first
// 1 MB of it (highlighted as HTML when the whole output fits), notes with line numbers, and
// tree rows one page at a time.
export const HIGHLIGHT_LIMIT = 1_000_000;

function utf8Size(s) { return new Blob([s]).size; }

// Highlighted output is cut at line ends into blocks of about BLOCK characters. The page styles
// .jf-blk with content-visibility: auto, so the browser lays out only blocks near the visible
// part. No highlight span crosses a line end (serialize writes line breaks only between
// tokens), so every block is complete HTML. The height hint is the line count (white-space:
// pre, line-height 1.5).
export const BLOCK = 16 * 1024;
export function blockHtml(html) {
  let out = '';
  for (let pos = 0; pos < html.length;) {
    let end = Math.min(html.length, pos + BLOCK);
    const nl = html.indexOf('\n', end);
    end = end >= html.length || nl < 0 ? html.length : nl + 1;
    const part = html.slice(pos, end);
    let lines = part.charAt(part.length - 1) === '\n' ? 0 : 1;
    for (let i = part.indexOf('\n'); i !== -1; i = part.indexOf('\n', i + 1)) lines++;
    out += '<span class="jf-blk" style="contain-intrinsic-height: auto ' + lines * 1.5 + 'em">' + part + '</span>';
    pos = end;
  }
  return out;
}

// Line number of an offset: the same value as lineCol(text, offset).line, from one pass over
// the text instead of one pass per note.
function lineFinder(text) {
  let nl = null;
  return (offset) => {
    if (!nl) {
      const list = [];
      for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) list.push(i);
      nl = list;
    }
    let lo = 0, hi = nl.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < offset) lo = mid + 1; else hi = mid; }
    return lo + 1;
  };
}

function rowOf(seg, value, dup, o) {
  const kind = kindOf(value);
  const row = { seg, kind, dup: !!dup };
  if (kind === 'object') { row.count = value.k.length; row.hasKids = row.count > 0; }
  else if (kind === 'array') { row.count = value.v.length; row.hasKids = row.count > 0; }
  else {
    const s = scalarOut(value, o);
    row.preview = s.length > 200 ? s.slice(0, 199) + '…' : s;
    row.hasKids = false;
  }
  return row;
}

// res: the result of analyze(text). o: serialize options plus `text` (false skips the
// highlighted / truncated display, as the tree view does not show it).
export function viewOf(res, text, o) {
  const line = lineFinder(text);
  const base = res.base || 0;
  const v = { ok: !!res.ok, empty: !!res.empty, bom: !!res.bom };
  if (res.ok) {
    const out = serialize(res.root, o);
    v.mode = res.mode;
    v.changes = res.changes;
    v.stats = res.stats;
    v.inner = res.inner;
    v.out = out;
    v.inSize = utf8Size(text);
    v.outSize = utf8Size(out);
    v.big = out.length > HIGHLIGHT_LIMIT;
    if (o.text !== false) {
      if (!v.big) v.html = blockHtml(highlight(out));
      else {
        const cut = out.lastIndexOf('\n', HIGHLIGHT_LIMIT);
        v.display = out.slice(0, cut > 0 ? cut : HIGHLIGHT_LIMIT) + '\n…';
      }
    }
    const path = (segs) => (segs.length ? pointerOf(segs) : null);
    v.dupCount = res.dupCount;
    v.dups = res.dups.map((d) => ({ key: d.key, path: path(d.path), line: line(d.offset + base) }));
    v.numberCount = res.numberCount;
    v.numbers = res.numbers.map((x) => ({ kind: x.kind, raw: x.raw, js: x.js, path: path(x.path), line: line(x.offset + base) }));
    v.surrogateCount = res.surrogateCount;
    v.surrogates = res.surrogates.map((x) => ({ path: path(x.path), line: line(x.offset + base) }));
    v.root = rowOf(null, res.root, false, o);
  } else if (!res.empty) {
    const off = res.error.offset + base;
    v.error = { code: res.error.code, offset: res.error.offset, ch: res.error.ch || text.charAt(res.error.offset) || '' };
    v.frame = codeFrame(text, off);
    v.errorRange = [off, Math.min(text.length, off + 1)];
    v.json5 = res.json5 || null;
    v.hint = res.hint || null;
  }
  return v;
}

export function createFormatterRunner() {
  let doc = null; // { id, text, res }
  let listCache = null; // { key, list }
  function find(path) {
    let node = doc.res.root;
    for (const idx of path) {
      if (node === null || typeof node !== 'object' || node.t === 'n' || !node.v || idx >= node.v.length) return undefined;
      node = node.v[idx];
    }
    return node;
  }
  function keep(id, text, res) { doc = { id, text, res }; listCache = null; }
  return function run(m) {
    if (m.type === 'analyze') {
      const res = analyze(m.text, { json5: !!m.json5 });
      keep(m.docId, m.text, res);
      return viewOf(res, m.text, m.opts);
    }
    if (m.type === 'decode') {
      const d = decodeBytes(new Uint8Array(m.buffer));
      if (d.error) return { decoded: { error: d.error, offset: d.offset } };
      const res = analyze(d.text, { json5: !!m.json5 });
      keep(m.docId, d.text, res);
      return { decoded: { text: d.text, encoding: d.encoding }, view: viewOf(res, d.text, m.opts) };
    }
    if (m.type !== 'render' && m.type !== 'children') throw new Error('Unknown request: ' + m.type);
    if (!doc || doc.id !== m.docId) return { stale: true };
    if (m.type === 'render') return viewOf(doc.res, doc.text, m.opts);
    if (m.type === 'children') {
      const node = find(m.path);
      if (node === undefined) return { stale: true };
      const o = m.opts;
      if (node === null || typeof node !== 'object' || node.t === 'n') return { total: 0, rows: [] };
      // Same rows as childrenOf(node, o), one page at a time; `idx` is the position in node.v,
      // which the page sends back to open that child.
      const key = m.path.join('/') + '|' + o.sortKeys + '|' + o.dupes;
      if (!listCache || listCache.key !== key) listCache = { key, order: node.t === 'a' ? null : orderOf(node, o) };
      const order = listCache.order;
      const total = order ? order.length : node.v.length;
      const end = Math.min(total, m.from + m.count);
      const rows = [];
      for (let x = m.from; x < end; x++) {
        const idx = order ? order[x] : x;
        const seg = order ? node.k[idx] : idx;
        const dup = !!order && !!node.d && o.dupes !== 'last' && node.k.indexOf(node.k[idx]) !== idx;
        const r = rowOf(seg, node.v[idx], dup, o);
        r.idx = idx;
        rows.push(r);
      }
      return { total, rows };
    }
  };
}

// Page side. A new analyze / decode terminates a worker that is still busy with one, so the
// previous document never finishes. Results of a terminated worker are ignored.
export function createFormatterClient(makeWorker) {
  let worker = null;
  let sequence = 0;
  let heavy = 0;
  const pending = new Map();
  function reset(error) {
    const old = worker;
    worker = null;
    heavy = 0;
    if (old) old.terminate();
    for (const r of pending.values()) r.reject(error);
    pending.clear();
  }
  function abortError() { const e = new Error('Cancelled'); e.name = 'AbortError'; return e; }
  function request(type, payload, transfer) {
    if (!worker) {
      const instance = makeWorker();
      worker = instance;
      instance.onmessage = ({ data }) => {
        if (worker !== instance) return;
        const item = pending.get(data.id);
        if (!item) return;
        pending.delete(data.id);
        if (item.heavy) heavy--;
        if (data.type === 'error') item.reject(new Error(data.message));
        else item.resolve(data.result);
      };
      instance.onerror = instance.onmessageerror = (e) => {
        if (worker === instance) reset(new Error((e && e.message) || 'Worker failed'));
      };
    }
    const id = ++sequence;
    const isHeavy = type === 'analyze' || type === 'decode' || type === 'render';
    if (isHeavy) heavy++;
    return new Promise((resolve, reject) => {
      pending.set(id, { heavy: isHeavy, resolve, reject });
      try { worker.postMessage(Object.assign({ id, type }, payload), transfer || []); }
      catch (error) { reset(error); }
    });
  }
  let docSeq = 0;
  return {
    get busy() { return heavy > 0; },
    analyze(text, json5, opts) {
      if (heavy > 0) reset(abortError());
      const docId = ++docSeq;
      return request('analyze', { text, json5, opts, docId }).then((view) => ({ docId, view }));
    },
    decode(buffer, json5, opts) {
      if (heavy > 0) reset(abortError());
      const docId = ++docSeq;
      return request('decode', { buffer, json5, opts, docId }, [buffer]).then((r) => Object.assign({ docId }, r));
    },
    render(docId, opts) { return request('render', { docId, opts }); },
    children(docId, path, from, count, opts) { return request('children', { docId, path, from, count, opts }); },
    cancel() { if (heavy > 0) reset(abortError()); },
    dispose() { reset(abortError()); },
  };
}
