import _ = require('lodash')
import { TYPE } from '@tradle/constants'
import yn = require('yn')
import parse = require('yargs-parser')
import { ICommand } from '../../types'

const ADDITIONAL_OPTS = ['kmsKeyId']

export const command:ICommand = {
  name: 'encryptbucket',
  description: 'set encryption on an s3 bucket',
  examples: [
    '/encryptbucket --bucket <bucketLogicalId> --enable <true/false> --kmsKeyId'
  ],
  exec: async ({ commander, args }) => {
    let { bucket, enable=true, ...opts } = args
    if (bucket.endsWith('Bucket')) {
      bucket = bucket.slice(0, bucket.length - 6)
    }

    const { buckets } = commander.bot
    const bucketInstance = buckets[bucket] || Object.keys(buckets)
      .map(logicalId => buckets[logicalId])
      .find(instance => instance.name === bucket)

    if (!bucketInstance) throw new Error(`bucket ${bucket} not found`)

    opts = _.pick(opts, ADDITIONAL_OPTS)
    if (enable) {
      await bucketInstance.enableEncryption(opts)
    } else {
      await bucketInstance.disableEncryption(opts)
    }

    return {
      bucket: bucketInstance.name,
      encryption: _.extend({ enabled: enable }, opts)
    }
  },
  sendResult: async ({ commander, req, result, to, args }) => {
    const verb = args.enable === false ? 'disabled' : 'enabled'
    await commander.sendSimpleMessage({
      req,
      to,
      message: `${verb} encryption on bucket ${args.bucket}`
    })
  }
}
