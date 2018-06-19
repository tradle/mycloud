import { EventSource } from '../../lambda'
import { createBot } from '../../'
import { customize } from '../customize'
import Errors from '../../errors'
import * as LambdaEvents from '../lambda-events'

const bot = createBot({ ready: false })
const lambda = bot.createLambda({ source: EventSource.SCHEDULE })
const promiseCustomize = customize({
  lambda,
  event: 'myjobname'
  // add in LambdaEvents, e.g.:
  // event: LambdaEvents.DOCUMENT_CHECKER_JOB
})

lambda.use(async (ctx) => {
  // const { myComponent } = promiseCustomize
  // await myComponent.runJob()

  // e.g.
  // const { documentChecker } = promiseCustomize
  // // document checker rate-limits to 1/min
  // await documentChecker.checkPending({ limit: 1 })
})

// to test, run: sls invoke local -f myjobname
// to debug, run: node --inspect ./node_modules/.bin/sls invoke local -f myjobname
// where "myjobname" is the name of your function block in serverless-uncompiled.yml
