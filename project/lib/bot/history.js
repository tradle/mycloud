const { co, clone, timestamp } = require('../utils')

module.exports = function createHistory ({ messages }) {
  const get = co(function* ({ userId, gt=0, limit /* lt=Infinity */ }) {
    const [inbound, outbound] = yield [
      messages.getMessagesFrom({ author: userId, gt, limit }),
      messages.getMessagesTo({ recipient: userId, gt, limit })
    ]

    return mergeArrays(inbound, outbound, getTime)
  })

  return get
}

function getTime (message) {
  return message.time
}

function mergeArrays (a, b, getIndex) {
  const merged = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    let left = a[i]
    let right = b[j]
    if (getIndex(left) <= getIndex(right)) {
      merged.push(left)
      i++
    } else {
      merged.push(right)
      j++
    }
  }

  return merged
    .concat(a.slice(i))
    .concat(b.slice(j))
}

// console.log(mergeArrays(
//   [
//     {
//       time: 0
//     },
//     {
//       time: 2
//     },
//     {
//       time: 5
//     },
//   ],
//   [
//     {
//       time: 1
//     },
//     {
//       time: 2
//     },
//     {
//       time: 3
//     },
//     {
//       time: 4
//     },
//   ],
//   item => item.time
// ))
