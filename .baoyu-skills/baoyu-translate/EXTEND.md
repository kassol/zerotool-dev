# baoyu-translate preferences (project: zerotool-dev)

target_language: zh-CN
default_mode: normal
audience: technical
style: technical

# ZeroTool blog posts: developer-focused tutorials and tool guides.
# All translations target SEO + comprehension for working developers,
# not casual readers. Keep code snippets, command-line examples, and
# technical terms unmodified. Translate prose around them.

glossary:
  - source: ZeroTool
    targets:
      zh: ZeroTool
      ja: ZeroTool
      ko: ZeroTool
  - source: tool
    targets:
      zh: 工具
      ja: ツール
      ko: 도구
  - source: browser-based
    targets:
      zh: 浏览器端
      ja: ブラウザベース
      ko: 브라우저 기반
  - source: client-side
    targets:
      zh: 客户端
      ja: クライアントサイド
      ko: 클라이언트 사이드
  - source: developer
    targets:
      zh: 开发者
      ja: 開発者
      ko: 개발자

# Internal link handling
# Markdown links to ZeroTool's own pages MUST gain a language prefix matching
# the target translation. Slug字面 stays unchanged; only the path prefix shifts.
#
#   en source:                ](/tools/json-formatter)
#   zh translation output:    ](/zh/tools/json-formatter/)
#   ja translation output:    ](/ja/tools/json-formatter/)
#   ko translation output:    ](/ko/tools/json-formatter/)
#
# Same rule applies to /category/, /blog/ paths. External URLs and code
# blocks are left untouched. scripts/audit.mjs `checkBlogInternalLinks`
# enforces this — missing the rewrite is a build-blocking FAIL.
