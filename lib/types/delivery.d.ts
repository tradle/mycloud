import { EventEmitter } from "events"

export interface IDelivery {
  deliverBatch: (
    opts: {
      recipient: string
      messages: Array<any>
    }
  ) => Promise<any>
  ack: (opts: any) => Promise<any>
  reject: (opts: any) => Promise<any>
}

export class Delivery extends EventEmitter implements IDelivery {
  deliverBatch: (
    opts: {
      recipient: string
      messages: Array<any>
    }
  ) => Promise<any>
  ack: (opts: any) => Promise<any>
  reject: (opts: any) => Promise<any>
}
