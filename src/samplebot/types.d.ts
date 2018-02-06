import { Bot, ModelsPack, DatedValue, Lambda } from '../types'
import { Commander } from './commander'
import { Onfido } from './plugins/onfido'
import { Remediator } from './remediation'

export * from '../types'

export {
  Commander,
  Onfido,
  Remediator
}

export type ExecCommandFunction = ({
  context: Commands,
  req: any,
  command:string
}) => Promise<void>

export interface Command {
  name: string
  description: string
  exec: ExecCommandFunction
  disabled?: boolean
}

export interface IProductsConf {
  enabled: string[]
  autoApprove?: boolean
  approveAllEmployees?: boolean
  plugins?: any
}

export interface IConf {
  bot: {
    products: IProductsConf
  },
  modelsPack?: ModelsPack
  style?: any
  termsAndConditions?: DatedValue
}

export type BotComponents = {
  bot: Bot
  models: any
  conf?: IConf
  productsAPI: any
  employeeManager: any
  remediator?: Remediator
  onfidoPlugin?: Onfido
  commands?: Commander
  [x:string]: any
}

export type CustomizeBotOpts = {
  lambda?: Lambda
  bot?: Bot
  delayReady?: boolean
  event?: string
  conf?: IConf
}
