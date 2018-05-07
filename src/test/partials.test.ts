import test from 'tape'
import sinon from 'sinon'
import engine from '@tradle/engine'
import { TYPE, SIG, AUTHOR } from '@tradle/constants'
import protocol from '@tradle/protocol'
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
      ...protocol.object({
        object: {
          [TYPE]: 'tradle.SimpleMessage',
          [AUTHOR]: 'abcd',
          message: 'hey'
        }
      }),
      [SIG]: 'somesig',
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
