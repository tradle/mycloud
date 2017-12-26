// @ts-ignore
import Promise = require('bluebird')
import { omit } from 'lodash'
import { settle } from 'settle-promise'
import Logger from './logger'
import Errors = require('./errors')
import {
  ISettledPromise
} from './types'

export interface ITaskResult extends ISettledPromise {
  name: string
}

export type Task = {
  name: string
  promiser?: (...any) => Promise<void|any>
  promise?: Promise<any|void>
  retryOnFail?: boolean
}

const RESOLVED = Promise.resolve()

export class TaskManager {
  private tasks:Task[]
  private logger: Logger

  constructor({ logger }: { logger?:Logger }={}) {
    this.logger = logger || new Logger('task-manager')
    this.tasks = []
  }

  public add = (task: Task) => {
    this.logger.debug('add', { name: task.name })

    if (task.retryOnFail && !task.promiser) {
      throw new Error('expected "promiser"')
    }

    const promise = task.promise || RESOLVED.then(() => task.promiser())
    task = { ...task, promise }
    this.monitorTask(task)
    this.tasks.push(task)
    return promise
  }

  public awaitAll = async () => {
    if (!this.tasks.length) return []

    this.logger.debug(`waiting for ${this.tasks.length} tasks to complete`)
    return await Promise.all(this.tasks.map(task => task.promise))
  }

  public awaitAllSettled = async ():Promise<ITaskResult> => {
    if (!this.tasks.length) return []

    this.logger.debug(`waiting for ${this.tasks.length} tasks to complete or fail`)
    const names = this.tasks.map(task => task.name)
    const results:ISettledPromise[] = await settle(this.tasks.map(task => task.promise))
    results.forEach(({ reason }) => {
      if (reason && Errors.isDeveloperError(reason)) {
        this.logger.warn('developer error', Errors.export(reason))
      }
    })

    return results.map((result, i) => ({
      ...result,
      name: names[i]
    }))
  }

  private monitorTask = async (task) => {
    const start = Date.now()
    try {
      await task.promise
      this.logger.debug('task completed', {
        name: task.name,
        time: Date.now() - start
      })
    } catch (err) {
      this.logger.warn('task failed', {
        name: task.name,
        stack: err.stack
      })

      if (task.retryOnFail) {
        this.add(omit(task, ['promise']) as Task)
      }
    } finally {
      this.tasks.splice(this.tasks.indexOf(task), 1)
    }
  }
}
