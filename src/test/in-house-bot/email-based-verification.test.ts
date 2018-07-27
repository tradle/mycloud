require('../env').install()

import test from 'tape'
import sinon from 'sinon'
import createProductsStrategy from '@tradle/bot-products'
import { EmailBasedVerifier } from '../../in-house-bot/email-based-verifier'
import { Commander } from '../../in-house-bot/commander'
import { Applications } from '../../in-house-bot/applications'
import { Logger } from '../../logger'
import { createBot } from '../../'
import { KeyValueMem } from '../../key-value-mem'
import { loudAsync } from '../../utils'
import { IConf } from '../../in-house-bot/types'

test('email-based-verification', loudAsync(async (t) => {
  const sandbox = sinon.createSandbox()
  const clock = sandbox.useFakeTimers()
  const bot = createBot()
  const senderEmail = 'someone@somewhere.com'
  const emailAddress = 'unverified@somewhere.com'
  const logger = new Logger('ebv:test')
  const components:any = {
    bot,
    employeeManager: {},
    productsAPI: createProductsStrategy({
      logger,
      bot,
      models: {
        all: bot.models
      },
      products: [],
      nullifyToDeleteProperty: true
    }),
    logger,
    store: new KeyValueMem()
  }

  components.applications = new Applications(components)
  const commands = new Commander(components)

  const ebv = new EmailBasedVerifier({
    bot,
    logger,
    commands,
    // @ts-ignore
    // commands: <Commander>{
    //   defer: sandbox.stub().callsFake(async (command) => {

    //   }),
    //   execDeferred: sandbox.stub().callsFake(async (code) => {

    //   })
    // },
    orgConf: {
      org: {
        name: 'My Org'
      }
    } as IConf,
    senderEmail
  })

  const mailStub = sandbox.stub(bot.mailer, 'send').callsFake(async (email) => {
    t.equal(email.from, senderEmail)
    t.equal(email.to, emailAddress)
  })

  const execStub = sandbox.stub(commands, 'exec').callsFake(async (opts) => {
    t.same(opts, command)
    return {
      result: {},
      // error
    }
  })

  const sendPLStub = sandbox.stub(components.productsAPI, 'sendProductList').callsFake(async ({ to }) => {
    t.equal(to.id, 'bob')
  })


  const command = {
    component: 'productsAPI',
    method: 'sendProductList',
    params: {
      to: {
        id: 'bob'
      }
    }
  }

  const opts = {
    deferredCommand: {
      ttl: 1000,
      command
    },
    confirmationEmail: {
      emailAddress,
      subject: 'Email Verification',
      confirmationText: 'Please confirm by clicking below',
      buttonText: 'Confirm that thing!'
    },
    confirmationPage: {
      title: 'Confirmed!',
      body: 'this is the confirmation body'
    }
  }

  const code = await ebv.confirmAndExec(opts)
  const { success, html } = await ebv.processConfirmationCode(code)

  t.equal(success, true)
  t.equal(execStub.callCount, 1)
  t.equal(mailStub.callCount, 1)

  const dup = await ebv.processConfirmationCode(code)
  t.equal(dup.success, false)

  const code2 = await ebv.confirmAndExec(opts)
  clock.tick(1001 * 1000) // ttl is in seconds

  const expired = await ebv.processConfirmationCode(code2)
  t.equal(expired.success, false)

  // const plugin = createPlugin(components, {
  //   logger,
  //   conf: {
  //     senderEmail: 'someone@somewhere.com'
  //   }
  // })

  // const createCheckStub = sandbox.stub(bot.mailer, 'send').callsFake(async ({ props }) => {
  //   application.checks.push()
  // })

  // const application = {}
  // await plugin['onmessage:tradle.PersonalInfo']({
  //   user: {
  //     id: 'bob'
  //   },
  //   application: {},
  //   payload: {
  //     emailAddress: 'bob@bob.bob'
  //   }
  // })

  clock.restore()
  sandbox.restore()
  t.end()
}))
