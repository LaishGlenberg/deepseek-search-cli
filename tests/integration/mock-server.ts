import { createServer } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export interface MockResponse {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

export type MockHandler = (request: RecordedRequest) => MockResponse | Promise<MockResponse>;

export interface MockServer {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

function sampleResult(query: unknown) {
  return {
    rerank_score: 2.4,
    title: `Result for ${String(query ?? '')}`,
    url: 'https://example.com/result',
    snippet: 'Snippet from the mock server.',
    summary: 'Summary from the mock server.',
    content: 'Full content from the mock server.',
    site_name: 'Mock News',
    site_icon: null,
    date: '2026-06-01T00:00:00+00:00',
    authority: 3,
  };
}

function defaultHandler(request: RecordedRequest): MockResponse {
  if (request.path === '/v1/tools/search') {
    const query = (request.body as { query?: unknown } | undefined)?.query;
    return { body: { results: [sampleResult(query)] } };
  }
  if (request.path === '/v1/tools/fetch') {
    return { body: { title: 'Mock page', content: '# Mock page\n\nFetched content.' } };
  }
  return {
    status: 404,
    body: { error: { message: `No mock route for ${request.path}`, code: 'not_found' } },
  };
}

/** Start a local HTTP server that mimics the DeepSeek Search and Fetch endpoints. */
export async function startMockServer(handler: MockHandler = defaultHandler): Promise<MockServer> {
  const requests: RecordedRequest[] = [];

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);

    const raw = Buffer.concat(chunks).toString('utf8');
    const request: RecordedRequest = {
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      headers: req.headers,
      body: raw ? JSON.parse(raw) : undefined,
    };
    requests.push(request);

    try {
      const result = await handler(request);
      res.writeHead(result.status ?? 200, {
        'Content-Type': 'application/json',
        ...result.headers,
      });
      res.end(JSON.stringify(result.body));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
