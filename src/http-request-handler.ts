import * as serverlessHTTP from "serverless-http"
import { ILambdaExecutionContext } from './types'
import { utils } from './'

const { cachifyPromiser } = utils

export function createHandler ({ router, env }) {
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

  return serverlessHTTP(router, {
    binary: binaryMimeTypes,
    request: async (request, event, context:ILambdaExecutionContext) => {
      env.setFromLambdaEvent({ event, context, source: 'http' })
      request.context = context
      request.event = event
      return request
    }
  })
}
