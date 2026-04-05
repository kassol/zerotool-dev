export interface ToolInfo {
  slug: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  category: 'data' | 'encoding' | 'text' | 'security' | 'dev';
}

export const allTools: ToolInfo[] = [
  { slug: 'json-formatter', name: 'JSON Formatter', nameZh: 'JSON 格式化', description: 'Prettify, minify, and validate JSON instantly in your browser.', descriptionZh: '在浏览器中即时美化、压缩和验证 JSON，实时高亮语法错误。', category: 'data' },
  { slug: 'base64', name: 'Base64 Encode / Decode', nameZh: 'Base64 编码 / 解码', description: 'Encode text to Base64 or decode Base64 back to plain text.', descriptionZh: '将文本编码为 Base64，或将 Base64 解码为纯文本。', category: 'encoding' },
  { slug: 'uuid-generator', name: 'UUID Generator', nameZh: 'UUID 生成器', description: 'Generate v4 UUIDs instantly — single or batch.', descriptionZh: '即时生成 v4 UUID，支持单个或批量生成。', category: 'dev' },
  { slug: 'url-encode', name: 'URL Encode / Decode', nameZh: 'URL 编码 / 解码', description: 'Encode or decode URL components and query strings.', descriptionZh: '编码或解码 URL 组件和查询字符串。', category: 'encoding' },
  { slug: 'text-case', name: 'Text Case Converter', nameZh: '文本大小写转换', description: 'Convert text to UPPER, lower, Title, camelCase, snake_case, and more.', descriptionZh: '将文本转换为全大写、全小写、标题格式、驼峰命名、下划线命名等。', category: 'text' },
  { slug: 'markdown-preview', name: 'Markdown Preview', nameZh: 'Markdown 预览', description: 'Live Markdown editor with real-time HTML preview. Supports GFM tables, task lists, and code blocks.', descriptionZh: '实时 Markdown 编辑器，带 HTML 预览。支持 GFM 表格、任务列表和代码块。', category: 'text' },
  { slug: 'color-converter', name: 'Color Converter', nameZh: '颜色转换器', description: 'Convert colors between HEX, RGB, and HSL formats with a live color preview.', descriptionZh: '在 HEX、RGB 和 HSL 格式之间转换颜色，带实时颜色预览。', category: 'dev' },
  { slug: 'regex-tester', name: 'Regex Tester', nameZh: '正则表达式测试器', description: 'Test regular expressions in real time with match highlighting and capture group details.', descriptionZh: '实时测试正则表达式，高亮匹配结果并显示捕获组详情。', category: 'dev' },
  { slug: 'hash-generator', name: 'Hash Generator', nameZh: '哈希生成器', description: 'Generate MD5, SHA-1, SHA-256, SHA-384, and SHA-512 hashes from any text.', descriptionZh: '从任意文本生成 MD5、SHA-1、SHA-256、SHA-384 和 SHA-512 哈希值。', category: 'security' },
  { slug: 'timestamp-converter', name: 'Timestamp Converter', nameZh: '时间戳转换器', description: 'Convert Unix timestamps to human-readable dates and vice versa. Auto-detects seconds vs milliseconds.', descriptionZh: '将 Unix 时间戳转换为可读日期，或反向转换。自动检测秒/毫秒。', category: 'dev' },
  { slug: 'jwt-decoder', name: 'JWT Decoder', nameZh: 'JWT 解码器', description: 'Decode and inspect JWT header, payload, and signature. Highlights expiry status and timestamp claims.', descriptionZh: '解码并查看 JWT 的 Header、Payload 和 Signature，高亮过期状态。', category: 'security' },
  { slug: 'diff-checker', name: 'Diff Checker', nameZh: '文本对比', description: 'Compare two texts line by line and highlight additions and deletions. Powered by LCS algorithm.', descriptionZh: '逐行比较两段文本，高亮新增和删除内容，基于 LCS 算法。', category: 'text' },
  { slug: 'password-generator', name: 'Password Generator', nameZh: '密码生成器', description: 'Generate cryptographically secure passwords. Customize length and character sets with entropy meter.', descriptionZh: '生成加密安全的密码，可自定义长度和字符集，附熵值计量。', category: 'security' },
  { slug: 'qr-code-generator', name: 'QR Code Generator', nameZh: '二维码生成器', description: 'Generate QR codes from URLs, text, Wi-Fi credentials, and more. Download as PNG.', descriptionZh: '从 URL、文本、Wi-Fi 凭证等生成二维码，可下载为 PNG。', category: 'dev' },
  { slug: 'cron-parser', name: 'Cron Expression Parser', nameZh: 'Cron 表达式解析器', description: 'Parse and explain cron expressions in plain English. Preview next 10 scheduled run times.', descriptionZh: '用自然语言解释 Cron 表达式，预览最近 10 次执行时间。', category: 'dev' },
  { slug: 'lorem-ipsum', name: 'Lorem Ipsum Generator', nameZh: 'Lorem Ipsum 生成器', description: 'Generate Lorem Ipsum placeholder text instantly. Choose paragraph count and copy to clipboard.', descriptionZh: '即时生成 Lorem Ipsum 占位文本，可选段落数量，一键复制。', category: 'text' },
  { slug: 'word-counter', name: 'Word & Character Counter', nameZh: '字数统计工具', description: 'Count words, characters, sentences, and paragraphs. Estimate reading and speaking time.', descriptionZh: '即时统计字数、字符数、句子数和段落数，估算阅读和演讲时间。', category: 'text' },
  { slug: 'chmod-calculator', name: 'Chmod Calculator', nameZh: 'Chmod 权限计算器', description: 'Calculate Linux file permissions interactively. Convert between numeric and symbolic notation.', descriptionZh: '交互式计算 Linux 文件权限，在数字和符号表示法之间转换。', category: 'dev' },
  { slug: 'csv-json', name: 'CSV to JSON Converter', nameZh: 'CSV JSON 转换器', description: 'Convert CSV to JSON and JSON to CSV instantly. Handles quoted fields, auto-detects headers.', descriptionZh: '即时进行 CSV 与 JSON 格式互转，支持引号字段，自动识别表头。', category: 'data' },
  { slug: 'html-entity', name: 'HTML Entity Encoder / Decoder', nameZh: 'HTML 实体编码 / 解码', description: 'Encode and decode HTML entities. Supports named, decimal, and hex entities.', descriptionZh: '编码和解码 HTML 实体，支持命名实体、十进制和十六进制编码。', category: 'encoding' },
  { slug: 'yaml-json', name: 'YAML to JSON Converter', nameZh: 'YAML JSON 转换器', description: 'Convert YAML to JSON and JSON to YAML instantly. Supports nested objects, arrays, and all YAML 1.2 features.', descriptionZh: '即时进行 YAML 与 JSON 格式互转，支持嵌套对象、数组及所有 YAML 1.2 特性。', category: 'data' },
  { slug: 'line-tools', name: 'Line Tools', nameZh: '文本行工具', description: 'Remove duplicate lines, sort alphabetically or numerically, reverse, shuffle, and trim text lines.', descriptionZh: '去除重复行、按字母或数字排序、反转、随机打乱、去除首尾空白。', category: 'text' },
  { slug: 'number-base', name: 'Number Base Converter', nameZh: '进制转换器', description: 'Convert between binary, octal, decimal, and hex number systems.', descriptionZh: '在二进制、八进制、十进制和十六进制之间互转。', category: 'dev' },
  { slug: 'sql-formatter', name: 'SQL Formatter', nameZh: 'SQL 格式化工具', description: 'Format, beautify, and minify SQL queries with syntax highlighting.', descriptionZh: '格式化、美化和压缩 SQL 查询语句，带语法高亮。', category: 'dev' },
  { slug: 'aspect-ratio', name: 'Aspect Ratio Calculator', nameZh: '宽高比计算器', description: 'Calculate and resize aspect ratios. Lock ratio and scale dimensions proportionally.', descriptionZh: '计算宽高比，锁定比例等比缩放尺寸。', category: 'dev' },
  { slug: 'xml-formatter', name: 'XML Formatter', nameZh: 'XML 格式化工具', description: 'Format, beautify, and minify XML documents with syntax validation.', descriptionZh: '格式化、美化和压缩 XML 文档，带语法校验。', category: 'data' },
  { slug: 'ascii-converter', name: 'ASCII Converter', nameZh: 'ASCII 转换器', description: 'Convert between text and ASCII codes. Supports decimal, hex, and binary representations.', descriptionZh: '在文本与 ASCII 码之间互转，支持十进制、十六进制和二进制。', category: 'encoding' },
  { slug: 'toml-json', name: 'TOML to JSON Converter', nameZh: 'TOML JSON 转换器', description: 'Convert between TOML and JSON formats instantly with validation.', descriptionZh: '即时进行 TOML 与 JSON 格式互转，带格式校验。', category: 'data' },
  { slug: 'image-to-base64', name: 'Image to Base64 Converter', nameZh: '图片转 Base64 工具', description: 'Convert images to Base64 strings and Data URIs. Supports PNG, JPEG, GIF, and more.', descriptionZh: '将图片转换为 Base64 字符串和 Data URI，支持 PNG、JPEG、GIF 等格式。', category: 'encoding' },
  { slug: 'css-to-tailwind', name: 'CSS to Tailwind Converter', nameZh: 'CSS 转 Tailwind 工具', description: 'Convert CSS properties to Tailwind utility classes instantly.', descriptionZh: '即时将 CSS 属性转换为 Tailwind 工具类。', category: 'dev' },
];

/** Return related tools for a given slug: same category first, then others. */
export function getRelatedTools(currentSlug: string, count = 4): ToolInfo[] {
  const current = allTools.find(t => t.slug === currentSlug);
  if (!current) return allTools.filter(t => t.slug !== currentSlug).slice(0, count);

  const sameCategory = allTools.filter(t => t.slug !== currentSlug && t.category === current.category);
  const otherCategory = allTools.filter(t => t.slug !== currentSlug && t.category !== current.category);
  return [...sameCategory, ...otherCategory].slice(0, count);
}
