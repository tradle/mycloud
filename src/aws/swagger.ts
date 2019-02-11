import _ from "lodash"
import AWS from "aws-sdk"
import { Logger } from "../types"
import { genOptionsBlock } from "./gen-cors-options-block"

const X_INTEGRATION = "x-amazon-apigateway-integration"
const ALLOW_HEADERS = "method.response.header.Access-Control-Allow-Headers"
const METHODS = ["GET", "HEAD", "DELETE", "POST", "PUT", "PATCH"]

interface SwaggerOpts {
  apigateway: AWS.APIGateway
  logger: Logger
  apiId: string
  stage: string
}

export class Swagger {
  constructor(private opts: SwaggerOpts) {}
  public getSwagger = async () => {
    // if (this.isTesting) {
    //   return {}
    // }

    const { body } = await this.opts.apigateway
      .getExport({
        restApiId: this.opts.apiId,
        exportType: "swagger",
        accepts: "application/json",
        parameters: {
          extensions: "integrations"
        },
        stageName: this.opts.stage
      })
      .promise()

    return JSON.parse(body.toString())
  }

  public addBinarySupportToSwagger = async (swagger): Promise<boolean> => {
    // if (this.isTesting) {
    //   return false
    // }

    const original = _.cloneDeep(swagger)
    this.opts.logger.debug("setting binary mime types")
    swagger["x-amazon-apigateway-binary-media-types"] = ["*/*"]
    for (let path in swagger.paths) {
      let pathConf = swagger.paths[path]
      // TODO: check methods against serverless.yml
      let methods = METHODS
      let defaultOptionsBlock = genOptionsBlock({ methods })
      if (pathConf.options) {
        this.opts.logger.debug(`updating existing OPTIONS integration for path: ${path}`)
        let integrationOpts = pathConf.options[X_INTEGRATION]
        if (integrationOpts) {
          if (!integrationOpts.contentHandling) {
            // THE SKELETON KEY
            integrationOpts.contentHandling = "CONVERT_TO_TEXT"
          }

          integrationOpts.responses.default.responseParameters[ALLOW_HEADERS] =
            defaultOptionsBlock[X_INTEGRATION].responses.default.responseParameters[ALLOW_HEADERS]
        } else {
          pathConf.options[X_INTEGRATION] = defaultOptionsBlock[X_INTEGRATION]
        }
      } else {
        this.opts.logger.debug(`setting default OPTIONS integration for path ${path}`)
        pathConf.options = defaultOptionsBlock
      }
    }

    if (_.isEqual(original, swagger)) {
      this.opts.logger.debug("skipping update, remote swagger is already up to date")
      return false
    }

    await this.pushSwagger(swagger)
    return true
  }

  public pushSwagger = async swagger => {
    await this.opts.apigateway
      .putRestApi({
        restApiId: this.opts.apiId,
        mode: "merge",
        body: JSON.stringify(swagger)
      })
      .promise()

    await this.createDeployment()
  }
  private createDeployment = async () => {
    await this.opts.apigateway
      .createDeployment({
        restApiId: this.opts.apiId,
        stageName: this.opts.stage
      })
      .promise()
  }
}
