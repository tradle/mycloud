
const { s3 } = require('./aws')

function put ({ key, value, bucket }) {
  return s3.putObject({
    Bucket: bucket,
    Key: key,
    Body: value
  }).promise()
}

function get ({ key, bucket }) {
  return s3.getObject({
    Bucket: bucket,
    Key: key
  }).promise()
}

function putJSON({ key, value, bucket }) {
  value = JSON.stringify(value)
  return put({ key, value, bucket })
}

function getJSON ({ key, bucket }) {
  return get({ key, bucket })
    .then(({ Body }) => JSON.parse(Body))
}


function head ({ key, bucket }) {
  return s3.headObject({
    Bucket: bucket,
    Key: key
  }).promise()
}

function exists ({ key, bucket }) {
  return head({ key, bucket })
    .then(() => true, err => false)
}

function getBucket (bucket) {
  return {
    get: key => get({ key, bucket }),
    getJSON: key => getJSON({ key, bucket }),
    put: (key, value) => put({ key, value, bucket }),
    putJSON: (key, value) => putJSON({ key, value, bucket }),
    head: key => head({ key, bucket }),
    exists: key => exists({ key, bucket })
  }
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
