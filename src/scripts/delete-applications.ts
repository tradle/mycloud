#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = 'false'

require('source-map-support').install()

import yn from 'yn'
import _ from 'lodash'

const argv = require('minimist')(process.argv.slice(2), {
  alias: {
    f: 'force'
  }
})

const { loadCredentials, clearTypes } = require('../cli/utils')

loadCredentials()

// const toDelete = ['tradle.Application']
import { TYPE } from '@tradle/constants'
import { createRemoteTradle } from '../'
import { customize } from '../in-house-bot/customize'

const tradle = createRemoteTradle()
const bot = require('../bot').createBot({ tradle })
const { db, dbUtils, env } = tradle
const { SERVERLESS_PREFIX } = env
// const { clear } = dbUtils
const readline = require('readline')

const deleteApplications = async () => {
  const { models } = await customize({ bot })
  console.log('finding victims...')
  const { definitions } = bot.dbUtils
  const modelsToDelete = Object.keys(models).filter(id => {
    const model = models[id]
    if (id === 'tradle.Application' ||
        id === 'tradle.AssignRelationshipManager' ||
        id === 'tradle.Verification' ||
        id === 'tradle.FormRequest') {
      return true
    }

    const { subClassOf } = model
    if (subClassOf === 'tradle.Form' ||
        subClassOf === 'tradle.MyProduct') {
      return true
    }
  })

  // const tablesToClear = [
  //   {
  //     name: definitions.UsersTable.Properties.TableName,
  //     filter: user => !user.friend
  //   }
  // ]

  console.log(`1. will delete the following types: ${JSON.stringify(modelsToDelete, null, 2)}`)
  console.log('2. will also clear users table')
  // console.log('2. will also clear the following tables\n', tablesToClear)

  if (!argv.force) {
    const rl = readline.createInterface(process.stdin, process.stdout)
    const answer = await new Promise(resolve => {
      rl.question('continue? y/[n]:', resolve)
    })

    rl.close()
    if (!yn(answer)) {
      console.log('aborted')
      return
    }
  }

  console.log('let the games begin!')
  const deleteCounts = await clearTypes({
    tradle,
    types: Object.keys(models)
  })

  console.log(`deleted items count: ${JSON.stringify(deleteCounts, null, 2)}`)

  const { TableName } = definitions.UsersTable.Properties
  const { KeySchema } = await dbUtils.getTableDefinition(TableName)
  const keyProps = KeySchema.map(({ AttributeName }) => AttributeName)
  await dbUtils.batchProcess({
    batchSize: 20,
    params: {
      TableName
    },
    processOne: async (item) => {
      if (item.friend) {
        await dbUtils.put({
          TableName,
          Item: _.pick(item, keyProps.concat(['friend', 'identity']))
        })
      } else {
        await dbUtils.del({
          TableName,
          Key: _.pick(item, keyProps)
        })
      }
    }
  })

  // const tableName = definitions.UsersTable.Properties.TableName


  // for (const { name, filter } of tablesToClear) {
  //   console.log('clearing', name)
  //   const numDeleted = await clear(name, filter)
  //   console.log(`deleted ${numDeleted} items from ${name}`)
  // }
}

deleteApplications().catch(err => {
  console.error(err)
  process.exitCode = 1
})
