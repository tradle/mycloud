#!/usr/bin/env node

// tslint:disable:no-console

import minimist from "minimist"
import AWS from "aws-sdk"
import { createClientCache } from "@tradle/aws-client-factory"
import { Logger } from "../logger"
import { Env } from "../env"
import { createUtils } from "../s3-utils"

const yml = require("../cli/serverless-yml")
const argv = minimist(process.argv.slice(2), {
  alias: {
    p: "profile",
    b: "bucket"
  }
})

const { profile = yml.provider.profile, bucket } = argv

if (!bucket) {
  throw new Error('expected "bucket"')
}

if (profile) {
  AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile })
}

const env = new Env(process.env)
const logger = new Logger("gen:emptybucket")
const aws = createClientCache()
const s3Utils = createUtils({ logger, env, s3: aws.s3 })
s3Utils.emptyBucket({ bucket }).catch(err => {
  console.error(err.stack)
  process.exitCode = 1
})
