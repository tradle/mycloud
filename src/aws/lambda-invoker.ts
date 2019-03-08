import { LambdaClient } from '../types'
import {
  DEFAULT_WARMUP_EVENT,
  WARMUP_FUNCTION,
  REINITIALIZE_CONTAINERS_FUNCTION,
  SEALPENDING_FUNCTION,
  POLLCHAIN_FUNCTION
} from '../constants'

export interface LambdaInvokerOpts {
  client: LambdaClient
}

export class LambdaInvoker {
  private client: LambdaClient
  constructor({ client }: LambdaInvokerOpts) {
    this.client = client
  }

  public scheduleReinitializeContainers = async (functions?: string[]) => {
    return await this.client.invoke({
      name: REINITIALIZE_CONTAINERS_FUNCTION,
      sync: false,
      arg: {
        name: 'reinitializeContainers',
        input: functions
      }
    })
  }

  public scheduleWarmUp = async (event = DEFAULT_WARMUP_EVENT) => {
    return await this.client.invoke({
      name: WARMUP_FUNCTION,
      arg: {
        name: 'warmup',
        input: event
      },
      sync: false
    })
  }

  public invokeSealPending = async () => {
    return await this.client.invoke({
      name: SEALPENDING_FUNCTION,
      sync: true,
      arg: {
        name: 'sealpending'
      }
    })
  }

  public scheduleSealPending = async () => {
    return await this.client.invoke({
      name: SEALPENDING_FUNCTION,
      sync: false,
      arg: {
        name: 'sealpending'
      }
    })
  }

  public invokePollChain = async () => {
    return await this.client.invoke({
      name: POLLCHAIN_FUNCTION,
      sync: true,
      arg: {
        name: 'pollchain'
      }
    })
  }

  public schedulePollChain = async () => {
    return await this.client.invoke({
      name: POLLCHAIN_FUNCTION,
      sync: false,
      arg: {
        name: 'pollchain'
      }
    })
  }
}

export const createLambdaInvoker = (opts: LambdaInvokerOpts) => new LambdaInvoker(opts)
