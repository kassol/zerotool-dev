// Build the DeepSeek V4 tokenizer data module for ai-token-counter
//
// Read:  the official tokenizer.json from DeepSeek's offline token counting package
//        (https://cdn.deepseek.com/api-docs/deepseek_v4_tokenizer.zip, linked from
//        https://api-docs.deepseek.com/quick_start/token_usage); path given as the first argument
// Write: src/data/deepseek-v4-tokenizer.mjs (generated, committed; do not edit by hand)
// Exit:  0 on success, 1 when the file does not have the structure the browser encoder assumes
//
// The browser encoder in AiTokenCounterTool.astro implements exactly what this file describes:
// three "Isolated" regex splits, byte-level mapping without a prefix space, then BPE that applies
// merges by rank. This script refuses to write the module if tokenizer.json uses anything else
// (a normalizer, dropout, byte fallback, a continuing-subword prefix, ...), so a future version of
// the file cannot be converted silently into a wrong tokenizer.
//
// Output layout (base64 of one byte array, 3-byte big-endian ids):
//   256 ids          token id of each byte value 0..255 (GPT-2 bytes_to_unicode mapping)
//   N pairs          left id, right id of merge i; the merge produces token id FIRST_MERGE_ID + i
// plus the added tokens (special and normal) as [id, content] pairs, the split patterns and the
// SHA-256 of the source file.
//
// Run: node scripts/build-deepseek-tokenizer.mjs /path/to/deepseek_v4_tokenizer/tokenizer.json

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/build-deepseek-tokenizer.mjs /path/to/tokenizer.json');
  process.exit(1);
}
const raw = readFileSync(src);
const sha256 = createHash('sha256').update(raw).digest('hex');
const tok = JSON.parse(raw.toString('utf8'));

function die(msg) {
  console.error('FAIL: ' + msg);
  process.exit(1);
}

// ── Structure checks ────────────────────────────────────────────────
if (tok.normalizer && !(tok.normalizer.type === 'Sequence' && tok.normalizer.normalizers.length === 0)) {
  die('unexpected normalizer ' + JSON.stringify(tok.normalizer));
}
const pre = tok.pre_tokenizer;
if (!pre || pre.type !== 'Sequence') die('pre_tokenizer is not a Sequence');
const splits = pre.pretokenizers.filter((p) => p.type === 'Split');
const byteLevel = pre.pretokenizers.filter((p) => p.type === 'ByteLevel');
if (splits.length + byteLevel.length !== pre.pretokenizers.length) die('unexpected pre_tokenizer step');
if (byteLevel.length !== 1 || pre.pretokenizers[pre.pretokenizers.length - 1] !== byteLevel[0]) die('ByteLevel must be the last step');
if (byteLevel[0].add_prefix_space !== false || byteLevel[0].use_regex !== false) die('ByteLevel must not add a prefix space or use its own regex');
for (const s of splits) {
  if (s.behavior !== 'Isolated' || s.invert !== false || !s.pattern || typeof s.pattern.Regex !== 'string') {
    die('unsupported Split ' + JSON.stringify(s));
  }
}
const pp = tok.post_processor;
if (pp && pp.type !== 'ByteLevel') die('post_processor adds tokens: ' + JSON.stringify(pp).slice(0, 200));
const m = tok.model;
if (m.type !== 'BPE') die('model is not BPE');
if (m.dropout != null || m.byte_fallback || m.continuing_subword_prefix || m.end_of_word_suffix || m.ignore_merges || m.unk_token) {
  die('unsupported BPE option');
}

// GPT-2 bytes_to_unicode
const bs = [];
for (let b = 0x21; b <= 0x7e; b++) bs.push(b);
for (let b = 0xa1; b <= 0xac; b++) bs.push(b);
for (let b = 0xae; b <= 0xff; b++) bs.push(b);
const cs = bs.slice();
let n = 0;
for (let b = 0; b < 256; b++) {
  if (!bs.includes(b)) { bs.push(b); cs.push(256 + n); n++; }
}
const byteChar = new Array(256);
bs.forEach((b, i) => { byteChar[b] = String.fromCodePoint(cs[i]); });

const vocab = m.vocab;
const byteIds = byteChar.map((c) => {
  if (!(c in vocab)) die('byte symbol missing from vocab');
  return vocab[c];
});

const merges = m.merges.map((x) => (Array.isArray(x) ? x : x.split(' ')));
let firstMergeId = null;
const pairs = [];
merges.forEach(([a, b], i) => {
  if (!(a in vocab) || !(b in vocab)) die('merge ' + i + ' uses an unknown symbol');
  const id = vocab[a + b];
  if (id === undefined) die('merge ' + i + ' result missing from vocab');
  if (firstMergeId === null) firstMergeId = id;
  if (id !== firstMergeId + i) die('merge ' + i + ' result id ' + id + ' is not ' + (firstMergeId + i));
  pairs.push(vocab[a], vocab[b]);
});
const maxId = Object.values(vocab).concat(tok.added_tokens.map((t) => t.id)).reduce((a, b) => (b > a ? b : a), 0);
if (maxId >= 1 << 24) die('ids do not fit in 3 bytes');

for (const t of tok.added_tokens) {
  if (t.lstrip || t.rstrip || t.single_word) die('added token with lstrip / rstrip / single_word: ' + t.content);
}

const ids = byteIds.concat(pairs);
const buf = Buffer.alloc(ids.length * 3);
ids.forEach((id, i) => {
  buf[i * 3] = (id >> 16) & 0xff;
  buf[i * 3 + 1] = (id >> 8) & 0xff;
  buf[i * 3 + 2] = id & 0xff;
});

const added = tok.added_tokens.map((t) => [t.id, t.content]);
const out = `// GENERATED by scripts/build-deepseek-tokenizer.mjs — do not edit.
// Source: DeepSeek offline token counting package deepseek_v4_tokenizer.zip, tokenizer.json
// (https://api-docs.deepseek.com/quick_start/token_usage), SHA-256 ${sha256}
export const SOURCE_SHA256 = '${sha256}';
export const VOCAB_SIZE = ${maxId + 1};
export const FIRST_MERGE_ID = ${firstMergeId};
export const MERGE_COUNT = ${merges.length};
export const SPLIT_PATTERNS = ${JSON.stringify(splits.map((s) => s.pattern.Regex))};
export const ADDED_TOKENS = ${JSON.stringify(added)};
export const DATA = '${buf.toString('base64')}';
`;
const target = join(root, 'src/data/deepseek-v4-tokenizer.mjs');
writeFileSync(target, out);
console.log(`wrote ${target}: ${merges.length} merges, ${added.length} added tokens, ${out.length} bytes`);
