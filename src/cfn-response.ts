// adapted from cfn-response
/* Copyright 2015 Amazon Web Services, Inc. or its affiliates. All Rights Reserved.
   This file is licensed to you under the AWS Customer Agreement (the "License").
   You may not use this file except in compliance with the License.
   A copy of the License is located at http://aws.amazon.com/agreement/.
   This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, express or implied.
   See the License for the specific language governing permissions and limitations under the License. */

// @ts-ignore
import Promise from 'bluebird'
import https from 'https'
import url from 'url'

export const SUCCESS = 'SUCCESS'
export const FAILED = 'FAILED'
export const sendSuccess = (event, context, responseData, physicalResourceId?) => {
  return send(event, context, SUCCESS, responseData, physicalResourceId)
}

export const sendError = (event, context, responseData, physicalResourceId?) => {
  return send(event, context, FAILED, responseData, physicalResourceId)
}

export const send = async (event, context, responseStatus, responseData, physicalResourceId?) => {
  return new Promise((resolve, reject) => {
    const responseBody = JSON.stringify({
      Status: responseStatus,
      Reason: "See the details in CloudWatch Log Stream: " + context.logStreamName,
      PhysicalResourceId: physicalResourceId || context.logStreamName,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Data: responseData
    })

    console.log("Response body:\n", responseBody)

    const parsedUrl = url.parse(event.ResponseURL)
    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.path,
      method: "PUT",
      headers: {
        "content-type": "",
        "content-length": responseBody.length
      }
    }

    const request = https.request(options, response => {
      console.log("Status code: " + response.statusCode)
      console.log("Status message: " + response.statusMessage)
      resolve(response)
    })

    request.on("error", err => {
      console.log("send(..) failed executing https.request(..): " + err)
      reject(err)
    })

    request.write(responseBody)
    request.end()
  })
}
