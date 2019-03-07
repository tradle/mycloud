#!/usr/bin/env node

// tslint:disable:no-console

import minimist from "minimist"
import AWS from "aws-sdk"
import { createClientCache } from "@tradle/aws-client-factory"
import { createClient } from "@tradle/aws-s3-client"

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

const aws = createClientCache({ AWS })
const s3Utils = createClient({ client: aws.s3 })
s3Utils.emptyBucket({ bucket }).catch(err => {
  console.error(err.stack)
  process.exitCode = 1
})
