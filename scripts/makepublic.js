#!/usr/bin/env node
const co = require('co').wrap
const AWS = require('AWS-SDK')
const s3 = new AWS.S3()
const Bucket = 'io.tradle.dev.deploys'
co(makeDeploymentBucketPublic)().catch(console.error)

function* makeDeploymentBucketPublic () {
  // console.log(yield s3.getBucketAcl({ Bucket }).promise())
  yield makePublic(Bucket)
}

function* makePublic (Bucket) {
  yield s3.putBucketPolicy({
    Bucket,
    Policy: `{
      "Version": "2012-10-17",
      "Statement": [{
        "Sid": "MakeItPublic",
        "Effect": "Allow",
        "Principal": "*",
        "Action": "s3:GetObject",
        "Resource": "arn:aws:s3:::${Bucket}/*"
      }]
    }`
  }).promise()
  // yield s3.putBucketAcl({
  //   Bucket,
  //   ACL: 'public-read'
  // }).promise()
}
