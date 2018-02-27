import test = require('tape')
import sinon = require('sinon')
import engine = require('@tradle/engine')
import { TYPE, SIG } from '@tradle/constants'
import { createPlugin } from '../in-house-bot/plugins/partials'
import { loudAsync } from '../utils'

test('partials', async t => {
  const sandbox = sinon.createSandbox()
  const productsAPI = {
    send: sandbox.stub()
  }

  const { onmessage } = createPlugin({
    bot: {},
    productsAPI,
    conf: {
      getRecipients: ({ message, payload }) => {
        return ['abc']
      },
      filterValues: ({ object, property }) => {
        return property === 'message'
      }
    }
  })

  await onmessage({
    req: {},
    message: {
      context: 'somecontext'
    },
    payload: {
      [SIG]: 'somesig',
      [TYPE]: 'tradle.SimpleMessage',
      message: 'hey'
    }
  })

  t.equal(productsAPI.send.callCount, 1)
  const { object, to } = productsAPI.send.getCall(0).args[0]
  t.equal(to, 'abc')
  t.ok(engine.partial.verify(object))
  const props = engine.partial.interpretLeaves(object.leaves)
  t.same(props, [{ key: 'message', value: 'hey' }])
  t.end()
})
