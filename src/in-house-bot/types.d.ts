import { Middleware as ComposeMiddleware } from 'koa-compose'
import { Bot, ModelsPack, DatedValue, Lambda } from '../types'
import { Conf } from './configure'
import { Commander } from './commander'
import { Onfido } from './plugins/onfido'
import { Remediation } from './remediation'
import { Deployment } from './deployment'
import { AppLinks } from './app-links'
import {
  ITradleObject,
  IIdentity,
  ITradleMessage,
  ResourceStub,
  Logger,
  IBotLambdaOpts,
  IDeepLink,
  ILambdaExecutionContext
} from '../types'

export * from '../types'

export {
  Conf,
  Commander,
  Onfido,
  Remediation,
  Deployment,
  AppLinks
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
  linker: AppLinks
  remediation?: Remediation
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
  user: IUser
  message: ITradleMessage
  payload: ITradleObject
  // alias for "payload"
  object: ITradleObject
  type: string
  application?: IPBApp
  applicant?: IUser
  isFromEmployee?: boolean
  skipChecks?: boolean
}

export type VerifiedItem = {
  item: ResourceStub
  verification: ResourceStub
}

export interface IPBApp extends ITradleObject {
  applicant: ResourceStub
  request?: ResourceStub
  requestFor: string
  forms?: ResourceStub[]
  verificationsImported?: VerifiedItem[]
  verificationsIssued?: VerifiedItem[]
  relationshipManagers?: ResourceStub[]
  checks?:ResourceStub[]
  status: string
  dateStarted: number
  dateModified: number
  dateCompleted?: number
  draft?: boolean
}

export interface IFormRequest extends ITradleObject {
  form: string
  prefill?: any
}

export interface IWillRequestFormArg {
  to: string | IUser
  application?: IPBApp
  formRequest: IFormRequest
}

export interface IOnFormsCollectedArg {
  req: IPBReq
  user: IUser
  application: IPBApp
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

export interface IPluginLifecycleMethods {
  onmessage?: (req:IPBReq) => boolean|void | Promise<boolean|void>
  willRequestForm?: (opts:IWillRequestFormArg) => void | Promise<void>
  onFormsCollected?: (opts:IOnFormsCollectedArg) => void | Promise<void>
  [toBeDefined: string]: Function
}

export interface IPluginExports {
  plugin: IPluginLifecycleMethods
  api?: any
  [customExport: string]: any
}

export interface IPlugin {
  name?: string
  createPlugin: (opts:any) => IPluginExports
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

export type ClaimType = 'dump' | 'prefill'

export type ClaimStub = {
  key: string
  nonce: string
  claimType: ClaimType
  claimId: string
  qrData?: string
}

export interface IDataBundle extends ITradleObject {
  items: ITradleObject[]
}

export interface IDeploymentOpts {
  name: string
  domain: string
  logo?: string
  stackPrefix: string
  configurationLink?: string
}

// conf used by MyCloud for initialization
export interface IOrganization extends ITradleObject {
  name: string
  domain: string
}

export interface ILaunchReportPayload {
  org: IOrganization
  identity: IIdentity
  deploymentUUID: string
  apiUrl: string
  stackId: string
  logo?: string
}

export interface IMyDeploymentConf {
  // become "org"
  name: string
  domain: string
  // same as ILaunchReportPayload
  identity: IIdentity
  deploymentUUID: string
  apiUrl: string
  service: string
  stage: string
  stackName: string
  stackId: string
  referrerUrl: string
  logo?: string
}

export interface IDeploymentConfForm extends ITradleObject {
  adminEmail: string
  hrEmail: string
}

export interface IPBotLambdaOpts extends IBotLambdaOpts {
  event: string
  [x:string]: any
}

export interface IDeploymentPluginConf {
  senderEmail: string
}

export interface IApplyForProductDeepLink extends IDeepLink {
  product: string
}

export interface IImportDataDeepLink extends IDeepLink {
  dataHash: string
}

export interface IPBMiddlewareContext extends ILambdaExecutionContext {
  components: IBotComponents
}

export type IPBMiddleware = ComposeMiddleware<IPBMiddlewareContext>
