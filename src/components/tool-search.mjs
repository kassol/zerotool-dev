// Tool directory search (home page and /tools/). Pure functions, shared by
// ToolSearchBar.astro and scripts/test-tool-search.mjs.
//
// Query: NFKC, lower case, split on spaces and list punctuation, then split again where Latin
// meets CJK ("格式化json" → "格式化", "json"). Every word must hit the tool's name, slug,
// description or its name in another language. Generic words ("online", "工具", "ツール",
// "도구" …) are dropped when other words remain.
//
// CJK words have no spaces between them, so a CJK run that is not found as a whole is split:
// generic words are removed, then the rest is covered from the left by the longest pieces
// (at least 2 characters, or a last single character) found in the same tool's text. Every
// piece must be found; the word scores as its weakest piece. "压缩gif图片" therefore needs
// "压缩", "gif" and "图片" all in one tool.
//
// Score per word, best field wins: exact name or slug 100, name or slug prefix 80, word start
// in name or slug 60, inside name or slug 40, other-language name 30 / 20 (word start / inside),
// description 15 / 10. A multi-word query also gets a bonus when the whole phrase is the name
// (50), starts it (30) or is inside it (20). Equal scores keep the directory order.

const GENERIC = [
  'online', 'tools', 'tool', 'free',
  '在线工具', '在线', '工具', '免费', '線上', '工具箱',
  'オンライン', 'ツール', '無料',
  '온라인', '도구', '무료',
];
const GENERIC_CJK = GENERIC.filter((w) => !/^[a-z]+$/.test(w)).sort((a, b) => b.length - a.length);

// Hangul Jamo, CJK punctuation-free ranges: Hiragana/Katakana, Hangul compatibility Jamo,
// CJK Unified Ideographs (+ Ext A), Hangul syllables, CJK compatibility ideographs.
const CJK_CHAR = /[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/;
const SEPARATORS = /[\s,，、。/|·・;；:：]+/;

export function normalizeSearchText(s) {
  return String(s == null ? '' : s).normalize('NFKC').toLowerCase();
}

export function isCjk(ch) {
  return CJK_CHAR.test(ch);
}

// "格式化json" → [{ text: '格式化', cjk: true }, { text: 'json', cjk: false }]
export function tokenizeQuery(query) {
  const parts = normalizeSearchText(query).trim().split(SEPARATORS).filter(Boolean);
  const words = [];
  for (const part of parts) {
    let run = '';
    let runCjk = null;
    for (const ch of part) {
      const c = isCjk(ch);
      if (run && c !== runCjk) { words.push({ text: run, cjk: runCjk }); run = ''; }
      run += ch;
      runCjk = c;
    }
    if (run) words.push({ text: run, cjk: runCjk });
  }
  const kept = words.filter((w) => !GENERIC.includes(w.text));
  return kept.length ? kept : words;
}

// tool: { slug, name, description, altNames: string[] }
export function makeEntry(tool) {
  return {
    slug: normalizeSearchText(tool.slug),
    name: normalizeSearchText(tool.name).trim(),
    desc: normalizeSearchText(tool.description),
    alt: (tool.altNames || []).map(normalizeSearchText).join('\n'),
  };
}

function atWordStart(hay, word) {
  let i = hay.indexOf(word);
  while (i !== -1) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(hay[i - 1])) return true;
    i = hay.indexOf(word, i + 1);
  }
  return false;
}

export function wordScore(entry, word) {
  if (!word) return 0;
  if (word === entry.name || word === entry.slug) return 100;
  if (entry.name.startsWith(word) || entry.slug.startsWith(word)) return 80;
  if (atWordStart(entry.name, word) || atWordStart(entry.slug, word)) return 60;
  if (entry.name.includes(word) || entry.slug.includes(word)) return 40;
  if (atWordStart(entry.alt, word)) return 30;
  if (entry.alt.includes(word)) return 20;
  if (atWordStart(entry.desc, word)) return 15;
  if (entry.desc.includes(word)) return 10;
  return 0;
}

// Covers a CJK run with pieces found in this tool's text; returns the weakest piece's score,
// 0 when a piece is missing, or -1 when the run is only generic words.
function cjkCoverScore(entry, text) {
  let rest = text;
  for (const g of GENERIC_CJK) rest = rest.split(g).join('\u0000');
  const segments = rest.split('\u0000').filter(Boolean);
  if (!segments.length) return -1;
  let min = Infinity;
  for (const seg of segments) {
    const chars = Array.from(seg);
    let i = 0;
    while (i < chars.length) {
      let best = 0;
      let next = i;
      for (let j = chars.length; j > i; j--) {
        if (j - i < 2 && !(j === chars.length && i === chars.length - 1)) continue;
        const s = wordScore(entry, chars.slice(i, j).join(''));
        if (s > 0) { best = s; next = j; break; }
      }
      if (!best) return 0;
      min = Math.min(min, best);
      i = next;
    }
  }
  return min;
}

export function scoreEntry(entry, words, phrase) {
  let total = 0;
  let counted = 0;
  for (const w of words) {
    let s = wordScore(entry, w.text);
    if (!s && !w.cjk && w.text.length > 3 && w.text.endsWith('s')) s = wordScore(entry, w.text.slice(0, -1)) * 0.9;
    if (!s && w.cjk && Array.from(w.text).length > 1) {
      const c = cjkCoverScore(entry, w.text);
      if (c === -1) continue;
      s = c * 0.8;
    }
    if (!s) return 0;
    total += s;
    counted++;
  }
  if (!counted) return 0;
  if (words.length > 1 && phrase) {
    if (entry.name === phrase) total += 50;
    else if (entry.name.startsWith(phrase)) total += 30;
    else if (entry.name.includes(phrase)) total += 20;
  }
  return total;
}

// Returns null for an empty query (show everything in directory order), otherwise the
// indices of matching entries, best first; equal scores keep the input order.
export function searchEntries(entries, query) {
  const words = tokenizeQuery(query);
  if (!words.length) return null;
  const phrase = normalizeSearchText(query).trim().split(/\s+/).join(' ');
  const hits = [];
  entries.forEach((entry, i) => {
    const score = scoreEntry(entry, words, phrase);
    if (score > 0) hits.push({ i, score });
  });
  hits.sort((a, b) => b.score - a.score || a.i - b.i);
  return hits.map((h) => h.i);
}
