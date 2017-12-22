import { createBot } from '../../../bot'
import { customize } from '../../customize'

const bot = createBot()
const lambda = bot.lambdas.auth()
// const promiseCustomize = customize({ bot })
// lambda.use(async (ctx) => {
//   const { employeeManager } = await promiseCustomize
//   const { userId } = ctx.userId
//   const user = await bot.users.get(userId)
//   if (employeeManager.isEmployee(user)) {

//   }
// })

export const handler = lambda.handler
