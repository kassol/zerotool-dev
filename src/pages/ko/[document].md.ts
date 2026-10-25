import type { APIRoute } from 'astro';
import { AGENT_DOCUMENTS, buildAgentMarkdown } from '../../data/llms.mjs';
import { llmsSiteData, markdownResponse } from '../../data/llms-input';

export function getStaticPaths() {
  return AGENT_DOCUMENTS.map((document) => ({ params: { document } }));
}

export const GET: APIRoute = ({ params }) =>
  markdownResponse(buildAgentMarkdown(llmsSiteData(), params.document, 'ko'));
