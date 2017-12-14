import Promise = require('bluebird')
import { settle } from 'settle-promise'
import Logger from './logger'

export type Task = {
  name: string
  promiser: (...any) => Promise<void|any>
  promise?: Promise<any|void>
}

const RESOLVED = Promise.resolve()

export class TaskManager {
  private tasks:Task[]

  constructor(opts={}) {
    this.logger = opts.logger || new Logger('task-manager')
    this.tasks = []
  }

  public add = (task: Task) => {
    this.logger.debug('add', { name: task.name })

    const promise = task.promise || RESOLVED.then(task.promiser)
    task = { ...task, promise }
    const start = Date.now()
    promise
      .then(result => {
        this.logger.debug('task completed', {
          name: task.name,
          time: Date.now() - start
        })
      })
      .catch(err => {
        this.logger.warn('task failed', {
          name: task.name,
          stack: err.stack
        })
      })
      .finally(() => {
        this.tasks.splice(this.tasks.indexOf(task), 1)
      })

    this.tasks.push(task)
    return promise
  }

  public awaitAll = async () => {
    if (!this.tasks.length) return []

    this.logger.debug(`waiting for ${this.tasks.length} tasks to complete`)
    return await Promise.all(this.tasks.map(task => task.promise))
  }

  public awaitAllSettled = async () => {
    if (!this.tasks.length) return []

    this.logger.debug(`waiting for ${this.tasks.length} tasks to complete or fail`)
    const names = this.tasks.map(task => task.name)
    const results = await settle(this.tasks.map(task => task.promise))
    results.forEach((result, i) => {
      result.task = names[i].name
    })

    return results
  }
}
