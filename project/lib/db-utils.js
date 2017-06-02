const { marshalItem, unmarshalItem } = require('dynamodb-marshaler')
const { NotFound } = require('./errors')
const { db, docClient, s3 } = require('./aws')
const { pick } = require('./utils')

module.exports = {
  get,
  put,
  del,
  update,
  findOne,
  getUpdateExpressions,
  marshalItem,
  unmarshalItem
}

function get (params) {
  return docClient.get(params)
    .promise()
    .then(data => {
      const result = data && data.Item
      if (!result) throw new NotFound(JSON.stringify(pick(params, ['TableName', 'Key'])))
      return result
    })
}

function put (params) {
  return docClient.put(params).promise()
}

function del (params) {
  return docClient.delete(params).promise()
}

function findOne (params) {
  return docClient.query(params)
    .promise()
    .then(data => {
      const result = data && data.Items && data.Items[0]
      if (!result) throw new NotFound(`"${params.TableName}" query returned 0 items`)
      return result
    })
}

function update (params) {
  return docClient
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
