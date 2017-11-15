import { EventEmitter } from 'events'

export interface IPosition {
  sent?: number
  received?: number
}

export interface ISession {
  clientId: string
  permalink: string
  challenge: string
  authenticated: boolean
  time: number
  connected: boolean
  clientPosition?: IPosition
  serverPosition?: IPosition
}

export interface IotClientResponse {
  iotEndpoint: string
  iotParentTopic: string
  challenge: string
  time: number
  region: string
  accessKey: string
  secretKey: string
  sessionToken: string
  uploadPrefix: string
  s3Endpoint?: string
}

export interface ILambdaExecutionContext {
  callbackWaitsForEmptyEventLoop: boolean
  logGroupName:                   string
  logStreamName:                  string
  functionName:                   string
  memoryLimitInMB:                string
  functionVersion:                string
  invokeid:                       string
  awsRequestId:                   string
  invokedFunctionArn:             string
}

export interface ITradleObject {
  _sigPubKey: string
  _link?: string
  _permalink?: string
  _author?: string
  _time?: number
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

export interface IDelivery {
  deliverBatch: (
    opts: {
      recipient: string
      messages: ITradleMessage[]
      friend?: any
    }
  ) => Promise<any>
  ack: (opts: any) => Promise<any>
  reject: (opts: any) => Promise<any>
}

export interface IDeliverBatchRequest {
  recipient: string
  messages: ITradleMessage[]
  friend?: any
  clientId?: string
}

export interface IDeliveryResult {
  finished: boolean
  range: IDeliveryMessageRange
}

export interface IDeliveryRequest {
  recipient: string
  range: IDeliveryMessageRange
  batchSize?: number
  clientId?: any
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
