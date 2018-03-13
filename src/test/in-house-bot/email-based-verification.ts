require('../env').install()

import _ from 'lodash'
import test from 'tape'
import sinon from 'sinon'
import createProductsStrategy from '@tradle/bot-products'
import { EmailBasedVerifier } from '../../in-house-bot/email-based-verifier'
import { Commander } from '../../in-house-bot/commander'
import { Applications } from '../../in-house-bot/applications'
import Errors from '../../errors'
import { Logger } from '../../logger'
import { createBot } from '../../bot'
import { KeyValueMem } from '../../key-value-mem'
import { loudAsync } from '../../utils'
import { IConf, IBotComponents } from '../../in-house-bot/types'

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
    orgConf: <IConf>{
      org: {
        name: 'My Org'
      }
    },
    senderEmail
  })

  const mailStub = sandbox.stub(bot.mailer, 'send').callsFake(async (email) => {
    t.equal(email.from, senderEmail)
    t.equal(email.to, emailAddress)
  })

  const execStub = sandbox.stub(commands, 'exec').callsFake(async (opts) => {
    t.same(opts, {
      sudo: true,
      confirmed: true,
      command
    })

    return {
      result: {},
      // error
    }
  })

  const command = 'listproducts'
  const emailOpts = {
    email: {
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

  const code = await ebv.confirmAndExec({ command, ttl: 1000 }, emailOpts)
  const { success, html } = await ebv.processConfirmationCode(code)

  t.equal(success, true)
  t.equal(execStub.callCount, 1)
  t.equal(mailStub.callCount, 1)

  try {
    await ebv.processConfirmationCode(code)
    t.fail('expected error')
  } catch (err) {
    t.ok(/used/.test(err.message))
  }

  const code2 = await ebv.confirmAndExec({ command, ttl: 1000 }, emailOpts)
  clock.tick(1001 * 1000) // ttl is in seconds

  try {
    await ebv.processConfirmationCode(code2)
    t.fail('expected error')
  } catch (err) {
    t.ok(/expired/.test(err.message))
  }

  clock.restore()
  sandbox.restore()
  t.end()
}))
