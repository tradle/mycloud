import { fromSchedule } from '../lambda'

// add in LambdaEvents, e.g.:
// event: LambdaEvents.DOCUMENT_CHECKER_JOB
const lambda = fromSchedule({ event: 'myjobname' })

lambda.use(async (ctx) => {
  // const { myComponent } = ctx.components
  // await myComponent.runJob()

  // e.g.
  // const { documentChecker } = ctx.components
  // // document checker rate-limits to 1/min
  // await documentChecker.checkPending({ limit: 1 })
})

// to test, run: sls invoke local -f myjobname
// to debug, run: node --inspect ./node_modules/.bin/sls invoke local -f myjobname
// where "myjobname" is the name of your function block in serverless-uncompiled.yml
