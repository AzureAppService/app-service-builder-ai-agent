import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const MAX_BODY = 8192;
const MAX_OUTPUT = 4000;
const home = readFileSync(new URL('./index.html', import.meta.url));

/** Bound bytes before parsing, including chunked requests without Content-Length. */
async function readBounded(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      stream.resume();
      throw new Error('body_limit');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const matches = (actual, expected) => {
  const left = Buffer.from(actual ?? '');
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * A single-turn, tool-free assistant. Provider destinations are fixed or
 * restricted to Azure OpenAI resource origins, never caller-controlled URLs.
 * Tests substitute only the fetch boundary; runtime has no mock-success mode.
 */
export function createApp({ env = process.env, fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const token = env.APP_API_TOKEN ?? '';
  const azure = env.MODEL_SERVICE === 'azure-openai';
  const key = (azure ? env.AZURE_OPENAI_API_KEY : env.OPENAI_API_KEY) ?? '';
  const model = (azure ? env.AZURE_OPENAI_DEPLOYMENT : env.OPENAI_MODEL) ?? '';
  let modelUrl = azure ? null : 'https://api.openai.com/v1/responses';
  if (azure && env.AZURE_OPENAI_ENDPOINT) {
    const endpoint = new URL(env.AZURE_OPENAI_ENDPOINT);
    if (endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password
      || endpoint.pathname !== '/' || endpoint.search || endpoint.hash
      || !/^[a-z0-9][a-z0-9-]*\.openai\.azure\.com$/.test(endpoint.hostname)) {
      throw new Error('AZURE_OPENAI_ENDPOINT must be an HTTPS Azure OpenAI resource origin');
    }
    modelUrl = `${endpoint.origin}/openai/v1/responses`;
  }
  const origin = env.PUBLIC_ORIGIN ? new URL(env.PUBLIC_ORIGIN) : null;
  if (origin && (origin.protocol !== 'https:' || origin.origin !== env.PUBLIC_ORIGIN)) {
    throw new Error('PUBLIC_ORIGIN must be an exact HTTPS origin');
  }
  const origins = new Set(['http://localhost:8080', 'http://127.0.0.1:8080', ...(origin ? [origin.origin] : [])]);
  let active = 0;
  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const server = createServer(async (req, res) => {
    if (req.headers.origin !== undefined && !origins.has(req.headers.origin)) {
      return send(res, 403, { error: 'untrusted_origin' });
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('OK\n');
    }
    if (req.method === 'GET' && req.url.split('?')[0] === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
      return res.end(home);
    }
    if (req.url !== '/agent') return send(res, 404, { error: 'not_found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    if (token.length < 32) return send(res, 503, { error: 'app_auth_not_configured' });
    if (!matches(req.headers.authorization, `Bearer ${token}`)) {
      return send(res, 401, { error: 'unauthorized' });
    }
    if (!['openai', 'azure-openai'].includes(env.MODEL_SERVICE) || !modelUrl || !key.trim() || !model.trim()) {
      return send(res, 503, { error: 'model_not_configured' });
    }
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
      return send(res, 415, { error: 'expected_json' });
    }
    if (active >= 4) return send(res, 429, { error: 'busy' });
    active++;
    const controller = new AbortController();
    let timer;
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnected);
    try {
      let input;
      try {
        input = JSON.parse(await readBounded(req, MAX_BODY));
      } catch {
        return send(res, 400, { error: 'invalid_or_oversized_json' });
      }
      if (!input || Object.keys(input).length !== 1 || typeof input.message !== 'string'
        || !input.message.trim() || input.message.length > 2000) {
        return send(res, 400, { error: 'message_must_be_1_to_2000_characters' });
      }
      timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetchImpl(modelUrl, {
        method: 'POST',
        headers: { ...(azure ? { 'api-key': key } : { Authorization: `Bearer ${key}` }), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, input: input.message,
          instructions: 'You are a concise development assistant. Answer in plain text. Do not request secrets.',
          max_output_tokens: 512, store: false, stream: false, tools: [],
        }),
        signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) throw new Error('upstream_failed');
      // Node Readable.fromWeb permits the same byte cap for the provider response.
      const { Readable } = await import('node:stream');
      const result = JSON.parse(await readBounded(Readable.fromWeb(response.body), 65_536));
      if (result.status !== 'completed' || !Array.isArray(result.output)) throw new Error('incomplete');
      const parts = result.output.filter((item) => item.type === 'message' && item.role === 'assistant')
        .flatMap((item) => item.content ?? []).filter((item) => item.type === 'output_text');
      if (parts.some((item) => typeof item.text !== 'string')) throw new Error('invalid_output');
      const text = parts.map((item) => item.text).join('\n');
      if (!text.trim() || text.length > MAX_OUTPUT || text.includes(key) || text.includes(token)) {
        throw new Error('invalid_output');
      }
      send(res, 200, { reply: text });
    } catch {
      if (!res.destroyed) send(res, controller.signal.aborted ? 504 : 502, {
        error: controller.signal.aborted ? 'request_timeout' : 'model_response_failed',
      });
    } finally {
      clearTimeout(timer);
      res.off('close', disconnected);
      active--;
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createApp();
  server.listen(8080, '0.0.0.0');
  process.once('SIGTERM', () => server.close());
  process.once('SIGINT', () => server.close());
}
