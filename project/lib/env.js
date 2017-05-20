const {
  CF_ObjectsBucket,
  CF_SecretsBucket,
  CF_EventsTable,
  CF_InboxTable,
  CF_OutboxTable,
  CF_PubKeysTable,
  NETWORK_NAME='testnet',
  // SERVERLESS_STAGE,
  // SERVERLESS_SERVICE_NAME,
  SERVERLESS_PREFIX
} = process.env

module.exports = {
  ObjectsBucket: CF_ObjectsBucket,
  SecretsBucket: CF_SecretsBucket,
  EventsTable: CF_EventsTable,
  InboxTable: CF_InboxTable,
  OutboxTable: CF_OutboxTable,
  PubKeysTable: CF_PubKeysTable,
  networkName: NETWORK_NAME,
  // serverlessStage: SERVERLESS_STAGE,
  // serverlessService: SERVERLESS_SERVICE_NAME,
  serverlessPrefix: SERVERLESS_PREFIX
}
