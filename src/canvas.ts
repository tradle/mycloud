/* tslint:disable:no-console */

let canvas
if (process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.IS_OFFLINE && !process.env.IS_OFFLINE) {
  console.log('USING LAMBDA PREBUILD')
  canvas = require('aws-lambda-canvas')
} else {
  canvas = require('canvas')
}

export default canvas
