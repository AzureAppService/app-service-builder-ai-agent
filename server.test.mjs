import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createApp } from './server.mjs';
import { request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('README documentation links use the canonical docs host', () => {
  const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');
  assert.match(readme, /https:\/\/builder\.appservice\.azure\.com\/docs\//);
  assert.doesNotMatch(readme, /https:\/\/builderapps\.azure\.com\/docs(?:\/|\b)/);
});

test('public liveness control checks only health and recovers after errors', async () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>\s*const button[\s\S]*?<\/script>/)[0]
    .replace(/<\/?script>/g, '');
  let click;
  let response;
  const button = { disabled: false, addEventListener: (_, listener) => { click = listener; } };
  const status = { textContent: '' };
  runInNewContext(script, {
    document: { querySelector: selector => selector === '[data-health-check]' ? button : status },
    AbortSignal,
    fetch: async (path, options) => {
      assert.equal(path, '/health');
      assert.equal(options.cache, 'no-store');
      assert.equal(button.disabled, true);
      assert.equal(status.textContent, 'Checking server liveness...');
      if (response instanceof Error) throw response;
      return response;
    },
  });
  for (const failed of [
    new Response('Unavailable', { status: 503 }),
    new Response('Not a health response'),
    new Error('Connection failed'),
  ]) {
    response = failed;
    await click();
    assert.match(status.textContent, /^Health check failed:.*Retry the check\.$/);
    assert.equal(button.disabled, false);
    response = new Response('OK\n');
    await click();
    assert.match(status.textContent, /^Healthy:.*Does not verify authentication, model configuration or AI responses\.$/);
    assert.equal(button.disabled, false);
  }
});

const env = {
  APP_API_TOKEN: 'local-test-token-'.repeat(3), OPENAI_API_KEY: 'provider-test-secret',
  MODEL_SERVICE: 'openai', OPENAI_MODEL: 'owner-selected-model',
};
const completed = (text = 'A short answer') => new Response(JSON.stringify({
  status: 'completed',
  output: [{ type: 'reasoning' }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
}));
async function fixture(t, options = {}) {
  const app = createApp({ env, fetchImpl: async () => completed(), ...options });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise((resolve) => { app.close(resolve); app.closeAllConnections(); }));
  return (path, options = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(`http://127.0.0.1:${app.address().port}${path}`, {
      ...options,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), {
        status: res.statusCode, headers: res.headers,
      })));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}
const post = (message = 'Explain HTTP') => ({
  method: 'POST',
  headers: { Authorization: `Bearer ${env.APP_API_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ message }),
});

test('root serves the actual public HTML without provider calls and preserves API boundaries', async (t) => {
  const request = await fixture(t, { env: {}, fetchImpl: () => { throw new Error('must not call'); } });
  for (const path of ['/', '/?scoutTheme=light', '/?scoutTheme=dark&check=1']) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(response.headers.get('content-security-policy'), /form-action 'none'/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('location'), null);
    const html = await response.text();
    assert.equal(html, readFileSync(new URL('./index.html', import.meta.url), 'utf8'));
    assert.match(html, /<html lang="en">/);
    assert.match(html, /not a live chat/);
    assert.match(html, /No generated reply is shown/);
    assert(!html.includes('<form'));
    assert.match(html, /fetch\('\/health',/);
    assert.match(html, /data-health-path="\/health"/);
    assert.match(html, /id="health-status" role="status"/);
    assert.doesNotMatch(html, /fetch\(['"]\/agent/);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
    assert(!html.includes(env.OPENAI_API_KEY));
    assert(!html.includes(env.APP_API_TOKEN));
    assert.doesNotMatch(html, /\/demo|sample identifier|<script[^>]+src=/);
  }
  assert.equal(await (await request('/health')).text(), 'OK\n');
  assert.equal((await request('/agent', { method: 'POST' })).status, 503);
  for (const path of ['/demo', '/demo/', '/demo/index.php', '/demo?scoutTheme=light',
    '/demo/missing', '/demo.html', '/index.html', '/missing', '/health?check=1', '/agent?check=1']) {
    assert.equal((await request(path)).status, 404, path);
  }
  for (const method of ['POST', 'HEAD', 'DELETE']) {
    assert.equal((await request('/', { method })).status, 404, method);
    assert.equal((await request('/demo', { method })).status, 404, method);
  }
  assert.equal((await request('/', { headers: { Origin: 'https://evil.example' } })).status, 403);
});

test('one authenticated turn calls the real API contract with bounded, tool-free output', async (t) => {
  let calls = 0;
  const request = await fixture(t, { fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, `Bearer ${env.OPENAI_API_KEY}`);
    const body = JSON.parse(options.body);
    assert.equal(body.model, env.OPENAI_MODEL);
    assert.equal(body.input, 'Explain HTTP');
    assert.equal(body.max_output_tokens, 512);
    assert.equal(body.store, false);
    assert.equal(body.stream, false);
    assert.deepEqual(body.tools, []);
    assert(!options.body.includes(env.OPENAI_API_KEY));
    return completed();
  } });
  const response = await request('/agent', post());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: 'A short answer' });
  assert.equal(calls, 1);
  assert.equal(await (await request('/health')).text(), 'OK\n');
});

test('rejects unauthorized, cross-origin, oversized and invalid requests before external calls', async (t) => {
  const request = await fixture(t, { fetchImpl: () => { throw new Error('must not call'); } });
  assert.equal((await request('/agent', { method: 'POST' })).status, 401);
  assert.equal((await request('/agent', { ...post(), headers: { ...post().headers, Origin: 'https://evil.example' } })).status, 403);
  for (const Origin of ['', 'null', 'http://localhost:8080, https://evil.example']) {
    assert.equal((await request('/agent', { ...post(), headers: { ...post().headers, Origin } })).status, 403);
  }
  for (const message of ['', 'x'.repeat(2001)]) {
    assert.equal((await request('/agent', post(message))).status, 400);
  }
  assert.equal((await request('/agent', { ...post(), body: '{"message":"ok","tools":[]}' })).status, 400);
  assert.equal((await request('/agent', { ...post(), body: '{' })).status, 400);
  assert.equal((await request('/agent', { ...post(), body: 'x'.repeat(8193) })).status, 400);
  assert.equal((await request('/missing')).status, 404);
  assert.equal((await request('/agent')).status, 405);
});

test('Azure OpenAI uses the configured resource and deployment with the bounded Responses contract', async (t) => {
  const azureEnv = {
    APP_API_TOKEN: env.APP_API_TOKEN, MODEL_SERVICE: 'azure-openai',
    AZURE_OPENAI_ENDPOINT: 'https://sample-resource.openai.azure.com/',
    AZURE_OPENAI_API_KEY: 'azure-provider-test-secret', AZURE_OPENAI_DEPLOYMENT: 'sample-deployment',
  };
  let calls = 0;
  const request = await fixture(t, { env: azureEnv, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://sample-resource.openai.azure.com/openai/v1/responses');
    assert.equal(options.headers['api-key'], azureEnv.AZURE_OPENAI_API_KEY);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.model, azureEnv.AZURE_OPENAI_DEPLOYMENT);
    assert.equal(body.input, 'Explain HTTP');
    assert.equal(body.max_output_tokens, 512);
    assert.equal(body.store, false);
    assert.equal(body.stream, false);
    assert.deepEqual(body.tools, []);
    assert(!options.body.includes(azureEnv.AZURE_OPENAI_API_KEY));
    return completed();
  } });
  const response = await request('/agent', post());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: 'A short answer' });
  assert.equal(calls, 1);
});

test('Azure configuration fails closed and rejects untrusted endpoints and leaked credentials', async (t) => {
  const azureEnv = {
    APP_API_TOKEN: env.APP_API_TOKEN, MODEL_SERVICE: 'azure-openai',
    AZURE_OPENAI_ENDPOINT: 'https://sample-resource.openai.azure.com',
    AZURE_OPENAI_API_KEY: 'azure-provider-test-secret', AZURE_OPENAI_DEPLOYMENT: 'sample-deployment',
  };
  for (const setting of ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_DEPLOYMENT']) {
    const request = await fixture(t, { env: { ...azureEnv, [setting]: '' },
      fetchImpl: () => { throw new Error('must not call'); } });
    assert.equal((await request('/agent', post())).status, 503);
  }
  for (const endpoint of [
    'http://sample-resource.openai.azure.com', 'https://evil.example',
    'https://sample-resource.openai.azure.com.evil.example',
    'https://sample-resource.openai.azure.com:8443',
    'https://user:password@sample-resource.openai.azure.com',
    'https://sample-resource.openai.azure.com/openai/v1',
    'https://sample-resource.openai.azure.com?redirect=evil', 'https://sample-resource.openai.azure.com#fragment',
  ]) {
    const request = await fixture(t, { env: { ...azureEnv, AZURE_OPENAI_ENDPOINT: endpoint },
      fetchImpl: () => { throw new Error('must not call'); } });
    assert.equal((await request('/health')).status, 200);
    assert.equal((await request('/agent', post())).status, 503);
    assert.equal((await request('/ready')).status, 503);
    assert.equal((await (await request('/api/setup')).json()).code, 'model_configuration_invalid');
  }
  const request = await fixture(t, { env: azureEnv, fetchImpl: async () => completed(azureEnv.AZURE_OPENAI_API_KEY) });
  const response = await request('/agent', post());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'model_response_failed' });
});

test('setup separates liveness/configuration from actual model success and sanitized failures', async (t) => {
  let calls = 0;
  let provider = completed();
  const request = await fixture(t, { fetchImpl: async () => { calls++; return provider; } });
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/ready')).status, 503);
  assert.equal((await (await request('/api/setup')).json()).code, 'not_checked');
  const document = await (await request('/README.md')).text();
  assert.match(document, /id="setup"/);
  assert.match(document, /already deployed/);
  assert.equal(calls, 0);
  assert.equal((await request('/agent', post())).status, 200);
  assert.equal((await request('/ready')).status, 200);
  for (const [http, code] of [[404, 'model_missing'], [401, 'model_access_denied'], [403, 'model_access_denied'],
    [429, 'provider_limit'], [500, 'provider_unavailable']]) {
    provider = new Response('private-canary provider diagnostics', { status: http });
    assert.equal((await request('/agent', post())).status, 502);
    const readiness = await request('/ready');
    assert.equal(readiness.status, 503);
    const state = await readiness.json();
    assert.equal(state.code, code);
    assert.equal(state.setupUrl, './README.md#setup');
    assert.doesNotMatch(JSON.stringify(state), /private-canary|provider-test-secret|owner-selected-model/);
  }
  assert.equal(calls, 6, 'Setup/readiness reads never call the provider');
});

test('missing config returns unavailable, not fabricated success, and health does not call provider', async (t) => {
  const request = await fixture(t, { env: { APP_API_TOKEN: env.APP_API_TOKEN } });
  assert.equal((await request('/agent', post())).status, 503);
  assert.equal((await request('/health')).status, 200);
  assert.equal(await (await request('/health', { headers: { Host: 'candidate.runtime.example' } })).text(), 'OK\n');
  assert.equal((await request('/health', { headers: { Host: 'candidate.runtime.example', Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/', { headers: { Host: 'candidate.runtime.example' } })).status, 200);
  assert.equal((await request('/health', { method: 'POST', headers: { Host: 'candidate.runtime.example' } })).status, 404);
  const noAuth = await fixture(t, { env: {} });
  assert.equal((await noAuth('/agent', post())).status, 503);
  assert.equal((await noAuth('/health')).status, 200);
  assert.throws(() => createApp({ env: { PUBLIC_ORIGIN: 'https://sample.example/path' } }), /HTTPS/);
});

test('provider errors, incomplete/empty/oversized/secret output produce sanitized failures', async (t) => {
  for (const response of [
    new Response(env.OPENAI_API_KEY, { status: 401 }),
    new Response(JSON.stringify({ status: 'incomplete', output: [] })),
    completed(''), completed(123), completed('x'.repeat(4001)), completed(env.OPENAI_API_KEY), completed(env.APP_API_TOKEN),
    new Response('x'.repeat(65_537)),
  ]) {
    const request = await fixture(t, { fetchImpl: async () => response });
    const result = await request('/agent', post());
    assert.equal(result.status, 502);
    assert.deepEqual(await result.json(), { error: 'model_response_failed' });
  }
});

test('provider timeout aborts and reports a gateway timeout', async (t) => {
  const request = await fixture(t, { timeoutMs: 20, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  assert.equal((await request('/agent', post())).status, 504);
});

test('limits in-flight model calls and recovers capacity after completion', async (t) => {
  const waiting = [];
  const request = await fixture(t, { fetchImpl: () => new Promise((resolve) => waiting.push(resolve)) });
  const pending = Array.from({ length: 4 }, () => request('/agent', post()));
  for (let attempts = 0; waiting.length < 4 && attempts < 100; attempts++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(waiting.length, 4);
  assert.equal((await request('/agent', post())).status, 429);
  waiting.splice(0).forEach((resolve) => resolve(completed()));
  assert((await Promise.all(pending)).every((response) => response.status === 200));
  const resumed = request('/agent', post());
  for (let attempts = 0; waiting.length < 1 && attempts < 100; attempts++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(waiting.length, 1);
  waiting[0](completed());
  assert.equal((await resumed).status, 200);
});

test('ordinary hosted HTTP requires no public-host forwarding and preserves authentication and Origin validation', async (t) => {
  let calls = 0;
  const request = await fixture(t, { env: { ...env, PUBLIC_ORIGIN: 'https://sample.example' },
    fetchImpl: async () => { calls++; return completed(); } });
  const hosted = { ...post().headers, Host: 'runtime.example' };
  const response = await request('/agent', { ...post(), headers: hosted });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: 'A short answer' });
  assert.equal(calls, 1);
  assert.equal((await request('/agent', { ...post(), headers: { ...hosted, Authorization: 'Bearer wrong' } })).status, 401);
  for (const forwardedHost of ['evil.example', 'sample.example, evil.example', '']) {
    assert.equal((await request('/agent', { method: 'POST',
      headers: { Host: 'runtime.example', 'X-Forwarded-Host': forwardedHost } })).status, 401);
  }
  assert.equal((await request('/agent', { ...post(),
    headers: { ...hosted, Origin: 'https://evil.example', 'X-Forwarded-Host': 'sample.example' } })).status, 403);
  assert.equal(calls, 1);
  assert.equal((await request('/agent', { ...post(), headers: { ...hosted, Origin: 'https://sample.example' } })).status, 200);
  assert.equal(calls, 2);
});
