import { createBot } from '../../'
import { fromCli } from '../lambda'
import { Remediation } from '../remediation'
import * as LambdaEvents from '../lambda-events'

const bot = createBot({ ready: false })
const lambda = fromCli({ bot, event: LambdaEvents.REMEDIATION_COMMAND })

lambda.use(async (ctx, next) => {
  const { remediation } = ctx.components
  const { method, data } = ctx.event
  ctx.body = await run({ method, data, remediation })
})

const run = async ({ method, data, remediation }: {
  method: string
  data: any
  remediation: Remediation
}) => {
  if (method === 'createbundle') {
    return {
      key: await remediation.saveUnsignedDataBundle(data)
    }
  }

  if (method === 'createclaim') {
    return await remediation.createClaim(data)
  }

  if (method === 'listclaims') {
    return await remediation.listClaimsForBundle(data)
  }

  if (method === 'getbundle') {
    return await remediation.getBundle(data)
  }

  if (method === 'clearclaims') {
    return await remediation.deleteClaimsForBundle(data)
  }

  throw new Error(`unknown method "${method}"`)
}

export const handler = lambda.handler
