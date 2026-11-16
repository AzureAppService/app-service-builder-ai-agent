targetScope = 'resourceGroup'

@description('Globally unique name for a NEW Azure OpenAI account; do not modify an existing account.')
param accountName string
@description('Operator-approved model region, independent of the Builder app region.')
param location string
param deploymentName string
param modelName string
param modelVersion string
@description('Explicitly approved deployment SKU with available quota; no automatic fallback.')
param deploymentSku string
@minValue(1)
param capacity int

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: accountName
  location: location
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: accountName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}
resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: account
  name: deploymentName
  sku: { name: deploymentSku, capacity: capacity }
  properties: {
    model: { format: 'OpenAI', name: modelName, version: modelVersion }
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

output accountResourceId string = account.id
output endpoint string = account.properties.endpoint
output deploymentName string = deployment.name
