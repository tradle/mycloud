import { EventEmitter } from 'events'

export interface Position {
  sent?: number
  received?: number
}

export interface Session {
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

export * from './identities'
export * from './auth'
export * from './delivery'
export * from './discovery'
export * from './errors'
