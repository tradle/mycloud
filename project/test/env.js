process.env.NODE_ENV = 'test'
process.env.IS_LOCAL = true

;[
  'Seals',
  'PubKeys',
  'Events',
  'Inbox',
  'Outbox',
  'Presence',
  'Users'
].forEach(table => {
  process.env[`CF_${table}Table`] = `${table}Table`
})

;[
  'Objects',
  'Secrets',
  'PublicConf',
].forEach(bucket => {
  process.env[`CF_${bucket}Bucket`] = `${bucket}Bucket`
})
