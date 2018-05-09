import Router from 'koa-router'
import { createBot } from '../../../'
import { EventSource } from '../../../lambda'
// import { customize } from '../../customize'

const bot = createBot()
const lambda = bot.lambdas.preauth()
// const promiseCustomize = customize({ lambda, event: 'preauth' })

export const handler = lambda.handler
