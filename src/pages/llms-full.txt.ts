import { buildLlmsFullTxt } from '../data/llms.mjs';
import { englishToolPages, llmsSiteData, textResponse } from '../data/llms-input';

export async function GET() {
  return textResponse(buildLlmsFullTxt(llmsSiteData(), await englishToolPages()));
}
