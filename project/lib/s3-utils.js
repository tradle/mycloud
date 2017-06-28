const debug = require('debug')('tradle:sls:s3-utils')
const aws = require('./aws')
const { logify } = require('./utils')
const { DEV } = require('./env')
const Errors = require('./errors')

function put ({ key, value, bucket }) {
  // debug(`putting ${key} -> ${value} into Bucket ${bucket}`)
  return aws.s3.putObject({
    Bucket: bucket,
    Key: key,
    Body: value
  }).promise()
}

function get ({ key, bucket }) {
  return aws.s3.getObject({
    Bucket: bucket,
    Key: key
  })
  .promise()
  .catch(err => {
    if (err.code === 'NoSuchKey') {
      throw new Errors.NotFound()
    }
  })
}

function putJSON ({ key, value, bucket }) {
  value = JSON.stringify(value)
  return put({ key, value, bucket })
}

function getJSON ({ key, bucket }) {
  return get({ key, bucket })
    .then(({ Body }) => JSON.parse(Body))
}


function head ({ key, bucket }) {
  return aws.s3.headObject({
    Bucket: bucket,
    Key: key
  }).promise()
}

function exists ({ key, bucket }) {
  return head({ key, bucket })
    .then(() => true, err => false)
}

function getBucket (bucket) {
  debug(`wrapping ${bucket} bucket`)
  return logify({
    get: key => get({ key, bucket }),
    getJSON: key => getJSON({ key, bucket }),
    put: (key, value) => put({ key, value, bucket }),
    putJSON: (key, value) => putJSON({ key, value, bucket }),
    head: key => head({ key, bucket }),
    exists: key => exists({ key, bucket }),
    toString: () => bucket
  }, { log: debug, logInputOutput: DEV })
}

module.exports = {
  getBucket,
  get,
  getJSON,
  put,
  putJSON,
  head,
  exists
}
