import Router from 'koa-router'
import { createBot } from '../../../'
import { EventSource } from '../../../lambda'
// import { configureLambda } from '../..'

const bot = createBot()
const lambda = bot.lambdas.preauth()
// const promiseCustomize = configureLambda({ lambda, event: 'preauth' })

export const handler = lambda.handler
