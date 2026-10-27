import { describe, expect, it } from 'vitest';
import { createClient, DeepSeekApiError } from '../../src/client.js';
import { startMockServer } from './mock-server.js';

describe('client against a local HTTP server', () => {
  it('performs a real HTTP search round trip', async () => {
    const server = await startMockServer();

    try {
      const client = createClient({ apiKey: 'integration-key', baseUrl: server.url });
      const response = await client.search('integration query', { count: 2, needContent: true });

      expect(response.results).toHaveLength(1);
      expect(response.results[0]).toMatchObject({
        title: 'Result for integration query',
        url: 'https://example.com/result',
        content: 'Full content from the mock server.',
      });

      expect(server.requests).toHaveLength(1);
      const request = server.requests[0]!;
      expect(request.method).toBe('POST');
      expect(request.path).toBe('/v1/tools/search');
      expect(request.headers.authorization).toBe('Bearer integration-key');
      expect(request.headers['content-type']).toBe('application/json');
      expect(request.body).toEqual({ query: 'integration query', count: 2, need_content: true });
    } finally {
      await server.close();
    }
  });

  it('performs a real HTTP fetch round trip', async () => {
    const server = await startMockServer();

    try {
      const client = createClient({ apiKey: 'integration-key', baseUrl: server.url });
      const page = await client.fetchPage('https://example.com/article');

      expect(page).toEqual({ title: 'Mock page', content: '# Mock page\n\nFetched content.' });
      expect(server.requests[0]).toMatchObject({
        path: '/v1/tools/fetch',
        body: { url: 'https://example.com/article' },
      });
    } finally {
      await server.close();
    }
  });

  it('surfaces HTTP error statuses from the server', async () => {
    const server = await startMockServer(() => ({
      status: 402,
      body: { error: { message: 'Insufficient Balance', code: 'insufficient_balance' } },
    }));

    try {
      const client = createClient({ apiKey: 'integration-key', baseUrl: server.url });
      const error = await client.search('q').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DeepSeekApiError);
      expect(error).toMatchObject({
        status: 402,
        code: 'insufficient_balance',
        message: 'DeepSeek API error (402): Insufficient Balance',
      });
    } finally {
      await server.close();
    }
  });
});
