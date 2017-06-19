const test = require('tape')
const utf8length = require('utf8-length')
const { batchBySize, MAX_PAYLOAD_SIZE, getMessageStub } = require('../lib/delivery')
const messageObject = require('./fixtures/alice/receive.json')

test('batch by size', function (t) {
  const sampleJSON = {
    blah: 1,
    url: 'http://blah.com/blah?blah=blah#blah=blah%$^*)_@#*('
  }

  const s = JSON.stringify(sampleJSON)
  const length = utf8length(s)
  const MAX = length
  const oneThird = Math.floor(length / 3)
  const twoFifths = Math.floor(2 * length / 5)
  const threeFifths = Math.floor(3 * length / 5)
  const leftOver = length - twoFifths - threeFifths
  const expected = [
    // 0
    [
      s,
    ],
    // 1
    [
      s.slice(0, oneThird),
      s.slice(0, oneThird),
      s.slice(0, oneThird),
    ],
    // // 2
    [
      s.slice(0, twoFifths),
      s.slice(0, twoFifths),
    ],
    // 3
    [
      s.slice(0, twoFifths),
      s.slice(0, threeFifths),
      'a'.repeat(leftOver)
    ],
    [
      'a'
    ]
  ]

  const input = expected.reduce((arr, next) => arr.concat(next), [])

  t.same(batchBySize(input, MAX), expected)
  t.end()
})

test('getMessageStub', function (t) {
  const message = {
    object: messageObject
  }

  t.same(getMessageStub, {

  })
})
