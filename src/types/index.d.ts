import { EventEmitter } from 'events'
import { Middleware as ComposeMiddleware } from 'koa-compose'
import { DB, Models, Model } from '@tradle/dynamodb'
import { Logger } from '../logger'
import { Lambda, EventSource } from '../lambda'
import { Bot } from '../bot'
import { Tradle } from '../tradle'
import { Env } from '../env'
import { Identities } from '../identities'
import { Messages } from '../messages'
import { Provider } from '../provider'
import { Objects } from '../objects'
import { Auth } from '../auth'
// import { Init } from '../init'
import { AwsApis } from '../aws'
import { Bucket } from '../bucket'
import { Seals } from '../seals'
import { Blockchain } from '../blockchain'
import { ModelStore } from '../model-store'
import { Task, TaskManager } from '../task-manager'
// import { ModelStore } from '../model-store'
import { Delivery } from '../delivery'
import { ContentAddressedStore } from '../content-addressed-store'
import { KeyValueTable } from '../key-value-table'
import { CacheableBucketItem } from '../cacheable-bucket-item'
import { Friends } from '../friends'
import { Push } from '../push'
import { User } from '../user'
import { Discovery } from '../discovery'
import { Backlinks } from '../backlinks'
import { StackUtils } from '../stack-utils'
import { LambdaUtils } from '../lambda-utils'
import { S3Utils } from '../s3-utils'
import {
  ResourceStub,
  ParsedResourceStub
} from '@tradle/validate-resource'

export {
  // re-export from @tradle/validate-resource
  ResourceStub,
  ParsedResourceStub,
  // re-export from @tradle/dynamodb
  DB,
  Models,
  Model,
  // export
  Bot,
  Tradle,
  Env,
  Identities,
  Messages,
  Provider,
  Objects,
  Auth,
  AwsApis,
  Bucket,
  Seals,
  Blockchain,
  ModelStore,
  Task,
  TaskManager,
  Delivery,
  ContentAddressedStore,
  KeyValueTable,
  Logger,
  CacheableBucketItem,
  Friends,
  Push,
  User,
  Discovery,
  Lambda,
  Backlinks,
  StackUtils,
  LambdaUtils,
  S3Utils
}

export interface IPositionPair {
  sent?: IPosition
  received?: IPosition
}

export interface IPosition {
  time?: number
  link?: string
}

export interface ISession {
  clientId: string
  permalink: string
  challenge: string
  authenticated: boolean
  time: number
  connected: boolean
  clientPosition?: IPositionPair
  serverPosition?: IPositionPair
}

export interface IIotClientResponse {
  iotEndpoint: string
  iotParentTopic: string
  challenge: string
  time: number
  region: string
  s3Endpoint?: string
}

export interface IRoleCredentials {
  accessKey: string
  secretKey: string
  sessionToken: string
  uploadPrefix: string
}

export interface IAuthResponse extends IRoleCredentials {
  position: IPosition
  time: number
}

export interface ILambdaAWSExecutionContext {
  callbackWaitsForEmptyEventLoop: boolean
  logGroupName:                   string
  logStreamName:                  string
  functionName:                   string
  memoryLimitInMB:                string
  functionVersion:                string
  invokeid:                       string
  awsRequestId:                   string
  invokedFunctionArn:             string
  getRemainingTimeInMillis:       Function
  done:                           Function
  succeed:                        Function
  fail:                           Function
}

export interface IRequestContext {
  requestId: string
  correlationId: string
  containerId: string
  seq: number
  virgin?: boolean
  start: number
}

export interface ILambdaExecutionContext {
  // requestNumber: number
  event: any
  context: ILambdaAWSExecutionContext
  callback?: Function
  error?: Error
  body?: any
  done: boolean
}

export type LambdaHandler = (event:any, context:ILambdaAWSExecutionContext, callback?:Function)
  => any|void

export interface ILambdaOpts {
  devModeOnly?: boolean
  source?: EventSource
  tradle?: Tradle
  [x:string]: any
}

export type Middleware = ComposeMiddleware<ILambdaExecutionContext>

export interface ITradleObject {
  _sigPubKey?: string
  _link?: string
  _permalink?: string
  _author?: string
  _time?: number
  _virtual?:string[]
  [x: string]: any
}

export interface IECMiniPubKey {
  pub: Buffer
  curve: string
  [x: string]: any
}

export interface ITradleMessage extends ITradleObject {
  recipientPubKey: IECMiniPubKey
  object: ITradleObject
  time: number
  context?: string
  forward?: string
  _recipient?: string
  _inbound?: boolean
  [x: string]: any
}

export interface IPubKey {
  type: string
  purpose: string
  pub: string
  fingerprint: string
  networkName?: string
  curve?: string
}

export interface IIdentity extends ITradleObject {
  pubkeys: Array<IPubKey>
}

export type IDebug = (...any) => void

export interface IMessageOpts {
  object: ITradleObject
  other?: any
}

export interface ISendOpts extends IMessageOpts {
  recipient: string
}

export type IBatchSendOpts = ISendOpts[]

export interface ILiveDeliveryOpts {
  recipient: string
  messages: ITradleMessage[]
  timeout?: number
  session?: ISession,
  friend?: any
}

export interface IDelivery {
  deliverBatch: (
    opts: ILiveDeliveryOpts
  ) => Promise<any>
  ack: (opts: any) => Promise<any>
  reject: (opts: any) => Promise<any>
}

export interface IDeliveryResult {
  finished: boolean
  range: IDeliveryMessageRange
}

export interface IDeliveryRequest {
  recipient: string
  range: IDeliveryMessageRange
  batchSize?: number
  session?: ISession
  friend?: any
}

export interface IOutboundMessagePointer {
  _recipient: string
  time: number
}

export interface IDeliveryMessageRange {
  after?: number
  before?: number
  afterMessage?: IOutboundMessagePointer
}

export type CacheContainer = {
  cache: any
  logger: Logger
  [x:string]: any
}

export type DatedValue = {
  lastModified: number
  value: any
}

export interface IAWSServiceConfig {
  maxRetries?: number
  region: string
  s3: any
  dynamodb: any
  iot: any
  iotdata: any
  sts: any
  sns: any
  kms: any
  lambda: any
  cloudformation: any
  xray: any
}

export type EndpointInfo = {
  aws: boolean
  iotParentTopic: string
  version: string
}

export type HooksHookFn = (event:string, handler:Function) => void
export type HooksFireFn = (event:string, ...args:any[]) => any|void

export type Hooks = {
  hook: HooksHookFn
  fire: HooksFireFn
}

export type LambdaCreator = (opts?:any) => Lambda

export interface ILambdaImpl {
  createLambda: LambdaCreator
  createMiddleware?: (lambda: Lambda, opts?: any) => Function
}

export type Lambdas = {
  [name:string]: ILambdaImpl
}

export type BotStrategyInstallFn = (bot:Bot, opts?:any) => any|void

export type ModelsPack = {
  models?: Model[]
  lenses?: any
  namespace?: string
}

export interface ISettledPromise<T> {
  isFulfilled: boolean
  isRejected: boolean
  value?: T
  reason?: Error
}

export interface IBucketInfo {
  length?: (obj:any) => number
  max: number
  maxAge: number
}

export interface IBucketsInfo {
  Objects: IBucketInfo
  Secrets: IBucketInfo
  ContentAddressed: IBucketInfo
  PublicConf: IBucketInfo
  PrivateConf: IBucketInfo
  FileUpload: IBucketInfo
  ServerlessDeployment: IBucketInfo
}

export type Buckets = {
  [P in keyof IBucketsInfo]: Bucket
}

export interface ILaunchStackUrlOpts {
  region: string
  stackName: string
  templateURL: string
}

export interface IUpdateStackUrlOpts {
  region?: string
  stackName?: string
  stackId?: string
  templateURL: string
}
