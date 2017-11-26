process.env.LAMBDA_BIRTH_DATE = Date.now()

import { tradle } from '../'

const { wrap, lambdaUtils } = tradle

export const handler = wrap(async (event) => {
  return await lambdaUtils.warmUp(event)
})
