// Tool-local engine. Declarations relocated unchanged from AiTokenCounterTool.astro.
  /* ── engine:start ── */
  // Unicode White_Space (PropList.txt). OpenAI's tiktoken (Rust regex) and Hugging Face tokenizers
  // (Oniguruma) both read \s as this set; JavaScript's \s adds U+FEFF and leaves out U+0085, so a
  // byte-order mark or NEL would split differently. Rewriting \s and \S makes the browser regex
  // match the reference implementations.
  var WHITE_SPACE = '\\t-\\r \\x85\\xA0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000';

  function unicodeWhiteSpace(pattern) {
    var out = '';
    var inClass = false;
    for (var i = 0; i < pattern.length; i++) {
      var ch = pattern[i];
      if (ch === '\\') {
        var nx = pattern[i + 1];
        if (nx === 's') { out += inClass ? WHITE_SPACE : '[' + WHITE_SPACE + ']'; i++; continue; }
        if (nx === 'S') {
          if (inClass) throw new Error('\\S inside a character class is not supported');
          out += '[^' + WHITE_SPACE + ']';
          i++;
          continue;
        }
        out += ch + (nx === undefined ? '' : nx);
        i++;
        continue;
      }
      if (ch === '[' && !inClass) inClass = true;
      else if (ch === ']' && inClass) inClass = false;
      out += ch;
    }
    return out;
  }

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Min-heap of (rank, position) pairs; ties go to the lower position. Both tiktoken and
  // tokenizers merge the lowest-ranked pair first and, among equal ranks, the leftmost one.
  function createHeap() {
    var r = []; var p = []; var e = [];
    function less(i, j) { return r[i] < r[j] || (r[i] === r[j] && p[i] < p[j]); }
    function swap(i, j) {
      var t = r[i]; r[i] = r[j]; r[j] = t;
      t = p[i]; p[i] = p[j]; p[j] = t;
      t = e[i]; e[i] = e[j]; e[j] = t;
    }
    return {
      size: function () { return r.length; },
      push: function (rank, pos, extra) {
        r.push(rank); p.push(pos); e.push(extra);
        var i = r.length - 1;
        while (i > 0) {
          var pa = (i - 1) >> 1;
          if (!less(i, pa)) break;
          swap(i, pa); i = pa;
        }
      },
      pop: function () {
        var top = [r[0], p[0], e[0]];
        var last = r.length - 1;
        swap(0, last);
        r.pop(); p.pop(); e.pop();
        var i = 0; var n = r.length;
        for (;;) {
          var c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && less(c + 1, c)) c++;
          if (!less(c, i)) break;
          swap(c, i); i = c;
        }
        return top;
      },
    };
  }

  // tiktoken encodings (o200k_base, cl100k_base). Same algorithm as tiktoken's byte_pair_encode:
  // a regex piece that is itself a token stays whole; otherwise merge the adjacent pair whose
  // concatenation has the lowest rank until no pair is a token. js-tiktoken implements this with a
  // linear scan per merge, which takes minutes on a 20,000-character run of CJK text; the heap keeps
  // it O(n log n).
  function createTiktokenEncoding(name, ranks) {
    var rankOf = new Map();
    var bytesOf = [];
    var lines = ranks.bpe_ranks.split('\n');
    for (var li = 0; li < lines.length; li++) {
      if (!lines[li]) continue;
      var parts = lines[li].split(' ');
      var offset = parseInt(parts[1], 10);
      for (var k = 2; k < parts.length; k++) {
        var bin = atob(parts[k]);
        rankOf.set(bin, offset + k - 2);
        var bytes = new Uint8Array(bin.length);
        for (var b = 0; b < bin.length; b++) bytes[b] = bin.charCodeAt(b);
        bytesOf[offset + k - 2] = bytes;
      }
    }
    var pattern = new RegExp(unicodeWhiteSpace(ranks.pat_str), 'gu');
    var encoder = new TextEncoder();

    function latin1(bytes) {
      var s = '';
      for (var i = 0; i < bytes.length; i += 4096) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
      return s;
    }

    function merge(s, out) {
      var n = s.length;
      var whole = rankOf.get(s);
      if (whole !== undefined) { out.push(whole); return; }
      var next = new Int32Array(n); var prev = new Int32Array(n); var alive = new Uint8Array(n);
      for (var i = 0; i < n; i++) { next[i] = i + 1 < n ? i + 1 : -1; prev[i] = i - 1; alive[i] = 1; }
      var endOf = function (i) { return next[i] < 0 ? n : next[i]; };
      var heap = createHeap();
      for (var j = 0; j + 1 < n; j++) {
        var r = rankOf.get(s.slice(j, j + 2));
        if (r !== undefined) heap.push(r, j, j + 2);
      }
      while (heap.size()) {
        var top = heap.pop();
        var a = top[1];
        if (!alive[a] || next[a] < 0) continue;
        var q = next[a];
        if (endOf(q) !== top[2]) continue;
        alive[q] = 0;
        next[a] = next[q];
        if (next[q] >= 0) prev[next[q]] = a;
        var pa = prev[a];
        if (pa >= 0) {
          var r1 = rankOf.get(s.slice(pa, endOf(a)));
          if (r1 !== undefined) heap.push(r1, pa, endOf(a));
        }
        if (next[a] >= 0) {
          var r2 = rankOf.get(s.slice(a, endOf(next[a])));
          if (r2 !== undefined) heap.push(r2, a, endOf(next[a]));
        }
      }
      for (var x = 0; x >= 0; x = next[x]) out.push(rankOf.get(s.slice(x, endOf(x))));
    }

    return {
      name: name,
      // Special tokens such as <|endoftext|> are counted as ordinary text, like tiktoken's
      // encode_ordinary. The API treats them as text in user content.
      pieces: function (text) {
        pattern.lastIndex = 0;
        return text.match(pattern) || [];
      },
      encodePiece: function (piece, out) { merge(latin1(encoder.encode(piece)), out); },
      tokenBytes: function (id) { return bytesOf[id] || new Uint8Array(0); },
    };
  }

  // DeepSeek V4 (Hugging Face tokenizers format): added tokens are matched first, then three
  // "Isolated" regex splits run in sequence, then byte-level BPE applies merges by merge rank.
  // The data module is generated from DeepSeek's official tokenizer.json by
  // scripts/build-deepseek-tokenizer.mjs.
  function createHfBpeEncoding(name, mod) {
    var raw = base64ToBytes(mod.DATA);
    var read = function (i) { return (raw[i * 3] << 16) | (raw[i * 3 + 1] << 8) | raw[i * 3 + 2]; };
    var byteIds = new Int32Array(256);
    for (var b = 0; b < 256; b++) byteIds[b] = read(b);
    var count = mod.MERGE_COUNT;
    var first = mod.FIRST_MERGE_ID;
    var left = new Int32Array(count);
    var right = new Int32Array(count);
    var SHIFT = 1 << 21;
    if (mod.VOCAB_SIZE > SHIFT) throw new Error('vocabulary too large for the pair key');
    var pairRank = new Map();
    for (var i = 0; i < count; i++) {
      left[i] = read(256 + i * 2);
      right[i] = read(256 + i * 2 + 1);
      pairRank.set(left[i] * SHIFT + right[i], i);
    }
    var byteOfId = new Map();
    for (var bb = 0; bb < 256; bb++) byteOfId.set(byteIds[bb], bb);
    var addedText = new Map();
    var added = mod.ADDED_TOKENS.slice().sort(function (x, y) { return y[1].length - x[1].length; });
    var firstChars = new Set();
    added.forEach(function (a) { firstChars.add(a[1][0]); addedText.set(a[0], a[1]); });
    var splitters = mod.SPLIT_PATTERNS.map(function (p) { return new RegExp(unicodeWhiteSpace(p), 'gu'); });
    var encoder = new TextEncoder();
    var bytesCache = new Map();

    function splitAll(pieces, re) {
      var out = [];
      for (var i = 0; i < pieces.length; i++) {
        var piece = pieces[i];
        re.lastIndex = 0;
        var last = 0; var m;
        while ((m = re.exec(piece)) !== null) {
          if (m[0].length === 0) { re.lastIndex++; continue; }
          if (m.index > last) out.push(piece.slice(last, m.index));
          out.push(m[0]);
          last = m.index + m[0].length;
        }
        if (last < piece.length) out.push(piece.slice(last));
      }
      return out;
    }

    function merge(bytes, out) {
      var n = bytes.length;
      if (n === 1) { out.push(byteIds[bytes[0]]); return; }
      var ids = new Int32Array(n); var next = new Int32Array(n); var prev = new Int32Array(n); var alive = new Uint8Array(n);
      for (var i = 0; i < n; i++) { ids[i] = byteIds[bytes[i]]; next[i] = i + 1 < n ? i + 1 : -1; prev[i] = i - 1; alive[i] = 1; }
      var heap = createHeap();
      for (var j = 0; j + 1 < n; j++) {
        var r = pairRank.get(ids[j] * SHIFT + ids[j + 1]);
        if (r !== undefined) heap.push(r, j, 0);
      }
      while (heap.size()) {
        var top = heap.pop();
        var rank = top[0]; var a = top[1];
        if (!alive[a]) continue;
        var q = next[a];
        if (q < 0 || left[rank] !== ids[a] || right[rank] !== ids[q]) continue;
        ids[a] = first + rank;
        alive[q] = 0;
        next[a] = next[q];
        if (next[q] >= 0) prev[next[q]] = a;
        var pa = prev[a];
        if (pa >= 0) {
          var r1 = pairRank.get(ids[pa] * SHIFT + ids[a]);
          if (r1 !== undefined) heap.push(r1, pa, 0);
        }
        if (next[a] >= 0) {
          var r2 = pairRank.get(ids[a] * SHIFT + ids[next[a]]);
          if (r2 !== undefined) heap.push(r2, a, 0);
        }
      }
      for (var x = 0; x >= 0; x = next[x]) out.push(ids[x]);
    }

    function plainPieces(text, out) {
      var pieces = [text];
      for (var s = 0; s < splitters.length; s++) pieces = splitAll(pieces, splitters[s]);
      for (var i = 0; i < pieces.length; i++) out.push(pieces[i]);
    }

    function tokenBytes(id) {
      var hit = bytesCache.get(id);
      if (hit) return hit;
      var result;
      if (addedText.has(id)) result = encoder.encode(addedText.get(id));
      else if (byteOfId.has(id)) result = new Uint8Array([byteOfId.get(id)]);
      else if (id >= first && id < first + count) {
        var l = tokenBytes(left[id - first]); var rr = tokenBytes(right[id - first]);
        result = new Uint8Array(l.length + rr.length);
        result.set(l, 0); result.set(rr, l.length);
      } else result = new Uint8Array(0);
      bytesCache.set(id, result);
      return result;
    }

    return {
      name: name,
      // Pieces are strings, except added tokens (such as <｜User｜>), which are their token id.
      // The official tokenizer.json recognises them inside the text, so they count as 1 token.
      pieces: function (text) {
        var out = [];
        var start = 0;
        var i = 0;
        while (i < text.length) {
          if (firstChars.has(text[i])) {
            var hit = null;
            for (var k = 0; k < added.length; k++) {
              if (text.startsWith(added[k][1], i)) { hit = added[k]; break; }
            }
            if (hit) {
              if (i > start) plainPieces(text.slice(start, i), out);
              out.push(hit[0]);
              i += hit[1].length;
              start = i;
              continue;
            }
          }
          i++;
        }
        if (start < text.length) plainPieces(text.slice(start), out);
        return out;
      },
      encodePiece: function (piece, out) {
        if (typeof piece === 'number') { out.push(piece); return; }
        merge(encoder.encode(piece), out);
      },
      tokenBytes: tokenBytes,
    };
  }

  // Encode everything at once (tests, small inputs). The page uses encodeSteps() instead.
  function encodeAll(enc, text) {
    var pieces = enc.pieces(text);
    var out = [];
    for (var i = 0; i < pieces.length; i++) enc.encodePiece(pieces[i], out);
    return out;
  }

  // Encode in slices so a large input does not block the page: returns a function that encodes up
  // to `budgetMs` of work and reports { done, ids, progress }.
  function encodeSteps(enc, text, now) {
    var pieces = enc.pieces(text);
    var ids = [];
    var i = 0;
    var cache = new Map();
    return function step(budgetMs) {
      var t0 = now();
      while (i < pieces.length) {
        var piece = pieces[i++];
        if (typeof piece === 'string' && piece.length <= 32) {
          var hit = cache.get(piece);
          if (!hit) { hit = []; enc.encodePiece(piece, hit); if (cache.size < 100000) cache.set(piece, hit); }
          for (var k = 0; k < hit.length; k++) ids.push(hit[k]);
        } else {
          enc.encodePiece(piece, ids);
        }
        if ((i & 255) === 0 && now() - t0 > budgetMs) break;
      }
      return { done: i >= pieces.length, ids: ids, progress: pieces.length ? i / pieces.length : 1 };
    };
  }

  var wordSegmenter = null;
  function textStats(text) {
    var chars = 0;
    for (var _c of text) chars++;
    var bytes = new TextEncoder().encode(text).length;
    var words = 0;
    if (text) {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        if (!wordSegmenter) wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
        for (var seg of wordSegmenter.segment(text)) if (seg.isWordLike) words++;
      } else {
        var m = text.match(/\S+/g);
        words = m ? m.length : 0;
      }
    }
    var lines = text ? text.split(/\r\n|\r|\n/).length : 0;
    return { chars: chars, bytes: bytes, words: words, lines: lines };
  }

  // Prices: USD per 1M tokens, standard tier, uncached input. Checked 2026-10-01 on
  // developers.openai.com/api/docs/pricing, platform.claude.com/docs/en/about-claude/pricing,
  // ai.google.dev/gemini-api/docs/pricing and api-docs.deepseek.com/quick_start/pricing (USD) /
  // api-docs.deepseek.com/zh-cn/quick_start/pricing (CNY). Context: input limit from each model page.
  // enc: the tokenizer that gives this model's exact count; ref: no local tokenizer, use o200k as a
  // reference. long: price for the whole request when input tokens exceed `over`.
  var PRICES_CHECKED = '2026-10-01';
  var PRICE_SOURCES = [
    ['OpenAI', 'https://developers.openai.com/api/docs/pricing'],
    ['Anthropic', 'https://platform.claude.com/docs/en/about-claude/pricing'],
    ['Google', 'https://ai.google.dev/gemini-api/docs/pricing'],
    ['DeepSeek', 'https://api-docs.deepseek.com/quick_start/pricing'],
  ];
  var MODELS = [
    { id: 'gpt-6-sol', provider: 'OpenAI', enc: 'ref', input: 2, output: 10, limit: 922000, long: { over: 272000, input: 4, output: 15 } },
    { id: 'gpt-6-luna', provider: 'OpenAI', enc: 'ref', input: 0.1, output: 0.5, limit: 922000, long: { over: 272000, input: 0.2, output: 0.75 } },
    { id: 'gpt-5.5', provider: 'OpenAI', enc: 'o200k', input: 5, output: 30, limit: 1050000, long: { over: 272000, input: 10, output: 45 } },
    { id: 'gpt-5.4-mini', provider: 'OpenAI', enc: 'o200k', input: 0.75, output: 4.5, limit: 272000 },
    { id: 'gpt-4.1', provider: 'OpenAI', enc: 'o200k', input: 2, output: 8, limit: 1047576 },
    { id: 'gpt-4o', provider: 'OpenAI', enc: 'o200k', input: 2.5, output: 10, limit: 128000 },
    { id: 'text-embedding-3-small', provider: 'OpenAI', enc: 'cl100k', input: 0.02, output: null, limit: 8192 },
    { id: 'claude-opus-5-5', provider: 'Anthropic', enc: 'ref', input: 4, output: 20, limit: 1000000 },
    { id: 'claude-sonnet-5-5', provider: 'Anthropic', enc: 'ref', input: 2, output: 10, limit: 1000000 },
    { id: 'claude-haiku-4-5', provider: 'Anthropic', enc: 'ref', input: 1, output: 5, limit: 200000 },
    { id: 'gemini-3.8-flash', provider: 'Google', enc: 'ref', input: 0.75, output: 3.75, limit: 1048576 },
    { id: 'gemini-3.1-pro-preview', provider: 'Google', enc: 'ref', input: 2, output: 12, limit: 1048576, long: { over: 200000, input: 4, output: 18 } },
    { id: 'deepseek-flash', provider: 'DeepSeek', enc: 'deepseek', input: 0.3, output: 1.2, limit: 1000000, offPeak: 0.5, cny: { input: 2, output: 8 } },
    { id: 'deepseek-v4-pro', provider: 'DeepSeek', enc: 'deepseek', input: 1.32, output: 3.96, limit: 1000000, offPeak: 0.5, cny: { input: 9, output: 27 } },
  ];

  // Cost of one request. Returns null parts when the model has no output price.
  function costFor(model, inputTokens, outputTokens, currency) {
    var rate = currency === 'CNY' && model.cny ? model.cny : model;
    var inRate = rate.input;
    var outRate = rate.output;
    var longApplied = false;
    if (model.long && inputTokens > model.long.over && currency !== 'CNY') {
      inRate = model.long.input; outRate = model.long.output; longApplied = true;
    }
    var input = inputTokens * inRate / 1e6;
    var output = outRate == null ? null : outputTokens * outRate / 1e6;
    return { input: input, output: output, total: input + (output || 0), long: longApplied, over: inputTokens > model.limit };
  }

  // Money with at most 4 significant digits (the inputs are exact; the prices are not finer than
  // that), and never in exponent form.
  function formatMoney(value, symbol) {
    if (value == null) return '—';
    if (value === 0) return symbol + '0';
    if (value < 0.000001) return '<' + symbol + '0.000001';
    var digits = value >= 1 ? 2 : Math.min(8, Math.max(2, 3 - Math.floor(Math.log10(value))));
    var f = Math.pow(10, digits);
    // Scale by (1 + 1e-12) so binary rounding (3.045 is stored as 3.04499…) rounds half up.
    var rounded = Math.round(value * f * (1 + 1e-12)) / f;
    return symbol + rounded.toFixed(digits).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
  }

  function formatPercent(part, whole) {
    if (!whole) return '—';
    var p = part / whole * 100;
    if (p === 0) return '0%';
    if (p < 0.01) return '<0.01%';
    return (p < 10 ? p.toFixed(2) : p < 100 ? p.toFixed(1) : p.toFixed(0)) + '%';
  }

  // How a token shows in the token view: its text when its bytes are complete UTF-8, otherwise the
  // bytes in hex inside ⟨⟩ (a character split across tokens, common for CJK and emoji in cl100k).
  var strictDecoder = null;
  function tokenLabel(bytes) {
    if (!strictDecoder) strictDecoder = new TextDecoder('utf-8', { fatal: true });
    try {
      var s = strictDecoder.decode(bytes);
      return { text: s.replace(/ /g, '\u00B7').replace(/\r/g, '\u240D').replace(/\n/g, '\u21B5').replace(/\t/g, '\u2192'), partial: false };
    } catch (e) {
      var hex = [];
      for (var i = 0; i < bytes.length; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
      return { text: '\u27E8' + hex.join(' ') + '\u27E9', partial: true };
    }
  }

  function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, function (m, k) { return values[k] != null ? String(values[k]) : m; });
  }
  /* ── engine:end ── */

export { unicodeWhiteSpace, createTiktokenEncoding, createHfBpeEncoding, encodeAll, encodeSteps, textStats, PRICES_CHECKED, PRICE_SOURCES, MODELS, costFor, formatMoney, formatPercent, tokenLabel, fill };
