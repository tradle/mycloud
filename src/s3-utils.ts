const parseUrl = require('url').parse
const debug = require('debug')('tradle:sls:s3-utils')
const { co, logify, clone } = require('./utils')
const Errors = require('./errors')

module.exports = function createUtils ({ resources, env, aws }) {
  const { DEV } = env

  function put ({ key, value, bucket, contentType }: {
    key:string,
    value:any,
    bucket:string,
    contentType?:string
  }):Promise<AWS.S3.Types.PutObjectOutput> {
    // debug(`putting ${key} -> ${value} into Bucket ${bucket}`)
    const opts:AWS.S3.Types.PutObjectRequest = {
      Bucket: bucket,
      Key: key,
      Body: value
    }

    if (contentType) {
      opts.ContentType = contentType
    }

    return aws.s3.putObject(opts).promise()
  }

  function get ({ key, bucket, opts={} }: {
    key:string,
    bucket:string,
    opts?:any
  }):Promise<AWS.S3.Types.GetObjectOutput> {
    const params:AWS.S3.Types.GetObjectRequest = {
      Bucket: bucket,
      Key: key,
      ...opts
    }

    return aws.s3.getObject(params)
    .promise()
    .catch(err => {
      if (err.code === 'NoSuchKey') {
        throw new Errors.NotFound(`${bucket}/${key}`)
      }

      throw err
    })
  }

  function getCacheable ({ key, bucket, ttl, parse }: {
    key:string,
    bucket:string,
    ttl:number,
    parse?:(any) => any
  }) {
    let cached
    let etag
    let cachedTime
    const maybeGet = co(function* () {
      if (!etag || (Date.now() - cachedTime) >= ttl) {
        const opts = {}
        if (etag) {
          opts.IfNoneMatch = etag
        }

        cached = yield get({ key, bucket, opts })
        if (cached.ETag !== etag) {
          etag = cached.ETag
          if (parse) {
            cached = parse(cached.Body)
          }
        }

        cachedTime = Date.now()
      }

      return cached
    })

    return {
      get: maybeGet
    }
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
    if (typeof bucket !== 'string') {
      throw new Error('expected string bucket name')
    }

    debug(`wrapping ${bucket} bucket`)
    let api = {
      get: key => get({ key, bucket }),
      getJSON: key => getJSON({ key, bucket }),
      put: (key, value) => put({ key, value, bucket }),
      putJSON: (key, value) => putJSON({ key, value, bucket }),
      head: key => head({ key, bucket }),
      exists: key => exists({ key, bucket }),
      del: key => del({ key, bucket }),
      getCacheable: opts => getCacheable({ ...opts, bucket })
    }

    // api = logify(api, {
    //   log: debug,
    //   // logInputOutput: DEV && bucket !== resources.Bucket.Secrets
    // })

    api.name = bucket
    api.id = bucket
    api.toString = () => bucket
    return api
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
