// Tool page v2 layout. Slugs listed here get the compact header, a layout
// chosen by tool type, the full-height first screen, and the reference content folded
// into one <details>. Every other tool page keeps the shared layout unchanged.
// To move a tool over, follow DESIGN.md "Tool Pages v2".
//
//   convert  — input and output side by side, both as tall as the screen allows
//   generate — the generated preview leads; controls sit in a narrow rail
//   analyze  — the result (overview, request list, details) uses the full width
export type ToolPageKind = 'convert' | 'generate' | 'analyze';

export const toolPageKinds: Record<string, ToolPageKind> = {
  'json-formatter': 'convert',
  'text-to-binary': 'convert',
  'hmac-generator': 'convert',
  'markdown-table-generator': 'convert',
  'svg-optimizer': 'convert',
  'protobuf-to-json': 'convert',
  'string-escape': 'convert',
  'jq-playground': 'convert',
  'color-palette-generator': 'generate',
  'har-file-analyzer': 'analyze',
};

export function toolPageKind(slug: string): ToolPageKind | undefined {
  return toolPageKinds[slug];
}
