import { EventEmitter } from "events"
export interface IDelivery extends EventEmitter {
  deliverBatch: (
    opts: {
      recipient: string
      messages: Array<any>
    }
  ) => Promise<any>
  ack: (opts: any) => Promise<any>
  reject: (opts: any) => Promise<any>
}
