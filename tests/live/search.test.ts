import { describe, expect, it } from 'vitest';
import { createClient } from '../../src/client.js';
import { loadConfig } from '../../src/config.js';

/**
 * Live tests hit the real DeepSeek Search API and are billed per request
 * (~$0.00075 each). They only run when RUN_LIVE_TESTS=1.
 *
 *   RUN_LIVE_TESTS=1 npm run test:live
 */
const live = process.env.RUN_LIVE_TESTS === '1' ? describe : describe.skip;

live('live DeepSeek Search API', () => {
  it(
    'returns web results for a real query',
    async () => {
      const config = loadConfig();
      const client = createClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });

      // A single request with count=1 keeps cost at one billable search.
      const response = await client.search('DeepSeek API documentation', {
        count: 1,
        oriQuestion: 'Where is the DeepSeek API documentation?',
      });

      expect(Array.isArray(response.results)).toBe(true);
      for (const result of response.results) {
        expect(result.url).toMatch(/^https?:\/\//);
        expect(typeof result.title).toBe('string');
        expect(typeof result.rerank_score).toBe('number');
      }
    },
    60_000,
  );
});
