
process.env.IS_LOCAL = true

const co = require('co').wrap
const shuffle = require('array-shuffle')
const { dynamodb, docClient } = require('./project/lib/aws')
const schema = {
  cursor: require('./project/conf/cursor-table-schema'),
  inbox: require('./project/conf/inbox-table-schema')
}

const { getTable } = require('./project/lib/db-utils')
const memCursor = require('./project/test/cursor-mem')
// const cursor = getTable(schema.cursor.TableName)
const inbox = getTable(schema.inbox.TableName)
// const seqs = [ 5, 9, 7, 4, 6, 0, 3, 8, 1, 2 ]
// [ 8, 2, 5, 9, 7, 1, 4, 0, 3, 6 ]
// [ 9, 0, 2, 3, 5, 6, 7, 8, 4, 1 ]
// [2, 4, 0, 5, 1, 9, 8, 3, 7, 6]
const numMessages = 100
const BATCH_SIZE = 10
const seqs = shuffle(new Array(numMessages).fill(null).map((el, i) => i))
const expected = memCursor(seqs.slice(), BATCH_SIZE)
console.log('seqs', seqs, expected)

const createCursor = require('./project/lib/cursor')
const cursor = createCursor({
  cursorTable: schema.cursor.TableName,
  itemsTable: schema.inbox.TableName,
  queueProp: 'author',
  seqProp: 'seq'
})

cursor.on('change', function (change) {
  console.log(change)
  if (change.seq !== expected[0]) {
    throw new Error(`expected ${expected[0]}, got ${change.seq}`)
  }

  expected.shift()
})

const author = 'bob'
const create = co(function* (schema) {
  try {
    yield dynamodb.createTable(schema).promise()
  } catch (err) {
    if (err.code !== 'ResourceInUseException') {
      throw err
    }
  }
})

const putMessage = co(function* (message) {
  const { author, seq } = message
  yield inbox.put({
    Key: { author, seq},
    Item: message
  })
})

const failSpots = []

const test = co(function* () {
  let failSpot = -1
  let seq
  while (seqs.length) {
    seq = seqs.shift()
    let message = { author, seq }

    // maybeFail()

    yield putMessage(message)

    // maybeFail()

    try {
      yield cursor.setIfInOrder({ author, seq })
    } catch (err) {
      console.log('not incrementing:', err.message)
      continue
    }

    // maybeFail()
    try {
      // update cursor in batches
      while (true) {
        let newSeq = yield cursor.scan({
          author,
          seq,
          batchSize: BATCH_SIZE
        })

        if (newSeq !== seq + BATCH_SIZE) {
          // we're out of stuff ahead of the cursor
          break
        }

        // keep going
        seq = newSeq
      }
    } catch (err) {
      console.log('failed to seek farther', err.message)
    }
  }

  function maybeFail () {
    if (!failSpots[++failSpot]) {
      failSpots[failSpot] = true
      // schedule retry
      seqs.unshift(seq)
      throw new Error(`${failSpot}. failing on purpose!`)
    }
  }
})

const recreateTables = co(function* () {
  try {
    yield [
      getTable(schema.cursor.TableName).destroy(),
      inbox.destroy()
    ]
  } catch (err) {
    console.error(err)
  }

  yield [
    create(schema.inbox),
    create(schema.cursor)
  ]
})

const loop = co(function* () {
  yield recreateTables()

  while (true) {
    try {
      yield test()
      break
    } catch (err) {
      console.log('failed, retrying', err)
    }
  }
})

loop()
