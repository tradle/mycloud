import { createBot } from '../../bot'
import { fromCli } from '../../bot/lambda'
import { customize } from '../customize'
import { Remediation } from '../remediation'

const bot = createBot({ ready: false })
const lambda = fromCli({ bot })
const promiseComponents = customize({ lambda, event: 'remediation:utils' })

lambda.use(async (ctx, next) => {
  const { remediation } = await promiseComponents
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
