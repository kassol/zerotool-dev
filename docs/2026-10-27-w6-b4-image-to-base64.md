# W6 batch 4 — image-to-base64 fact check (2026-10-27)

Scope: `image-to-base64` en / zh / ja / ko MDX and the visible strings of `ImageToBase64Tool.astro`. Read-only evidence: `src/data/persistence.ts`, `src/data/network.ts`, `scripts/test-image-to-base64.mjs`. No candidate index existed for this tool; statements were enumerated from the four MDX and the component. External facts re-fetched 2026-10-27.

## Counts

146 statements: 123 supported, 16 corrected, 4 qualified (clearing clause added to the privacy answer), 3 unverified. 24 FAQ answers, 36 claim-bearing component strings, 86 body claims. FAQ ids, order and count unchanged; steps unchanged; seoTitle reviewed, not changed; `engine:start/end`, persistence, network, analytics and scripts untouched.

| Language | Statements | Corrected | Qualified | Unverified |
|---|---:|---:|---:|---:|
| en | 38 | 5 | 1 | 0 |
| zh | 36 | 2 | 1 | 2 |
| ja | 36 | 3 | 1 | 1 |
| ko | 36 | 2 | 1 | 0 |
| component (4 languages) | 36 | 4 | 0 | 0 |

## Corrections

| # | Location | Before | After | Evidence |
|---|---|---|---|---|
| 1 | en.mdx:40 | "The alt text is the file name" | "the file name without its extension" | `ImageToBase64Tool.astro:514-517` `altFromName()` strips `\.[A-Za-z0-9]+$`; `dot.png` → `dot`. Verified with the engine. |
| 2 | en.mdx:48 | "Only the characters that change meaning are escaped." | "Only the characters that would break the URL, the HTML attribute or the CSS string are escaped, and bytes outside ASCII are escaped too." | `:493-508` `URL_RAW` omits `[ ] { } \| ^ \`` and all bytes ≥ 0x80; every non-raw byte becomes `%XX`, including CJK text that does not change URL meaning. |
| 3 | en.mdx:48 | "which can join `<svg` to the next attribute" | "which would join the end of one line to the start of the next" | `:602-603` deletes raw tab / LF / CR (URL Standard), so the tag end joins `<path>`, not an attribute name. |
| 4 | en.mdx:54 | "sends a data URI in `image_url.url`" | "sends a data URI in the `image_url` field (`image_url.url` in Chat Completions)" | OpenAI Images and vision guide: Responses API uses `input_image.image_url` as a string; only Chat Completions nests `url`. |
| 5 | en.mdx:77 | "The Base64 of a 100 MB file is about 140 million characters" | "The Base64 of the largest accepted file (104,857,600 bytes) is about 140 million characters" | `:318` `FILE_LIMIT = 100 * 1024 * 1024`; `base64Length()` gives 139,810,136 characters (verified). A decimal 100 MB file gives 133.3 million, so the old pair mixed units. |
| 6 | zh.mdx:69 | "上限 100 MB，对应约 1.4 亿个 Base64 字符" | "上限 100 MB（实际判断为 104,857,600 字节，最大文件的 Base64 约 1.4 亿个字符）" | Same `:318`; 139,810,136 characters. |
| 7 | ja.mdx:73 | "100 MB まで（Base64 で約 1 億 4 千万文字）" | "100 MB まで（判定は 104,857,600 バイト、Base64 で約 1 億 4 千万文字）" | Same `:318`. |
| 8 | ko.mdx:71 | "100MB까지입니다(Base64로 약 1억 4천만 자)" | "100MB까지입니다(판정 기준 104,857,600바이트, Base64로 약 1억 4천만 자)" | Same `:318`. |
| 9 | en.mdx:79 | "the tool makes no network requests" | "the tool does not download an image" | The page loads GA4 (`persistence.ts` has no entry, so the default `input` policy applies) and `:842` / `:998` call `trackTool`, which sends requests. The intended claim is that image URLs are not fetched (no `fetch` / XHR in the component). |
| 10 | zh.mdx:71 | "工具不发出网络请求" | "工具不下载图片" | Same: `trackTool` at `:842`, `:998`; no image fetch. |
| 11 | ja.mdx:75 | "通信しないので画像の URL は指定できません" | "画像を取得しないので URL は指定できません" | Same. |
| 12 | ko.mdx:73 | "네트워크 요청을 하지 않으므로" | "이미지를 내려받지 않으므로" | Same. |
| 13 | component en `tips.output` (:55) | "takes its alt text from the file name" | "from the file name without the extension" | `:514-517`. |
| 14 | component zh `tips.output` (:103) | "alt 取自文件名" | "alt 取自去掉扩展名的文件名" | `:514-517`. |
| 15 | component ja `tips.output` (:151) | "alt はファイル名から作ります" | "alt は拡張子を除いたファイル名から作ります" | `:514-517`. |
| 16 | component ko `tips.output` (:199) | "alt는 파일 이름에서 가져오며" | "alt는 확장자를 뺀 파일 이름에서 가져오며" | `:514-517`. |
| 17 | privacy answer ×4 (en:29, zh:29, ja:29, ko:29) | No clearing statement | "Clear removes the file, the text and the decoded image from the page" (localized) | `:754-767` `resetEncode()`, `:946-954` `resetDecode()`, `:1004-1009` Ctrl/⌘+L. Site convention requires the privacy answer to say how data is cleared. |

## Reviewed, no change

- Format detection: `sniffImage()` (`:431-446`) checks the `ftyp` brands first (`:370-395`), then PNG, JPEG, GIF, WebP, `FF 0A` / `0000000C JXL ` (JPEG XL), TIFF, ICO, CUR, BMP, then SVG text (`:399-426`). Matches the en claim that PNG, JPEG, GIF, WebP, BMP and ICO come from WHATWG MIME Sniffing §6.1, with AVIF / HEIC brands and TIFF / JPEG XL headers added. A 256-byte `ftyp` box starting `00 00 01 00` is not read as ICO (checked first).
- Non-image error lists 8 bytes: `:453-457`, `:799`; a PDF (`25 50 44 46`) and ZIP (`50 4B 03 04`) fall through to it.
- `image/png` for a `.jpg`-named PNG and the mismatch note: `:466-483`, `:813-816`; decode side `:666-675`, `:977-979`.
- Base64 growth: `base64Length()` `:485`, `growthPercent()` `:693-696`. Recomputed against the engine: 95 B → 128 chars (+34.7%); 267 B → 356 (+33.3%); 66 B → 88 (+33.3%); 1,009 B → 1,348 (+33.6%). Data URI prefixes 22 (`image/png`) and 26 (`image/svg+xml`).
- SVG examples recomputed byte for byte with `percentEncodeBytes()` and `dataUriSvg()`: en 139 B → 214 / 198; zh 258 B → 370 / 357; ja 156 B → 234 / 221; ko 173 B → 258 / 222. The engine reproduces each CSS body exactly and selects the shorter URI (`:811`).
- HTML output takes `naturalWidth` / `naturalHeight` (`:826-831`) and omits them for SVG (`:828`); Markdown wraps a destination containing a space in `<...>` (`:529-532`), which the ko example shows.
- Display threshold 2,000,000 (`:319`), `Copy` uses `state.text` even when the box is hidden (`:916-933`), `Download .txt` appears only for long output (`:746-751`, `:935-943`).
- Decode accepts bare Base64, a data URI inside CSS / HTML / Markdown / JSON, `\/`, URL-safe alphabet, missing padding (`:560-664`); positions are 1-based code points (`:550-558`). The quoted messages in en:60, zh:52, ja:56 match `T.decBadLength` / `T.decPadMiddle` / `T.decBadChar` exactly.
- Preview notes: HEIC / HEIF only in Safari 17+ (caniuse HEIF: Safari 17.0–26.6, iOS 17.0+ supported; Chrome / Edge / Firefox not supported), TIFF only in Safari (MDN image format guide). `noPreview` selects the HEIC note for every key starting `hei` (`:834`, `:992`).
- MDN data URL limits: Chromium and Firefox 512 MB, Safari 2048 MB (page last modified 2026-08-30).
- Privacy: the component never calls `ztPersist`; `test-image-to-base64.mjs:315` asserts no storage / cookie / fetch / XHR API. `persistence.ts:10-60` has no entry (default `input`, nothing saved). `network.ts:5-10, 22-24` does not list the slug, so no network note and the trust bar keeps the browser-processing text.
- Analytics: one `encode` per successful encode (`:842`), one `decode` per successful decode (`:998`); no event for failures, Clear or copy.
- Local scenes: Baidu general OCR (`image` is Base64 + urlencode, ≤ 8M, jpg/jpeg/png/bmp; page updated 2024-07-31); CLOVA OCR General (`format` jpg/jpeg/png/pdf/tif/tiff, image ≤ 50 MB, `images[].data` is Base64) and its JavaScript example comment `base64String.split(',')[1]`; Apple support 116944 (Settings → Camera → Formats → Most Compatible saves JPEG; Preview exports via File → Export).
- Anthropic vision: Base64 in `data`, type in `media_type`, JPEG / PNG / GIF / WebP. OpenAI: PNG / JPEG / WebP / non-animated GIF.
- Competitor table and sentences are dated 2026-09-30 observations; the dates were kept and the numbers were not re-measured.

## Unverified

- zh.mdx:46 "发票截图 `invoice.jpg`（267 字节）": the byte count, Base64 length and growth are consistent with `base64Length()`; the file itself is not in the repo, so that it is a 2 × 2 receipt screenshot is unverified.
- zh.mdx:44 "文档里的 Python 示例用 `base64.b64encode(f.read())`": the parameter text was verified, but the fetched page was truncated before the Python sample; the exact call was not re-read.
- ja.mdx:36 "macOS の `sips` で PNG から作った 1,009 バイトの例": the info line arithmetic (1,009 → 1,348, +33.6%) was recomputed; the HEIC fixture was not regenerated today.

## seoTitle (reported, not changed)

All four are accurate and within the 30-character local limit where applicable: en 47, zh "图片转 Base64，可转回图片 | ZeroTool", ja "画像 Base64 変換（相互変換）| ZeroTool", ko "이미지 Base64 변환·복원 | ZeroTool". No change needed.

## Tests

- `node scripts/test-image-to-base64.mjs` — 469 passed, 0 failed.
- `node scripts/test-tool-content-parity.mjs` — 141 tools, 7,753 passed, 0 failed.
- `node scripts/audit.mjs --quiet` — 24 PASS, 0 WARN, 0 FAIL.
