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
  Bot,
} from './types'

declare namespace PluginLifecycle {
  export type onmessage = (req:IPBReq) => boolean|void | Promise<boolean|void>
  export type willRequestForm = (opts:IWillRequestFormArg) => void | Promise<void>
  export type onFormsCollected = (opts:IOnFormsCollectedArg) => void | Promise<void>
  export type onPendingApplicationCollision = (opts:IOnPendingApplicationCollisionArg) => void | Promise<void>
  export type onRequestForExistingProduct = (req:IPBReq) => void | Promise<void>
  export type onCommand = ({ req: IPBReq, command: string }) => void | Promise<void>
  export type getRequiredForms = (opts: IGetRequiredFormsArg) => Promise<void|string[]>
  export type onCheckStatusChanged = (check: ITradleCheck) => Promise<void>
  export type onResourceChanged = (opts: OnResourceChangedArg) => Promise<void>
  export type onResourceCreated = (obj: ITradleObject) => Promise<void>
  export type onResourceDeleted = (obj: ITradleObject) => Promise<void>

  export interface Methods {
    onmessage?: onmessage
    willRequestForm?: willRequestForm
    onFormsCollected?: onFormsCollected
    onPendingApplicationCollision?: onPendingApplicationCollision
    onRequestForExistingProduct?: onRequestForExistingProduct
    onCommand?: onCommand
    getRequiredForms?: getRequiredForms
    onCheckStatusChanged?: onCheckStatusChanged
    onResourceChanged?: onResourceChanged
    onResourceCreated?: onResourceCreated
    onResourceDeleted?: onResourceDeleted
    [toBeDefined: string]: any
  }
}

export interface IWillRequestFormArg {
  user: IPBUser
  application?: IPBApp
  formRequest: IFormRequest
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

export interface IPluginExports<BotComponent> {
  plugin: PluginLifecycle.Methods
  api?: BotComponent
  [customExport: string]: any
}

export interface IPluginOpts {
  logger: Logger
  conf?: any
}

export type CreatePlugin<BotComponent> = (components:IBotComponents, opts:IPluginOpts) => IPluginExports<BotComponent>

export type ValidatePluginConfOpts = {
  bot: Bot
  conf: IConfComponents
  pluginConf: any
  [other:string]: any
}

export type UpdatePluginConfOpts = ValidatePluginConfOpts

export type ValidatePluginConf = (opts:ValidatePluginConfOpts) => Promise<void>
export type UpdatePluginConf = (opts:UpdatePluginConfOpts) => Promise<void>
export interface IPlugin<BotComponent> {
  name?: string
  createPlugin: CreatePlugin<BotComponent>
  validateConf?: ValidatePluginConf
  updateConf?: UpdatePluginConf
}

export type IPlugins = Registry<IPlugin<any>>
export interface IPluginLifecycleMethods extends PluginLifecycle.Methods {}
