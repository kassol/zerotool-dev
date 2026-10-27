# W6 batch 5 — wifi-qr-code-generator fact-check (2026-10-27)

Scope: 88 statements — the 6 FAQ answers in each language, the 5 field-table rows, the intro, the escaping paragraph, every example paragraph, the phone lists, the printable-card section, the competitor lists, the closing claim and the Limits section. Files: `src/content/tools/wifi-qr-code-generator/{en,zh,ja,ko}.mdx`, visible copy of `src/components/tools/WifiQrCodeGeneratorTool.astro`, `src/data/persistence.ts:42`, `src/data/network.ts` (slug absent). No FAQ item, id, order, steps, seoTitle, `engine:start/end`, persistence, network, analytics or script changed.

## Corrections (18 statements; en 5, zh 4, ja 5, ko 4)

| Claim | file:line (en / zh / ja / ko) | Before → after |
|---|---|---|
| WIFI URI origin | en.mdx:34 · zh.mdx:34 · ja.mdx:34 · ko.mdx:34 | "Wi-Fi Alliance later wrote it into section 7 of the WPA3 Specification v3.5" → the spec's own revision history says WIFI URI arrived in **v3.0** (2020-12-14); section 7 of v3.5 defines it |
| `T` values | en.mdx:38 · zh.mdx:38 · ja.mdx:38 · ko.mdx:38 | Values `WEP`/`nopass` presented alongside the spec's `WPA` → they are ZXing/Android values; §7.1 "does not define usage of the WIFI URI with WEP" and omits `T` for an open network |
| `R:1` meaning | en.mdx:39 · zh.mdx:39 · ja.mdx:39 · ko.mdx:39 | "bit 0 = WPA3-Personal: phones … will not fall back" → Table 6 names bit 0 **WPA3-Personal Only**, which disables all PSK/FT-over-PSK AKMs; the URI field is a hex bitmap |
| WPA3 example vs spec example 2 | en.mdx:55 | "the same string as example 2 in section 7.3" → false: example 2 is `WIFI:T:WPA;R:1;S:MyNet;P:MyPassword;;`. Now "the same field pattern … which uses `MyNet` and `MyPassword`" |
| Enterprise limit and `I` | en.mdx:86 · zh.mdx:88 · ja.mdx:88 · ko.mdx:87 | en said the spec "does not define" E/A/I/PH2 → §7.1 **does** define `I` (SAE Password Identifier), while ZXing uses `I` for the EAP identity. Split into two bullets: enterprise fields, then `K` and the SAE `I` |
| Literal `%XX` | en.mdx:89 · zh.mdx:91 · ja.mdx:91 · ko.mdx:90 | Missing: a literal `%` + two hex digits is ambiguous once the spec percent-encodes `;` as `%3B`; the engine warns (`checkWifi` line 399). Added as a limits bullet |

`ja.mdx:52`: "食い違うのはこれらの文字だけ" was an exclusivity claim that the new `%` bullet contradicts; changed to "こうした文字の扱いが食い違うため".

## Verified against code (file:line)

- Payload order `T, R, S, H, P` and `T:nopass` for open: `WifiQrCodeGeneratorTool.astro:348-359`. `R:1` only for WPA3-only: 348 + 356. `H:true` only when hidden: 356.
- Escaping set `\ ; , " :`: 349-351. The `%`-plus-hex warning: 399. Trailing-backslash warning: 402-404.
- 32-byte SSID warning and non-ASCII note: 383-385; WPA passphrase 8–63 printable ASCII or 64 hex: 386; WEP 5/13 chars or 10/26 hex: 387-390; leading/trailing space: 393-395.
- WPA/WEP without `P` is an error (no code drawn): 382; `errNoPassword`/`errNoKey` strings 42-43.
- Printer card 1200 units = 100 mm, PNG 1 px/unit ≈ 305 dpi: 408-412, 450, 810-825; space printed as `␣`: 460; hidden line: 456; SVG `width="100mm"`: 483.
- Quiet zone 4 modules: 340; PNG whole-pixel layout: 640-644; vendor library `/vendor/qrcode.min.js`: 335, `QRCode.create` 739.
- Privacy: no storage/network calls in the component (only `trackTool` on copy/download/print, 680, 864-890); `persistence.ts:42` `'wifi-qr-code-generator': 'disabled'` → `ToolLayout.astro` `sensitive` → no GA4/AdSense (same wiring verified for cookie-parser). `network.ts` has no entry.

## Primary sources (retrieved 2026-10-27)

- Wi-Fi Alliance, WPA3 Specification v3.5 (2025-02-26), revision history p.3, §7.1 ABNF (`type`, `trdisable`, `ssid`, `hidden`, `id`, `password`, `public-key`), §7.3 examples 1–4, §8 Table 6 bit 0: <https://www.wi-fi.org/system/files/WPA3%20Specification%20v3.5.pdf>
- AOSP `WifiUriParser.java`, `main` (types WEP/WPA/SAE/nopass, `R` honored only when equal to `1`, `isValidConfig`, `removeBackSlash`, `addQuotation`, OPEN+OWE params): <https://android.googlesource.com/platform/packages/modules/Wifi/+/refs/heads/main/framework/java/android/net/wifi/WifiUriParser.java>
- ZXing wiki, Barcode Contents § Wi-Fi (5 escaped characters, hex-looking names quoted, `T` list, field order free): <https://raw.githubusercontent.com/wiki/zxing/zxing/Barcode-Contents.md>

## Unverified (unchanged)

- Competitor observations are dated 2026-10-01 and were not re-run: qifi.org low-byte UTF-16 bug, GenQRCode `/preview` POST, UU 在线工具 no escaping and default "no encryption", 草料 help page, QRのススメ `data=` request, wifiqr.co.kr Korean rejection.
- iPhone Camera field support: Apple publishes no list; the page says so and says it was not tested.
- Samsung Wi-Fi screen QR icon and the 2026 external links were not re-checked.
- Android "shares the same format" (`WifiNetworkConfig.getQrCode()`) was not re-fetched today; the prior batch recorded `WIFI:S:…;T:…;P:…;H:false;;` (different field order, same fields).
- "WEP can be cracked in minutes" and the ISO/IEC 18004 / 15415 numbers in component copy rest on prior batches, not on a source fetched today.

## Tests

- `node scripts/test-wifi-qr-code-generator.mjs` after edits: 368 passed, 0 failed, exit 0.
- `node scripts/test-tool-content-parity.mjs`: 7753 passed, 0 failed, exit 0.
- `node scripts/audit.mjs --quiet`: 24 PASS, 0 WARN, 0 FAIL, exit 0.
