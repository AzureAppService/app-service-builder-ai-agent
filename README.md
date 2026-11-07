# AI assistant HTTP API on App Service Builder

A standalone Node.js sample that hosts a bounded, single-turn AI assistant HTTP API on App Service Builder. Each authenticated `POST /agent` makes one text-generation request to a separately configured OpenAI or Azure OpenAI Responses API.

## Preview

![AI assistant static showcase with a request example, setup links, and single-turn API boundaries](https://github.com/user-attachments/assets/41606df5-4329-4355-ba21-903e2861f8f1)

The screenshot shows the static showcase served directly at `/`, not a live chat.

**App Service Builder is in Private Preview.** This sample is for development and testing, not production, and has not been live-qualified against a preview deployment. You need approved preview access and a supported target supplied by your preview onboarding; no region or model availability is guaranteed. Start with the [Host an AI agent guide](https://builder.appservice.azure.com/docs/guides/host-ai-agent/).

Builder hosts this ordinary Node.js web application. It does **not** provision or host the model, provide Builder-managed agent orchestration, or run an autonomous agent loop. There are no tools, side effects, conversation history, retries, or fabricated model-success responses.

## Features

- Dependency-free Node.js HTTP server and a repository-root `builder.yaml`.
- Public liveness and HTML home page; authenticated, bounded assistant requests.
- Explicit OpenAI or Azure OpenAI configuration with sanitized failures and response limits.
- Local HTTP tests with mocked providers: no model account, credentials, or paid model calls required.
- A responsive, static home page at `/` with a request example and setup links. It never collects credentials, calls a model, or displays fabricated replies.

## Getting Started

### Prerequisites

- **Node.js 24.x and npm**, matching `package.json` and the Builder platform version. `curl` is used below.
- An isolated local development environment: the server binds `0.0.0.0:8080`, not just loopback.
- For deployment, approved App Service Builder Private Preview access, an authorized Azure subscription/target, and a GitHub repository you own or are authorized to deploy.
- For a real assistant response, a **separately owned and authorized** OpenAI API account or Azure OpenAI resource with a Responses-compatible model/deployment. It must support text input and `max_output_tokens`; verify current model and regional support with the provider.

**Costs:** local mocked tests do not call a model. Deployment can incur Azure hosting charges, and real assistant requests incur separate model-service charges. Obtain approval, review the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/) or [OpenAI API pricing](https://openai.com/api/pricing/), and configure provider budgets/quotas before sending real requests. The sample's concurrency and token limits are not a cost budget.

### Installation

Clone this repository (or your fork) and work from its root; no parent repository, source subdirectory, or download ZIP is needed:

```sh
git clone https://github.com/AzureAppService/app-service-builder-ai-agent.git
cd app-service-builder-ai-agent
npm ci --ignore-scripts
npm test
```

`npm ci --ignore-scripts` restores the committed lockfile. There are no third-party runtime dependencies. `npm test` uses Node's test runner, local HTTP requests, and mocked provider success/error/timeout responses; it does not use provider credentials from your environment.

### Quickstart

Generate a disposable **synthetic app token**, not a provider key or an existing account credential. It must be at least 32 characters. Start without model configuration so these first checks cannot call a paid service:

```sh
export APP_API_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
env -u MODEL_SERVICE -u OPENAI_API_KEY -u OPENAI_MODEL \
  -u AZURE_OPENAI_ENDPOINT -u AZURE_OPENAI_API_KEY -u AZURE_OPENAI_DEPLOYMENT \
  -u PUBLIC_ORIGIN npm start
```

Keep that terminal open. In another terminal, health and the HTML home page work without credentials:

```sh
curl --fail-with-body http://127.0.0.1:8080/health
# OK
curl --fail-with-body http://127.0.0.1:8080/
# HTML showcase
```

For the visual template showcase, open `http://127.0.0.1:8080/` in a browser. This is a static introduction, not a chat client or configuration-status check. It follows the device's light/dark preference; use `/?scoutTheme=light` for a consistent light thumbnail or `/?scoutTheme=dark` for dark. All styling and scripts are in the local `index.html`, with no external assets or runtime dependencies. The home page is served directly without a redirect; the API and health routes are unchanged.

An unauthenticated request returns `401` with `{"error":"unauthorized"}`:

```sh
curl -i http://127.0.0.1:8080/agent \
  -H "Content-Type: application/json" \
  --data '{"message":"Explain HTTP in one sentence."}'
```

Set the **same disposable app token** in the client terminal through your approved local secret-handling mechanism; do not generate a different token or paste real credentials into commands/history. With no model configured, an authenticated request returns `503` with `{"error":"model_not_configured"}`, not a fake answer:

```sh
curl -i http://127.0.0.1:8080/agent \
  -H "Authorization: Bearer ${APP_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"message":"Explain HTTP in one sentence."}'
```

Stop with Ctrl+C. SIGINT/SIGTERM closes the server. If the server's `APP_API_TOKEN` is absent or shorter than 32 characters, `POST /agent` instead returns `503` with `{"error":"app_auth_not_configured"}`. `/health` is liveness only: `200 OK` does not prove authentication, provider configuration, or model access.

## Opt-in real provider request

Only perform this step after authorizing the service, charges, and prompt data handling. Inject the required provider key into the **server process environment** using your approved secret manager; the sample does not automatically load `.env` files. Never put a provider key in a browser, client request body, URL, Git repository, build output, or shell history.

Keep `APP_API_TOKEN` configured and choose exactly one provider:

| Provider | Required server variables | Endpoint and API contract |
|---|---|---|
| OpenAI | `MODEL_SERVICE=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL=<your-authorized-model-id>` | Fixed `https://api.openai.com/v1/responses`; server-side bearer API key; explicit model ID with no default. |
| Azure OpenAI | `MODEL_SERVICE=azure-openai`, `AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT=<your-deployment-name>` | `${AZURE_OPENAI_ENDPOINT}/openai/v1/responses`; server-side `api-key` header; `model` is the deployment name, not its underlying model family. Uses the v1 API, with no dated `api-version` query or API-version environment variable. |

The Azure endpoint must be an HTTPS Azure OpenAI resource origin: no credentials, non-default port, path, query, or fragment. The sample does not support arbitrary gateways, other endpoint domains, or managed-identity authentication; this API-key development example is not a production identity design.

After securely configuring the environment, restart the server with `npm start` (not the earlier command that deliberately removes provider configuration). Repeat the authenticated `/agent` request above, now using `curl --fail-with-body` rather than `curl -i`. A successful response is:

```json
{"reply":"<model-produced-text>"}
```

The answer is nondeterministic, not the literal placeholder or a promised sentence. Verify a `200` status and nonempty `reply`. A provider refusal, incomplete or unusable response is a failure, not success. Do not include secrets or sensitive data in prompts; evaluate model safety and output suitability yourself. `store:false` is an API option, not a guarantee about all provider retention policies.

## HTTP contract and limits

| Setting or route | Behavior |
|---|---|
| `APP_API_TOKEN` | Required for `POST /agent`; at least 32 characters; exact bearer comparison. Separate from the provider key. |
| `PUBLIC_ORIGIN` | Optional exact HTTPS origin, without trailing slash, accepted when a caller supplies `Origin`. Local origins `http://localhost:8080` and `http://127.0.0.1:8080` are also accepted. No browser CORS access is granted. |
| `GET /health` | Public `200` with `OK`; liveness only, no provider call. |
| `GET /` | Public `200` HTML showcase, served directly without a redirect; no credentials, provider requests, or simulated assistant output. Query strings leave the HTML response unchanged. |
| `POST /agent` | JSON containing only `{"message":"..."}`; nonblank string up to 2000 UTF-16 code units; body capped at 8192 bytes. |
| Provider request | One call per accepted turn; 512 output tokens, `store:false`, `stream:false`, `tools:[]`. No retries or conversation store. |
| Response | Completed assistant text only; up to 4000 UTF-16 code units; upstream body capped at 65,536 bytes. |
| Capacity | Four simultaneous calls per process; ten-second model deadline. |

Missing app/model configuration returns `503`; absent/wrong app credentials return `401`; untrusted supplied `Origin` returns `403`. Invalid or oversized input returns `400`, unsupported content type `415`, excess concurrency `429`, upstream/incomplete/refused/unusable responses `502`, and model timeout `504`. Unknown routes return `404`; non-POST requests to `/agent` return `405`.

Provider errors are sanitized. Provider keys, app tokens, prompts, and upstream error bodies are not logged. Exact-secret output is rejected, but this is not a general data-loss-prevention system. Host and forwarding headers are not used to authorize requests. Shared bearer authentication is a development example, not per-user authorization, a distributed rate limiter, or production abuse protection. Before adding tools, validate caller scopes, roles, and resource ownership server-side; prompts and model decisions never authorize side effects.

## Deploy with App Service Builder

Follow the [Host an AI agent guide](https://builder.appservice.azure.com/docs/guides/host-ai-agent/) with your approved Private Preview onboarding. If the Portal or documentation endpoint is unavailable or presents a certificate warning, stop and contact your preview support channel; do not bypass the warning. This repository does not provide a public CLI installer or guarantee a supported region.

1. **Fork** this repository into your own GitHub account or organization. Use a repository you are authorized to deploy, and ensure the sample files are committed on its `main` branch.
2. In the Builder Portal, authorize GitHub access only to the repository you need. Create an app and select **your own repository**, branch **`main`**, and the **repository root** as the source. `builder.yaml` declares a Node.js 24 web component, startup command `node server.mjs`, and `/health` probe. It uses Builder's single-component defaults for the repository-root mount, port `8080`, and an exact health-check success status of `200`.
3. Securely configure Portal **Variables**: a new dedicated `APP_API_TOKEN` plus exactly one provider's required variables from the table above. Do not reuse the local test token. `PUBLIC_ORIGIN` is optional for callers that supply `Origin`; ordinary server-side clients do not need it.
4. Use **Save and deploy** to capture the variables in a new deployment. **Save only** persists desired values but does not deploy them. Variables are shared with build and runtime: keep build scripts free of environment dumps, credential logging, and secret-containing public assets. The provider key stays server-side; only the app token belongs in the authorized HTTP client.
5. Wait for deployment success and use the application's returned HTTPS origin. Verify `/health` is `200` with `OK`, unauthenticated `/agent` is `401`, and an authenticated real-provider request is `200` with nonempty `reply`. Health success alone is insufficient. Qualify routing, external-service egress, model compatibility, and authorization on your actual preview target.

Use the local HTTP commands with `https://<your-returned-app-origin>` replacing `http://127.0.0.1:8080`; there is no additional path prefix. If platform bearer access is enabled, send its separate credential in `X-Embr-Authorization` and retain the sample app credential in `Authorization`; qualify forwarding on the actual target. Browser sign-in is not a machine-client credential.

**Updates:** commit and push changes to your own repository's `main`, then **explicitly redeploy** the app in the Portal. Do not assume a Git push automatically deploys. Wait for success and repeat the health, authorization, and real-response checks. Variable changes also require a new deployment to take effect.

## Cleanup

Stop the local server with Ctrl+C and clear local configuration:

```sh
unset APP_API_TOKEN MODEL_SERVICE OPENAI_API_KEY OPENAI_MODEL \
  AZURE_OPENAI_ENDPOINT AZURE_OPENAI_API_KEY AZURE_OPENAI_DEPLOYMENT PUBLIC_ORIGIN
```

In the Portal, delete **only the sample app** when finished and verify deletion. App cleanup does **not** delete your separately owned Azure OpenAI resource, model deployment, OpenAI account, repository, or other external services; those can continue to incur charges. Manage those resources separately under their owner's authorization, and revoke dedicated provider keys and app tokens when no longer needed. Do not delete a shared resource group as sample cleanup.

## Resources

- [Host an AI agent on App Service Builder](https://builder.appservice.azure.com/docs/guides/host-ai-agent/) (Private Preview).
- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create) and [text generation](https://developers.openai.com/api/docs/guides/text).
- [Azure OpenAI Responses API](https://learn.microsoft.com/azure/foundry/openai/how-to/responses) and [v1 REST contract](https://learn.microsoft.com/rest/api/microsoft-foundry/azureopenai/responses).
- [Microsoft Open Source Code of Conduct](.github/CODE_OF_CONDUCT.md).
- [Contributing](CONTRIBUTING.md), including the Contributor License Agreement.
- [MIT license](LICENSE.md).
- Report security vulnerabilities privately through the [Microsoft Security Response Center](https://msrc.microsoft.com/report), not in a public issue.
