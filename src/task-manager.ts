// @ts-ignore
import Promise from 'bluebird'
import { omit, partition } from 'lodash'
import { allSettled } from './utils'
import Logger from './logger'
import Errors from './errors'
import {
  ISettledPromise
} from './types'

export interface ITaskResult<T> extends ISettledPromise<T> {
  name: string
}

export type Task = {
  name: string
  promiser?: (...any) => Promise<void|any>
  promise?: Promise<any|void>
  retryOnFail?: boolean
}

const RESOLVED = Promise.resolve()

export default class TaskManager {
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

  public describe = ():string[] => {
    return this.tasks.map(({ name }) => name)
  }

  public awaitAllSettled = async ():Promise<ITaskResult<any>> => {
    if (!this.tasks.length) {
      this.logger.silly(`no async tasks!`)
      return []
    }

    const names = this.tasks.map(task => task.name)
    this.logger.debug(`waiting for ${names.length} tasks to complete or fail`)
    const results:ISettledPromise<any>[] = await allSettled(this.tasks.map(task => task.promise))
    const [succeeded, failed] = partition(results, r => r.isFulfilled)
    this.logger.debug(`of ${names.length} tasks, ${succeeded.length} succeeded and ${failed.length} failed`)
    return results.map((result, i) => ({
      ...result,
      name: names[i]
    }))
  }

  public length = () => this.tasks.length

  private monitorTask = async (task) => {
    const start = Date.now()
    try {
      await task.promise
      this.logger.debug('task completed', {
        name: task.name,
        time: Date.now() - start
      })
    } catch (err) {
      if (Errors.isDeveloperError(err)) {
        this.logger.error('developer error', Errors.export(err))
      } else {
        this.logger.warn('error', Errors.export(err))
      }

      if (task.retryOnFail) {
        this.add(omit(task, ['promise']) as Task)
      }
    } finally {
      this.tasks.splice(this.tasks.indexOf(task), 1)
    }
  }
}

export { TaskManager }
