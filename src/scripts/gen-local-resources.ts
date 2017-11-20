#!/usr/bin/env node

process.env.IS_LOCAL = true
process.env.DEBUG = process.env.DEBUG || 'tradle*'

console.warn(`if you made any changes to serverless-uncompiled.yml
make sure to run: npm run build:yml before running this script
`)

const { force } = require('minimist')(process.argv.slice(2), {
  boolean: ['force']
})

import promisify = require('pify')
import { tradle } from '../'
import { genLocalResources } from '../cli/utils'
import { handler } from '../samplebot/lambda/init'
import { org } from '../../conf/provider'
import Errors = require('../errors')

const rethrow = (err) => {
  if (err) throw err
}

(async () => {
  try {
    await genLocalResources({ tradle })
    await promisify(handler)({
      RequestType: 'Create',
      ResourceProperties: {
        org: {
          // force,
          name: org.name + '-local',
          domain: org.domain + '.local',
          logo: org.logo
        }
      }
    }, {})
  } catch (err) {
    Errors.ignore(err, Errors.Exists)
    console.log('prevented overwrite of existing identity/keys')
  }
})()
.catch(err => {
  console.error(err)
  process.exitCode = 1
})
