require('./env').install()

import sinon from 'sinon'
import AWS from 'aws-sdk'
AWS.config.update({
  maxRetries: 0,
  retryDelayOptions: {
    customBackoff (retryCount) {
      if (retryCount > 3) {
        console.log("AWS SERVICE RETRY COUNT", retryCount)
        console.warn(`are you sure localstack is up? To start it, run: npm run localstack:start`)
      }

      return Math.pow(2, retryCount) * 100
      // returns delay in ms
    }
  }
})

import test from 'tape'
import { createTestBot } from '../'
import { loudAsync } from '../utils'

const {
  aws,
  dbUtils: { getTable, batchPut }
} = createTestBot()

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

test('batch put', loudAsync(async (t) => {
  // const table = await recreateTable(schema)
  const sandbox = sinon.createSandbox()
  const { docClient } = aws
  const stub = sandbox.stub(aws.docClient, 'batchWrite').callsFake(({ RequestItems }) => {
    let promise
    let items
    for (let TableName in RequestItems) {
      items = RequestItems[TableName]
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
  })

  const batch = {
    RequestItems: {
      SomeTable: new Array(25).fill(null).map((ignore, i) => {
        return {
          id: `${i}`
        }
      })
    }
  }

  await batchPut(batch)
  t.equal(stub.callCount, 2)
  stub.restore()

  // const batches = new Array(25).fill(null).map((blah) => {
  //   return new Array(25).fill(null).map((ignore, i) => {
  //     return {
  //       id: `${i}`
  //     }
  //   })
  // })

  // await Promise.all(batches.map(batch => table.batchPut(batch)))

  sandbox.restore()
  t.end()
}))

// const recreateTable = loudAsync(async (schema) => {
//   const table = getTable(schema.TableName)
//   try {
//     await table.destroy()
//   } catch (err) {}

//   await table.create(schema)
//   return table
// })
