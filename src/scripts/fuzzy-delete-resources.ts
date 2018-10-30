#!/usr/bin/env node

import AWS from 'aws-sdk'
import emptyBucket from 'empty-aws-bucket'
import Errors from '../errors'
import { loadCredentials, confirm } from '../cli/utils'

const [stackName, region='us-east-1'] = process.argv.slice(2)

if (!stackName) {
  throw new Error('expected arguments: <stackName> [region]')
}

AWS.config.update({ region })

loadCredentials()

const findMatchingTables = async (stackName: string) => {
  const dynamodb = new AWS.DynamoDB()
  const { TableNames } = await dynamodb.listTables().promise()
  return TableNames.filter(name => name.startsWith(`${stackName}-`))
}

const findMatchingBuckets = async (stackName: string) => {
  const s3 = new AWS.S3()
  const { Buckets } = await s3.listBuckets().promise()
  return Buckets
    .map(b => b.Name)
    .filter(name => name.startsWith(`${stackName}-`))
}

const findMatchingKeys = async (stackName: string) => {
  const kms = new AWS.KMS()
  const { Keys } = await kms.listKeys().promise()
  const policies = await Promise.all(Keys.map(k => kms.getKeyPolicy({ KeyId: k.KeyId, PolicyName: 'default' }).promise()))
  const policyIds = policies.map(p => JSON.parse(p.Policy).Id)
  const matching = policyIds
    .map((id, i) => id.startsWith(stackName) ? Keys[i].KeyId : null)
    .filter(keyId => keyId)

  const keysInfo = await Promise.all(matching.map(KeyId => kms.describeKey({ KeyId }).promise()))
  return keysInfo.filter(({ KeyMetadata }) => !KeyMetadata.DeletionDate).map(({ KeyMetadata }) => KeyMetadata.KeyId)
}

const findMatchingLogGroups = async (stackName: string) => {
  const logs = new AWS.CloudWatchLogs()
  const { logGroups } = await logs.describeLogGroups({ logGroupNamePrefix: `/aws/lambda/${stackName}-` }).promise()
  return logGroups.map(l => l.logGroupName)
}

const findMatching = async (stackName: string) => {
  const [tables, buckets, keys, logGroups] = await Promise.all([
    findMatchingTables(stackName),
    findMatchingBuckets(stackName),
    findMatchingKeys(stackName),
    findMatchingLogGroups(stackName),
  ])

  return { tables, buckets, keys, logGroups }
}

const delMatching = async (stackName: string) => {
  const resources = await findMatching(stackName)
  const size = Object.keys(resources).map(key => resources[key]).reduce((size, arr) => size + arr.length, 0)
  if (!size) {
    console.log('no matches')
    return
  }

  console.log(JSON.stringify(resources, null, 2))
  const ok = await confirm('about to delete the above resources')
  if (!ok) return

  await Promise.all([
    delBuckets(resources.buckets),
    delTables(resources.tables),
    delKeys(resources.keys),
    delLogGroups(resources.logGroups),
  ])
}

const delBuckets = async (buckets: string[]) => {
  const s3 = new AWS.S3()
  await Promise.all(buckets.map(bucket => emptyBucket({ s3, bucket })))
  await Promise.all(buckets.map(Bucket => s3.deleteBucket({ Bucket }).promise()))
}

const delTables = async (tables: string[]) => {
  const dynamodb = new AWS.DynamoDB()
  await Promise.all(tables.map(TableName => dynamodb.deleteTable({ TableName }).promise()))
}

const delKeys = async (keys: string[]) => {
  const kms = new AWS.KMS()
  await Promise.all(keys.map(async KeyId => {
    await kms.scheduleKeyDeletion({ KeyId, PendingWindowInDays: 7 }).promise()
  }))
}

const delLogGroups = async (logGroups: string[]) => {
  const logs = new AWS.CloudWatchLogs()
  await Promise.all(logGroups.map(async logGroupName => {
    await logs.deleteLogGroup({ logGroupName }).promise()
  }))
}

delMatching(stackName).catch(err => {
  console.error(err.stack)
  process.exitCode = 1
})
