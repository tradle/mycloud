import { Middleware as ComposeMiddleware } from 'koa-compose'
import { Bot, ModelsPack, DatedValue, Lambda } from '../types'
import { Conf } from './configure'
import { Commander } from './commander'
import { Onfido } from './plugins/onfido'
import { Remediation } from './remediation'
import { Deployment } from './deployment'
import { EmailBasedVerifier } from './email-based-verifier'
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
  EmailBasedVerifier
}

export type StringToNumMap = {
  [key: string]: number
}

export interface IProductsConf {
  enabled: string[]
  autoApprove?: boolean
  approveAllEmployees?: boolean
  maximumApplications?: StringToNumMap
  plugins?: any
}

export interface ITours {
  [name:string]: ITradleObject
}

export interface IBotConf {
  products: IProductsConf
  tours?: ITours
  sandbox?: boolean
  graphqlAuth?: boolean
  // exposed directly in /info
  // publicConfig: any
}

export interface IConf {
  bot: IBotConf
  org: IOrganization
  modelsPack?: ModelsPack
  style?: any
  termsAndConditions?: DatedValue
}

export interface IBotComponents {
  bot: Bot
  logger: Logger
  productsAPI: any
  employeeManager: any
  conf?: IConf
  remediation?: Remediation
  onfido?: Onfido
  deployment?: Deployment
  commands?: Commander
  emailBasedVerifier?: EmailBasedVerifier
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
  applications?: IPBAppStub[]
  applicationsApproved?: IPBAppStub[]
  applicationsDenied?: IPBAppStub[]
  verificationsImported?: VerifiedItem[]
  verificationsIssued?: VerifiedItem[]
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
  context: string
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

export interface IPBAppStub {
  dateModified: number
  requestFor: string
  statePermalink: string
  context: string
  status: string
}

export interface IFormRequest extends ITradleObject {
  form: string
  prefill?: any
}

export interface IWillRequestFormArg {
  user: IUser
  application?: IPBApp
  formRequest: IFormRequest
}

export interface IOnFormsCollectedArg {
  req: IPBReq
  user: IUser
  application: IPBApp
}

export interface ICommandInput {
  command: string
  req?: IPBReq
  sudo?: boolean
}

export interface IDeferredCommandInput extends ICommandInput {
  ttl: number
}

export interface ICommandContext {
  commander: Commander
  commandName: string
  commandString: string
  argsStr: string
  req?: IPBReq
  args?: IYargs
  employee?: boolean
  sudo?: boolean
  [x:string]: any
}

export type CommandOutput = {
  ctx: ICommandContext
  command?: ICommand
  result?:any
  error?:any
}

export interface ICommandSendResultOpts extends ICommandContext {
  to: IUser | string
  result: any
}

export interface ICommand {
  name: string
  description: string
  examples: string[]
  exec: (opts:ICommandContext) => Promise<any>
  parse?: (args:string, opts?:any) => any
  parseOpts?: any
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

interface IOnPendingApplicationCollisionArg {
  req: IPBReq
  pending: ResourceStub[]
}

export interface IPluginLifecycleMethods {
  onmessage?: (req:IPBReq) => boolean|void | Promise<boolean|void>
  willRequestForm?: (opts:IWillRequestFormArg) => void | Promise<void>
  onFormsCollected?: (opts:IOnFormsCollectedArg) => void | Promise<void>
  onPendingApplicationCollision?: (opts:IOnPendingApplicationCollisionArg) => void | Promise<void>
  onRequestForExistingProduct?: (req:IPBReq) => void | Promise<void>
  onCommand?: ({ req: IPBReq, command: string }) => void | Promise<void>
  [toBeDefined: string]: any
}

export interface IPluginExports<BotComponent> {
  plugin: IPluginLifecycleMethods
  api?: BotComponent
  [customExport: string]: any
}

export interface IPluginOpts {
  logger: Logger
  conf?: any
}

export type CreatePlugin<BotComponent> = (components:IBotComponents, opts:IPluginOpts) => IPluginExports<BotComponent>

export interface IPlugin<BotComponent> {
  name?: string
  createPlugin: CreatePlugin<BotComponent>
  validateConf?: (opts:ValidatePluginConfOpts) => Promise<void>
}

export interface IPlugins {
  get: <T>(name:string) => IPlugin<T>
  set: (name:string, IPlugin) => void
}

export type ClaimType = 'bulk' | 'prefill'

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
  region: string
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
  contextId?: string
}

export interface IImportDataDeepLink extends IDeepLink {
  dataHash: string
}

export interface IPBMiddlewareContext extends ILambdaExecutionContext {
  components: IBotComponents
}

export type IPBMiddleware = ComposeMiddleware<IPBMiddlewareContext>

export interface IAppLinkSet {
  mobile?: string
  web?: string
  employeeOnboarding?: string
}
