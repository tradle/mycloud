import {
  Bot,
  Logger,
  IBotConf,
} from '../types'

import { TYPE } from '@tradle/constants'
import { enumValue } from '@tradle/build-resource'
import BoxSDK from 'box-node-sdk'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const RESPONSES = 'RESPONSES'
const PROCESSED_RESPONSES = 'PROCESSED_RESPONSES'
const SCREENING_CHECK = 'tradle.RoarScreeningCheck'
const STATUS = 'tradle.Status'

export class RoarFeedback {

  private bot: Bot
  private conf: IBotConf
  private logger: Logger
  private token: string
  private trace: boolean

  constructor(bot: Bot, conf: IBotConf) {
    this.bot = bot
    this.logger = bot.logger
    let jobs: any = conf['jobs']
    if (jobs) {
      let roarFeedbackConf = jobs.roarFeedback
      if (roarFeedbackConf) {
        this.token = roarFeedbackConf.token
        this.trace = roarFeedbackConf.trace
      }
    }
  }

  pullResponses = async () => {
    this.logger.debug('roarFeedback pullResponses starts')
    if (!this.token)
      throw Error('token is not provided')
    const client: any = BoxSDK.getBasicClient(this.token)
    let res = await client.folders.get('0')
    let responsesFolderId: string
    let processedResponsesFolderId: string
    for (let elem of res.item_collection.entries) {
      if (RESPONSES == elem.name) {
        responsesFolderId = elem.id
      }
      else if (PROCESSED_RESPONSES == elem.name) {
        processedResponsesFolderId = elem.id
      }
    }
    if (!responsesFolderId) {
      this.logger.error('roarFeedback could not find box folder RESPONSES')
      return
    }
    if (!processedResponsesFolderId) {
      this.logger.error('roarFeedback could not find box folder PROCESSED_RESPONSES')
      return
    }

    let folder = await client.folders.get(responsesFolderId)
    for (let entry of folder.item_collection.entries) {
      let name: string = entry.name
      if (entry.type == 'file' && name.endsWith('_response.json')) {
        let jsonResponse = await this.downloadFile(entry.id, client)
        if (this.trace)
          this.logger.debug(`roarFeedback handling response: ${JSON.stringify(jsonResponse, null, 2)}`)
        let status = jsonResponse.RecommendtoOnBoard == 'YES' ? 'pass' : 'fail'
        let statusEnum = enumValue({
          model: this.bot.models[STATUS],
          value: status
        })
        let permalink = name.substring(0, name.indexOf('_'))
        let check: any = await this.findCheck(permalink)
        if (check) {
          check.responseData = sanitize(jsonResponse).sanitized
          check.status = statusEnum
          if (this.trace)
            this.logger.debug(`roarFeedback updating check with response ${JSON.stringify(check, null, 2)}`)
          else
            this.logger.debug(`roarFeedback updating check with response`)
          await this.bot.versionAndSave(check)
          this.logger.debug('roarFeedback check updated')

          // move file to processed responses
          await client.files.move(entry.id, processedResponsesFolderId)
          this.logger.debug('roarFeedback moved request into processed')
        }
      }
    }
  }

  findCheck = async (permalink: string) => {
    try {
      return await this.bot.db.findOne({
        filter: {
          EQ: {
            [TYPE]: SCREENING_CHECK,
            '_permalink': permalink
          }
        }
      })
    } catch (err) {
      this.logger.error(`roarFeedback failed to find check matching to ${permalink}`)
      return undefined
    }
  }

  downloadFile = async (id: string, client: any) => {
    let response: string = await new Promise((resolve, reject) => {
      let data = []
      client.files.getReadStream(id, null, function (error: any, stream: any) {
        if (error) {
          reject(error)
          return
        }
        stream.on('data', (chunk: any) => {
          data.push(chunk)
        })
          .on('end', () => {
            let buff = data.join('')
            resolve(buff.toString())
          })
      })
    })
    return JSON.parse(response)
  }
}