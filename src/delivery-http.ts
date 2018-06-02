import yn from 'yn'
import { EventEmitter } from 'events'
import { TYPE } from '@tradle/constants'
import { post, promiseNoop, timeoutIn, tryUntilTimeRunsOut, gzip } from './utils'
import { IDelivery, ILiveDeliveryOpts, ITradleMessage, Logger, Env, DB, IDeliveryMessageRange } from "./types"
import Errors from './errors'
import { RetryableTask } from './retryable-task'

const COMPRESSION_THRESHOLD = 1024
const FETCH_TIMEOUT = 10000
const INITIAL_BACKOFF = 1000
const DELIVERY_ERROR = 'tradle.DeliveryError'

export default class Delivery extends EventEmitter implements IDelivery {
  private env:Env
  private logger:Logger
  private db:DB
  constructor({ env, logger, db }: {
    env: Env,
    logger: Logger
    db: DB
  }) {
    super()
    this.env = env
    this.logger = logger
    this.db = db
  }

  public ack = promiseNoop
  public reject = (opts: { reason: Error }) => Promise.reject(opts.reason)
  public deliverBatch = async (opts:ILiveDeliveryOpts) => {
    const { recipient, friend, messages, timeout } = opts
    const endpoint = `${friend.url}/inbox`
    const headers = {}
    let payload = JSON.stringify({ messages })
    if (!this.env.IS_OFFLINE && payload.length > COMPRESSION_THRESHOLD) {
      this.logger.debug('gzipping payload')
      payload = await gzip(payload)
      headers['Content-Encoding'] = 'gzip'
    }

    const maxTime = this.env.getRemainingTime() - 1000
    if (maxTime < 0) {
      await this._onFailedToDeliver({
        message: messages[0],
        error: new Errors.Timeout(`didn't even have time to try`)
      })

      return
    }

    const task = new RetryableTask({
      shouldTryAgain: err => {
        this.logger.warn(`failed to deliver message`, { error: err.stack, message: messages[0]._link })
        return !Errors.isDeveloperError(err)
      },
      initialDelay: Math.min(INITIAL_BACKOFF, maxTime),
      attemptTimeout: Math.min(FETCH_TIMEOUT, maxTime),
      timeout: maxTime,
      maxAttempts: 3
    })

    try {
      await task.run(() => this._post(endpoint, payload, { headers }))
    } catch (error) {
      await this._onFailedToDeliver({ message: messages[0], error })
      return
    }

    // kind of shame to do this every time
    // but otherwise we need to lookup whether we have an error or not beforehand
    await this.deleteError({ counterparty: recipient })

    // await tryUntilTimeRunsOut(() => post(endpoint, payload, { headers }), {
    //   env: this.env,
    //   attemptTimeout: FETCH_TIMEOUT,
    //   onError: (err:Error) => {
    //     this.logger.error('failed to deliver messages', err)
    //   }
    // })

    this.logger.debug(`delivered ${messages.length} messages to ${recipient}`)
    // let timedOut
    // const timer = setTimeout(() => {
    //   timedOut = true
    // }, timeout)

    // while (!timedOut) {
    //   try {
    //     await Promise.race([
    //       post(endpoint, { messages }),
    //       timeoutIn(FETCH_TIMEOUT)
    //     ])
    //   } catch (err) {
    //     this.logger.error('failed to deliver messages', err)
    //     Errors.ignore(err, Errors.Timeout)
    //   }
    // }
  }

  // for testing
  public _post = post

  // public for testing
  public _onFailedToDeliver = async ({ message, error }: {
    message: ITradleMessage
    error: Error
  }) => {
    Errors.rethrow(error, 'developer')
    const opts = {
      counterparty: message._counterparty,
      time: message._time
    }

    try {
      await this.saveError(opts)
    } catch (err) {
      Errors.ignore(err, Errors.Exists)
      this.logger.debug('failed to save DeliveryError, one already exists', opts)
    }
  }

  public saveError = async ({ counterparty, time }: {
    counterparty: string
    time: number
  }) => {
    try {
      await this.db.put({
        [TYPE]: DELIVERY_ERROR,
        counterparty,
        _time: time
      }, {
        // only store one per counterparty
        ExpressionAttributeNames: {
          '#counterparty': 'counterparty'
        },
        ConditionExpression: 'attribute_not_exists(#counterparty)'
      })
    } catch (err) {
      Errors.ignoreUnmetCondition(err)
      throw new Errors.Exists(`error for counterparty ${counterparty}`)
    }
  }

  public getError = async (counterparty) => {
    return await this.db.get({
      [TYPE]: DELIVERY_ERROR,
      counterparty
    })
  }

  public getErrors = async () => {
    const { items } = await this.db.find({
      filter: {
        EQ: {
          [TYPE]: DELIVERY_ERROR
        }
      }
    })

    return items
  }

  public deleteError = async (deliveryErr) => {
    await this.db.del({
      [TYPE]: DELIVERY_ERROR,
      ...deliveryErr
    })
  }

  public getRangeFromError = ({ _time }: {
    _time: number
  }):IDeliveryMessageRange => ({
    after: _time - 1
  })
}

export { Delivery }
