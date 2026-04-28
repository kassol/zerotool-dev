// Centralized component map for the dynamic [slug] tool routes.
// One registry, four routes (en/zh/ja/ko) consume it — adding a new tool
// requires editing this file once instead of four parallel route files.

import AsciiConverterTool from './AsciiConverterTool.astro';
import AspectRatioTool from './AspectRatioTool.astro';
import Base64Tool from './Base64Tool.astro';
import ChmodCalculatorTool from './ChmodCalculatorTool.astro';
import ColorConverterTool from './ColorConverterTool.astro';
import CronParserTool from './CronParserTool.astro';
import CssToTailwindTool from './CssToTailwindTool.astro';
import CssUnitConverterTool from './CssUnitConverterTool.astro';
import CsvJsonTool from './CsvJsonTool.astro';
import DiffCheckerTool from './DiffCheckerTool.astro';
import HashGeneratorTool from './HashGeneratorTool.astro';
import HtmlEntityTool from './HtmlEntityTool.astro';
import ImageToBase64Tool from './ImageToBase64Tool.astro';
import JsonFormatterTool from './JsonFormatterTool.astro';
import JwtDecoderTool from './JwtDecoderTool.astro';
import LineToolsTool from './LineToolsTool.astro';
import LoremIpsumTool from './LoremIpsumTool.astro';
import MarkdownPreviewTool from './MarkdownPreviewTool.astro';
import MarkdownLinterTool from './MarkdownLinterTool.astro';
import MarkdownToWordTool from './MarkdownToWordTool.astro';
import MarkdownTableGeneratorTool from './MarkdownTableGeneratorTool.astro';
import NumberBaseTool from './NumberBaseTool.astro';
import PasswordGeneratorTool from './PasswordGeneratorTool.astro';
import QrCodeGeneratorTool from './QrCodeGeneratorTool.astro';
import RegexTesterTool from './RegexTesterTool.astro';
import SqlFormatterTool from './SqlFormatterTool.astro';
import TextCaseTool from './TextCaseTool.astro';
import TimestampConverterTool from './TimestampConverterTool.astro';
import TomlJsonTool from './TomlJsonTool.astro';
import UrlEncodeTool from './UrlEncodeTool.astro';
import UuidGeneratorTool from './UuidGeneratorTool.astro';
import WordCounterTool from './WordCounterTool.astro';
import XmlFormatterTool from './XmlFormatterTool.astro';
import YamlJsonTool from './YamlJsonTool.astro';
import JsonToTypescriptTool from './JsonToTypescriptTool.astro';
import FakeDataGeneratorTool from './FakeDataGeneratorTool.astro';
import UrlParserTool from './UrlParserTool.astro';
import SlugifyTool from './SlugifyTool.astro';
import HttpStatusCodesTool from './HttpStatusCodesTool.astro';
import HmacGeneratorTool from './HmacGeneratorTool.astro';
import CurlToCodeTool from './CurlToCodeTool.astro';
import JsonToZodTool from './JsonToZodTool.astro';
import DockerToComposeTool from './DockerToComposeTool.astro';
import RsaKeyGeneratorTool from './RsaKeyGeneratorTool.astro';
import TotpGeneratorTool from './TotpGeneratorTool.astro';
import JsonDiffTool from './JsonDiffTool.astro';
import EnvFileParserTool from './EnvFileParserTool.astro';
import YamlValidatorTool from './YamlValidatorTool.astro';
import JsonSchemaValidatorTool from './JsonSchemaValidatorTool.astro';
import HtaccessGeneratorTool from './HtaccessGeneratorTool.astro';
import RobotsTxtGeneratorTool from './RobotsTxtGeneratorTool.astro';
import SvgToPngConverterTool from './SvgToPngConverterTool.astro';
import WebpConverterTool from './WebpConverterTool.astro';
import CssVariablesGeneratorTool from './CssVariablesGeneratorTool.astro';
import CssGridGeneratorTool from './CssGridGeneratorTool.astro';
import JsonpathTesterTool from './JsonpathTesterTool.astro';
import CssFlexboxGeneratorTool from './CssFlexboxGeneratorTool.astro';
import JsonToJsonSchemaTool from './JsonToJsonSchemaTool.astro';
import MorseCodeTranslatorTool from './MorseCodeTranslatorTool.astro';
import AesEncryptDecryptTool from './AesEncryptDecryptTool.astro';
import JsonToKotlinTool from './JsonToKotlinTool.astro';
import JsonToJavaTool from './JsonToJavaTool.astro';
import JsonToGoStructTool from './JsonToGoStructTool.astro';
import UnicodeTextConverterTool from './UnicodeTextConverterTool.astro';
import CssSpecificityCalculatorTool from './CssSpecificityCalculatorTool.astro';
import OpenapiValidatorTool from './OpenapiValidatorTool.astro';
import CsvToMarkdownTool from './CsvToMarkdownTool.astro';
import TextToBinaryTool from './TextToBinaryTool.astro';
import NatoPhoneticAlphabetTool from './NatoPhoneticAlphabetTool.astro';
import TextToAsciiArtTool from './TextToAsciiArtTool.astro';
import IpSubnetCalculatorTool from './IpSubnetCalculatorTool.astro';
import HtmlToJsxTool from './HtmlToJsxTool.astro';
import CsvToSqlTool from './CsvToSqlTool.astro';
import SvgToJsxTool from './SvgToJsxTool.astro';
import HtpasswdGeneratorTool from './HtpasswdGeneratorTool.astro';
import ProtobufToJsonTool from './ProtobufToJsonTool.astro';
import BoxShadowGeneratorTool from './BoxShadowGeneratorTool.astro';
import ColorShadesGeneratorTool from './ColorShadesGeneratorTool.astro';
import UlidGeneratorTool from './UlidGeneratorTool.astro';
import QrCodeDecoderTool from './QrCodeDecoderTool.astro';
import TypescriptToZodTool from './TypescriptToZodTool.astro';
import JsonToPythonDataclassTool from './JsonToPythonDataclassTool.astro';
import JwtGeneratorTool from './JwtGeneratorTool.astro';
import JsonToMongooseTool from './JsonToMongooseTool.astro';
import YamlTomlTool from './YamlTomlTool.astro';
import JsonToCsvTool from './JsonToCsvTool.astro';
import BcryptGeneratorTool from './BcryptGeneratorTool.astro';
import HtmlToMarkdownTool from './HtmlToMarkdownTool.astro';
import GlassmorphismGeneratorTool from './GlassmorphismGeneratorTool.astro';
import CssTriangleGeneratorTool from './CssTriangleGeneratorTool.astro';
import CssGradientGeneratorTool from './CssGradientGeneratorTool.astro';
import NanoIdGeneratorTool from './NanoIdGeneratorTool.astro';
import CookieParserTool from './CookieParserTool.astro';
import CssClipPathGeneratorTool from './CssClipPathGeneratorTool.astro';
import ColorPaletteGeneratorTool from './ColorPaletteGeneratorTool.astro';
import StringEscapeTool from './StringEscapeTool.astro';
import JsonXmlConverterTool from './JsonXmlConverterTool.astro';
import CssFilterGeneratorTool from './CssFilterGeneratorTool.astro';
import CronJobGeneratorTool from './CronJobGeneratorTool.astro';
import WifiQrCodeGeneratorTool from './WifiQrCodeGeneratorTool.astro';
import ExifMetadataViewerTool from './ExifMetadataViewerTool.astro';

export const toolComponentMap: Record<string, (_props: { lang?: string }) => any> = {
  'ascii-converter': AsciiConverterTool,
  'aspect-ratio': AspectRatioTool,
  'base64': Base64Tool,
  'chmod-calculator': ChmodCalculatorTool,
  'color-converter': ColorConverterTool,
  'cron-parser': CronParserTool,
  'css-to-tailwind': CssToTailwindTool,
  'css-unit-converter': CssUnitConverterTool,
  'csv-json': CsvJsonTool,
  'diff-checker': DiffCheckerTool,
  'hash-generator': HashGeneratorTool,
  'html-entity': HtmlEntityTool,
  'image-to-base64': ImageToBase64Tool,
  'json-formatter': JsonFormatterTool,
  'jwt-decoder': JwtDecoderTool,
  'line-tools': LineToolsTool,
  'lorem-ipsum': LoremIpsumTool,
  'markdown-preview': MarkdownPreviewTool,
  'markdown-linter': MarkdownLinterTool,
  'markdown-to-word': MarkdownToWordTool,
  'markdown-table-generator': MarkdownTableGeneratorTool,
  'number-base': NumberBaseTool,
  'password-generator': PasswordGeneratorTool,
  'qr-code-generator': QrCodeGeneratorTool,
  'regex-tester': RegexTesterTool,
  'sql-formatter': SqlFormatterTool,
  'text-case': TextCaseTool,
  'timestamp-converter': TimestampConverterTool,
  'toml-json': TomlJsonTool,
  'url-encode': UrlEncodeTool,
  'uuid-generator': UuidGeneratorTool,
  'word-counter': WordCounterTool,
  'xml-formatter': XmlFormatterTool,
  'yaml-json': YamlJsonTool,
  'json-to-typescript': JsonToTypescriptTool,
  'fake-data-generator': FakeDataGeneratorTool,
  'url-parser': UrlParserTool,
  'slugify': SlugifyTool,
  'http-status-codes': HttpStatusCodesTool,
  'hmac-generator': HmacGeneratorTool,
  'curl-to-code': CurlToCodeTool,
  'json-to-zod': JsonToZodTool,
  'docker-to-compose': DockerToComposeTool,
  'rsa-key-generator': RsaKeyGeneratorTool,
  'totp-generator': TotpGeneratorTool,
  'json-diff': JsonDiffTool,
  'env-file-parser': EnvFileParserTool,
  'yaml-validator': YamlValidatorTool,
  'json-schema-validator': JsonSchemaValidatorTool,
  'htaccess-generator': HtaccessGeneratorTool,
  'robots-txt-generator': RobotsTxtGeneratorTool,
  'svg-to-png-converter': SvgToPngConverterTool,
  'webp-converter': WebpConverterTool,
  'css-variables-generator': CssVariablesGeneratorTool,
  'css-grid-generator': CssGridGeneratorTool,
  'jsonpath-tester': JsonpathTesterTool,
  'css-flexbox-generator': CssFlexboxGeneratorTool,
  'json-to-json-schema': JsonToJsonSchemaTool,
  'morse-code-translator': MorseCodeTranslatorTool,
  'aes-encrypt-decrypt': AesEncryptDecryptTool,
  'json-to-kotlin': JsonToKotlinTool,
  'json-to-java-pojo': JsonToJavaTool,
  'json-to-go-struct': JsonToGoStructTool,
  'unicode-text-converter': UnicodeTextConverterTool,
  'css-specificity-calculator': CssSpecificityCalculatorTool,
  'openapi-validator': OpenapiValidatorTool,
  'csv-to-markdown': CsvToMarkdownTool,
  'text-to-binary': TextToBinaryTool,
  'nato-phonetic-alphabet': NatoPhoneticAlphabetTool,
  'text-to-ascii-art': TextToAsciiArtTool,
  'ip-subnet-calculator': IpSubnetCalculatorTool,
  'html-to-jsx': HtmlToJsxTool,
  'csv-to-sql': CsvToSqlTool,
  'svg-to-jsx': SvgToJsxTool,
  'htpasswd-generator': HtpasswdGeneratorTool,
  'protobuf-to-json': ProtobufToJsonTool,
  'box-shadow-generator': BoxShadowGeneratorTool,
  'color-shades-generator': ColorShadesGeneratorTool,
  'ulid-generator': UlidGeneratorTool,
  'qr-code-decoder': QrCodeDecoderTool,
  'typescript-to-zod': TypescriptToZodTool,
  'json-to-python-dataclass': JsonToPythonDataclassTool,
  'jwt-generator': JwtGeneratorTool,
  'json-to-mongoose': JsonToMongooseTool,
  'yaml-toml': YamlTomlTool,
  'json-to-csv': JsonToCsvTool,
  'bcrypt-generator': BcryptGeneratorTool,
  'html-to-markdown': HtmlToMarkdownTool,
  'glassmorphism-generator': GlassmorphismGeneratorTool,
  'css-triangle-generator': CssTriangleGeneratorTool,
  'css-gradient-generator': CssGradientGeneratorTool,
  'nano-id-generator': NanoIdGeneratorTool,
  'cookie-parser': CookieParserTool,
  'css-clip-path-generator': CssClipPathGeneratorTool,
  'color-palette-generator': ColorPaletteGeneratorTool,
  'string-escape': StringEscapeTool,
  'json-xml-converter': JsonXmlConverterTool,
  'css-filter-generator': CssFilterGeneratorTool,
  'cron-job-generator': CronJobGeneratorTool,
  'wifi-qr-code-generator': WifiQrCodeGeneratorTool,
  'exif-metadata-viewer': ExifMetadataViewerTool,
};
