import yn from 'yn'
import AWSXRay from 'aws-xray-sdk-core'

const xrayIsOn =
  yn(process.env.ENABLE_XRAY) && !yn(process.env.TRADLE_BUILD) && process.env._X_AMZN_TRACE_ID

process.env.XRAY_IS_ON = xrayIsOn ? '1' : ''

if (!process.env.IS_OFFLINE) {
  if (xrayIsOn) {
    // tslint-disable-rule: no-console
    console.warn('capturing all http requests with AWSXRay')
    AWSXRay.captureHTTPsGlobal(require('http'))
  } else if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    console.warn('AWSXray is off')
  }
}
