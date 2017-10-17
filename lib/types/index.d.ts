import { EventEmitter } from 'events'

export interface Position {
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
  clientPosition?: Position
  serverPosition?: Position
}

export interface IotClientResponse {
  iotEndpoint: string
  iotTopicPrefix: string
  challenge: string
  time: number
  region: string
  accessKey: string
  secretKey: string
  sessionToken: string
  uploadPrefix: string
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

export interface IDelivery {
  deliverBatch: (
    opts: {
      recipient: string
      messages: any[]
      friend?: any
    }
  ) => Promise<any>
  ack: (opts: any) => Promise<any>
  reject: (opts: any) => Promise<any>
}

export interface IDeliverBatchRequest {
  recipient: string
  messages: Array<any>
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
  friend?: any
}

export interface IDeliveryMessageRange {
  after?: number
  before?: number
  afterMessage?: string
}

export interface ITradleObject {
  _sigPubKey: string
  _link?: string
  _permalink?: string
  _author?: string
  _time?: number
}

export interface IECMiniPubKey {
  pub: Buffer
  curve: string
}

export interface ITradleMessage extends ITradleObject {
  recipientPubKey: IECMiniPubKey
  object: ITradleObject
  time: number
  _recipient?: string
  _inbound?: boolean
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
