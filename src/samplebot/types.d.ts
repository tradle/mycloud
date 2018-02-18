import { Bot, ModelsPack, DatedValue, Lambda } from '../types'
import { Conf } from './configure'
import { Commander } from './commander'
import { Onfido } from './plugins/onfido'
import { Remediator } from './remediation'
import { Deployment } from './deployment'
import {
  ITradleObject,
  IIdentity,
  ITradleMessage,
  ResourceStub,
  Logger,
  IBotLambdaOpts
} from '../types'

export * from '../types'

export {
  Conf,
  Commander,
  Onfido,
  Remediator,
  Deployment
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

export interface IBotConf {
  products: IProductsConf
  tours?: ITours
  sandbox?: boolean
  // exposed directly in /info
  // publicConfig: any
}

export interface IConf {
  bot: IBotConf
  modelsPack?: ModelsPack
  style?: any
  termsAndConditions?: DatedValue
}

export interface IBotComponents {
  bot: Bot
  models: any
  conf?: IConf
  productsAPI: any
  employeeManager: any
  remediator?: Remediator
  onfido?: Onfido
  deployment?: Deployment
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

export interface IYargs {
  _: string[]
  [x: string]: any
}

export interface IUser {
  id: string
  identity?: IIdentity
  [key:string]: any
}

export interface IPBReq {
  user: any
  message: ITradleMessage
  payload: ITradleObject
  // alias for "payload"
  object: ITradleObject
  type: string
}

export type VerifiedItem = {
  item: ResourceStub
  verification: ResourceStub
}

export interface IPBApp {
  applicant: ResourceStub
  requestFor: string
  forms?: ResourceStub[]
  verificationsImported?: VerifiedItem[]
  verificationsIssued?: VerifiedItem[]
  relationshipManagers?: ResourceStub[]
  status: string
  dateStarted: number
  dateModified: number
  dateCompleted?: number
}

export interface IFormRequest extends ITradleObject {
  form: string
}

export interface IWillRequestFormOpts {
  to: string | IUser
  application?: IPBApp
  formRequest: IFormRequest
  requestFor: string
}

export type WillRequestForm = (opts:IWillRequestFormOpts) => void | Promise<void>

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
  req: IPBReq
  args: IYargs
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

export type Name = {
  firstName:string
  lastName:string
  formatted?:string
}

export type ValidatePluginConfOpts = {
  bot: Bot
  conf: Conf
  pluginConf: any
  [other:string]: any
}

export interface IPluginParts {
  plugin: any
  api?: any
}

export interface IPlugin {
  name?: string
  createPlugin: (opts:any) => IPluginParts
  validateConf?: (opts:ValidatePluginConfOpts) => Promise<void>
}

export interface IPlugins {
  get: (name:string) => IPlugin
  set: (name:string, IPlugin) => void
}

export interface IPluginOpts {
  bot: Bot
  productsAPI: any
  logger: Logger
  conf?: any // plugin conf
  [other:string]: any
}

export type ClaimStub = {
  key: string
  nonce: string
  claimId: string
  qrData: string
}

export interface IDeploymentOpts {
  name: string
  domain: string
  logo?: string
  // scale?: number
}

export interface IPBotLambdaOpts extends IBotLambdaOpts {
  event: string
  [x:string]: any
}
