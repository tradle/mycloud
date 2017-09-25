import * as serverlessHTTP from 'serverless-http'
import { router, env } from './'
const { TESTING } = env
const binaryMimeTypes = TESTING ? [] : [
  'application/javascript',
  'application/json',
  'application/octet-stream',
  'application/xml',
  'font/eot',
  'font/opentype',
  'font/otf',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'text/comma-separated-values',
  'text/css',
  'text/html',
  'text/javascript',
  'text/plain',
  'text/text',
  'text/xml'
]

module.exports = serverlessHTTP(router, {
  binary: binaryMimeTypes,
  request: (request, event, context) => {
    request.context = context
    request.event = event
    return request
  }
})
