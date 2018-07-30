import { Lambda } from './types'
import serverlessHTTP from 'serverless-http'
import { utils } from './'

const { cachifyPromiser } = utils

export function createHandler ({
  lambda,
  preProcess,
  postProcess
}: {
  lambda: Lambda
  preProcess: (...any) => Promise<void>
  postProcess: (...any) => Promise<void>
}) {
  const binaryMimeTypes = lambda.isLocal
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

  return serverlessHTTP(lambda.koa, {
    binary: binaryMimeTypes,
    request: preProcess,
    response: postProcess
  })
}
