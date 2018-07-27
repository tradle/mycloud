#!/usr/bin/env node

// process.env.IS_LAMBDA_ENVIRONMENT = 'false'

import { loadCredentials, loadRemoteEnv, confirm } from '../cli/utils'

loadCredentials()
loadRemoteEnv()

import { bot } from '../'

const { buckets } = bot

;(async () => {
  const ids = Object.keys(buckets).map(name => buckets[name].id)
  console.warn('will delete the following buckets:')
  ids.forEach(id => console.log(id))
  const ok = await confirm()
  if (!ok) return

  await Promise.all(Object.keys(buckets).map(async (name) => {
    const bucket = buckets[name]
    console.log('emptying and deleting bucket: ' + bucket.id)
    await bucket.destroy()
  }))
})()
.catch(err => {
  console.error(err.stack)
  process.exitCode = 1
})
