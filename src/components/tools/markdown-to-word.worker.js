// Builds the .docx for MarkdownToWordTool. The page sends the Markdown text and the
// prepared options (paper, font, title, and prefetched image bytes); this Worker parses,
// builds and zips, then returns the file bytes and the image report.
//
// It also renders the preview HTML, so opening a large document does not parse it on the
// page's main thread.
import * as docxLib from 'docx';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { cjkFriendlyExtension } from 'micromark-extension-cjk-friendly';
import { gfmStrikethroughCjkFriendly } from 'micromark-extension-cjk-friendly-gfm-strikethrough';
import {
  parseMarkdown, buildDocx, renderHtml, firstHeadingText, collectImageUrls, PREVIEW_BLOCKS,
} from './markdown-to-word-engine.js';

const lib = {
  fromMarkdown, gfm, gfmFromMarkdown, cjkFriendlyExtension, gfmStrikethroughCjkFriendly,
  D: docxLib,
};

self.addEventListener('message', async (event) => {
  const { id, kind, md, opts } = event.data || {};
  try {
    if (kind === 'preview') {
      const tree = parseMarkdown(md, lib);
      const blocks = tree && Array.isArray(tree.children) ? tree.children.length : 0;
      const shown = blocks > PREVIEW_BLOCKS ? Object.assign({}, tree, { children: tree.children.slice(0, PREVIEW_BLOCKS) }) : tree;
      self.postMessage({
        id, kind: 'preview', ok: true,
        html: renderHtml(shown),
        blocks,
        heading: firstHeadingText(tree),
        urls: collectImageUrls(tree, true),
      });
      return;
    }
    const tree = parseMarkdown(md, lib);
    const { doc, report } = buildDocx(tree, lib, opts || {});
    const blob = await docxLib.Packer.toBlob(doc);
    const bytes = await blob.arrayBuffer();
    self.postMessage({ id, ok: true, bytes, report }, [bytes]);
  } catch (error) {
    self.postMessage({ id, ok: false, error: String((error && error.message) || error) });
  }
});
