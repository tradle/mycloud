import * as LambdaEvents from '../lambda-events'
import { fromSchedule } from '../lambda'

const lambda = fromSchedule({ event: LambdaEvents.DOCUMENT_CHECKER_JOB })

lambda.use(async (ctx) => {
  // const { myComponent } = promiseCustomize
  // await myComponent.runJob()

  // e.g.
  const { documentChecker } = ctx.components
  if (!documentChecker) {
    this.logger.debug('document checker not set up')
    return
  }

  // // document checker rate-limits to 1/min
  await documentChecker.checkPending({ limit: 1 })
})

export const handler = lambda.handler
// to test, run: sls invoke local -f myjobname
// to debug, run: node --inspect ./node_modules/.bin/sls invoke local -f myjobname
// where "myjobname" is the name of your function block in serverless-uncompiled.yml
