import { Bot, ModelsPack, DatedValue, Lambda } from '../types'
import { Commander } from './commander'
import { Onfido } from './plugins/onfido'
import { Remediator } from './remediation'
import {
  ITradleObject,
  IIdentity,
  ITradleMessage
} from '../types'

export * from '../types'

export {
  Commander,
  Onfido,
  Remediator
}

export interface IProductsConf {
  enabled: string[]
  autoApprove?: boolean
  approveAllEmployees?: boolean
  plugins?: any
}

export interface ITours {
  [name:string]: ITradleObject
}

export interface IConf {
  bot: {
    products: IProductsConf,
    tours: ITours
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

export type CliOpts = {
  remote?: boolean
  console?: any
}

export interface Yargs {
  _: string[]
  [option: string]: any
}

export interface IUser {
  id: string
  identity?: IIdentity
  [key:string]: any
}

export interface PBReq {
  user: any
  message: ITradleMessage
  payload: ITradleObject
  // alias for "payload"
  object: ITradleObject
  type: string
}

export interface ICommandContext {
  commandName: string
  allowed?: boolean
  employee?: boolean
  sudo?: boolean
  argsStr: string
  [x:string]: any
}

export type CommandOutput = {
  result?:any
  error?:any
}

export interface ICommandExecOpts {
  commander: Commander
  req: PBReq
  args: Yargs
  argsStr: string
  ctx: ICommandContext
}

export interface ICommandSendResultOpts extends ICommandExecOpts {
  to: IUser | string
  result: any
}

export interface ICommand {
  name: string
  description: string
  examples: string[]
  exec: (opts:ICommandExecOpts) => Promise<any>
  parse?: (args:string) => any
  sendResult?: (opts:ICommandSendResultOpts) => Promise<any>
  aliases?: string[]
}
