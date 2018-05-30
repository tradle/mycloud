#!/usr/bin/env node

import { loadRemoteEnv, loadCredentials } from '../cli/utils'

loadCredentials()
loadRemoteEnv()

import { createBot } from '../bot'
import { fromCli } from '../lambda'
import { customize } from '../in-house-bot/customize'
import { createConf } from '../in-house-bot/configure'
import yml from '../cli/serverless-yml'

const bot = createBot({ ready: false })
const lambda = fromCli({ bot })

;(async () => {
  await customize({ lambda, event: 'remote:patch' })

  // add self
  const identity = await bot.identity.getPublic()
  bot.identities.addContactWithoutValidating(identity)
})();
