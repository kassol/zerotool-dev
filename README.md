# ZeroTool

**Free, fast, browser-based developer tools. No sign-up required.**

[zerotool.dev](https://zerotool.dev) — 44 tools and growing.

## Tools

| Tool | URL |
|------|-----|
| JSON Formatter | [/tools/json-formatter](https://zerotool.dev/tools/json-formatter) |
| Base64 Encode / Decode | [/tools/base64](https://zerotool.dev/tools/base64) |
| UUID Generator | [/tools/uuid-generator](https://zerotool.dev/tools/uuid-generator) |
| URL Encode / Decode | [/tools/url-encode](https://zerotool.dev/tools/url-encode) |
| Text Case Converter | [/tools/text-case](https://zerotool.dev/tools/text-case) |
| Markdown Preview | [/tools/markdown-preview](https://zerotool.dev/tools/markdown-preview) |
| Color Converter | [/tools/color-converter](https://zerotool.dev/tools/color-converter) |
| Regex Tester | [/tools/regex-tester](https://zerotool.dev/tools/regex-tester) |
| Hash Generator | [/tools/hash-generator](https://zerotool.dev/tools/hash-generator) |
| Timestamp Converter | [/tools/timestamp-converter](https://zerotool.dev/tools/timestamp-converter) |
| JWT Decoder | [/tools/jwt-decoder](https://zerotool.dev/tools/jwt-decoder) |
| Diff Checker | [/tools/diff-checker](https://zerotool.dev/tools/diff-checker) |
| Password Generator | [/tools/password-generator](https://zerotool.dev/tools/password-generator) |
| QR Code Generator | [/tools/qr-code-generator](https://zerotool.dev/tools/qr-code-generator) |
| Cron Expression Parser | [/tools/cron-parser](https://zerotool.dev/tools/cron-parser) |
| Lorem Ipsum Generator | [/tools/lorem-ipsum](https://zerotool.dev/tools/lorem-ipsum) |
| Word Counter | [/tools/word-counter](https://zerotool.dev/tools/word-counter) |
| Chmod Calculator | [/tools/chmod-calculator](https://zerotool.dev/tools/chmod-calculator) |
| CSV ↔ JSON Converter | [/tools/csv-json](https://zerotool.dev/tools/csv-json) |
| HTML Entity Encoder | [/tools/html-entity](https://zerotool.dev/tools/html-entity) |
| YAML ↔ JSON Converter | [/tools/yaml-json](https://zerotool.dev/tools/yaml-json) |
| Line Tools | [/tools/line-tools](https://zerotool.dev/tools/line-tools) |
| Number Base Converter | [/tools/number-base](https://zerotool.dev/tools/number-base) |
| SQL Formatter | [/tools/sql-formatter](https://zerotool.dev/tools/sql-formatter) |
| Aspect Ratio Calculator | [/tools/aspect-ratio](https://zerotool.dev/tools/aspect-ratio) |
| XML Formatter | [/tools/xml-formatter](https://zerotool.dev/tools/xml-formatter) |
| ASCII Converter | [/tools/ascii-converter](https://zerotool.dev/tools/ascii-converter) |
| TOML to JSON Converter | [/tools/toml-json](https://zerotool.dev/tools/toml-json) |
| Image to Base64 Converter | [/tools/image-to-base64](https://zerotool.dev/tools/image-to-base64) |
| CSS to Tailwind Converter | [/tools/css-to-tailwind](https://zerotool.dev/tools/css-to-tailwind) |
| CSS Unit Converter | [/tools/css-unit-converter](https://zerotool.dev/tools/css-unit-converter) |
| Markdown Table Generator | [/tools/markdown-table-generator](https://zerotool.dev/tools/markdown-table-generator) |
| JSON to TypeScript Generator | [/tools/json-to-typescript](https://zerotool.dev/tools/json-to-typescript) |
| Fake Data Generator | [/tools/fake-data-generator](https://zerotool.dev/tools/fake-data-generator) |
| URL Parser | [/tools/url-parser](https://zerotool.dev/tools/url-parser) |
| Slugify String | [/tools/slugify](https://zerotool.dev/tools/slugify) |
| HTTP Status Codes | [/tools/http-status-codes](https://zerotool.dev/tools/http-status-codes) |
| HMAC Generator | [/tools/hmac-generator](https://zerotool.dev/tools/hmac-generator) |
| cURL to Code Converter | [/tools/curl-to-code](https://zerotool.dev/tools/curl-to-code) |
| JSON to Zod Schema | [/tools/json-to-zod](https://zerotool.dev/tools/json-to-zod) |
| Docker Run to Compose | [/tools/docker-to-compose](https://zerotool.dev/tools/docker-to-compose) |
| RSA Key Pair Generator | [/tools/rsa-key-generator](https://zerotool.dev/tools/rsa-key-generator) |
| TOTP Generator | [/tools/totp-generator](https://zerotool.dev/tools/totp-generator) |
| JSON Diff | [/tools/json-diff](https://zerotool.dev/tools/json-diff) |

## Why ZeroTool?

- **Private by design** — everything runs in your browser, nothing is sent to a server
- **No friction** — no account, no paywalls
- **Offline-capable** — works without internet after first load
- **Fast** — static site on Cloudflare edge, global CDN

## Stack

- [Astro](https://astro.build/) — static site generator
- [Cloudflare Pages](https://pages.cloudflare.com/) — hosting & edge delivery
- Vanilla JS — zero framework overhead in tool pages

## Development

```bash
npm install
npm run dev       # localhost:4321
npm run build     # production build → dist/
```

## Contributing

Tool requests and bug reports welcome via [GitHub Issues](https://github.com/kassol/zerotool-dev/issues).

For new tool PRs: each tool should be self-contained in a single `.astro` file under `src/pages/tools/`, with all logic in an inline `<script>` tag. No external dependencies.

## License

MIT
