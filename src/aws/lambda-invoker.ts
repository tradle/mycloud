import { FirstArgument } from '@tradle/aws-common-utils'
import { LambdaClient, Logger } from '../types'
import {
  DEFAULT_WARMUP_EVENT,
  WARMUP_FUNCTION,
  REINITIALIZE_CONTAINERS_FUNCTION,
  SEALPENDING_FUNCTION,
  POLLCHAIN_FUNCTION
} from '../constants'

export interface LambdaInvokerOpts {
  client: LambdaClient
  logger: Logger
  lambdaPrefix?: string
}

export class LambdaInvoker {
  constructor(private opts: LambdaInvokerOpts) {}

  private getFunctionArn = (name: string) => (this.opts.lambdaPrefix || '') + name
  public invoke = (opts: FirstArgument<LambdaClient['invoke']>) => {
    const { logger, client } = this.opts
    const arn = this.getFunctionArn(opts.name)
    logger.debug('invoking', {
      shortName: opts.name,
      arn
    })

    return client.invoke({ ...opts, name: arn })
  }

  public scheduleReinitializeContainers = async (functions?: string[]) => {
    return await this.invoke({
      name: REINITIALIZE_CONTAINERS_FUNCTION,
      sync: false,
      arg: {
        name: 'reinitializeContainers',
        input: functions
      }
    })
  }

  public scheduleWarmUp = async (event = DEFAULT_WARMUP_EVENT) => {
    return await this.invoke({
      name: WARMUP_FUNCTION,
      arg: {
        name: 'warmup',
        input: event
      },
      sync: false
    })
  }

  public invokeSealPending = async () => {
    return await this.invoke({
      name: SEALPENDING_FUNCTION,
      sync: true,
      arg: {
        name: 'sealpending'
      }
    })
  }

  public scheduleSealPending = async () => {
    return await this.invoke({
      name: SEALPENDING_FUNCTION,
      sync: false,
      arg: {
        name: 'sealpending'
      }
    })
  }

  public invokePollChain = async () => {
    return await this.invoke({
      name: POLLCHAIN_FUNCTION,
      sync: true,
      arg: {
        name: 'pollchain'
      }
    })
  }

  public schedulePollChain = async () => {
    return await this.invoke({
      name: POLLCHAIN_FUNCTION,
      sync: false,
      arg: {
        name: 'pollchain'
      }
    })
  }
}

export const createLambdaInvoker = (opts: LambdaInvokerOpts) => new LambdaInvoker(opts)
