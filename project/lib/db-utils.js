const debug = require('debug')('tradle:sls:db-utils')
const { marshalItem, unmarshalItem } = require('dynamodb-marshaler')
const { NotFound } = require('./errors')
const aws = require('./aws')
const { pick, prettify } = require('./utils')

module.exports = {
  get,
  put,
  update,
  del,
  find,
  findOne,
  getUpdateExpressions,
  marshalDBItem: marshalItem,
  unmarshalDBItem: unmarshalItem,
  getTable
}

function getTable (TableName) {
  const tableAPI = {
    toString: () => TableName
  }

  const api = { get, put, update, del, findOne, find }
  Object.keys(api).forEach(method => {
    tableAPI[method] = params => {
      params.TableName = TableName
      debug(`performing "${method}" on ${TableName}: ${prettify(params)}`)
      return api[method](params)
    }
  })

  return tableAPI
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
  return aws.docClient
    .update(params)
    .promise()
}

function getUpdateExpressions (item) {
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
