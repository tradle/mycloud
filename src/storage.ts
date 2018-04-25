import cloneDeep from 'lodash/cloneDeep'
import { TYPE } from '@tradle/constants'
import Errors from './errors'
import {
  DB,
  Objects,
  Logger,
  ISaveObjectOpts
} from './types'

import {
  ensureTimestamped,
  RESOLVED_PROMISE
} from './utils'

type StorageOpts = {
  db: DB
  objects: Objects
  logger: Logger
}

export default class Storage {
  public db: DB
  public objects: Objects
  private logger: Logger
  constructor({
    db,
    objects,
    logger
  }: StorageOpts) {
    this.db = db
    this.objects = objects
    this.logger = logger
  }

  public save = async ({ object, diff, saveToObjects, saveToDB }: ISaveObjectOpts) => {
    object = cloneDeep(object)
    this.objects.addMetadata(object)
    ensureTimestamped(object)
    await this.objects.replaceEmbeds(object)
    await Promise.all([
      saveToObjects === false ? RESOLVED_PROMISE : this.objects.put(object),
      saveToDB === false ? RESOLVED_PROMISE : this.putInDB({ object, diff })
    ])

    return object
  }

  private putInDB = async ({ object, diff }: ISaveObjectOpts) => {
    // const inbound = await this.isAuthoredByMe(object)
    const type = object[TYPE]

    let table
    try {
      table = await this.db.getTableForModel(type)
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.debug(`not saving "${type}", don't have a table for it`, Errors.export(err))
      return false
    }

    if (diff) {
      throw new Errors.Unsupported('update via "diff" is not supported at this time')
      // await this.db.update(object, { diff })
    } else {
      await this.db.put(object)
    }

    return true
  }
}

export { Storage }
