import { EventEmitter } from 'events'
import { Middleware as ComposeMiddleware } from 'koa-compose'
import { GraphQLSchema, ExecutionResult as GraphqlExecutionResult } from 'graphql'
import { DB, Models, Model } from '@tradle/dynamodb'
import { AppLinks } from '@tradle/qr-schema'
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
import { Init } from '../init'
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
import { Events } from '../events'
import { Mailer } from '../mailer'
import {
  ResourceStub,
  ParsedResourceStub
} from '@tradle/validate-resource'

export * from '../retryable-task'
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
  Init,
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
  S3Utils,
  Events,
  Mailer,
  AppLinks
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

export interface IBotLambdaOpts extends ILambdaOpts {
  bot?: Bot
  middleware?: Middleware
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
  _counterparty?: string
  _dcounterparty?: string
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

export interface IEncodedPriv {
  pem: {
    priv: string
    pub: string
  }
}

export interface IPrivKey extends IPubKey {
  priv: string
  encoded: IEncodedPriv
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
  // timestamps
  after?: number
  before?: number
  // afterMessage?: IOutboundMessagePointer
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

// export type HooksHookFn = (event:string, handler:Function) => void
// export type HooksFireFn = (event:string, ...args:any[]) => any|void

// export type Hooks = {
//   hook: HooksHookFn
//   fire: HooksFireFn
// }

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

export interface ITable {
  // placeholder
  // TODO: export api from db-utils
  // or switch to using @tradle/dynamodb
  name: string
  [key: string]: any
}

export type Tables = {
  PubKeys: ITable
  Messages: ITable
  Seals: ITable
  Bucket0: ITable
  KV: ITable
  Events: ITable
  Users: ITable
  Presence: ITable
  Friends: ITable
}


// TODO: generate this from serverless.yml
export type IServiceMap = {
  Table: {
    [name: string]: string
  },
  Bucket: {
    [P in keyof IBucketsInfo]: string
  },
  RestApi: {
    [name: string]: {
      url: string
      id: string
    }
  },
  Role: {
    [name: string]: string
  },
  Stack: string
}

export interface ILaunchStackUrlOpts {
  region: string
  stackName: string
  templateURL?: string
  quickLink?: boolean
}

export interface IUpdateStackUrlOpts {
  region?: string
  stackId?: string
  stackName?: string
  templateURL: string
}

export interface ISaveObjectOpts {
  object: ITradleObject
  merge?: boolean
  inbound?: boolean
}

export type CloudName = 'aws'

export interface IDeepLink {
  provider: string
  host: string
  platform: 'mobile' | 'web'
}

export interface ISendEmailResult {
  id: string
}

export interface IMailer {
  send: (opts: ISendEmailOpts) => Promise<ISendEmailResult>
  canSendFrom: (address: string) => Promise<boolean>
}

export interface ISendEmailOpts {
  from: string
  to?: string|string[]
  cc?: string|string[]
  bcc?: string|string[]
  subject: string
  body: string
  format?: 'text' | 'html'
  replyTo?: string|string[]
}

export interface ITimeoutOpts {
  millis?: number
  error?: Error
  unref?: boolean
}

export interface ILoadFriendOpts {
  url: string
  domain?: string
}

export interface IBotOpts {
  tradle: Tradle
  users?: any
  ready?:boolean
}

export interface IGraphiqlBookmark {
  title: string
  query: string
}

export interface IGraphiqlOptions {
  jwt?: boolean
  bookmarks?: {
    title: string
    items: IGraphiqlBookmark[]
  },
  logo?: {
    src: string
    width: number
    height: number
  }
}

export interface IGraphqlAPI {
  schema: GraphQLSchema
  exportSchema: () => any
  resolvers: any
  execute: (query: string, variables?: any) => Promise<GraphqlExecutionResult>
  graphiqlOptions: IGraphiqlOptions
}

export interface IBlockchainIdentifier {
  flavor: string
  networkName: string
}

export type StreamRecordType = 'create'|'update'|'delete'|string
export type StreamService = 'dynamodb'

export interface IStreamRecord {
  id: string
  time: number
  seq: string
  type: StreamRecordType
  source: string
  service: StreamService
  new?: any
  old?: any
}

export interface IStreamEventDBRecord {
  id: string
  topic: string
  time: number
  // dateN: string
  // timeR: string
  // source: string
  data: any
}

export interface IStreamEvent {
  id: string
  time: number
  topic: string
  source: string
  data: any
}

export type IBotMiddlewareContext = {
  bot: Bot
  event: any
}

export type BotMiddleware = ComposeMiddleware<IBotMiddlewareContext>
