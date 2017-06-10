const clone = require('xtend')
const {
  CF_ObjectsBucket,
  CF_SecretsBucket,
  CF_EventsTable,
  CF_InboxTable,
  CF_OutboxTable,
  CF_MessagesTable,
  CF_PubKeysTable,
  CF_PresenceTable,
  CF_IotClientRole,
  NETWORK_NAME='testnet',
  SERVERLESS_SERVICE_NAME,
  SERVERLESS_STAGE,
  SERVERLESS_PREFIX,
  PUSH_SERVER_URL
} = process.env

module.exports = clone(require('../../env'), {
  OBJECTS_BUCKET: CF_ObjectsBucket,
  SECRETS_BUCKET: CF_SecretsBucket,
  EVENTS_TABLE: CF_EventsTable,
  MESSAGES_TABLE: CF_MessagesTable,
  INBOX_TABLE: CF_InboxTable,
  OUTBOX_TABLE: CF_OutboxTable,
  PUBKEYS_TABLE: CF_PubKeysTable,
  PRESENCE_TABLE: CF_PresenceTable,
  IOT_CLIENT_ROLE: CF_IotClientRole,
  NETWORK_NAME,
  SERVERLESS_STAGE,
  SERVERLESS_SERVICE_NAME,
  SERVERLESS_PREFIX,
  DEV: SERVERLESS_STAGE === 'dev',
  PUSH_SERVER_URL
})
