import { Lambda } from './lambda'

export class LambdaHttp extends Lambda {
  get body() {
    const { body={} } = this.event
    return typeof body === 'string' ? JSON.parse(body) : body
  }

  get queryParams() {
    return this.event.queryStringParameters || {}
  }

  get params() {
    return this.event.pathParameters || {}
  }

  get correlationId() {
    return this.event.requestContext.requestId
  }

  public response = (body, statusCode=200) => {
    if (statusCode >= 400) {              // eslint-disable-line no-magic-numbers
      console.error(body, this.event)     // eslint-disable-line no-console
    }

    // TODO: isBase64Encoded

    return this.callback(null, {
      statusCode,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify(body)
    })
  }
}
