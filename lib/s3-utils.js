const parseUrl = require('url').parse
const debug = require('debug')('tradle:sls:s3-utils')
const { logify } = require('./utils')
const Errors = require('./errors')

module.exports = function createUtils ({ resources, env, aws }) {
  const { DEV } = env

  function put ({ key, value, bucket, contentType }) {
    // debug(`putting ${key} -> ${value} into Bucket ${bucket}`)
    const opts = {
      Bucket: bucket,
      Key: key,
      Body: value
    }

    if (contentType) {
      opts.ContentType = contentType
    }

    return aws.s3.putObject(opts).promise()
  }

  function get ({ key, bucket }) {
    return aws.s3.getObject({
      Bucket: bucket,
      Key: key
    })
    .promise()
    .catch(err => {
      if (err.code === 'NoSuchKey') {
        throw new Errors.NotFound(`${bucket}/${key}`)
      }

      throw err
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

  function del ({ key, bucket }) {
    return aws.s3.deleteObject({
      Bucket: bucket,
      Key: key
    }).promise()
  }

  function getBucket (bucket) {
    debug(`wrapping ${bucket} bucket`)
    const logified = logify({
      get: key => get({ key, bucket }),
      getJSON: key => getJSON({ key, bucket }),
      put: (key, value) => put({ key, value, bucket }),
      putJSON: (key, value) => putJSON({ key, value, bucket }),
      head: key => head({ key, bucket }),
      exists: key => exists({ key, bucket }),
      del: key => del({ key, bucket })
    }, {
      log: debug,
      // logInputOutput: DEV && bucket !== resources.Bucket.Secrets
    })

    logified.name = bucket
    logified.id = bucket
    logified.toString = () => bucket
    return logified
  }

  function createPresignedUrl ({ bucket, key }) {
    return aws.s3.getSignedUrl('getObject', {
      Bucket: bucket,
      Key: key
    })
  }

  return {
    getBucket,
    get,
    getJSON,
    put,
    putJSON,
    head,
    del,
    exists,
    createPresignedUrl
  }
}
