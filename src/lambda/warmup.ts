import '../init-lambda'

import { tradle } from '../'

const { wrap, lambdaUtils } = tradle

export const handler = wrap(async (event) => {
  return await lambdaUtils.warmUp(event)
})
