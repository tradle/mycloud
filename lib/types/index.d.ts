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

export type IDebug = (...any) => void
