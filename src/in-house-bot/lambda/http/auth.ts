import { createBot } from '../../../'

const bot = createBot()
const lambda = bot.lambdas.auth()
// const promiseCustomize = configureLambda({ lambda })
// lambda.use(async (ctx) => {
//   const { employeeManager } = await promiseCustomize
//   const { userId } = ctx.userId
//   const user = await bot.users.get(userId)
//   if (employeeManager.isEmployee(user)) {

//   }
// })

export const handler = lambda.handler
