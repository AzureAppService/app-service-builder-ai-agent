targetScope = 'resourceGroup'

@description('Unique name for a new source-less Builder App; do not rerun over a configured app.')
param appName string
@description('Existing Azure OpenAI account in this resource group with a separately prepared Responses model deployment.')
param modelAccountName string
@secure()
@minLength(32)
param appApiToken string
@allowed(['westus2'])
param location string = 'westus2'

resource modelAccount 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: modelAccountName
}
resource app 'Microsoft.Web/builderApps@2026-09-01-preview' = {
  name: appName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    versionConfiguration: {
      variables: [
        { name: 'MODEL_SERVICE', value: 'azure-openai' }
        { name: 'AZURE_OPENAI_AUTH_MODE', value: 'managed-identity' }
        { name: 'APP_API_TOKEN', value: appApiToken }
      ]
    }
    scaling: {
      components: [
        { name: 'web', minReplicas: 0, maxReplicas: 1, httpEnabled: true }
      ]
    }
  }
}
var inferenceUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
resource inference 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(modelAccount.id, app.id, inferenceUser)
  scope: modelAccount
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: inferenceUser
  }
}

output appResourceId string = app.id
output principalId string = app.identity.principalId
