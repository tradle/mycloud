import { EventEmitter } from 'events'
import Logger from '../logger'

export interface ISettledPromise {
  isFulfilled: boolean
  isRejected: boolean
  value?: any
  reason?: Error
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

export interface IDeliverBatchRequest {
  timeout: number
  recipient: string
  messages: ITradleMessage[]
  friend?: any
  session?: ISession
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

export type ResourceStub = {
  id: string
  title?: string
}

export type ParsedResourceStub = {
  type: string
  link: string
  permalink: string
  title?: string
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
