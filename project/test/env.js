console.warn('make sure localstack is running')

process.env.NODE_ENV = 'test'
process.env.IS_LOCAL = true
process.env.SERVERLESS_STAGE = 'test'
process.env.SERVERLESS_SERVICE = 'tradle'

;[
  'Seals',
  'PubKeys',
  'Events',
  'Inbox',
  'Outbox',
  'Presence',
  'Users'
].forEach(table => {
  process.env[`CF_Table_${table}Table`] = `${table}TableTest`
})

;[
  'Objects',
  'Secrets',
  'PublicConf',
].forEach(bucket => {
  process.env[`CF_Bucket_${bucket}Bucket`] = `${bucket}BucketTest`
})

;[
  'bot_onmessage',
  'bot_onsealevent'
].forEach(fn => {
  process.env[`CF_Function_${fn}Function`] = `${fn}FunctionTest`
})
