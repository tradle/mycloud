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

interface IError {
  laneId: string
  eventId: string
  message: string
}

interface IErrorCheckpoint {
  errors: any[]
}

interface IEvent {
  id: string
  laneId?: string
  [x: string]: any
}

type ProcessBatchOpts = {
  batch: IEvent[]
  processOne(item: IEvent): Promise<void>
}

export default class StreamProcessor {
  private store: IKeyValueStore
  constructor({ store }: StreamProcessorOpts) {
    this.store = store
  }

  public processBatch = async ({ batch, processOne }: ProcessBatchOpts) => {
    const batchId = batch[0].id
    // lanes run in parallel
    const byLane = groupBy(batch, 'laneId')

    let checkpoint:IErrorCheckpoint
    try {
      checkpoint = await this.store.get(batchId)
    } catch (err) {
      Errors.ignoreNotFound(err)
      checkpoint = { errors: [] }
    }

    let { errors } = checkpoint
    if (errors.length) {
      forEach(byLane, (laneBatch, laneId) => {
        const idx = errors.findIndex(e => e.laneId === laneId)
        if (idx === -1) {
          // shouldn't happen
        } else {
          byLane[laneId] = laneBatch.slice(idx)
        }
      })
    }

    errors = await Promise.all(map(byLane, async (laneBatch, laneId) => {
      for (const event of laneBatch) {
        try {
          await processOne(event)
        } catch (error) {
          return { laneId, eventId: event.id, message: error.message }
        }
      }
    }))

    errors = errors.filter(notNull)
    if (errors.length) {
      await this.store.put(batchId, {
        ...checkpoint,
        errors
      })
    } else {
      await this.store.del(batchId)
    }
  }
}

export { StreamProcessor }

// const createStreamState = props => ({
//   [TYPE]: STATE_TYPE,
//   ...props
// })
