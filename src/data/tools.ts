export interface ToolTranslation {
  name: string;
  description: string;
}

export interface ToolInfo {
  slug: string;
  translations: Record<string, ToolTranslation>;
  category: 'data' | 'encoding' | 'text' | 'security' | 'dev';
}

export function getToolName(tool: ToolInfo, lang: string): string {
  return tool.translations[lang]?.name ?? tool.translations.en.name;
}
export function getToolDescription(tool: ToolInfo, lang: string): string {
  return tool.translations[lang]?.description ?? tool.translations.en.description;
}

export const allTools: ToolInfo[] = [
  { slug: 'json-formatter', translations: { en: { name: 'JSON Formatter', description: 'Prettify, minify, and validate JSON instantly in your browser.' }, zh: { name: 'JSON 格式化', description: '在浏览器中即时美化、压缩和验证 JSON，实时高亮语法错误。' } }, category: 'data' },
  { slug: 'base64', translations: { en: { name: 'Base64 Encode / Decode', description: 'Encode text to Base64 or decode Base64 back to plain text.' }, zh: { name: 'Base64 编码 / 解码', description: '将文本编码为 Base64，或将 Base64 解码为纯文本。' } }, category: 'encoding' },
  { slug: 'uuid-generator', translations: { en: { name: 'UUID Generator', description: 'Generate v4 UUIDs instantly — single or batch.' }, zh: { name: 'UUID 生成器', description: '即时生成 v4 UUID，支持单个或批量生成。' } }, category: 'dev' },
  { slug: 'url-encode', translations: { en: { name: 'URL Encode / Decode', description: 'Encode or decode URL components and query strings.' }, zh: { name: 'URL 编码 / 解码', description: '编码或解码 URL 组件和查询字符串。' } }, category: 'encoding' },
  { slug: 'text-case', translations: { en: { name: 'Text Case Converter', description: 'Convert text to UPPER, lower, Title, camelCase, snake_case, and more.' }, zh: { name: '文本大小写转换', description: '将文本转换为全大写、全小写、标题格式、驼峰命名、下划线命名等。' } }, category: 'text' },
  { slug: 'markdown-preview', translations: { en: { name: 'Markdown Preview', description: 'Live Markdown editor with real-time HTML preview. Supports GFM tables, task lists, and code blocks.' }, zh: { name: 'Markdown 预览', description: '实时 Markdown 编辑器，带 HTML 预览。支持 GFM 表格、任务列表和代码块。' } }, category: 'text' },
  { slug: 'color-converter', translations: { en: { name: 'Color Converter', description: 'Convert colors between HEX, RGB, and HSL formats with a live color preview.' }, zh: { name: '颜色转换器', description: '在 HEX、RGB 和 HSL 格式之间转换颜色，带实时颜色预览。' } }, category: 'dev' },
  { slug: 'regex-tester', translations: { en: { name: 'Regex Tester', description: 'Test regular expressions in real time with match highlighting and capture group details.' }, zh: { name: '正则表达式测试器', description: '实时测试正则表达式，高亮匹配结果并显示捕获组详情。' } }, category: 'dev' },
  { slug: 'hash-generator', translations: { en: { name: 'Hash Generator', description: 'Generate MD5, SHA-1, SHA-256, SHA-384, and SHA-512 hashes from any text.' }, zh: { name: '哈希生成器', description: '从任意文本生成 MD5、SHA-1、SHA-256、SHA-384 和 SHA-512 哈希值。' } }, category: 'security' },
  { slug: 'timestamp-converter', translations: { en: { name: 'Timestamp Converter', description: 'Convert Unix timestamps to human-readable dates and vice versa. Auto-detects seconds vs milliseconds.' }, zh: { name: '时间戳转换器', description: '将 Unix 时间戳转换为可读日期，或反向转换。自动检测秒/毫秒。' } }, category: 'dev' },
  { slug: 'jwt-decoder', translations: { en: { name: 'JWT Decoder', description: 'Decode and inspect JWT header, payload, and signature. Highlights expiry status and timestamp claims.' }, zh: { name: 'JWT 解码器', description: '解码并查看 JWT 的 Header、Payload 和 Signature，高亮过期状态。' } }, category: 'security' },
  { slug: 'diff-checker', translations: { en: { name: 'Diff Checker', description: 'Compare two texts line by line and highlight additions and deletions. Powered by LCS algorithm.' }, zh: { name: '文本对比', description: '逐行比较两段文本，高亮新增和删除内容，基于 LCS 算法。' } }, category: 'text' },
  { slug: 'password-generator', translations: { en: { name: 'Password Generator', description: 'Generate cryptographically secure passwords. Customize length and character sets with entropy meter.' }, zh: { name: '密码生成器', description: '生成加密安全的密码，可自定义长度和字符集，附熵值计量。' } }, category: 'security' },
  { slug: 'qr-code-generator', translations: { en: { name: 'QR Code Generator', description: 'Generate QR codes from URLs, text, Wi-Fi credentials, and more. Download as PNG.' }, zh: { name: '二维码生成器', description: '从 URL、文本、Wi-Fi 凭证等生成二维码，可下载为 PNG。' } }, category: 'dev' },
  { slug: 'cron-parser', translations: { en: { name: 'Cron Expression Parser', description: 'Parse and explain cron expressions in plain English. Preview next 10 scheduled run times.' }, zh: { name: 'Cron 表达式解析器', description: '用自然语言解释 Cron 表达式，预览最近 10 次执行时间。' } }, category: 'dev' },
  { slug: 'lorem-ipsum', translations: { en: { name: 'Lorem Ipsum Generator', description: 'Generate Lorem Ipsum placeholder text instantly. Choose paragraph count and copy to clipboard.' }, zh: { name: 'Lorem Ipsum 生成器', description: '即时生成 Lorem Ipsum 占位文本，可选段落数量，一键复制。' } }, category: 'text' },
  { slug: 'word-counter', translations: { en: { name: 'Word & Character Counter', description: 'Count words, characters, sentences, and paragraphs. Estimate reading and speaking time.' }, zh: { name: '字数统计工具', description: '即时统计字数、字符数、句子数和段落数，估算阅读和演讲时间。' } }, category: 'text' },
  { slug: 'chmod-calculator', translations: { en: { name: 'Chmod Calculator', description: 'Calculate Linux file permissions interactively. Convert between numeric and symbolic notation.' }, zh: { name: 'Chmod 权限计算器', description: '交互式计算 Linux 文件权限，在数字和符号表示法之间转换。' } }, category: 'dev' },
  { slug: 'csv-json', translations: { en: { name: 'CSV to JSON Converter', description: 'Convert CSV to JSON and JSON to CSV instantly. Handles quoted fields, auto-detects headers.' }, zh: { name: 'CSV JSON 转换器', description: '即时进行 CSV 与 JSON 格式互转，支持引号字段，自动识别表头。' } }, category: 'data' },
  { slug: 'html-entity', translations: { en: { name: 'HTML Entity Encoder / Decoder', description: 'Encode and decode HTML entities. Supports named, decimal, and hex entities.' }, zh: { name: 'HTML 实体编码 / 解码', description: '编码和解码 HTML 实体，支持命名实体、十进制和十六进制编码。' } }, category: 'encoding' },
  { slug: 'yaml-json', translations: { en: { name: 'YAML to JSON Converter', description: 'Convert YAML to JSON and JSON to YAML instantly. Supports nested objects, arrays, and all YAML 1.2 features.' }, zh: { name: 'YAML JSON 转换器', description: '即时进行 YAML 与 JSON 格式互转，支持嵌套对象、数组及所有 YAML 1.2 特性。' } }, category: 'data' },
  { slug: 'line-tools', translations: { en: { name: 'Line Tools', description: 'Remove duplicate lines, sort alphabetically or numerically, reverse, shuffle, and trim text lines.' }, zh: { name: '文本行工具', description: '去除重复行、按字母或数字排序、反转、随机打乱、去除首尾空白。' } }, category: 'text' },
  { slug: 'number-base', translations: { en: { name: 'Number Base Converter', description: 'Convert between binary, octal, decimal, and hex number systems.' }, zh: { name: '进制转换器', description: '在二进制、八进制、十进制和十六进制之间互转。' } }, category: 'dev' },
  { slug: 'sql-formatter', translations: { en: { name: 'SQL Formatter', description: 'Format, beautify, and minify SQL queries with syntax highlighting.' }, zh: { name: 'SQL 格式化工具', description: '格式化、美化和压缩 SQL 查询语句，带语法高亮。' } }, category: 'dev' },
  { slug: 'aspect-ratio', translations: { en: { name: 'Aspect Ratio Calculator', description: 'Calculate and resize aspect ratios. Lock ratio and scale dimensions proportionally.' }, zh: { name: '宽高比计算器', description: '计算宽高比，锁定比例等比缩放尺寸。' } }, category: 'dev' },
  { slug: 'xml-formatter', translations: { en: { name: 'XML Formatter', description: 'Format, beautify, and minify XML documents with syntax validation.' }, zh: { name: 'XML 格式化工具', description: '格式化、美化和压缩 XML 文档，带语法校验。' } }, category: 'data' },
  { slug: 'ascii-converter', translations: { en: { name: 'ASCII Converter', description: 'Convert between text and ASCII codes. Supports decimal, hex, and binary representations.' }, zh: { name: 'ASCII 转换器', description: '在文本与 ASCII 码之间互转，支持十进制、十六进制和二进制。' } }, category: 'encoding' },
  { slug: 'toml-json', translations: { en: { name: 'TOML to JSON Converter', description: 'Convert between TOML and JSON formats instantly with validation.' }, zh: { name: 'TOML JSON 转换器', description: '即时进行 TOML 与 JSON 格式互转，带格式校验。' } }, category: 'data' },
  { slug: 'image-to-base64', translations: { en: { name: 'Image to Base64 Converter', description: 'Convert images to Base64 strings and Data URIs. Supports PNG, JPEG, GIF, and more.' }, zh: { name: '图片转 Base64 工具', description: '将图片转换为 Base64 字符串和 Data URI，支持 PNG、JPEG、GIF 等格式。' } }, category: 'encoding' },
  { slug: 'css-to-tailwind', translations: { en: { name: 'CSS to Tailwind Converter', description: 'Convert CSS properties to Tailwind utility classes instantly.' }, zh: { name: 'CSS 转 Tailwind 工具', description: '即时将 CSS 属性转换为 Tailwind 工具类。' } }, category: 'dev' },
  { slug: 'markdown-table-generator', translations: { en: { name: 'Markdown Table Generator', description: 'Build Markdown tables visually — add rows and columns, paste CSV or JSON, then copy the formatted table.' }, zh: { name: 'Markdown 表格生成器', description: '可视化构建 Markdown 表格，支持 CSV 和 JSON 导入，一键复制格式化表格。' } }, category: 'text' },
];

/** Return related tools for a given slug: same category first, then others. */
export function getRelatedTools(currentSlug: string, count = 4): ToolInfo[] {
  const current = allTools.find(t => t.slug === currentSlug);
  if (!current) return allTools.filter(t => t.slug !== currentSlug).slice(0, count);

  const sameCategory = allTools.filter(t => t.slug !== currentSlug && t.category === current.category);
  const otherCategory = allTools.filter(t => t.slug !== currentSlug && t.category !== current.category);
  return [...sameCategory, ...otherCategory].slice(0, count);
}
