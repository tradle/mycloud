import typeforce from "typeforce"
import pick from "lodash/pick"
import { KeyValueStore } from "./types"
import Errors from "./errors"
import { runWithTimeout } from "./utils"

const STATE_TYPE = "tradle.cloud.StreamProcessingError"

type StreamProcessorOpts = {
  store: KeyValueStore
}

interface IErrorCheckpoint {
  eventId: string
  errors: any[]
}

interface IEvent {
  id: string
  [x: string]: any
}

type ProcessBatchOpts = {
  batch: IEvent[]
  worker(item: IEvent): Promise<void>
  perItemTimeout?: number
  timeout?: number
}

export default class StreamProcessor {
  private store: KeyValueStore
  constructor({ store }: StreamProcessorOpts) {
    this.store = store
  }

  public processBatch = async (opts: ProcessBatchOpts) => {
    typeforce(
      {
        batch: "Array",
        worker: "Function",
        perItemTimeout: "Number",
        timeout: "Number"
      },
      opts
    )

    let { batch, worker, perItemTimeout, timeout } = opts
    const start = Date.now()
    const batchId = batch[0].id
    let checkpoint: IErrorCheckpoint
    try {
      checkpoint = await this.store.get(batchId)
    } catch (err) {
      Errors.ignoreNotFound(err)
      checkpoint = { eventId: null, errors: [] }
    }

    if (checkpoint.eventId) {
      // start from last failed event
      const idx = batch.findIndex(e => e.id === checkpoint.eventId)
      if (idx === -1) {
        // oops, i guess we're past that batch?
      } else {
        batch = batch.slice(idx)
      }
    }

    for (const event of batch) {
      const timeLeft = timeout - (Date.now() - start)
      try {
        if (timeLeft < perItemTimeout) {
          throw new Errors.Timeout(`aborted mid-batch, almost out of time`)
        }

        await runWithTimeout(() => worker(event), {
          millis: perItemTimeout
        })

        // we've passed the checkpoint!
        checkpoint.eventId = null
        checkpoint.errors = []
      } catch (error) {
        checkpoint.eventId = event.id
        checkpoint.errors.push(pick(error, ["message", "stack"]))
        break
      }
    }

    if (checkpoint.eventId) {
      await this.store.put(batchId, checkpoint)
    } else {
      await this.store.del(batchId)
    }
  }
}

export { StreamProcessor }
