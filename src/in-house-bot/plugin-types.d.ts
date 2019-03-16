import {
  IPBReq,
  IPBApp,
  IPBUser,
  IFormRequest,
  IBotComponents,
  IConfComponents,
  ResourceStub,
  ITradleCheck,
  ITradleObject,
  Registry,
  Logger,
  Bot
} from './types'

declare namespace PluginLifecycle {
  // synchronous, attach conditioned on handleMessages
  export type onmessage = (req: IPBReq) => boolean | void | Promise<boolean | void>
  export type willSend = (opts: IWillSendArg) => void | Promise<void>
  export type willRequestForm = (opts: IWillRequestFormArg) => void | Promise<void>
  export type willApproveApplication = (opts: IWillJudgeAppArg) => void | Promise<void>
  export type didApproveApplication = (
    opts: IWillJudgeAppArg,
    signedObject: ITradleObject
  ) => void | Promise<void>
  export type willDenyApplication = (opts: IWillJudgeAppArg) => void | Promise<void>
  export type onFormsCollected = (opts: IOnFormsCollectedArg) => void | Promise<void>
  export type onPendingApplicationCollision = (
    opts: IOnPendingApplicationCollisionArg
  ) => void | Promise<void>
  export type onRequestForExistingProduct = (req: IPBReq) => void | Promise<void>
  export type onCommand = ({ req: IPBReq, command: string }) => void | Promise<void>
  export type getRequiredForms = (opts: IGetRequiredFormsArg) => Promise<void | string[]>
  export type validateForm = (opts: IValidateFormArg) => Promise<void | IValidateFormOutput>

  // asynchronous, attach conditioned on runAsyncHandlers
  export type onCheckStatusChanged = (check: ITradleCheck) => Promise<void>
  export type onResourceChanged = (opts: OnResourceChangedArg) => Promise<void>
  export type onResourceCreated = (obj: ITradleObject) => Promise<void>
  export type onResourceDeleted = (obj: ITradleObject) => Promise<void>

  export interface Methods {
    onmessage?: onmessage
    willSend?: willSend
    willRequestForm?: willRequestForm
    willApproveApplication?: willApproveApplication
    didApproveApplication?: didApproveApplication
    willDenyApplication?: willDenyApplication
    onFormsCollected?: onFormsCollected
    onPendingApplicationCollision?: onPendingApplicationCollision
    onRequestForExistingProduct?: onRequestForExistingProduct
    onCommand?: onCommand
    getRequiredForms?: getRequiredForms
    validateForm?: validateForm

    onCheckStatusChanged?: onCheckStatusChanged
    onResourceChanged?: onResourceChanged
    onResourceCreated?: onResourceCreated
    onResourceDeleted?: onResourceDeleted
    [toBeDefined: string]: any
  }
}

interface MayHaveReq {
  req?: IPBReq
}

interface MayHaveReqAndApp extends MayHaveReq {
  application?: IPBApp
}

export interface IWillSendArg extends MayHaveReqAndApp {
  to: string | IPBUser
  object?: ITradleObject
  link?: string
}

export interface IWillRequestFormArg extends MayHaveReqAndApp {
  user: IPBUser
  formRequest: IFormRequest
}

export interface IWillJudgeAppArg extends MayHaveReq {
  user: IPBUser
  application: IPBApp
  judge?: IPBUser
}

export interface IOnFormsCollectedArg {
  req: IPBReq
  user: IPBUser
  application: IPBApp
}

export interface IOnPendingApplicationCollisionArg {
  req: IPBReq
  pending: ResourceStub[]
}

export interface IGetRequiredFormsArg {
  user: IPBUser
  application: IPBApp
  productModel: any
}

export interface OnResourceChangedArg {
  old: ITradleObject
  value: ITradleObject
}

export interface IValidateFormArg extends MayHaveReqAndApp {
  form: ITradleObject
}

type ValidationError = {
  name: string
  message?: string
}

export interface IValidateFormOutput {
  message: string
  // e.g. if you want to dynamically request more properties based on input
  requestedProperties?: ValidationError[]
  // if the user entered some invalid values
  errors?: ValidationError[]
}

export interface IPluginExports<BotComponent> {
  plugin: PluginLifecycle.Methods
  api?: BotComponent
  [customExport: string]: any
}

export interface IPluginOpts {
  logger: Logger
  conf?: any
}

export type CreatePlugin<BotComponent> = (
  components: IBotComponents,
  opts: IPluginOpts
) => IPluginExports<BotComponent>

export type ValidatePluginConfOpts = {
  bot: Bot
  conf: IConfComponents
  pluginConf: any
  [other: string]: any
}

export type UpdatePluginConfOpts = ValidatePluginConfOpts

export type ValidatePluginConf = (opts: ValidatePluginConfOpts) => Promise<void>
export type UpdatePluginConf = (opts: UpdatePluginConfOpts) => Promise<void>
export interface IPlugin<BotComponent> {
  name?: string
  createPlugin: CreatePlugin<BotComponent>
  validateConf?: ValidatePluginConf
  updateConf?: UpdatePluginConf
}

export type IPlugins = Registry<IPlugin<any>>
export interface IPluginLifecycleMethods extends PluginLifecycle.Methods {}
