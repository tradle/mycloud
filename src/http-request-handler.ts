import * as serverlessHTTP from "serverless-http"
import { ILambdaExecutionContext } from './types'
import { tradle } from './'
const { router, env, discovery, utils } = tradle
const { cachifyPromiser } = utils
const { TESTING } = env
const binaryMimeTypes = TESTING
  ? []
  : [
      "application/javascript",
      "application/json",
      "application/octet-stream",
      "application/xml",
      "font/eot",
      "font/opentype",
      "font/otf",
      "image/jpeg",
      "image/png",
      "image/svg+xml",
      "text/comma-separated-values",
      "text/css",
      "text/html",
      "text/javascript",
      "text/plain",
      "text/text",
      "text/xml"
    ]

const discoverServices = cachifyPromiser(async () => {
  const serviceMap = await discovery.discoverServices()
  env.set(serviceMap)
})

// const serverlessHttpHandler =
export = serverlessHTTP(router, {
  binary: binaryMimeTypes,
  request: async (request, event, context:ILambdaExecutionContext) => {
    env.setFromLambdaEvent({ event, context, source: 'http' })
    request.context = context
    request.event = event
    return request
  }
})

// export const handler = (event, context, callback) => {
//   env.setFromLambdaEvent({ event, context, source: 'http' })
//   return serverlessHttpHandler(event, context, callback)
// }
