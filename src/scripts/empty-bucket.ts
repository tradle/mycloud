#!/usr/bin/env node

import path = require('path')
import promisify = require('pify')
import minimist = require('minimist')
import AWS = require('aws-sdk')
import { Logger } from '../logger'
import { createAWSWrapper } from '../aws'
import { Env } from '../env'
import { createUtils } from '../s3-utils'

const yml = require('../cli/serverless-yml')
const argv = minimist(process.argv.slice(2), {
  alias: {
    p: 'profile',
    b: 'bucket'
  }
})

const {
  profile=yml.provider.profile,
  bucket
} = argv

if (!bucket) {
  throw new Error('expected "bucket"')
}

if (profile) {
  AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile })
}

const env = new Env(process.env)
const logger = new Logger('gen:emptybucket')
const aws = createAWSWrapper({ logger, env })
const s3Utils = createUtils({ logger, env, s3: aws.s3 })
s3Utils.emptyBucket({ bucket }).catch(err => {
  console.error(err.stack)
  process.exitCode = 1
})
