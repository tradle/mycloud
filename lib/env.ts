
import './globals'
import * as createLogger from 'debug'

// serverless-offline plugin sets IS_OFFLINE
import * as yn from 'yn'
import * as Networks from './networks'
import { parseArn } from './utils'

export default class Env {
  public TESTING:boolean
  public DEV:boolean
  public IS_WARM_UP:boolean
  public IS_LAMBDA_ENVIRONMENT:boolean
  public IS_LOCAL:boolean
  public DISABLED:boolean

  public AWS_REGION:string
  public REGION:string
  public AWS_LAMBDA_FUNCTION_NAME:string
  public FUNCTION_NAME:string

  public SERVERLESS_PREFIX:string
  public SERVERLESS_STAGE:string
  public SERVERLESS_SERVICE_NAME:string

  public BLOCKCHAIN:any
  public NO_TIME_TRAVEL:boolean
  public IOT_TOPIC_PREFIX:string
  public IOT_ENDPOINT:string

  constructor(props:any) {
    this.set(props)

    const {
      SERVERLESS_PREFIX,
      SERVERLESS_STAGE='',
      NODE_ENV,
      IS_LOCAL,
      IS_OFFLINE,
      AWS_REGION,
      AWS_LAMBDA_FUNCTION_NAME,
      NO_TIME_TRAVEL,
      BLOCKCHAIN='ethereum:ropsten'
    } = props

    const [flavor, networkName] = BLOCKCHAIN.split(':')
    this.BLOCKCHAIN = Networks[flavor][networkName]
    this.TESTING = NODE_ENV === 'test' || yn(IS_LOCAL) || yn(IS_OFFLINE)
    this.FUNCTION_NAME = AWS_LAMBDA_FUNCTION_NAME
      ? AWS_LAMBDA_FUNCTION_NAME.slice(SERVERLESS_PREFIX.length)
      : '[unknown]'

    this.DEV = !SERVERLESS_STAGE.startsWith('prod')
    this.NO_TIME_TRAVEL = yn(NO_TIME_TRAVEL)
    this.REGION = this.AWS_REGION
    this.IS_LAMBDA_ENVIRONMENT = !!AWS_REGION
    this.debug = createLogger(`λ:${this.FUNCTION_NAME}`)
  }

  public set = props => Object.assign(this, props)
  public logger = namespace => createLogger(`λ:${this.FUNCTION_NAME}:${namespace}`)
  public setFromLambdaEvent = (event, context) => {
    this.IS_WARM_UP = event.source === 'serverless-plugin-warmup'
    const { invokedFunctionArn } = context
    if (invokedFunctionArn) {
      const {
        accountId
      } = parseArn(invokedFunctionArn)

      this.set({ accountId })
    }
  }
}

// const env = {}
// env.IS_LAMBDA_ENVIRONMENT = !!process.env.AWS_REGION
// if (TESTING) {
//   extend(process.env, require('../test/service-map'))
// } else if (!env.IS_LAMBDA_ENVIRONMENT) {
//   require('./cli/utils').loadCredentials()
//   try {
//     extend(process.env, require('../test/fixtures/remote-service-map'))
//   } catch (err) {}
// }

// env.set(process.env)
// env.REGION = env.AWS_REGION
// env.TESTING = TESTING
// env.prefix = env.SERVERLESS_PREFIX

// this one might be set dynamically
// env.__defineGetter__('IOT_ENDPOINT', () => process.env.IOT_ENDPOINT)


// module.exports = env
