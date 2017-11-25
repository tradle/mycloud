
import { tradle } from '../'

const { wrap, lambdaUtils, logger } = tradle

export const handler = wrap(async (event) => {
  logger.debug('reinitializing lambda containers', event)
  await lambdaUtils.forceReinitializeContainers(event.functions)
  // await lambdaUtils.invoke({
  //   sync: false,
  //   name: 'warmup',
  //   arg: require('./')
  // })
})
