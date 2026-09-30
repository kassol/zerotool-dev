import { buildLlmsTxt } from '../../data/llms.mjs';
import { llmsSiteData, textResponse } from '../../data/llms-input';

export function GET() {
  return textResponse(buildLlmsTxt(llmsSiteData(), 'ko'));
}
