import '../init-lambda'

import { tradle } from '../'
import serverlessYml = require('../cli/serverless-yml')

const { wrap, lambdaUtils, logger } = tradle

export const handler = wrap(async (event) => {
  logger.debug('reinitializing lambda containers', event)
  await lambdaUtils.forceReinitializeContainers(event.functions)
  await lambdaUtils.warmUp(lambdaUtils.getWarmUpInfo(serverlessYml).input)
})
