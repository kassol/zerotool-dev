// Tool-local engine. Declarations relocated unchanged from JsonFormatterTool.astro.
  /* ── engine:start ── */
  // Pure functions. The test runs this block in Node (scripts/test-json-formatter.mjs).
  // A parsed document is a tree of: null, true, false, a JS string, { t: 'n', r: '<number as
  // written>' }, { t: 'a', v: [...] } or { t: 'o', k: [keys], v: [values] } (every member is
  // kept, duplicates included). Numbers keep their source text, so 12345678901234567890, 1.0
  // and 1e2 are written back unchanged; JSON.parse would read them as doubles.
  var MAX_LIST = 50;

  function fmt(tpl, params) {
    return String(tpl).replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] !== undefined && params[k] !== null ? String(params[k]) : m;
    });
  }
  function escSeg(s) { return String(s).replace(/~/g, '~0').replace(/\//g, '~1'); }
  function pointerOf(segs) { return segs.map(function (s) { return '/' + escSeg(s); }).join(''); }
  function jqPathOf(segs) {
    if (!segs.length) return '.';
    return segs.map(function (s) {
      if (typeof s === 'number') return '[' + s + ']';
      return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? '.' + s : '[' + JSON.stringify(s) + ']';
    }).join('').replace(/^\[/, '.[');
  }

  // Copied verbatim from JsonSchemaValidatorTool.astro (the test compares the source).
  function lineCol(text, offset) {
    var line = 1, last = -1;
    for (var i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) { line++; last = i; }
    return { line: line, col: offset - last };
  }

  // Copied verbatim from JsonSchemaValidatorTool.astro (the test compares the source).
  // Called only after strict parsing failed: names the first error and its usual cause.
  function jsonSyntaxError(text) {
    var i = 0, n = text.length;
    var SMART = '\u201c\u201d\u2018\u2019\u300c\u300d';
    var WIDE = '\u3000\uff1a\uff0c\uff5b\uff5d\uff3b\uff3d\uff02';
    function fail(code, at, ch) { throw { jsonErr: true, code: code, offset: at === undefined ? i : at, ch: ch }; }
    function special(c) {
      if (SMART.indexOf(c) >= 0) fail('smartQuote', i, c);
      if (WIDE.indexOf(c) >= 0) fail('fullWidth', i, c);
    }
    function ws() {
      while (i < n) {
        var c = text[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
        if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) fail('comment');
        if (c === '#') fail('comment');
        break;
      }
    }
    var NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    var WORD = /[A-Za-z_$][\w$]*/y;
    function str() {
      var s = i; i++;
      while (i < n) {
        var c = text.charCodeAt(i);
        if (c === 34) { i++; return; }
        if (c === 92) {
          var e = text[i + 1];
          if (e !== undefined && '"\\/bfnrt'.indexOf(e) >= 0) { i += 2; continue; }
          if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(text.substr(i + 2, 4))) { i += 6; continue; }
          fail('badEscape');
        }
        if (c < 0x20) fail('controlChar');
        i++;
      }
      fail('unterminatedString', s);
    }
    function num() {
      NUM.lastIndex = i;
      var m = NUM.exec(text);
      if (!m || m[0] === '-' || m[0] === '') fail('badNumber');
      i += m[0].length;
      if (i < n && /[0-9.eE]/.test(text[i])) fail('badNumber');
    }
    function startsValue(c) { return c === '{' || c === '[' || c === '"' || c === '-' || (c >= '0' && c <= '9') || c === 't' || c === 'f' || c === 'n'; }
    function value(depth) {
      if (depth > 3000) fail('unexpectedChar');
      ws();
      if (i >= n) fail('unexpectedEnd');
      var c = text[i];
      if (c === '{') return obj(depth);
      if (c === '[') return arr(depth);
      if (c === '"') return str();
      if (c === "'") fail('singleQuote');
      special(c);
      if (c === '-' || (c >= '0' && c <= '9')) return num();
      if (c === '+' || c === '.') fail('badNumber');
      WORD.lastIndex = i;
      var m = WORD.exec(text);
      if (m) {
        if (m[0] === 'true' || m[0] === 'false' || m[0] === 'null') { i += m[0].length; return; }
        if (m[0] === 'NaN' || m[0] === 'Infinity') fail('badNumber');
        fail('badLiteral');
      }
      fail('unexpectedChar', i, c);
    }
    function obj(depth) {
      i++; ws();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        ws();
        if (i >= n) fail('unexpectedEnd');
        var c = text[i];
        if (c === "'") fail('singleQuote');
        special(c);
        if (c !== '"') { if (/[A-Za-z_$0-9]/.test(c)) fail('unquotedKey'); fail('unexpectedChar', i, c); }
        str(); ws();
        if (i >= n) fail('unexpectedEnd');
        if (text[i] !== ':') { special(text[i]); fail('missingColon'); }
        i++;
        value(depth + 1); ws();
        if (i >= n) fail('unexpectedEnd');
        c = text[i];
        if (c === ',') { var comma = i; i++; ws(); if (text[i] === '}') fail('trailingComma', comma); continue; }
        if (c === '}') { i++; return; }
        special(c);
        if (c === '"' || /[A-Za-z_$]/.test(c)) fail('missingComma');
        fail('unexpectedChar', i, c);
      }
    }
    function arr(depth) {
      i++; ws();
      if (text[i] === ']') { i++; return; }
      for (;;) {
        value(depth + 1); ws();
        if (i >= n) fail('unexpectedEnd');
        var c = text[i];
        if (c === ',') { var comma = i; i++; ws(); if (text[i] === ']') fail('trailingComma', comma); continue; }
        if (c === ']') { i++; return; }
        special(c);
        if (startsValue(c)) fail('missingComma');
        fail('unexpectedChar', i, c);
      }
    }
    try {
      ws();
      if (i >= n) return { code: 'empty', offset: 0 };
      value(0);
      ws();
      if (i < n) fail('extraData');
      return null;
    } catch (e) {
      if (e && e.jsonErr) return { code: e.code, offset: e.offset, ch: e.ch };
      throw e;
    }
  }

  /* Parser ------------------------------------------------------------------------------
     j5 = false: RFC 8259 / ECMA-404 exactly (accepts what JSON.parse accepts).
     j5 = true: JSON5 1.0.0 (spec.json5.org), which also covers JSONC: line and block comments,
     trailing commas, single-quoted strings, unquoted (ECMAScript identifier) keys, hex,
     leading +, .5 and 5. numbers, \x \v \0 \' escapes, line continuations and the extra
     whitespace characters. Infinity and NaN have no JSON form and stay an error. */
  var ID_START = /[$_\p{L}\p{Nl}]/u;
  var ID_PART = /[$_\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}\u200c\u200d]/u;
  var NUM_JSON = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  var NUM_J5 = /[+-]?(?:Infinity|NaN|0[xX][0-9a-fA-F]+|(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/y;
  function isJ5Space(c) {
    return c === 11 || c === 12 || c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029 ||
      c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x202f || c === 0x205f || c === 0x3000;
  }

  function parseJson(text, j5) {
    var n = text.length, i = 0;
    var changes = j5 ? { comments: 0, trailingCommas: 0, singleQuotes: 0, unquotedKeys: 0, numbers: 0, escapes: 0, whitespace: 0 } : null;
    var stats = { objects: 0, arrays: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0, keys: 0, depth: 0 };
    var dups = [], dupCount = 0, surr = [], surrCount = 0, nums = [], numCount = 0;
    var stack = [];
    function err(code, at) { throw { jfErr: true, code: code, offset: at === undefined ? i : at }; }
    function segsNow() {
      var s = [];
      for (var d = 0; d < stack.length; d++) s.push(stack[d].node.t === 'o' ? stack[d].key : stack[d].node.v.length);
      return s;
    }
    function ws() {
      while (i < n) {
        var c = text.charCodeAt(i);
        if (c === 32 || c === 10 || c === 13 || c === 9) { i++; continue; }
        if (!j5) return;
        if (isJ5Space(c)) { changes.whitespace++; i++; continue; }
        if (c === 47 && text.charCodeAt(i + 1) === 47) {
          changes.comments++; i += 2;
          while (i < n) { var d = text.charCodeAt(i); if (d === 10 || d === 13 || d === 0x2028 || d === 0x2029) break; i++; }
          continue;
        }
        if (c === 47 && text.charCodeAt(i + 1) === 42) {
          var end = text.indexOf('*/', i + 2);
          if (end < 0) err('unterminatedComment');
          changes.comments++; i = end + 2;
          continue;
        }
        return;
      }
    }
    function hex4(at) {
      var h = text.substr(at, 4);
      if (!/^[0-9a-fA-F]{4}$/.test(h)) err('badEscape', at - 2);
      return parseInt(h, 16);
    }
    function readString() {
      var q = text.charCodeAt(i), open = i;
      if (q === 39) changes.singleQuotes++;
      i++;
      var out = '', seg = i, hadSurr = false;
      for (;;) {
        if (i >= n) err('unterminatedString', open);
        var c = text.charCodeAt(i);
        if (c === q) break;
        if (c === 92) {
          out += text.slice(seg, i);
          var e = text.charCodeAt(i + 1);
          switch (e) {
            case 34: out += '"'; break;
            case 92: out += '\\'; break;
            case 47: out += '/'; break;
            case 98: out += '\b'; break;
            case 102: out += '\f'; break;
            case 110: out += '\n'; break;
            case 114: out += '\r'; break;
            case 116: out += '\t'; break;
            case 117: {
              var u = hex4(i + 2);
              if (u >= 0xd800 && u <= 0xdfff) hadSurr = true;
              out += String.fromCharCode(u); i += 6; seg = i; continue;
            }
            default: {
              if (!j5 || i + 1 >= n) err('badEscape');
              changes.escapes++;
              if (e === 39) out += "'";
              else if (e === 118) out += '\v';
              else if (e === 48) { var nx = text.charCodeAt(i + 2); if (nx >= 48 && nx <= 57) err('badEscape'); out += '\0'; }
              else if (e === 120) {
                var h = text.substr(i + 2, 2);
                if (!/^[0-9a-fA-F]{2}$/.test(h)) err('badEscape');
                out += String.fromCharCode(parseInt(h, 16)); i += 4; seg = i; continue;
              } else if (e === 10 || e === 0x2028 || e === 0x2029) { /* line continuation */ }
              else if (e === 13) { if (text.charCodeAt(i + 2) === 10) i++; }
              else if (e >= 49 && e <= 57) err('badEscape');
              else {
                var cp = text.codePointAt(i + 1);
                var ch = String.fromCodePoint(cp);
                out += ch; i += 1 + ch.length; seg = i; continue;
              }
            }
          }
          i += 2; seg = i; continue;
        }
        if (c < 32) {
          if (!j5 || c === 10 || c === 13) err('controlChar');
        } else if (c >= 0xd800 && c <= 0xdfff) hadSurr = true;
        i++;
      }
      out += text.slice(seg, i);
      i++;
      stats.strings++;
      if (hadSurr && /[\ud800-\udbff](?![\udc00-\udfff])|(^|[^\ud800-\udbff])[\udc00-\udfff]/.test(out)) {
        surrCount++;
        if (surr.length < MAX_LIST) surr.push({ offset: open, path: segsNow() });
      }
      return out;
    }
    function readIdent() {
      var start = i, out = '';
      for (;;) {
        var ch, cp;
        if (text.charCodeAt(i) === 92) {
          if (text.charCodeAt(i + 1) !== 117) err('unexpectedChar');
          cp = hex4(i + 2); ch = String.fromCharCode(cp); i += 6;
        } else {
          cp = text.codePointAt(i);
          if (cp === undefined) break;
          ch = String.fromCodePoint(cp);
          if (!(out ? ID_PART : ID_START).test(ch)) break;
          i += ch.length;
        }
        if (!(out ? ID_PART : ID_START).test(ch)) err('unexpectedChar', start);
        out += ch;
      }
      if (!out) err('unexpectedChar');
      changes.unquotedKeys++;
      return out;
    }
    function readKey(frame) {
      ws();
      if (i >= n) err('unexpectedEnd');
      var c = text.charCodeAt(i), at = i, key;
      if (c === 34 || (j5 && c === 39)) {
        var before = surr.length;
        key = readString(); stats.strings--;
        if (surr.length > before) surr[surr.length - 1].path[stack.length - 1] = key;
      }
      else if (j5) key = readIdent();
      else err('unquotedKey');
      frame.key = key; frame.offs.push(at); stats.keys++;
      ws();
      if (text.charCodeAt(i) !== 58) err(i >= n ? 'unexpectedEnd' : 'missingColon');
      i++;
    }
    function readNumber() {
      var re = j5 ? NUM_J5 : NUM_JSON, at = i;
      re.lastIndex = i;
      var m = re.exec(text);
      if (!m) err('badNumber');
      var lex = m[0];
      i += lex.length;
      var raw = lex;
      if (j5) {
        var sign = lex.charAt(0) === '-' ? '-' : '';
        var body = lex.replace(/^[+-]/, '');
        if (body === 'Infinity' || body === 'NaN') err('nonFinite', at);
        if (/^0[xX]/.test(body)) raw = sign + BigInt(body).toString();
        else {
          var p = /^(\d*)(?:\.(\d*))?(.*)$/.exec(body);
          raw = sign + (p[1] || '0') + (p[2] ? '.' + p[2] : '') + p[3];
        }
        if (raw !== lex) changes.numbers++;
      }
      stats.numbers++;
      var ch = numberChange(raw);
      if (ch) {
        numCount++;
        if (nums.length < MAX_LIST) nums.push({ offset: at, raw: raw, kind: ch.kind, js: ch.js, path: segsNow() });
      }
      return { t: 'n', r: raw };
    }
    function closeFrame() {
      var f = stack.pop(), node = f.node;
      if (node.t === 'o' && node.k.length > 1) {
        var k = node.k, path = null, seen = k.length > 16 ? new Map() : null;
        for (var a = 1; a < k.length; a++) {
          var dupe = false;
          if (seen) { if (a === 1) seen.set(k[0], 0); if (seen.has(k[a])) dupe = true; else seen.set(k[a], a); }
          else { for (var b = 0; b < a; b++) if (k[b] === k[a]) { dupe = true; break; } }
          if (dupe) {
            node.d = true; dupCount++;
            if (dups.length < MAX_LIST) {
              if (!path) path = segsNow();
              dups.push({ offset: f.offs[a], key: k[a], path: path });
            }
          }
        }
      }
      return node;
    }
    function scalar() {
      var c = text.charCodeAt(i);
      if (c === 34 || (j5 && c === 39)) return readString();
      if (c === 45 || (c >= 48 && c <= 57) || (j5 && (c === 43 || c === 46 || c === 73 || c === 78))) return readNumber();
      if (text.startsWith('true', i)) { i += 4; stats.booleans++; return true; }
      if (text.startsWith('false', i)) { i += 5; stats.booleans++; return false; }
      if (text.startsWith('null', i)) { i += 4; stats.nulls++; return null; }
      err(i >= n ? 'unexpectedEnd' : 'unexpectedChar');
    }
    try {
      var root, value;
      ws();
      if (i >= n) err('empty', 0);
      parse: for (;;) {
        // expecting a value
        ws();
        if (i >= n) err('unexpectedEnd');
        var c = text.charCodeAt(i);
        if (c === 123 || c === 91) {
          var node = c === 123 ? { t: 'o', k: [], v: [] } : { t: 'a', v: [] };
          if (c === 123) stats.objects++; else stats.arrays++;
          var frame = { node: node, key: null, offs: [] };
          stack.push(frame);
          if (stack.length > stats.depth) stats.depth = stack.length;
          i++; ws();
          var close = c === 123 ? 125 : 93;
          if (text.charCodeAt(i) === close) { i++; value = closeFrame(); }
          else {
            if (c === 123) readKey(frame);
            continue parse;
          }
        } else value = scalar();
        // a complete value: attach it and close finished containers
        for (;;) {
          if (!stack.length) { root = value; break parse; }
          var top = stack[stack.length - 1];
          if (top.node.t === 'o') top.node.k.push(top.key);
          top.node.v.push(value);
          ws();
          var cc = text.charCodeAt(i), closer = top.node.t === 'o' ? 125 : 93;
          if (cc === 44) {
            i++; ws();
            if (text.charCodeAt(i) === closer) {
              if (!j5) err('trailingComma');
              changes.trailingCommas++; i++; value = closeFrame(); continue;
            }
            if (top.node.t === 'o') readKey(top);
            continue parse;
          }
          if (cc === closer) { i++; value = closeFrame(); continue; }
          err(i >= n ? 'unexpectedEnd' : 'missingComma');
        }
      }
      ws();
      if (i < n) err('extraData');
      return {
        ok: true, root: root, stats: stats, changes: changes,
        dups: dups, dupCount: dupCount, surrogates: surr, surrogateCount: surrCount, numbers: nums, numberCount: numCount,
      };
    } catch (e) {
      if (e && e.jfErr) return { ok: false, code: e.code, offset: e.offset };
      throw e;
    }
  }

  /* Numbers: what JSON.parse followed by JSON.stringify makes of a number literal. Returns null
     when the value is unchanged (only the spelling may differ: 1.0 → 1, 1e2 → 100). */
  function decCanon(s) {
    var m = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!m) return s;
    var digits = (m[2] || '') + (m[3] || ''), exp = (m[4] ? parseInt(m[4], 10) : 0) - (m[3] || '').length;
    digits = digits.replace(/^0+/, '');
    if (!digits) return m[1] + '0';
    var t = /0+$/.exec(digits);
    if (t) { exp += t[0].length; digits = digits.slice(0, -t[0].length); }
    return m[1] + digits + 'e' + exp;
  }
  function numberChange(raw) {
    var v = Number(raw);
    if (!isFinite(v)) return { kind: 'overflow', js: 'null' };
    var js = JSON.stringify(v);
    if (js === raw) return null;
    var a = decCanon(raw), b = decCanon(js);
    if (a === b) return null;
    if (a === '-0') return { kind: 'negZero', js: js };
    if (v === 0) return { kind: 'underflow', js: js };
    return { kind: 'precision', js: js };
  }

  /* Text → result. BOM: RFC 8259 §8.1 lets a parser ignore it; it is removed and reported. */
  function analyze(text, opts) {
    opts = opts || {};
    var base = 0, bom = false;
    if (text.charCodeAt(0) === 0xfeff) { text = text.slice(1); base = 1; bom = true; }
    if (!/[^ \t\n\r]/.test(text)) return { ok: false, empty: true, base: base, bom: bom };
    var r = parseJson(text, false);
    if (r.ok) { r.base = base; r.bom = bom; r.mode = 'json'; r.inner = innerJson(r.root); return r; }
    var j = parseJson(text, true);
    if (j.ok && opts.json5) { j.base = base; j.bom = bom; j.mode = 'json5'; j.inner = innerJson(j.root); return j; }
    var syn = jsonSyntaxError(text) || { code: r.code, offset: r.offset };
    var res = { ok: false, base: base, bom: bom, error: syn };
    if (opts.json5) res.error = { code: j.code, offset: j.offset };
    else if (j.ok) res.json5 = j.changes;
    else if (j.code === 'nonFinite') res.hint = { code: 'nonFinite', offset: j.offset };
    var hint = hintFor(text, syn, opts);
    if (hint && !res.hint) res.hint = hint;
    return res;
  }
  function innerJson(root) {
    if (typeof root !== 'string') return null;
    var s = root.trim();
    if (s.charAt(0) !== '{' && s.charAt(0) !== '[') return null;
    return parseJson(s, false).ok ? s : null;
  }
  // Common non-JSON input with a one-step fix.
  function hintFor(text, syn, opts) {
    var t = text.trim();
    var fence = /^```[\w-]*[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(t);
    if (fence) {
      var inner = fence[1];
      if (parseJson(inner, false).ok || (opts.json5 && parseJson(inner, true).ok)) return { code: 'fence', text: inner };
    }
    if (t.indexOf('\\"') >= 0) {
      try {
        var un = JSON.parse('"' + t.replace(/^"|"$/g, '') + '"');
        if (typeof un === 'string' && parseJson(un.trim(), false).ok) return { code: 'escaped', text: un.trim() };
      } catch (e) { /* not an escaped string */ }
    }
    if (syn.code === 'extraData') {
      var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
      if (lines.length > 1 && lines.every(function (l) { return parseJson(l, false).ok; })) return { code: 'jsonl', n: lines.length };
    }
    if (syn.code === 'badLiteral' || syn.code === 'badNumber') {
      var w = /^[A-Za-z_$][\w$]*/.exec(text.slice(syn.offset));
      if (w) {
        var py = { True: 'true', False: 'false', None: 'null' }[w[0]];
        if (py) return { code: 'python', word: w[0], fix: py, offset: syn.offset };
        if (w[0] === 'undefined') return { code: 'undefined', offset: syn.offset };
        if (w[0] === 'NaN' || w[0] === 'Infinity') return { code: 'nonFinite', offset: syn.offset };
      }
    }
    return null;
  }

  /* Output ------------------------------------------------------------------------------ */
  // Code point order (Python sort_keys, jq -S). JS < compares UTF-16 code units, which puts
  // U+E000–U+FFFF after astral characters; this mapping fixes that.
  function cmpCodePoint(a, b) {
    if (a === b) return 0;
    var n = Math.min(a.length, b.length);
    for (var x = 0; x < n; x++) {
      var ca = a.charCodeAt(x), cb = b.charCodeAt(x);
      if (ca !== cb) {
        if (ca >= 0xd800 && cb >= 0xd800) {
          ca = ca >= 0xe000 ? ca - 0x800 : ca + 0x2000;
          cb = cb >= 0xe000 ? cb - 0x800 : cb + 0x2000;
        }
        return ca - cb;
      }
    }
    return a.length - b.length;
  }
  // Member order for an object: dupes 'last' keeps the first position with the last value
  // (what JSON.parse, Python and jq do); sortKeys sorts by code point (stable).
  function orderOf(node, o) {
    var k = node.k, order = [];
    if (node.d && o.dupes === 'last') {
      var last = new Map();
      for (var a = 0; a < k.length; a++) last.set(k[a], a);
      var done = new Set();
      for (var b = 0; b < k.length; b++) if (!done.has(k[b])) { done.add(k[b]); order.push(last.get(k[b])); }
    } else for (var c = 0; c < k.length; c++) order.push(c);
    if (o.sortKeys) order.sort(function (x, y) { return cmpCodePoint(k[x], k[y]); });
    return order;
  }
  function quote(s, ascii) {
    var q = JSON.stringify(s);
    return ascii ? q.replace(/[\u007f-\uffff]/g, function (c) { return '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4); }) : q;
  }
  function numberOut(raw, mode) {
    if (mode !== 'js') return raw;
    var v = Number(raw);
    return isFinite(v) ? JSON.stringify(v) : raw;
  }
  function scalarOut(v, o) {
    if (v === null) return 'null';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (typeof v === 'string') return quote(v, o.ascii);
    return numberOut(v.r, o.numbers);
  }
  // o: { indent: '' (minified) | '  ' | '    ' | '\t', sortKeys, ascii, numbers: 'raw' | 'js', dupes: 'keep' | 'last' }
  function serialize(root, o) {
    var ind = o.indent || '', nl = ind ? '\n' : '', colon = ind ? ': ' : ':';
    var pads = [''], out = '', stack = [];
    function pad(d) { while (pads.length <= d) pads.push(pads[pads.length - 1] + ind); return pads[d]; }
    function emit(v) {
      if (v !== null && typeof v === 'object' && v.t !== 'n') {
        var isObj = v.t === 'o';
        if (!v.v.length) { out += isObj ? '{}' : '[]'; return; }
        out += isObj ? '{' : '[';
        stack.push({ v: v, obj: isObj, order: isObj ? orderOf(v, o) : null, pos: 0 });
        return;
      }
      out += scalarOut(v, o);
    }
    emit(root);
    while (stack.length) {
      var f = stack[stack.length - 1], len = f.obj ? f.order.length : f.v.v.length;
      if (f.pos < len) {
        var idx = f.obj ? f.order[f.pos] : f.pos;
        out += (f.pos ? ',' : '') + nl + pad(stack.length);
        if (f.obj) out += quote(f.v.k[idx], o.ascii) + colon;
        f.pos++;
        emit(f.v.v[idx]);
      } else {
        stack.pop();
        out += nl + pad(stack.length) + (f.obj ? '}' : ']');
      }
    }
    return out;
  }

  // Colours for the output text (valid JSON produced by serialize). HTML is escaped first.
  function highlight(json) {
    var esc = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc.replace(/("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, function (m) {
      var cls = m.charAt(0) === '"' ? (/:$/.test(m) ? 'jf-k' : 'jf-s') : m === 'null' ? 'jf-z' : (m === 'true' || m === 'false') ? 'jf-b' : 'jf-n';
      return '<span class="' + cls + '">' + m + '</span>';
    });
  }

  // Two lines of context and a caret; long lines (minified JSON) are cut to 72 characters
  // around the column.
  function codeFrame(text, offset) {
    var lc = lineCol(text, offset);
    var lines = text.split('\n');
    var out = [], w = String(lc.line).length;
    for (var ln = Math.max(1, lc.line - 1); ln <= lc.line; ln++) {
      var s = (lines[ln - 1] || '').replace(/\r$/, ''), from = 0, col = lc.col - 1;
      if (s.length > 72) {
        from = ln === lc.line ? Math.max(0, Math.min(col - 36, s.length - 72)) : 0;
        s = (from > 0 ? '…' : '') + s.slice(from, from + 72) + (from + 72 < s.length ? '…' : '');
      }
      out.push(String(ln).padStart(w) + ' | ' + s);
      if (ln === lc.line) out.push(' '.repeat(w) + ' | ' + ' '.repeat(col - from + (from > 0 ? 1 : 0)) + '^');
    }
    return { line: lc.line, col: lc.col, text: out.join('\n') };
  }

  /* Files: RFC 8259 §8.1 requires UTF-8. UTF-16 with a BOM is decoded and reported; bytes
     that are not UTF-8 are an error with the byte offset. */
  function firstBadUtf8(u8) {
    for (var x = 0; x < u8.length;) {
      var b = u8[x], need, min;
      if (b < 0x80) { x++; continue; }
      if (b >= 0xc2 && b <= 0xdf) { need = 1; min = 0x80; }
      else if (b >= 0xe0 && b <= 0xef) { need = 2; min = 0x800; }
      else if (b >= 0xf0 && b <= 0xf4) { need = 3; min = 0x10000; }
      else return x;
      var cp = b & (0x3f >> need);
      for (var y = 1; y <= need; y++) {
        var c = u8[x + y];
        if (c === undefined || (c & 0xc0) !== 0x80) return x;
        cp = (cp << 6) | (c & 0x3f);
      }
      if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return x;
      x += need + 1;
    }
    return -1;
  }
  function decodeBytes(u8) {
    if (u8[0] === 0xff && u8[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(u8.subarray(2)), encoding: 'UTF-16LE' };
    if (u8[0] === 0xfe && u8[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(u8.subarray(2)), encoding: 'UTF-16BE' };
    var bad = firstBadUtf8(u8);
    if (bad >= 0) {
      var zeros = 0;
      for (var x = 0; x < Math.min(u8.length, 64); x++) if (u8[x] === 0) zeros++;
      return { error: zeros * 4 >= Math.min(u8.length, 64) ? 'utf16NoBom' : 'notUtf8', offset: bad };
    }
    return { text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(u8), encoding: 'UTF-8' };
  }

  /* Tree view helpers. */
  function kindOf(v) {
    if (v === null) return 'null';
    if (typeof v === 'string') return 'string';
    if (typeof v === 'boolean') return 'boolean';
    return v.t === 'n' ? 'number' : v.t === 'o' ? 'object' : 'array';
  }
  function childrenOf(v, o) {
    if (v === null || typeof v !== 'object' || v.t === 'n') return [];
    if (v.t === 'a') return v.v.map(function (x, idx) { return { seg: idx, value: x }; });
    return orderOf(v, o).map(function (idx) { return { seg: v.k[idx], value: v.v[idx], dup: !!v.d && o.dupes !== 'last' && v.k.indexOf(v.k[idx]) !== idx }; });
  }
  /* ── engine:end ── */

export { fmt, escSeg, pointerOf, jqPathOf, lineCol, jsonSyntaxError, parseJson, decCanon, numberChange, analyze, innerJson, hintFor, cmpCodePoint, orderOf, quote, numberOut, scalarOut, serialize, highlight, codeFrame, firstBadUtf8, decodeBytes, kindOf, childrenOf };
