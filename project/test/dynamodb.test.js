process.env.IS_LOCAL = true
const AWS = require('aws-sdk')
AWS.config.update({
  maxRetries: 0,
  retryDelayOptions: {
    customBackoff: function (retryCount) {
      console.log("RETRY COUNT", retryCount)
      return Math.pow(2, retryCount) * 100
  // returns delay in ms
    }
  }
})

const test = require('tape')
const co = require('../lib/utils').loudCo
const { getTable, batchPut } = require('../lib/db-utils')
const schema = {
  "AttributeDefinitions": [
    {
       "AttributeName": "id",
       "AttributeType": "S"
    }
  ],
  "KeySchema": [
    {
      "AttributeName": "id",
      "KeyType": "HASH"
    }
  ],
  "ProvisionedThroughput": {
    "ReadCapacityUnits": 1,
    "WriteCapacityUnits": 1
  },
  "StreamSpecification": {
    "StreamEnabled": true,
    "StreamViewType": "NEW_AND_OLD_IMAGES"
  },
  "TableName": "TestTable"
}

const aws = require('../lib/aws')

test('batch put', co(function* (t) {
  // const table = yield recreateTable(schema)


  let timesCalled = 0
  const { docClient } = aws
  aws.docClient = {
    batchWrite: function ({ RequestItems }) {
      let promise
      timesCalled++
      for (let TableName in RequestItems) {
        const items = RequestItems[TableName]
        if (items.length > 15) {
          promise = Promise.resolve({
            UnprocessedItems: {
              [TableName]: items.slice(15)
            }
          })
        } else {
          promise = Promise.resolve({})
        }

        break
      }

      return {
        promise: () => promise
      }
    }
  }

  const batch = {
    RequestItems: {
      SomeTable: new Array(25).fill(null).map((ignore, i) => {
        return {
          id: `${i}`
        }
      })
    }
  }

  yield batchPut(batch)
  t.equal(timesCalled, 2)
  aws.docClient = docClient

  // const batches = new Array(25).fill(null).map((blah) => {
  //   return new Array(25).fill(null).map((ignore, i) => {
  //     return {
  //       id: `${i}`
  //     }
  //   })
  // })

  // yield Promise.all(batches.map(batch => table.batchPut(batch)))

  t.end()
}))

// const recreateTable = co(function* (schema) {
//   const table = getTable(schema.TableName)
//   try {
//     yield table.destroy()
//   } catch (err) {}

//   yield table.create(schema)
//   return table
// })
