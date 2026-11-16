# Configure the assistant with CLI or ARM

Run from your fork's root. Use a dedicated DEV/TEST group, approved regional model quota/SKU/prices and a small request budget.
Creation templates are for new resources, not updates over an existing configured app.

## Provision model infrastructure when needed

You may use an existing authorized Azure OpenAI account and Responses-compatible deployment from README setup.
For new resources, `infra/model.bicep` creates an OpenAI S0 account with local/key auth disabled and one explicitly selected model/version/SKU/capacity.
It does not promise regional model availability or fallback to a larger SKU.
Set `SUBSCRIPTION`, `RG`, `ACCOUNT`, `MODEL_LOCATION`, `DEPLOYMENT`, `MODEL`, `MODEL_VERSION`, `DEPLOYMENT_SKU` and `CAPACITY` from the reviewed regional quote/quota.

```bash
az deployment group validate --subscription "$SUBSCRIPTION" -g "$RG" \
  --template-file infra/model.bicep --parameters accountName="$ACCOUNT" location="$MODEL_LOCATION" \
    deploymentName="$DEPLOYMENT" modelName="$MODEL" modelVersion="$MODEL_VERSION" \
    deploymentSku="$DEPLOYMENT_SKU" capacity="$CAPACITY"
az deployment group what-if --subscription "$SUBSCRIPTION" -g "$RG" \
  --template-file infra/model.bicep --parameters accountName="$ACCOUNT" location="$MODEL_LOCATION" \
    deploymentName="$DEPLOYMENT" modelName="$MODEL" modelVersion="$MODEL_VERSION" \
    deploymentSku="$DEPLOYMENT_SKU" capacity="$CAPACITY"
```

Stop if validation fails.
Review the proposed resources and regional prices before creation.
The Azure OpenAI resource is not a Foundry project or AI Gateway.

```bash
az deployment group create --subscription "$SUBSCRIPTION" -g "$RG" \
  --name assistant-model --template-file infra/model.bicep \
  --parameters accountName="$ACCOUNT" location="$MODEL_LOCATION" deploymentName="$DEPLOYMENT" \
    modelName="$MODEL" modelVersion="$MODEL_VERSION" deploymentSku="$DEPLOYMENT_SKU" capacity="$CAPACITY"
```

## Provision the app and inference grant

`infra/app.bicep` creates a new source-less SAMI app, 0–1 scaling, managed-identity controls and account-scoped OpenAI User.
The existing model account must be in this group. Set a unique new `APP`.
Generate the separate app token through your approved secret manager; never pass it as a command-line argument.
Create the private workspace before preparing parameters:

```bash
umask 077
mkdir -p .local
```

Prepare ignored private `.local/app-parameters.json` with `appName`, `modelAccountName` and secure `appApiToken` parameter entries, using mode 600.
It has the normal ARM parameter shape `{"appName":{"value":"<app>"},"modelAccountName":{"value":"<account>"},"appApiToken":{"value":"<secret-from-manager>"}}`.
Do not commit, display or capture this file.

```bash
az deployment group create --subscription "$SUBSCRIPTION" -g "$RG" \
  --name assistant-app --template-file infra/app.bicep --parameters @.local/app-parameters.json
az rest --method get --url "https://management.azure.com/subscriptions/$SUBSCRIPTION/resourceGroups/$RG/providers/Microsoft.Web/builderApps/$APP?api-version=2026-09-01-preview" \
  --query '{identity:identity,identityUpdate:properties.identityUpdate}'
```

Wait for committed identity/no pending operation (`builder app status`) and inference-role propagation.
With ARM-only tooling, GET the app ARM URL below and inspect `identity` and `properties.identityUpdate` instead.
Copy root `connection.json` into ignored `.local/connection.json`, replacing account ID, endpoint and exact deployment name.
Use `cp connection.json .local/connection.json`; keep app parameters and token files private in that ignored directory.
Keep MI; no Azure key, access token or `AZURE_CLIENT_ID` belongs in this object.

## Add with native Builder CLI

Requires a release listing `app connections` in help; older archives use ARM below.

```bash
builder login
builder app connections list --name "$APP" -s "$SUBSCRIPTION" -g "$RG" --json
builder app connections add --name "$APP" -s "$SUBSCRIPTION" -g "$RG" --connection-json '@.local/connection.json'
builder app connections status --name "$APP" -s "$SUBSCRIPTION" -g "$RG" --connection-name model
```

The role is already granted; selecting identity alone never grants it again.
`update --connection-json` replaces the complete object; `remove --connection-name model` changes pending configuration only.
API key is an explicit alternate mode requiring local auth, a protected declaration and `AZURE_OPENAI_AUTH_MODE=api-key`; it is not this default.
CLI accepts no credential value; use its Portal handoff for that alternative.

## Add with ARM instead

Use Bash/`jq`; private `.local/` metadata must remain out of Git and screenshots.

```bash
APP_ARM="https://management.azure.com/subscriptions/$SUBSCRIPTION/resourceGroups/$RG/providers/Microsoft.Web/builderApps/$APP"
APP_URL="$APP_ARM?api-version=2026-09-01-preview"
az rest --method get --url "$APP_URL" > .local/app.json
ETAG="$(jq -er .etag .local/app.json)"
jq --slurpfile next .local/connection.json '
  {properties:{versionConfiguration:{connections:
    ((.properties.versionConfiguration.connections // [] |
      map(select((.name|ascii_downcase) != ($next[0].name|ascii_downcase)))) + $next)}}}
' .local/app.json > .local/update.json
az rest --method patch --url "$APP_URL" --headers "If-Match=$ETAG" --body @.local/update.json
az rest --method get --url "$APP_URL" --query properties.versionConfiguration.connections
```

The PATCH preserves app-token/manual controls, source, scaling and unrelated connections without secret readback.
On 412 refresh/reconcile; never remove the guard. When migrating, remove old manual endpoint/deployment/key without deploying before saving the MI connection.

## Deploy and verify a real response

Use connected GitHub source, or `git archive --format=zip --output=../assistant-source.zip HEAD` followed by `builder app deploy --name "$APP" -s "$SUBSCRIPTION" -g "$RG" --source-archive ../assistant-source.zip --manifest ./builder.yaml --json`.
Wait for terminal success. Use README's stdin bearer-header example for one harmless prompt and require a real nonempty reply plus wrong-token denial.
The root notebook, health/setup checks and architecture node do not prove model access.
