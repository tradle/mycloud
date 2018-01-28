import { createBot } from '../../bot'
import { fromCli } from '../../bot/lambda'
import { customize } from '../customize'
import { Remediator } from '../remediation'

const bot = createBot({ ready: false })
const lambda = fromCli({ bot })
const promiseComponents = customize({ lambda, event: 'remediation:utils' })

lambda.use(async (ctx, next) => {
  const { remediator } = await promiseComponents
  const { method, data } = ctx.event
  ctx.body = await run({ method, data, remediator })
})

const run = async ({ method, data, remediator }: {
  method: string
  data: any
  remediator: Remediator
}) => {
  if (method === 'createbundle') {
    return {
      key: await remediator.saveUnsignedDataBundle(data)
    }
  }

  if (method === 'createclaim') {
    return await remediator.createClaim(data)
  }

  if (method === 'listclaims') {
    return await remediator.listClaimsForBundle(data)
  }

  if (method === 'getbundle') {
    return await remediator.getBundle(data)
  }

  if (method === 'clearclaims') {
    return await remediator.deleteClaimsForBundle(data)
  }

  throw new Error(`unknown method "${method}"`)
}

export const handler = lambda.handler
