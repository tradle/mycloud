import pick from 'lodash/pick'
import groupBy from 'lodash/groupBy'
import forEach from 'lodash/forEach'
import map from 'lodash/map'
import notNull from 'lodash/identity'
import { TYPE } from '@tradle/constants'
import { DB, IKeyValueStore } from './types'
import Errors from './errors'

const STATE_TYPE = 'tradle.cloud.StreamProcessingError'

type StreamProcessorOpts = {
  store: IKeyValueStore
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
}

export default class StreamProcessor {
  private store: IKeyValueStore
  constructor({ store }: StreamProcessorOpts) {
    this.store = store
  }

  public processBatch = async ({ batch, worker }: ProcessBatchOpts) => {
    const batchId = batch[0].id
    let checkpoint:IErrorCheckpoint
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
      try {
        await worker(event)
        // we've passed the checkpoint!
        checkpoint.eventId = null
        checkpoint.errors = []
      } catch (error) {
        debugger
        checkpoint.eventId = event.id
        checkpoint.errors.push(pick(error, ['message', 'stack']))
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
