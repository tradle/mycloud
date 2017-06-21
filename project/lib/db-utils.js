const debug = require('debug')('tradle:sls:db-utils')
const { marshalItem, unmarshalItem } = require('dynamodb-marshaler')
const { NotFound } = require('./errors')
const aws = require('./aws')
const { co, pick, logify, timestamp, wait, clone } = require('./utils')
const { prettify } = require('./string-utils')
const { DEV } = require('./env')
const Errors = require('./errors')

function getTable (TableName) {
  const tableAPI = {
    toString: () => TableName,
    batchPut: batchPutToTable
  }

  const api = {
    get,
    put,
    update,
    del,
    findOne,
    find,
    scan,
    create: createTable,
    createTable,
    destroy: deleteTable,
    deleteTable,
    query: find,
    queryOne: findOne
  }

  // aliases
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
  const keys = Object.keys(item)
  const toSet = keys.filter(key => item[key] != null)
  const toRemove = keys.filter(key => item[key] == null)

  let UpdateExpression = ''
  if (toSet.length) {
    const ops = toSet.map(key => `#${key} = :${key}`).join(', ')
    UpdateExpression += `SET ${ops} `
  }

  if (toRemove.length) {
    const ops = toRemove.map(key => `#${key}`).join(', ')
    UpdateExpression += `REMOVE ${ops} `
  }

  UpdateExpression = UpdateExpression.trim()
  if (!UpdateExpression.length) {
    throw new Error('nothing was updated!')
  }

  const ExpressionAttributeNames = {}
  const ExpressionAttributeValues = {}
  for (let key in item) {
    ExpressionAttributeNames[`#${key}`] = key
    if (toSet.indexOf(key) !== -1) {
      ExpressionAttributeValues[`:${key}`] = item[key]
    }
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

function createTable (params) {
  return aws.dynamodb.createTable(params).promise()
}

function deleteTable (params) {
  return aws.dynamodb.deleteTable(params).promise()
}

function rawBatchPut (params) {
  return aws.docClient.batchWrite(params).promise()
}

// const create = co(function* (schema) {
//   try {
//     yield dynamodb.createTable(schema).promise()
//   } catch (err) {
//     // already exists
//     if (err.code !== 'ResourceInUseException') {
//       throw err
//     }
//   }
// })

const batchPut = co(function* (params, backoffOptions={}) {
  params = clone(params)

  const {
    backoff=defaultBackoffFunction,
    maxTries=6
  } = backoffOptions

  let tries = 0
  let start = Date.now()
  let time = 0
  let failed
  while (tries < maxTries) {
    let result = yield rawBatchPut(params)
    failed = result.UnprocessedItems
    if (!(failed && Object.keys(failed).length > 0)) return

    params.RequestItems = failed
    yield wait(backoff(tries++))
  }

  const err = new Errors.BatchPutFailed()
  err.failed = failed
  err.attempts = tries
  throw err
})

function jitter (val, percent) {
  // jitter by val * percent
  return val * (1 + 2 * percent * Math.random() - percent)
}

function defaultBackoffFunction (retryCount) {
  const delay = Math.pow(2, retryCount) * 500
  return Math.min(jitter(delay, 0.1), 10000)
}

function getRecordsFromEvent (event, oldAndNew) {
  return event.Records.map(record => {
    const { NewImage, OldImage } = record.dynamodb
    if (oldAndNew) {
      return {
        old: OldImage && unmarshalItem(OldImage),
        new: NewImage && unmarshalItem(NewImage)
      }
    }

    return NewImage && unmarshalItem(NewImage)
  })
  .filter(data => data)
}

module.exports = {
  createTable,
  deleteTable,
  get,
  put,
  update,
  del,
  find,
  findOne,
  batchPut,
  getUpdateParams,
  marshalDBItem: marshalItem,
  unmarshalDBItem: unmarshalItem,
  getTable,
  getRecordsFromEvent
}
