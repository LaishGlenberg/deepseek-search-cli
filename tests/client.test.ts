import { describe, expect, it, vi } from 'vitest';
import { createClient, DeepSeekApiError } from '../src/client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const plainTextFailure = async () => new Response('Bad Gateway', { status: 502 });
const malformedSuccess = async () => new Response('not json', { status: 200 });
const networkFailure = async (): Promise<Response> => {
  throw new TypeError('fetch failed');
};
const timeoutFailure = async (): Promise<Response> => {
  throw new DOMException('The operation timed out.', 'TimeoutError');
};

describe('createClient', () => {
  it('sends an authenticated search request and returns results', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        results: [
          {
            rerank_score: 2.4,
            title: 'Result',
            url: 'https://example.com',
            snippet: 'snippet',
            summary: 'summary',
            content: '',
            site_name: null,
            site_icon: null,
            date: null,
            authority: 3,
          },
        ],
      }),
    );
    const client = createClient({ apiKey: 'secret', fetchImpl });

    const response = await client.search('deepseek', {
      count: 5,
      needContent: true,
      oriQuestion: 'what is new',
      localization: '1.2.3.4',
    });

    expect(response.results).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/v1/tools/search');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      query: 'deepseek',
      count: 5,
      need_content: true,
      ori_question: 'what is new',
      localization: '1.2.3.4',
    });
  });

  it('omits unset optional fields and normalizes the base URL', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ results: [] }));
    const client = createClient({ apiKey: 'secret', baseUrl: 'https://proxy.test/', fetchImpl });

    await client.search('q');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://proxy.test/v1/tools/search');
    expect(JSON.parse(String(init?.body))).toEqual({ query: 'q' });
  });

  it('fetches a page as Markdown', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ title: 'Page', content: '# Heading' }));
    const client = createClient({ apiKey: 'secret', fetchImpl });

    await expect(client.fetchPage('https://example.com')).resolves.toEqual({
      title: 'Page',
      content: '# Heading',
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/v1/tools/fetch');
    expect(JSON.parse(String(init?.body))).toEqual({ url: 'https://example.com' });
  });

  it('maps API error bodies to DeepSeekApiError', async () => {
    for (const status of [400, 401, 402, 403, 404, 429, 500]) {
      const fetchImpl = async () =>
        jsonResponse(
          { error: { message: `failure ${status}`, type: 'invalid_request_error', param: null, code: 'bad' } },
          status,
        );
      const client = createClient({ apiKey: 'secret', fetchImpl });

      const error = await client.search('q').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DeepSeekApiError);
      expect(error).toMatchObject({ status, code: 'bad' });
      expect((error as Error).message).toContain(`DeepSeek API error (${status}): failure ${status}`);
    }
  });

  it('uses a plain-text body when the error is not JSON', async () => {
    const client = createClient({ apiKey: 'secret', fetchImpl: plainTextFailure });

    await expect(client.search('q')).rejects.toThrow('DeepSeek API error (502): Bad Gateway');
  });

  it('rejects malformed success responses', async () => {
    const client = createClient({ apiKey: 'secret', fetchImpl: malformedSuccess });

    await expect(client.search('q')).rejects.toThrow('malformed JSON');
  });

  it('maps network failures to status 0', async () => {
    const client = createClient({ apiKey: 'secret', fetchImpl: networkFailure });

    await expect(client.search('q')).rejects.toMatchObject({
      name: 'DeepSeekApiError',
      status: 0,
    });
  });

  it('maps timeouts to status 0', async () => {
    const client = createClient({ apiKey: 'secret', timeoutMs: 10, fetchImpl: timeoutFailure });

    await expect(client.search('q')).rejects.toThrow('timed out after 10ms');
  });
});
