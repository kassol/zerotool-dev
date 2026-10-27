# W6 B2 — ssl-certificate-decoder fact-check (2026-10-27)

Scope: the four MDX files and the component's visible copy. 80 statements reviewed: 41 supported, 17 corrected, 13 qualified, 9 unverified. Machine-readable rows: `docs/2026-10-27-w6-b2-ssl-certificate-decoder.json`. The correction table below covers 21 copy locations; the JSON counts 17 corrected statement rows (four new Limits bullets are disclosure, not replacements). No logic, options, engine blocks, tests or other tools changed.

## Corrections

| file:line | before -> after |
|---|---|
| en.mdx:13, zh.mdx:13, ja.mdx:13, ko.mdx:13 | Quoted input is "saved ... and restored" -> "saved ... up to the site's 50 KB per-entry limit; larger input is not saved and leaves an earlier saved entry in place"; "Web Crypto computes the fingerprints" -> "SHA fingerprints" (MD5 is the page's JS); "tool name and action only" -> "the tool's custom event parameters". |
| en.mdx:16, zh.mdx:16, ja.mdx:16, ko.mdx:16 | "Every certificate in the input is decoded" -> "Every certificate in the input is decoded, up to 200 per input" (matches `MAX_CERTS = 200` and the truncation notice). |
| en.mdx:79, zh.mdx:71, ja.mdx:61, ko.mdx:68 | "CERTIFICATE, the legacy X509 CERTIFICATE, and OpenSSL's TRUSTED CERTIFICATE (RFC 7468)" -> RFC 7468 is cited for `CERTIFICATE` only; `X509 CERTIFICATE` is called non-standard and `TRUSTED CERTIFICATE` OpenSSL-specific. |
| en.mdx:70 | "Leaf validity longer than the Baseline Requirements allow for its issue date (398, 200, 100, then 47 days)" -> "Leaf validity above 398 days (the tier applied to every certificate issued before 2026-03-15), or above 200, 100, then 47 days for certificates issued on or after 2026-03-15, 2027-03-15 and 2029-03-15". |
| SslCertificateDecoderTool.astro:134, 257, 380, 503 | `chk_brValidity` "issued from this date may be valid for at most {max} days" -> "This check compares it with the {max}-day Baseline Requirements tier; certificates issued before 2020-09-01 had earlier limits that this check does not model." |
| en.mdx:104, zh.mdx:95, ja.mdx:91, ko.mdx:90 | No disclosure -> new Limits bullet: the check applies the 398-day tier to every certificate issued before 2026-03-15; the 398-day rule took effect 2020-09-01 and earlier limits are not modelled. |

## Primary sources (retrieved 2026-10-27)

| Source | URL |
|---|---|
| CA/B Forum Baseline Requirements 2.3.1 (2026-10-04) | https://raw.githubusercontent.com/cabforum/servercert/main/docs/BR.md |
| Chrome certificate lifetimes (398 days from 2020-09-01) | https://github.com/chromium/chromium/blob/main/net/docs/certificate_lifetimes.md |
| RFC 5280 (validity, serial, signature, extensions) | https://www.rfc-editor.org/rfc/rfc5280.txt |
| RFC 8446 §4.4.2 (certificate order, root omission) | https://www.rfc-editor.org/rfc/rfc8446.txt |
| RFC 9525 (CN, wildcards) | https://www.rfc-editor.org/rfc/rfc9525.txt |
| RFC 7469 §2.4 (SPKI pin-sha256) | https://www.rfc-editor.org/rfc/rfc7469.txt |
| RFC 7468 (PEM labels) | https://www.rfc-editor.org/rfc/rfc7468.txt |
| Oracle JDK 21 PKI guide (AIA property default off) | https://docs.oracle.com/en/java/javase/21/security/java-pki-programmers-guide.html |
| golang/go#31773 (AIA proposal declined) | https://go.dev/issue/31773 |
| nginx HTTPS servers (chain order) | https://nginx.org/en/docs/http/configuring_https_servers.html |
| Chrome 58 deprecations (CN matching removed) | https://developer.chrome.com/blog/chrome-58-deprecations |
| Chrome SHA-1 removal (local-anchor policy ended after 2019-01-01) | https://www.chromium.org/Home/chromium-security/education/tls/sha-1/ |
| Google Analytics default event parameters | https://support.google.com/analytics/answer/9234069?hl=en |
| OpenSSL 3.6 `pkcs12` (`-nokeys`; PKCS #12 may hold a private key) | https://docs.openssl.org/3.6/man1/openssl-pkcs12/ |

## Unverified / qualified

- Competitor tables (SSL Shopper, CertLogik, Report URI, MySSL, ラッコツールズ, SecureSign) and their date/time observations are dated 2026-10-01; not re-run today because this task forbids browser automation.
- `chk_weakHash` says browsers reject SHA-1 and MD5. Chrome's SHA-1 removal is sourced; the MD5 half was not separately re-sourced today, so the row is qualified.
- "Browsers often download a missing intermediate through AIA" is implementation-specific and was not re-tested; Java default-off and Go's declined AIA support were verified.
- "Every time is shown in UTC, next to the raw value" holds for notBefore/notAfter; SCT timestamps are UTC but have no raw certificate-encoded value. Left unchanged, recorded as qualified.
- The validity check still applies the 398-day tier to every certificate issued before 2026-03-15. The 398-day rule took effect 2020-09-01; the earlier 825-day limit (2018-03-01 to 2020-08-31) is not modelled. This is now disclosed, not fixed.
- Code finding (not a copy blocker): a PEM `-----BEGIN PKCS12-----` block is skipped by `parseInput` but does not set `hasPrivateKey` (component lines 1446–1451), so `persist()` can save it (2156–2161). `.pfx`/`.p12` files are rejected before the input box. This needs a code fix; the page does not claim such a block is never saved, but `scripts/audit.mjs:660` does.
- Example expiry: all four example leaves are valid on 2026-10-27. The en leaf expires 2026-12-25, so that example will show "expired" after that date; no page text claims otherwise.

## Tests

- `node scripts/test-ssl-certificate-decoder.mjs`: before edits 1057 passed / 0 failed / 0 skipped; after edits 1057 / 0 / 0. No test file changed.
- `node scripts/test-tool-content-parity.mjs`: 7753 passed / 0 failed.
- `node scripts/audit.mjs --quiet`: 24 PASS / 0 WARN / 0 FAIL.
