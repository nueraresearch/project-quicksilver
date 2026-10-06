// Always-on host on Azure (M5): the equivalent of deploy/render.yaml.
//
// Not deployed. Nothing here runs until someone runs `az deployment group create` with their own
// subscription (docs/platform/azure-deploy.md). It creates, in one resource group:
//   - App Service (Linux, Web App for Containers) running the image built from deploy/Dockerfile.host
//   - Azure Database for PostgreSQL Flexible Server (the managed run store)
//   - Azure Container Registry for the image (pulled with the web app's managed identity, no password)
//   - Key Vault for every secret (app settings are Key Vault references; no secret is in this file)
//   - Azure Files shares for /data (vault file, intent graphs, ledger) and /config (host config JSON)
//   - Log Analytics + Application Insights
//
// Honest limits: the database accepts connections from Azure services over TLS, not from a private
// network. Put the host and database in a VNet with private endpoints before real customer data.

@description('Prefix for resource names. Lowercase letters and digits, 3 to 10 characters.')
@minLength(3)
@maxLength(10)
param namePrefix string = 'nqs'

param location string = resourceGroup().location

@description('The tenant this single-tenant host serves (QUICKSILVER_TENANT_ID).')
param tenantId string = 'nuera'

@description('Image in the registry, built from deploy/Dockerfile.host, as name:tag.')
param imageName string = 'quicksilver-host:latest'

@description('App Service plan SKU. B1 is the smallest that supports Always On and Azure Files mounts.')
param appServiceSku string = 'B1'

@description('PostgreSQL SKU (Burstable). Use a General Purpose SKU for load.')
param postgresSku string = 'Standard_B1ms'

param postgresAdminLogin string = 'quicksilver'

@description('Letters and digits only, so it can sit inside a connection URL without escaping.')
@secure()
@minLength(20)
param postgresAdminPassword string

@description('Plain settings, not secrets.')
param sanityProjectId string = ''
param sanityContextMcpUrl string = ''
param azureOpenAiResourceName string = ''

var unique = uniqueString(resourceGroup().id)
var baseName = '${namePrefix}${unique}'
var acrName = take('${namePrefix}acr${unique}', 50)
var kvName = take('${namePrefix}-kv-${unique}', 24)
var storageName = take('${namePrefix}st${unique}', 24)
var pgName = '${namePrefix}-pg-${unique}'
var planName = '${namePrefix}-plan'
var appName = '${namePrefix}-host-${unique}'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${baseName}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${baseName}-ai'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
  }
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource dataShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: 'qs-data'
  properties: { shareQuota: 5 }
}

resource configShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: 'qs-config'
  properties: { shareQuota: 1 }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 30
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: pgName
  location: location
  sku: { name: postgresSku, tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'quicksilver'
}

// 0.0.0.0 to 0.0.0.0 is Azure's "allow Azure services" rule. See the limits in the header.
resource allowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource databaseUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'database-url'
  properties: {
    value: 'postgres://${postgresAdminLogin}:${postgresAdminPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/quicksilver?sslmode=require'
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  kind: 'linux'
  sku: { name: appServiceSku }
  properties: { reserved: true }
}

// A reference to a secret that has not been added yet stays unresolved and the host will not start:
// add the secrets listed in docs/platform/azure-deploy.md before the first deploy.
var kvRef = '@Microsoft.KeyVault(VaultUri=${vault.properties.vaultUri};SecretName='

resource host 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  kind: 'app,linux,container'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    keyVaultReferenceIdentity: 'SystemAssigned'
    siteConfig: {
      linuxFxVersion: 'DOCKER|${acr.properties.loginServer}/${imageName}'
      acrUseManagedIdentityCreds: true
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      healthCheckPath: '/healthz'
      numberOfWorkers: 1
      appSettings: [
        { name: 'WEBSITES_PORT', value: '8787' }
        { name: 'PORT', value: '8787' }
        { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'false' }
        { name: 'QUICKSILVER_HOST_CONFIG', value: '/config/quicksilver.host.json' }
        { name: 'QUICKSILVER_DATA_DIR', value: '/data' }
        { name: 'QUICKSILVER_TENANT_ID', value: tenantId }
        { name: 'DATABASE_URL', value: '${kvRef}database-url)' }
        { name: 'QUICKSILVER_VAULT_KEY', value: '${kvRef}quicksilver-vault-key)' }
        { name: 'QUICKSILVER_PRINCIPALS', value: '${kvRef}quicksilver-principals)' }
        { name: 'SANITY_CONTEXT_TOKEN', value: '${kvRef}sanity-context-token)' }
        { name: 'SANITY_WRITE_TOKEN', value: '${kvRef}sanity-write-token)' }
        { name: 'AZURE_API_KEY', value: '${kvRef}azure-openai-api-key)' }
        { name: 'NEXT_PUBLIC_SANITY_PROJECT_ID', value: sanityProjectId }
        { name: 'SANITY_CONTEXT_MCP_URL', value: sanityContextMcpUrl }
        { name: 'AZURE_RESOURCE_NAME', value: azureOpenAiResourceName }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
      ]
    }
  }
}

resource mounts 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: host
  name: 'azurestorageaccounts'
  properties: {
    data: {
      type: 'AzureFiles'
      accountName: storage.name
      shareName: dataShare.name
      mountPath: '/data'
      accessKey: storage.listKeys().keys[0].value
    }
    config: {
      type: 'AzureFiles'
      accountName: storage.name
      shareName: configShare.name
      mountPath: '/config'
      accessKey: storage.listKeys().keys[0].value
    }
  }
}

// The web app pulls its image and reads its secrets as itself: no registry password, no vault key in settings.
var acrPullRole = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var kvSecretsUserRole = '4633458b-17de-408a-b874-0445c86b69e6'

resource pullImage 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, host.id, acrPullRole)
  properties: {
    principalId: host.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRole)
  }
}

resource readSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, host.id, kvSecretsUserRole)
  properties: {
    principalId: host.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRole)
  }
}

output hostUrl string = 'https://${host.properties.defaultHostName}'
output healthUrl string = 'https://${host.properties.defaultHostName}/healthz'
output registryLoginServer string = acr.properties.loginServer
output keyVaultName string = vault.name
output configShareName string = configShare.name
