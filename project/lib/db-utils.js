const debug = require('debug')('tradle:sls:db-utils')
const { marshalItem, unmarshalItem } = require('dynamodb-marshaler')
const { NotFound } = require('./errors')
const aws = require('./aws')
const { co, pick, prettify, logify, timestamp, wait } = require('./utils')
const { DEV } = require('./env')
const Errors = require('./errors')

module.exports = {
  get,
  put,
  update,
  del,
  find,
  findOne,
  getUpdateParams,
  marshalDBItem: marshalItem,
  unmarshalDBItem: unmarshalItem,
  getTable
}

function getTable (TableName) {
  const tableAPI = {
    toString: () => TableName,
    batchPut: batchPutToTable,
    get: Key => get({ TableName, Key }),
    put: Item => put({ TableName, Item })
  }

  const api = { update, del, findOne, find, scan, create, destroy }
  // aliases
  api.query = find
  api.queryOne = findOne

  Object.keys(api).forEach(method => {
    tableAPI[method] = (params={}) => {
      params.TableName = TableName
      debug(`performing "${method}" on ${TableName}: ${prettify(params)}`)
      return api[method](params)
    }
  })

  return logify(tableAPI, { log: debug, logInputOutput: DEV })

  function batchPutToTable (items) {
    return batchPut({
      RequestItems: {
        [TableName]: items.map(Item => {
          return {
            PutRequest: { Item }
          }
        })
      }
    })
  }
}

function get (params) {
  return aws.docClient.get(params)
    .promise()
    .then(data => {
      const result = data && data.Item
      if (!result) throw new NotFound(JSON.stringify(pick(params, ['TableName', 'Key'])))
      // debug(`got item from ${params.TableName}: ${prettify(result)}`)
      return result
    })
}

function put (params) {
  debug(`putting to ${params.TableName}`, prettify(params))
  return aws.docClient.put(params).promise()
}

function del (params) {
  return aws.docClient.delete(params).promise()
}

function find (params) {
  return aws.docClient.query(params).promise()
    .then(data => data.Items)
}

function findOne (params) {
  params.Limit = 1
  return find(params)
    .then(results => {
      if (!results.length) throw new NotFound(`"${params.TableName}" query returned 0 items`)
      return results[0]
    })
}

function update (params) {
  return aws.docClient.update(params).promise()
}

function getUpdateParams (item) {
  const UpdateExpression = 'SET ' + Object.keys(item).map(key => `#${key} = :${key}`).join(', ')
  const ExpressionAttributeNames = {}
  const ExpressionAttributeValues = {}
  for (let key in item) {
    ExpressionAttributeNames[`#${key}`] = key
    ExpressionAttributeValues[`:${key}`] = item[key]
  }

  return {
    ExpressionAttributeNames,
    ExpressionAttributeValues,
    UpdateExpression
  }
}

function scan (params) {
  return aws.docClient.scan(params).promise()
    .then(data => data.Items)
}

function create (params) {
  return aws.dynamodb.createTable(params).promise()
}

function destroy (params) {
  return aws.dynamodb.deleteTable(params).promise()
}

function batchPut (params) {
  return aws.docClient.batchWrite(params).promise()
}

const batchPutWithBackoff = co(function* ({
  params,
  initialDelay=1000,
  maxDelay=10000,
  factor=2,
  maxTries=10,
  maxTime=60000
}) {
  let tries = 0
  let start = Date.now()
  let time = 0
  let delay = initialDelay
  let failed
  while (tries < maxTries && time < maxTries) {
    let result = yield batchPut(params)
    failed = []
    if (!failed.length) return

    tries++
    time = Date.now() - start
    delay = Math.min(maxDelay, delay * factor)
    yield wait(Math.min(delay, maxTime - time))
    time = Date.now() - start
  }

  const err = new Errors.BatchPutFailed()
  err.failed = failed
  throw err
})
