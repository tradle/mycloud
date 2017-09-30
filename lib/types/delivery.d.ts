import { EventEmitter } from "events"
export interface IDelivery extends EventEmitter {
  public deliverBatch: (
    opts: {
      recipient: string
      messages: Array<any>
    }
  ) => Promise<any>
  public ack: (opts: any) => Promise<any>
  public reject: (opts: any) => Promise<any>
}
