import { EventEmitter } from 'events'
import { Middleware as ComposeMiddleware } from 'koa-compose'
import { Context as KoaContext } from 'koa'
import { GraphQLSchema, ExecutionResult as GraphqlExecutionResult } from 'graphql'
import { Table, DB, Models, Model, Diff, FindOpts } from '@tradle/dynamodb'
import { AppLinks } from '@tradle/qr-schema'
import { Logger } from '../logger'
import { BaseLambda, LambdaHttp, Lambda, EventSource } from '../lambda'
import { Bot } from '../bot'
import { Users } from '../users'
import { Env } from '../env'
import { Identities } from '../identities'
import { Identity } from '../identity'
import { Secrets } from '../secrets'
import { Storage } from '../storage'
import { Messages } from '../messages'
import { Messaging } from '../messaging'
import { Objects } from '../objects'
import { Auth } from '../auth'
import { Init } from '../init'
import { AwsApis } from '../aws'
import { Bucket } from '../bucket'
import { Seals, Seal, SealPendingResult, CreateSealOpts } from '../seals'
import { SealBatcher } from '../batch-seals'
import { Blockchain } from '../blockchain'
import { ModelStore } from '../model-store'
import { Task, TaskManager } from '../task-manager'
// import { ModelStore } from '../model-store'
import { Delivery } from '../delivery'
import { ContentAddressedStore } from '../content-addressed-store'
import { KeyValueTable } from '../key-value-table'
import { KV } from '../kv'
import { CacheableBucketItem } from '../cacheable-bucket-item'
import { Friends } from '../friends'
import { Push } from '../push'
import { User } from '../user'
import { Discovery } from '../discovery'
import { Backlinks } from '../backlinks'
import { StackUtils } from '../stack-utils'
import { LambdaUtils } from '../lambda-utils'
import { S3Utils } from '../s3-utils'
import { SNSUtils } from '../sns-utils'
import { Iot, IIotEndpointInfo } from '../iot-utils'
import { Events, EventTopic } from '../events'
import { Mailer } from '../mailer'
import { MiddlewareContainer } from '../middleware-container'
import { ResourceStub } from '@tradle/validate-resource'

type Folder = Bucket

export {
  ResourceStub,
  ParsedResourceStub,
  EnumStub,
  GetResourceIdentifierInput,
  GetResourceIdentifierOutput,
  ValidateResourceOpts,
} from '@tradle/validate-resource'

export type Constructor<T = {}> = new (...args: any[]) => T

export * from '../retryable-task'
// export { ECKey } from '../crypto'

export {
  // re-export from @tradle/dynamodb
  DB,
  Table,
  Models,
  Model,
  Diff,
  FindOpts as DBFindOpts,
  // export
  Bot,
  Users,
  Env,
  Identities,
  Identity,
  Secrets,
  Storage,
  Messages,
  Messaging,
  Objects,
  Auth,
  Init,
  AwsApis,
  Bucket,
  Folder,
  Seal,
  Seals,
  SealBatcher,
  CreateSealOpts,
  SealPendingResult,
  Blockchain,
  ModelStore,
  Task,
  TaskManager,
  Delivery,
  ContentAddressedStore,
  KeyValueTable,
  KV,
  Logger,
  CacheableBucketItem,
  Friends,
  Push,
  User,
  Discovery,
  Lambda,
  LambdaHttp,
  BaseLambda,
  EventSource,
  Backlinks,
  StackUtils,
  LambdaUtils,
  S3Utils,
  SNSUtils,
  Iot,
  Events,
  Mailer,
  AppLinks,
  MiddlewareContainer
}

export interface IPositionPair {
  sent?: IPosition
  received?: IPosition
}

export interface IPosition {
  time?: number
  link?: string
}

// time < dateAuthenticated < dateConnected < dateSubscribed
export interface ISession extends ITradleObject {
  clientId: string
  permalink: string
  challenge: string
  authenticated: boolean
  connected: boolean
  subscribed: boolean
  dateCreated?: number
  dateAuthenticated?: number
  dateConnected?: number
  dateSubscribed?: number
  clientPosition?: IPositionPair
  serverPosition?: IPositionPair
}

export interface IIotClientChallenge {
  challenge: string
  time: number
}

export interface IRoleCredentials {
  accessKey: string
  secretKey: string
  sessionToken: string
  uploadPrefix: string
}

export interface IIotClientChallengeAndCreds extends IIotClientChallenge, IRoleCredentials {}

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
  getRemainingTimeInMillis:       () => number
  done:                           GenericCallback
  // succeed:                        (result: any) => void
  // fail:                           (error: Error) => void
}

export interface IRequestContext {
  requestId: string
  correlationId: string
  containerId: string
  seq: number
  commit: string
  cold?: boolean
  start: number
}

export interface ILambdaExecutionContext {
  // requestNumber: number
  event: any
  context: ILambdaAWSExecutionContext
  callback?: Function
  error?: Error
  body: any
  done: boolean
  [x: string]: any
}

export interface ILambdaHttpExecutionContext extends ILambdaExecutionContext, KoaContext {
}

export interface ILambdaCloudWatchLogsExecutionContext extends ILambdaExecutionContext {
  event: CloudWatchLogsEvent
}

export interface ISNSExecutionContext extends ILambdaExecutionContext {
  event: SNSEvent
}

export type GenericCallback = (err?: Error, result?: any) => void

export type LambdaHandler = (event:any, context:ILambdaAWSExecutionContext, callback?: GenericCallback)
  => Promise<any>|void

export interface ILambdaOpts<T> {
  source?: EventSource
  bot?: Bot
  middleware?: Middleware<T>
  [x:string]: any
}

export type Middleware<T> = ComposeMiddleware<T>
export type MiddlewareHttp = Middleware<ILambdaHttpExecutionContext>

export interface ITradleObject {
  _version?: number
  _sigPubKey?: string
  _link?: string
  _permalink?: string
  _author?: string
  _org?: string
  _time?: number
  [x: string]: any
}

export interface IECMiniPubKey {
  pub: Buffer
  curve: string
  [x: string]: any
}

export interface ITradleMessage extends ITradleObject {
  object: ITradleObject
  _time: number
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
  pubkeys: IPubKey[]
}

export interface IIdentityAndKeys {
  identity: IIdentity
  keys: IPrivKey[]
}

export interface ObjectLinks {
  link: string
  permalink: string
  prevlink?: string
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

export interface IDeliveryError {
  counterparty: string
  time: number
}

export interface IDeliveryRequest {
  recipient: string
  range: IDeliveryMessageRange
  batchSize?: number
  session?: ISession
  friend?: any
  onProgress?: (messages:ITradleMessage[]) => Promise<any|void>
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

export interface IHasLogger {
  logger: Logger
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

export interface IEndpointInfo extends IIotEndpointInfo {
  aws: boolean
  endpoint: string
  version: VersionInfo
}

export type TopicOrString = string|EventTopic
export type HooksHookFn = (event:TopicOrString, handler:Function) => Function
export type HooksFireFn = (event:TopicOrString, ...args:any[]) => any|void

export interface IHooks {
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
  Logs: IBucketInfo
  // ContentAddressed: IBucketInfo
  // PublicConf: IBucketInfo
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
  // PubKeys: ITable
  // Messages: ITable
  // Seals: ITable
  Bucket0: ITable
  // KV: ITable
  Events: ITable
  // Users: ITable
  // Presence: ITable
  // Friends: ITable
}

type AttrMap = {
  [name: string]: string
}

// TODO: generate this from serverless.yml
export type IServiceMap = {
  Table: Tables
  Bucket: {
    [P in keyof IBucketsInfo]: string
  }
  RestApi: {
    [name: string]: {
      url: string
      id: string
    }
  }
  Role: AttrMap
  Key: AttrMap
  Topic: {
    AdminAlerts: string
  }
  Stack: string
}

export interface ILaunchStackUrlOpts {
  region: string
  stackName: string
  templateUrl?: string
  quickLink?: boolean
}

export interface IUpdateStackUrlOpts {
  region?: string
  stackId?: string
  stackName?: string
  templateUrl: string
}

export interface ISaveObjectOpts {
  object: ITradleObject
  diff?: Diff
  saveToObjects?: boolean
  saveToDB?: boolean
}

export interface UpdateResourceOpts {
  type: string
  permalink: string
  props: any
}

export type CloudName = 'aws'

export interface IDeepLink {
  provider: string
  host: string
  platform: 'mobile' | 'web'
}

export interface IMailerSendEmailResult {
  id: string
}

export type IMailerCanSendFromResult = {
  result: boolean
  reason?: string
}

export interface IMailer {
  send: (opts: IMailerSendEmailOpts) => Promise<IMailerSendEmailResult>
  canSendFrom: (address: string) => Promise<IMailerCanSendFromResult>
}

export interface IMailerSendEmailOpts {
  from: string
  to?: string|string[]
  cc?: string|string[]
  bcc?: string|string[]
  subject: string
  body: string
  format?: 'text' | 'html'
  replyTo?: string|string[]
}

type ErrorCreator = () => Error

export interface ITimeoutOpts {
  millis?: number
  error?: Error|ErrorCreator
  unref?: boolean
}

export interface ILoadFriendOpts {
  url: string
  domain?: string
}

export interface IBotOpts {
  env?: any
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
  blockchain: string
  networkName: string
  // confirmations?: number
}

export interface BlockchainNetworkInfo extends IBlockchainIdentifier {
  confirmations?: number
  minBalance?: number|string
}

export interface BlockchainNetwork extends BlockchainNetworkInfo {
  pubKeyToAddress: (pubKey: Buffer) => string
  curve: string
  transactor: any
  toString: () => string
  // select: (obj: any) => any
}

export type SealingMode = 'single'|'batch'

export type StreamRecordType = 'create'|'update'|'delete'|string
export type StreamService = 'dynamodb'

export interface IStreamRecord {
  id: string
  time: number
  seq: string
  type: StreamRecordType
  source: string
  service: StreamService
  value?: any
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

export interface IBackoffOptions {
  initialDelay?: number
  maxAttempts?: number
  maxTime?: number
  maxDelay?: number
  factor?: number
  logger?: Logger
  shouldTryAgain?: (err?:Error) => boolean
}

export interface IKeyValueStore {
  exists: (key: string) => Promise<boolean>
  get: (key: string, opts?:any) => Promise<any>
  put: (key: string, value:any) => Promise<void|any>
  del: (key: string, opts?:any) => Promise<void>
  update?: (key: string, opts?:any) => Promise<void|any>
  sub?: (prefix: string) => IKeyValueStore
}

export interface IUser {
  id: string
  [key:string]: any
}

export interface IBotMessageEvent {
  bot: Bot
  user: IUser
  message: ITradleMessage
  payload: ITradleObject
  object: ITradleObject
  type: string
  link: string
  permalink: string
}

export interface ISaveEventPayload {
  value: any // should really be ITradleObject
  old?: any  // should really be ITradleObject
}

export interface IModelsMixinTarget {
  models: Models
  [key: string]: any
}

export interface IHasModels {
  buildResource: (model: string|Model) => any
  buildStub: (resource: ITradleObject) => ResourceStub
  validateResource: (resource: ITradleObject) => void
  validatePartialResource: (resource: ITradleObject) => void
  getModel: (id: string) => Model
}

export interface IBacklinkItem {
  target: ResourceStub
  source: ResourceStub
  linkProp: string
  backlinkProps: string[]
  _time?: number
}

type KVPair = [string, string]

export interface ISecretStore {
  get(name: string): Promise<string>
  multiGet(names: string[]): Promise<string[]>
  put(name: string): Promise<void>
  putMulti(pairs: KVPair[]): Promise<void>
}

export type BucketCopyOpts = {
  source: string
  target: string
  prefix?: string
  keys?: string[]
  acl?: AWS.S3.ObjectCannedACL
}

export type BucketPutOpts = {
  key:string
  value:any
  bucket:string
  headers?:any
  acl?: AWS.S3.ObjectCannedACL
}

export type PresignEmbeddedMediaOpts = {
  object: ITradleObject
  stripEmbedPrefix?: boolean
}

export type EnumValueStub = {
  id: string
  title?: string
}

export type StackStatusEvent = {
  stackId: string
  timestamp: number
  status: AWS.CloudFormation.ResourceStatus
  resourceType: AWS.CloudFormation.ResourceType
  resourceId: string
  resourceName: string
  subscriptionArn: string
}

export type Job = {
  name: string
  period?: number // seconds
  input?: any
  requiresComponents?: string[]
  [x: string]: any
}

export type VersionInfo = {
  tag: string
  sortableTag: string
  branch: string
  commit: string
  commitsSinceTag: number
  time: string
  templateUrl?: string
  alert?: boolean
  templatesPath?: string
}

export interface Registry<T> {
  get: (name:string) => T
  set: (name:string, T) => void
  keys: () => string[]
}

export type CloudWatchLogsEntry = {
  id: string
  timestamp: number
  message: string
  extractedFields: any
}

export type CloudWatchLogsEvent = {
  messageType: 'DATA_MESSAGE'|'CONTROL_MESSAGE'
  owner: string // accountId
  logGroup: string
  logStream: string
  subscriptionFilters: string[]
  logEvents: CloudWatchLogsEntry[]
}

export type SNSEventRecord = {
  EventVersion: string
  EventSubscriptionArn: string
  EventSource: string
  Sns: {
    SignatureVersion: string
    Timestamp: string
    Signature: string
    SigningCertUrl: string
    MessageId: string
    Message: string
    MessageAttributes: any,
    Type: string
    UnsubscribeUrl: string
    TopicArn: string
    Subject: string
  }
}

export type SNSEvent = {
  Records: SNSEventRecord[]
}

export interface SNSMessage {
  default: any
  email?: any
  lambda?: any
}

export interface SendSMSOpts {
  phoneNumber: string
  message: string
  senderId?: string
  highPriority?: boolean
}

export interface ECKey {
  sign: (data, algorithm, callback) => void
  signSync: (data, algorithm?) => void
  promiseSign: (data, algorithm?) => Promise<string>
  verify: (data, algorithm, sig, callback) => void
  promiseVerify: (data, algorithm, sig) => Promise<boolean>
  toJSON: (exportPrivateKey?: boolean) => any
}

export interface BlockchainAddressIdentifier extends IBlockchainIdentifier {
  address: string
}

export interface LowFundsInput extends BlockchainAddressIdentifier {
  blockchain: string
  networkName: string
  address: string
  balance?: string|number
  minBalance?: string|number
}

export interface CFTemplateParameter {
  Type: string
  Description?: string
  Default?: string
  AllowedValues?: string[]
}

export interface CFTemplateResource {
  Type: string
  Description?: string
  Properties?: any
  DeletionPolicy?: 'Delete'|'Replace'|'Retain'
}

export interface CFTemplate {
  Description?: string
  Parameters?: {
    [key: string]: CFTemplateParameter
  }
  Mappings?: any
  Conditions?: any
  Resources: {
    [key: string]: CFTemplateResource
  }
}

export interface MyCloudUpdateTemplate extends CFTemplate {
  Parameters: {
    [p in keyof StackLaunchParameters]: CFTemplateParameter
  },
}

export interface MyCloudLaunchTemplate extends CFTemplate {
  Parameters: {
    [p in keyof StackUpdateParameters]: CFTemplateParameter
  },
  Mappings: {
    deployment: {
      init: {
        stackName: string
        referrerUrl: string
        deploymentUUID: string
      }
    }
  },
  Resources: {
    Initialize: {
      Type: string
      Properties: {
        ServiceToken: string
        commit: string
        name: string
        domain: string
        logo: string
        deploymentUUID: string
        referrerUrl: string
        ImmutableParameters: {
          Stage: string
          BlockchainNetwork: string
          EncryptTables: string
        }
      }
    },
    [key: string]: CFTemplateResource
  }
}

export interface StackUpdateParameters {
  // Stage: 'dev'|'prod'
  SourceDeploymentBucket: string
}

export interface StackLaunchParameters extends StackUpdateParameters {
  BlockchainNetwork: string
  OrgName: string
  OrgDomain: string
  OrgLogo: string
  OrgAdminEmail: string
}
