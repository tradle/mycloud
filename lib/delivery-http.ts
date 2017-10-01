import { EventEmitter } from "events"
const debug = require("debug")("tradle:sls:delivery-http")
const { post, promiseNoop } = require("./utils")
import { IDelivery } from "./types"

export default class Delivery extends EventEmitter implements IDelivery {
  constructor(opts: { objects: any }) {
    super()
  }

  public ack = promiseNoop
  public reject = (opts: { reason: Error }) => Promise.reject(opts.reason)
  public deliverBatch = async (opts: { friend: any; recipient: string; messages: Array<any> }) => {
    const { friend, messages } = opts
    const endpoint = `${friend.url}/inbox`
    await post(endpoint, { messages })
  }
}
