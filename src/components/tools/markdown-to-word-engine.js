// Markdown to Word — parsing, .docx construction, and preview HTML.
// Extracted verbatim from MarkdownToWordTool.astro so the page and the export Worker
// run the same code. scripts/test-markdown-to-word.mjs loads this module.

/* ── engine:start ── */
  // Characters between which a soft line break is dropped (Han, Kana, CJK punctuation,
  // fullwidth forms). Hangul is not here: Korean separates words with spaces.
  var CJK_JOIN = /[\u2E80-\u2FFF\u3000-\u303F\u3040-\u30FF\u3100-\u312F\u31A0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF9F]/;
  // Any CJK character: paragraphs that contain one get w:hint="eastAsia", so ambiguous
  // characters such as “ ” … — use the East Asian font, as Word does for IME input.
  var CJK_ANY = /[\u1100-\u11FF\u2E80-\u9FFF\uA960-\uA97F\uAC00-\uD7FF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/;

  var FONT_PRESETS = {
    'zh-song': { eastAsia: 'SimSun', lang: 'zh-CN' },
    'zh-yahei': { eastAsia: 'Microsoft YaHei', lang: 'zh-CN' },
    'ja-mincho': { eastAsia: 'Yu Mincho', lang: 'ja-JP' },
    'ja-gothic': { eastAsia: 'Yu Gothic', lang: 'ja-JP' },
    'ko-malgun': { eastAsia: 'Malgun Gothic', lang: 'ko-KR' },
    'ko-batang': { eastAsia: 'Batang', lang: 'ko-KR' },
  };
  var LATIN_FONT = 'Calibri';
  var MONO_FONT = 'Consolas';
  // twips (1/1440 inch)
  var PAPER = { a4: { width: 11906, height: 16838 }, letter: { width: 12240, height: 15840 } };
  var MARGIN = 1440;
  var LIST_INDENT = 420;
  var QUOTE_INDENT = 360;
  // Regions whose default paper is US Letter
  var LETTER_REGIONS = ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'PR', 'GT', 'CR', 'PA', 'DO'];

  function defaultFontFor(pageLang) {
    return { zh: 'zh-song', ja: 'ja-mincho', ko: 'ko-malgun' }[pageLang] || 'zh-yahei';
  }

  function paperFor(locale) {
    var m = /^[A-Za-z]{2,3}[-_](?:[A-Za-z]{4}[-_])?([A-Za-z]{2})\b/.exec(String(locale || ''));
    return m && LETTER_REGIONS.indexOf(m[1].toUpperCase()) >= 0 ? 'letter' : 'a4';
  }

  // zh / ja / ko pages: A4 (the paper used in China, Japan and Korea). English page: by
  // the browser's region.
  function defaultPaper(pageLang, locale) {
    return pageLang && pageLang !== 'en' ? 'a4' : paperFor(locale);
  }

  function safeFilename(name) {
    var s = String(name == null ? '' : name)
      .replace(/[\u0000-\u001f\u007f<>:"\/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\.docx$/i, '')
      .replace(/^[. ]+|[. ]+$/g, '');
    var cps = Array.from(s);
    if (cps.length > 80) s = cps.slice(0, 80).join('').trim();
    return s || 'document';
  }

  function stripFrontmatter(md) {
    var m = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(md);
    if (!m) return md;
    var lines = m[1].split('\n');
    var keyLine = /^["']?[A-Za-z0-9_][^:]*["']?:(\s|$)/;
    var yamlish = lines.every(function (l) {
      return !l.trim() || keyLine.test(l) || /^\s+\S/.test(l) || /^\s*-\s/.test(l) || /^\s*#/.test(l);
    });
    if (!yamlish || !lines.some(function (l) { return keyLine.test(l); })) return md;
    return md.slice(m[0].length);
  }

  function visit(node, fn) {
    if (fn(node) === false) return;
    if (node.children) for (var i = 0; i < node.children.length; i++) visit(node.children[i], fn);
  }

  function leafText(n) {
    if (n.type === 'text' || n.type === 'inlineCode') return n.value;
    if (n.type === 'image' || n.type === 'imageReference') return n.alt || 'x';
    if (n.type === 'break') return '\n';
    if (n.type === 'footnoteReference') return '1';
    return '';
  }

  // Soft line breaks: CommonMark renders them as a line ending that browsers show as a
  // space. Between two Han / Kana characters that space is wrong, so drop it there.
  function joinSoftBreaks(tree) {
    visit(tree, function (c) {
      if (c.type !== 'paragraph' && c.type !== 'heading' && c.type !== 'tableCell') return true;
      var leaves = [];
      visit(c, function (n) { if (!n.children) leaves.push(n); return true; });
      var full = '';
      var starts = [];
      leaves.forEach(function (l) { starts.push(full.length); full += leafText(l); });
      leaves.forEach(function (l, i) {
        if (l.type !== 'text' || l.value.indexOf('\n') < 0) return;
        var base = starts[i];
        l.value = l.value.replace(/[ \t]*\n[ \t]*/g, function (m, off) {
          var prev = full.charAt(base + off - 1);
          var next = full.charAt(base + off + m.length);
          return CJK_JOIN.test(prev) && CJK_JOIN.test(next) ? '' : ' ';
        });
      });
      return false;
    });
  }

  function parseMarkdown(md, lib) {
    var src = stripFrontmatter(String(md == null ? '' : md).replace(/\r\n?/g, '\n'));
    var tree = lib.fromMarkdown(src, {
      extensions: [lib.gfm(), lib.cjkFriendlyExtension(), lib.gfmStrikethroughCjkFriendly()],
      mdastExtensions: [lib.gfmFromMarkdown()],
    });
    joinSoftBreaks(tree);
    return tree;
  }

  function plainText(node) {
    var s = '';
    visit(node, function (n) {
      if (n.type === 'text' || n.type === 'inlineCode') s += n.value;
      else if (n.type === 'image' || n.type === 'imageReference') s += n.alt || '';
      return true;
    });
    return s;
  }

  function firstHeadingText(tree) {
    var h = null;
    visit(tree, function (n) { if (!h && n.type === 'heading') h = n; return !h; });
    return h ? plainText(h).trim() : '';
  }

  function collectDefinitions(tree) {
    var defs = {};
    visit(tree, function (n) {
      if (n.type === 'definition' && !defs[n.identifier]) defs[n.identifier] = n;
      return true;
    });
    return defs;
  }

  function decodeDataUri(uri) {
    var m = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/i.exec(String(uri || '').trim());
    if (!m) return null;
    var mime = (m[1] || 'text/plain').toLowerCase();
    var data;
    try {
      if (/;base64/i.test(m[2])) {
        var bin = atob(m[3].replace(/\s+/g, ''));
        data = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      } else {
        data = new TextEncoder().encode(decodeURIComponent(m[3]));
      }
    } catch (e) {
      return null;
    }
    return { mime: mime, data: data };
  }

  // Type and pixel size from the file header, for the formats Word embeds directly.
  function sniffImage(b) {
    if (!b || b.length < 10) return null;
    var be16 = function (i) { return (b[i] << 8) | b[i + 1]; };
    var le16 = function (i) { return b[i] | (b[i + 1] << 8); };
    var le32 = function (i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)); };
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b.length >= 24) {
      return { type: 'png', width: ((b[16] << 24) >>> 0) + (b[17] << 16) + (b[18] << 8) + b[19], height: ((b[20] << 24) >>> 0) + (b[21] << 16) + (b[22] << 8) + b[23] };
    }
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
      return { type: 'gif', width: le16(6), height: le16(8) };
    }
    if (b[0] === 0x42 && b[1] === 0x4d && b.length >= 26) {
      return { type: 'bmp', width: Math.abs(le32(18)), height: Math.abs(le32(22)) };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      var i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        var marker = b[i + 1];
        if (marker === 0xff) { i++; continue; }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { type: 'jpg', width: be16(i + 7), height: be16(i + 5) };
        }
        i += 2 + be16(i + 2);
      }
    }
    return null;
  }

  function fitImage(width, height, maxWidth) {
    var w = Math.max(1, Math.round(width || 1));
    var h = Math.max(1, Math.round(height || 1));
    if (w <= maxWidth) return { width: w, height: h };
    return { width: maxWidth, height: Math.max(1, Math.round(h * maxWidth / w)) };
  }

  function imageUrlOf(n, defs) {
    if (n.type === 'image') return n.url;
    if (n.type === 'imageReference' && defs[n.identifier]) return defs[n.identifier].url;
    return null;
  }

  // Images the browser has to fetch or re-encode before export: http(s) URLs (only when
  // embedding web images is switched on), and data URIs in a format Word cannot embed
  // directly (SVG, WebP, ...).
  function collectImageUrls(tree, embedRemote) {
    var defs = collectDefinitions(tree);
    var out = [];
    visit(tree, function (n) {
      var url = imageUrlOf(n, defs);
      if (!url || out.indexOf(url) >= 0) return true;
      if (/^https?:\/\//i.test(url)) { if (embedRemote === true) out.push(url); }
      else if (/^data:image\//i.test(url)) {
        var d = decodeDataUri(url);
        if (d && !sniffImage(d.data)) out.push(url);
      }
      return true;
    });
    return out;
  }

  function isLinkUrl(url) {
    return /^(https?:\/\/|mailto:)/i.test(String(url || '').trim());
  }

  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, function (m, e) {
      var k = e.toLowerCase();
      if (k === 'amp') return '&';
      if (k === 'lt') return '<';
      if (k === 'gt') return '>';
      if (k === 'quot') return '"';
      if (k === 'apos') return "'";
      if (k === 'nbsp') return '\u00a0';
      var cp = k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch (err) { return m; }
    });
  }

  // Raw HTML is not rendered: tags are dropped and their text kept. <script>, <style>
  // and comments produce nothing; <br> and closing block tags end a line.
  function htmlToText(html) {
    var s = String(html)
      .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
      .replace(/<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre|table|ul|ol|section|details|summary)\s*>/gi, '\n')
      .replace(/<\/?[A-Za-z][^>]*>/g, '');
    return decodeEntities(s)
      .split('\n')
      .map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); })
      .filter(Boolean)
      .join('\n');
  }

  function inlineHtmlKind(value) {
    var v = String(value).trim();
    if (/^<br\s*\/?>$/i.test(v)) return { kind: 'br' };
    var open = /^<(script|style)\b/i.exec(v);
    if (open) return { kind: 'skip', tag: open[1].toLowerCase() };
    return { kind: 'drop' };
  }

  function columnWidths(rows, ncol, total) {
    var weights = [];
    for (var c = 0; c < ncol; c++) {
      var w = 3;
      rows.forEach(function (r) {
        var cell = r.children[c];
        if (!cell) return;
        var t = plainText(cell);
        var len = 0;
        for (var ch of t) len += CJK_ANY.test(ch) ? 2 : 1;
        if (len > w) w = len;
      });
      weights.push(Math.min(w, 40));
    }
    var sum = weights.reduce(function (a, b) { return a + b; }, 0);
    var widths = weights.map(function (w) { return Math.floor(total * w / sum); });
    widths[ncol - 1] += total - widths.reduce(function (a, b) { return a + b; }, 0);
    return widths;
  }

  function buildDocx(tree, lib, opts) {
    var D = lib.D;
    opts = opts || {};
    var preset = FONT_PRESETS[opts.font] || FONT_PRESETS['zh-yahei'];
    var paper = PAPER[opts.paper] || PAPER.a4;
    var contentWidth = paper.width - 2 * MARGIN;
    var defs = collectDefinitions(tree);
    var report = { imagesEmbedded: 0, imagesMissing: 0, imagesSkipped: 0 };
    var images = opts.images || {};
    var maxImgPx = Math.round(contentWidth / 15);

    var bulletLevels = [];
    var orderedFormats = [D.LevelFormat.DECIMAL, D.LevelFormat.LOWER_LETTER, D.LevelFormat.LOWER_ROMAN];
    var bulletGlyphs = [['\uF0B7', 'Symbol'], ['o', 'Courier New'], ['\uF0A7', 'Wingdings']];
    for (var L = 0; L < 9; L++) {
      bulletLevels.push({
        level: L, format: D.LevelFormat.BULLET, text: bulletGlyphs[L % 3][0], alignment: D.AlignmentType.LEFT,
        style: {
          paragraph: { indent: { left: LIST_INDENT * (L + 1), hanging: LIST_INDENT } },
          run: { font: { ascii: bulletGlyphs[L % 3][1], hAnsi: bulletGlyphs[L % 3][1], hint: 'default' } },
        },
      });
    }
    var numbering = [{ reference: 'zt-ul', levels: bulletLevels }];
    var olCount = 0;
    function orderedReference(start) {
      var ref = 'zt-ol-' + (olCount++);
      var levels = [];
      for (var L = 0; L < 9; L++) {
        levels.push({
          level: L, format: orderedFormats[L % 3], text: '%' + (L + 1) + '.', alignment: D.AlignmentType.LEFT, start: start,
          style: { paragraph: { indent: { left: LIST_INDENT * (L + 1), hanging: LIST_INDENT } } },
        });
      }
      numbering.push({ reference: ref, levels: levels });
      return ref;
    }

    // Footnotes are numbered in order of first reference
    var fnDefs = {};
    visit(tree, function (n) { if (n.type === 'footnoteDefinition' && !fnDefs[n.identifier]) fnDefs[n.identifier] = n; return true; });
    var fnIds = {};
    var fnOrder = [];
    visit(tree, function (n) {
      if (n.type === 'footnoteDefinition') return false;
      if (n.type === 'footnoteReference' && fnDefs[n.identifier] && !fnIds[n.identifier]) {
        fnOrder.push(n.identifier);
        fnIds[n.identifier] = fnOrder.length;
      }
      return true;
    });

    function withStyle(st, extra) {
      var o = {};
      for (var k in st) o[k] = st[k];
      for (var k2 in extra) o[k2] = extra[k2];
      return o;
    }

    function runOpts(text, st) {
      var o = { text: text };
      if (st.bold) o.bold = true;
      if (st.italics) o.italics = true;
      if (st.strike) o.strike = true;
      if (st.code) o.style = 'VerbatimChar';
      else if (st.link) o.style = 'Hyperlink';
      if (st.cjk) o.font = { hint: 'eastAsia' };
      return o;
    }

    function resolveImage(url) {
      if (images[url]) return images[url];
      if (/^data:/i.test(url)) {
        var d = decodeDataUri(url);
        var s = d && sniffImage(d.data);
        if (s) return { type: s.type, data: d.data, width: s.width, height: s.height };
      }
      return null;
    }

    function imageRun(url, alt, title, st) {
      var img = url ? resolveImage(url) : null;
      if (img) {
        report.imagesEmbedded++;
        return [new D.ImageRun({
          type: img.type, data: img.data,
          transformation: fitImage(img.width, img.height, maxImgPx),
          altText: { name: alt || 'image', description: alt || '', title: title || '' },
        })];
      }
      if (/^https?:\/\//i.test(String(url || '')) && opts.embedRemote !== true) report.imagesSkipped++;
      else report.imagesMissing++;
      var label = '[' + (alt || String(url || '').split(/[?#]/)[0].split('/').pop() || 'image') + ']';
      if (isLinkUrl(url)) {
        return [new D.ExternalHyperlink({ link: url, children: [new D.TextRun(runOpts(label, withStyle(st, { link: true })))] })];
      }
      return [new D.TextRun(runOpts(label, st))];
    }

    function inlineRuns(nodes, st) {
      var out = [];
      var skip = null;
      (nodes || []).forEach(function (n) {
        if (skip) {
          if (n.type === 'html' && new RegExp('^</' + skip + '\\s*>$', 'i').test(n.value.trim())) skip = null;
          return;
        }
        switch (n.type) {
          case 'text':
            if (n.value) out.push(new D.TextRun(runOpts(n.value, st)));
            break;
          case 'strong':
            out = out.concat(inlineRuns(n.children, withStyle(st, { bold: true })));
            break;
          case 'emphasis':
            out = out.concat(inlineRuns(n.children, withStyle(st, { italics: true })));
            break;
          case 'delete':
            out = out.concat(inlineRuns(n.children, withStyle(st, { strike: true })));
            break;
          case 'inlineCode':
            out.push(new D.TextRun(Object.assign(runOpts(n.value, withStyle(st, { code: true })), { noProof: true })));
            break;
          case 'break':
            out.push(new D.TextRun({ break: 1 }));
            break;
          case 'link':
          case 'linkReference': {
            var url = n.type === 'link' ? n.url : (defs[n.identifier] || {}).url;
            if (isLinkUrl(url)) {
              out.push(new D.ExternalHyperlink({ link: url.trim(), children: inlineRuns(n.children, withStyle(st, { link: true })) }));
            } else {
              out = out.concat(inlineRuns(n.children, st));
            }
            break;
          }
          case 'image':
            out = out.concat(imageRun(n.url, n.alt, n.title, st));
            break;
          case 'imageReference': {
            var def = defs[n.identifier];
            out = out.concat(imageRun(def && def.url, n.alt, def && def.title, st));
            break;
          }
          case 'footnoteReference':
            if (fnIds[n.identifier]) out.push(new D.FootnoteReferenceRun(fnIds[n.identifier]));
            else out.push(new D.TextRun(runOpts('[^' + n.label + ']', st)));
            break;
          case 'html': {
            var k = inlineHtmlKind(n.value);
            if (k.kind === 'br') out.push(new D.TextRun({ break: 1 }));
            else if (k.kind === 'skip' && !new RegExp('</' + k.tag + '\\s*>', 'i').test(n.value)) skip = k.tag;
            break;
          }
          default:
            if (n.children) out = out.concat(inlineRuns(n.children, st));
        }
      });
      return out;
    }

    function paragraphFrom(node, props, st) {
      var cjk = CJK_ANY.test(plainText(node));
      var children = inlineRuns(node.children, withStyle(st || {}, { cjk: cjk }));
      var onlyImages = node.children && node.children.length > 0 && node.children.every(function (c) {
        return c.type === 'image' || c.type === 'imageReference' || (c.type === 'text' && !c.value.trim());
      });
      var p = Object.assign({ children: children }, props || {});
      if (onlyImages && !p.alignment) p.alignment = D.AlignmentType.CENTER;
      return new D.Paragraph(p);
    }

    function baseProps(env) {
      var p = {};
      if (env.quote) p.style = 'Quote';
      if (env.indent) p.indent = { left: env.indent };
      return p;
    }

    function codeParagraphs(node, env) {
      var lines = String(node.value).split('\n');
      return lines.map(function (line) {
        var parts = line.split('\t');
        var cjk = CJK_ANY.test(line);
        var kids = [];
        parts.forEach(function (part, i) {
          if (i > 0) kids.push(new D.TextRun({ children: [new D.Tab()], noProof: true }));
          if (part) kids.push(new D.TextRun({ text: part, noProof: true, font: cjk ? { hint: 'eastAsia' } : undefined }));
        });
        var p = { style: 'SourceCode', children: kids };
        if (env.indent) p.indent = { left: env.indent };
        return new D.Paragraph(p);
      });
    }

    function tableBlock(node, env) {
      var rows = node.children || [];
      if (!rows.length) return [];
      var ncol = rows[0].children.length || 1;
      var align = node.align || [];
      var widths = columnWidths(rows, ncol, contentWidth - (env.indent || 0));
      var jc = { left: D.AlignmentType.LEFT, center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT };
      var border = { style: D.BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
      var trs = rows.map(function (row, ri) {
        var cells = [];
        for (var c = 0; c < ncol; c++) {
          var cell = row.children[c] || { type: 'tableCell', children: [] };
          var pOpts = { spacing: { before: 0, after: 0 } };
          if (align[c]) pOpts.alignment = jc[align[c]];
          var cellOpts = {
            children: [paragraphFrom(cell, pOpts, ri === 0 ? { bold: true } : {})],
            width: { size: widths[c], type: D.WidthType.DXA },
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
          };
          if (ri === 0) cellOpts.shading = { type: D.ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' };
          cells.push(new D.TableCell(cellOpts));
        }
        return new D.TableRow({ tableHeader: ri === 0, cantSplit: true, children: cells });
      });
      var t = {
        rows: trs,
        width: { size: widths.reduce(function (a, b) { return a + b; }, 0), type: D.WidthType.DXA },
        columnWidths: widths,
        layout: D.TableLayoutType.FIXED,
        borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
      };
      if (env.indent) t.indent = { size: env.indent, type: D.WidthType.DXA };
      // An empty paragraph keeps two adjacent tables from merging in Word
      return [new D.Table(t), new D.Paragraph({ children: [], spacing: { after: 0 } })];
    }

    function listBlocks(list, env, level) {
      var ref = list.ordered ? orderedReference(list.start == null ? 1 : list.start) : 'zt-ul';
      var textIndent = (env.indent || 0) + LIST_INDENT;
      var out = [];
      list.children.forEach(function (item, idx) {
        var last = idx === list.children.length - 1;
        var kids = item.children || [];
        var lead = kids[0] && kids[0].type === 'paragraph' ? kids[0] : { type: 'paragraph', children: [] };
        var props = {
          indent: { left: textIndent, hanging: LIST_INDENT },
          spacing: { after: list.spread || (last && level === 0) ? 120 : 0 },
        };
        if (env.quote) props.style = 'Quote';
        var task = item.checked === true || item.checked === false;
        if (!task) props.numbering = { reference: ref, level: Math.min(level, 8) };
        var p = paragraphFrom(lead, props);
        if (task) {
          var cjk = CJK_ANY.test(plainText(lead));
          p = new D.Paragraph(Object.assign({}, props, {
            children: [
              new D.CheckBox({ checked: item.checked, checkedState: { value: '2612', font: 'MS Gothic' }, uncheckedState: { value: '2610', font: 'MS Gothic' } }),
              new D.TextRun({ children: [new D.Tab()] }),
            ].concat(inlineRuns(lead.children, { cjk: cjk })),
          }));
        }
        out.push(p);
        var inner = { indent: textIndent, quote: env.quote };
        kids.slice(kids[0] === lead ? 1 : 0).forEach(function (child) {
          if (child.type === 'list') out = out.concat(listBlocks(child, inner, level + 1));
          else out = out.concat(blocks([child], inner));
        });
      });
      return out;
    }

    function blocks(nodes, env) {
      var out = [];
      (nodes || []).forEach(function (n) {
        switch (n.type) {
          case 'heading': {
            var hp = { heading: D.HeadingLevel['HEADING_' + Math.min(n.depth, 6)] };
            if (env.indent) hp.indent = { left: env.indent };
            out.push(paragraphFrom(n, hp));
            break;
          }
          case 'paragraph':
            out.push(paragraphFrom(n, baseProps(env)));
            break;
          case 'list':
            out = out.concat(listBlocks(n, env, 0));
            break;
          case 'code':
            out = out.concat(codeParagraphs(n, env));
            out.push(new D.Paragraph({ children: [], spacing: { after: 0, line: 120 } }));
            break;
          case 'blockquote':
            out = out.concat(blocks(n.children, { indent: (env.indent || 0) + QUOTE_INDENT, quote: (env.quote || 0) + 1 }));
            break;
          case 'table':
            out = out.concat(tableBlock(n, env));
            break;
          case 'thematicBreak':
            out.push(new D.Paragraph({
              children: [],
              border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: 'BFBFBF', space: 1 } },
              indent: env.indent ? { left: env.indent } : undefined,
            }));
            break;
          case 'html': {
            var text = htmlToText(n.value);
            if (!text) break;
            var cjk = CJK_ANY.test(text);
            var runs = [];
            text.split('\n').forEach(function (line, i) {
              if (i > 0) runs.push(new D.TextRun({ break: 1 }));
              runs.push(new D.TextRun(runOpts(line, { cjk: cjk })));
            });
            out.push(new D.Paragraph(Object.assign(baseProps(env), { children: runs })));
            break;
          }
          default:
            break;
        }
      });
      return out;
    }

    var children = blocks(tree.children, { indent: 0, quote: 0 });
    if (!children.length) children.push(new D.Paragraph({ children: [] }));

    var footnotes = {};
    fnOrder.forEach(function (id) {
      var paras = [];
      (fnDefs[id].children || []).forEach(function (child) {
        if (child.type === 'paragraph') paras.push(paragraphFrom(child, { style: 'FootnoteText' }));
        else blocks([child], { indent: 0, quote: 0 }).forEach(function (b) { if (b instanceof D.Paragraph) paras.push(b); });
      });
      footnotes[fnIds[id]] = { children: paras.length ? paras : [new D.Paragraph({ children: [] })] };
    });

    function headingStyle(level, size, before) {
      return {
        run: { bold: true, size: size, color: '1F1F1F', italics: false },
        paragraph: { keepNext: true, keepLines: true, outlineLevel: level, spacing: { before: before, after: 120 } },
      };
    }
    var shade = { type: D.ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' };
    var mono = { ascii: MONO_FONT, hAnsi: MONO_FONT, cs: MONO_FONT };

    var doc = new D.Document({
      creator: '',
      lastModifiedBy: '',
      title: opts.title || '',
      styles: {
        default: {
          document: {
            run: {
              font: { ascii: LATIN_FONT, hAnsi: LATIN_FONT, cs: LATIN_FONT, eastAsia: preset.eastAsia },
              size: 22,
              language: { value: 'en-US', eastAsia: preset.lang },
            },
            paragraph: { spacing: { after: 120, line: 276 } },
          },
          heading1: headingStyle(0, 36, 360),
          heading2: headingStyle(1, 30, 300),
          heading3: headingStyle(2, 26, 240),
          heading4: headingStyle(3, 24, 200),
          heading5: headingStyle(4, 22, 200),
          heading6: headingStyle(5, 22, 200),
        },
        paragraphStyles: [
          {
            id: 'SourceCode', name: 'Source Code', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { font: mono, size: 20 },
            paragraph: { spacing: { before: 0, after: 0, line: 240 }, shading: shade },
          },
          {
            id: 'Quote', name: 'Quote', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { color: '595959' },
            paragraph: {
              indent: { left: QUOTE_INDENT },
              border: { left: { style: D.BorderStyle.SINGLE, size: 18, color: 'BFBFBF', space: 8 } },
            },
          },
        ],
        characterStyles: [
          { id: 'VerbatimChar', name: 'Verbatim Char', basedOn: 'DefaultParagraphFont', run: { font: mono, size: 20, shading: shade } },
        ],
      },
      numbering: { config: numbering },
      footnotes: footnotes,
      sections: [{
        properties: {
          page: {
            size: { width: paper.width, height: paper.height, orientation: D.PageOrientation.PORTRAIT },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        children: children,
      }],
    });
    return { doc: doc, report: report };
  }

  // Loads the images the document needs, then builds it. io.fetch is only called for
  // http(s) images, and only when opts.embedRemote is true; io.toImage re-encodes
  // formats Word cannot embed directly.
  // Shared by the page and the export Worker.
  var PREVIEW_BLOCKS = 300;

  async function prepareImages(tree, opts, io) {
    opts = Object.assign({}, opts || {});
    opts.embedRemote = opts.embedRemote === true;
    var urls = Array.isArray(tree) ? tree : collectImageUrls(tree, opts.embedRemote);
    if (!opts.embedRemote) urls = urls.filter(function (u) { return !/^https?:/i.test(u); });
    var images = {};
    await Promise.all(urls.map(async function (url) {
      try {
        var bytes;
        var mime = '';
        if (/^data:/i.test(url)) {
          var d = decodeDataUri(url);
          if (!d) return;
          bytes = d.data;
          mime = d.mime;
        } else {
          var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
          var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
          try {
            var res = await io.fetch(url, { signal: ctrl ? ctrl.signal : undefined, credentials: 'omit', referrerPolicy: 'no-referrer' });
            if (!res.ok) return;
            bytes = new Uint8Array(await res.arrayBuffer());
            mime = res.headers.get('content-type') || '';
          } finally {
            if (timer) clearTimeout(timer);
          }
        }
        var s = sniffImage(bytes);
        var img = s ? { type: s.type, data: bytes, width: s.width, height: s.height } : await io.toImage(bytes, mime);
        if (img) images[url] = img;
      } catch (e) {
        /* kept as a link */
      }
    }));
    opts.images = images;
    return opts;
  }

  async function exportDocx(tree, lib, opts, io) {
    opts = await prepareImages(tree, opts, io);
    return buildDocx(tree, lib, opts);
  }

  // ── preview ──
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderHtml(tree) {
    var defs = collectDefinitions(tree);
    var fnDefs = {};
    visit(tree, function (n) { if (n.type === 'footnoteDefinition' && !fnDefs[n.identifier]) fnDefs[n.identifier] = n; return true; });
    var fnIds = {};
    var fnOrder = [];
    visit(tree, function (n) {
      if (n.type === 'footnoteDefinition') return false;
      if (n.type === 'footnoteReference' && fnDefs[n.identifier] && !fnIds[n.identifier]) {
        fnOrder.push(n.identifier);
        fnIds[n.identifier] = fnOrder.length;
      }
      return true;
    });

    function img(url, alt) {
      if (/^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml)[;,]/i.test(url || '')) {
        return '<img src="' + escHtml(url) + '" alt="' + escHtml(alt || '') + '">';
      }
      return '<span class="mw-img-ph">[' + escHtml(alt || 'image') + '] ' + escHtml(url || '') + '</span>';
    }

    function inline(nodes) {
      var s = '';
      var skip = null;
      (nodes || []).forEach(function (n) {
        if (skip) {
          if (n.type === 'html' && new RegExp('^</' + skip + '\\s*>$', 'i').test(n.value.trim())) skip = null;
          return;
        }
        switch (n.type) {
          case 'text': s += escHtml(n.value); break;
          case 'strong': s += '<strong>' + inline(n.children) + '</strong>'; break;
          case 'emphasis': s += '<em>' + inline(n.children) + '</em>'; break;
          case 'delete': s += '<del>' + inline(n.children) + '</del>'; break;
          case 'inlineCode': s += '<code>' + escHtml(n.value) + '</code>'; break;
          case 'break': s += '<br>'; break;
          case 'link':
          case 'linkReference': {
            var url = n.type === 'link' ? n.url : (defs[n.identifier] || {}).url;
            s += isLinkUrl(url)
              ? '<a href="' + escHtml(url.trim()) + '" target="_blank" rel="noopener noreferrer">' + inline(n.children) + '</a>'
              : inline(n.children);
            break;
          }
          case 'image': s += img(n.url, n.alt); break;
          case 'imageReference': s += img((defs[n.identifier] || {}).url, n.alt); break;
          case 'footnoteReference':
            s += fnIds[n.identifier] ? '<sup>[' + fnIds[n.identifier] + ']</sup>' : escHtml('[^' + n.label + ']');
            break;
          case 'html': {
            var k = inlineHtmlKind(n.value);
            if (k.kind === 'br') s += '<br>';
            else if (k.kind === 'skip' && !new RegExp('</' + k.tag + '\\s*>', 'i').test(n.value)) skip = k.tag;
            break;
          }
          default:
            if (n.children) s += inline(n.children);
        }
      });
      return s;
    }

    function block(nodes) {
      var s = '';
      (nodes || []).forEach(function (n) {
        switch (n.type) {
          case 'heading': s += '<h' + n.depth + '>' + inline(n.children) + '</h' + n.depth + '>'; break;
          case 'paragraph': s += '<p>' + inline(n.children) + '</p>'; break;
          case 'list': {
            var tag = n.ordered ? 'ol' : 'ul';
            s += '<' + tag + (n.ordered && n.start != null && n.start !== 1 ? ' start="' + Number(n.start) + '"' : '') + '>';
            n.children.forEach(function (item) {
              var task = item.checked === true || item.checked === false;
              s += '<li' + (task ? ' class="mw-task"' : '') + '>';
              if (task) s += '<input type="checkbox" disabled' + (item.checked ? ' checked' : '') + '> ';
              s += block(item.children).replace(/^<p>([\s\S]*?)<\/p>/, '$1');
              s += '</li>';
            });
            s += '</' + tag + '>';
            break;
          }
          case 'code': s += '<pre><code>' + escHtml(n.value) + '</code></pre>'; break;
          case 'blockquote': s += '<blockquote>' + block(n.children) + '</blockquote>'; break;
          case 'thematicBreak': s += '<hr>'; break;
          case 'table': {
            var align = n.align || [];
            var ncol = n.children[0] ? n.children[0].children.length : 0;
            s += '<div class="mw-table-wrap"><table>';
            n.children.forEach(function (row, ri) {
              if (ri === 0) s += '<thead>';
              if (ri === 1) s += '<tbody>';
              s += '<tr>';
              for (var c = 0; c < ncol; c++) {
                var cell = row.children[c];
                var t = ri === 0 ? 'th' : 'td';
                s += '<' + t + (align[c] ? ' style="text-align:' + align[c] + '"' : '') + '>' + (cell ? inline(cell.children) : '') + '</' + t + '>';
              }
              s += '</tr>';
              if (ri === 0) s += '</thead>';
            });
            if (n.children.length > 1) s += '</tbody>';
            s += '</table></div>';
            break;
          }
          case 'html': {
            var text = htmlToText(n.value);
            if (text) s += '<p>' + escHtml(text).replace(/\n/g, '<br>') + '</p>';
            break;
          }
          default:
            break;
        }
      });
      return s;
    }

    var html = block(tree.children);
    if (fnOrder.length) {
      html += '<ol class="mw-footnotes">' + fnOrder.map(function (id) {
        return '<li>' + block(fnDefs[id].children).replace(/^<p>([\s\S]*?)<\/p>/, '$1') + '</li>';
      }).join('') + '</ol>';
    }
    return html;
  }
  
export { parseMarkdown, renderHtml, exportDocx, prepareImages, buildDocx, firstHeadingText, safeFilename, paperFor, defaultPaper, defaultFontFor, collectImageUrls, escHtml, sniffImage, decodeDataUri, fitImage, FONT_PRESETS, PREVIEW_BLOCKS };
