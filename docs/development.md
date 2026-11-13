# Local checks and HTTP contracts

From this repository root, use Node.js 24. No third-party runtime dependencies are required. Local tests replace only the fetch boundary and never use live provider credentials.

```bash
npm test
env -u MODEL_SERVICE -u OPENAI_API_KEY -u OPENAI_MODEL \
  -u AZURE_OPENAI_ENDPOINT -u AZURE_OPENAI_API_KEY -u AZURE_OPENAI_DEPLOYMENT \
  -u APP_API_TOKEN -u PUBLIC_ORIGIN npm start
```

Open `http://127.0.0.1:8080/`; the server binds all interfaces, so use an isolated development environment. Missing configuration leaves the guide and `/health` available; `/agent` and `/ready` return 503. Stop with Ctrl+C.

The current language-family design uses a daylight palette. The notebook is illustrative and never generates a reply. Inline logos retain their local source/provenance in `assets/`; keep the supplied Builder SVG and inline copy synchronized.

## Alternate provider: OpenAI

The [recommended deployed-app setup](../README.md#setup) uses a dedicated Azure OpenAI resource. If you already own an authorized OpenAI API project, choose `MODEL_SERVICE=openai`, `OPENAI_API_KEY` and `OPENAI_MODEL` instead. Create a dedicated project API key with only the Responses write permission where the provider supports restricted keys; the exact authorized model ID has no default. Review project budgets and [OpenAI key permissions](https://help.openai.com/en/articles/8867743-assign-api-key-permissions). Never use your account password.

Inject provider keys and a separate random `APP_API_TOKEN` into the server environment through your secret manager. The sample does not load `.env` files. Restart locally; in Builder save settings **and deploy a new version**. Never use a provider key in the API caller or browser.

| Contract | Behavior |
|---|---|
| OpenAI destination | Fixed `https://api.openai.com/v1/responses`, server-side bearer API key |
| Azure destination | Resource origin plus `/openai/v1/responses`; `api-key` header, deployment name in `model`; no dated `api-version` query |
| `PUBLIC_ORIGIN` | Optional exact HTTPS origin for supplied `Origin`; local localhost/127.0.0.1:8080 also allowed; no browser CORS grant |
| App auth | Exact bearer comparison, token at least 32 characters; independent from provider and platform auth |
| Input | JSON containing only a nonblank `message`, at most 2000 UTF-16 code units and 8192 body bytes |
| Output | Completed assistant text only, at most 4000 UTF-16 code units and 65,536 upstream bytes |
| Provider request | One call, 512 output tokens, `store:false`, `stream:false`, `tools:[]` |
| Capacity | Four concurrent calls per process, ten-second deadline; no automatic retries/history/tools |

Missing configuration is 503; wrong/missing caller auth 401; untrusted Origin 403; invalid JSON 400; unsupported content type 415; concurrency limit 429; failed/incomplete/refused/unusable output 502; timeout 504. Unknown routes are 404 and non-POST `/agent` is 405.

Public `/api/setup` exposes only allowlisted categories and the last completion time, expiring after five minutes. It does not reveal endpoint/model names, prompt text or secrets. Invalid Azure endpoints fail closed while the setup guide remains available. `/health` is liveness, never provider readiness.

Platform bearer access, if enabled, requires its separate credential in `X-Embr-Authorization`, retaining the sample token in `Authorization`; qualify forwarding on the target. Do not treat browser sign-in as a machine token. The approved target authentication child is `/authConfigs/default`. The inspected local Builder CLI 0.0.2 bundle still contains `/authConfigs/current`; do not copy that stale route or use its auth writes without a corrected contract. This journey changes neither platform auth nor its policy.

Shared bearer auth is a development example, not production per-user authorization or distributed abuse protection. Never send private prompt data. Exact-secret output is rejected, but this is not general data-loss prevention.
