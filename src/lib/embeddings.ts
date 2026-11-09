import { GoogleGenerativeAI } from '@google/generative-ai';

export const EMBEDDING_MODEL_NAME = 'gemini-embedding-2';

/**
 * Returns a configured GoogleGenerativeAI instance.
 */
export function getGenAIClient(apiKey?: string): GoogleGenerativeAI {
  const key = apiKey || process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error('GEMINI_API_KEY is not configured in .env.local.');
  }
  return new GoogleGenerativeAI(key);
}

/**
 * Returns the Gemini embedding model configured with gemini-embedding-2.
 * Used for both documents (ingestion) and questions (retrieval).
 */
export function getEmbeddingModel(genAI: GoogleGenerativeAI) {
  return genAI.getGenerativeModel({
    model: EMBEDDING_MODEL_NAME
  });
}

/**
 * Embeds a single query string for question answering.
 */
export async function embedQuery(query: string, apiKey?: string): Promise<number[]> {
  const genAI = getGenAIClient(apiKey);
  const model = getEmbeddingModel(genAI);
  const res = await model.embedContent({
    content: { role: 'user', parts: [{ text: query }] }
  });
  return res.embedding.values;
}
