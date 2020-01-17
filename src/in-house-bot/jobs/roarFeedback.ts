import {
  Bot,
  Logger,
  IBotConf,
} from '../types'

import BoxSDK from 'box-node-sdk'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const RESPONSES = 'RESPONSES'
const PROCESSED_RESPONSES = 'PROCESSED_RESPONSES'

export class RoarFeedback {

  private bot: Bot
  private logger: Logger
  private token: string

  constructor(bot: Bot, conf: IBotConf) {
    this.bot = bot
    this.logger = bot.logger
    let jobs: any = conf['jobs']
    if (jobs) {
      let roarFeedbackConf = jobs.roarFeedback
      if (roarFeedbackConf)
        this.token = roarFeedbackConf.token
    }
  }

  pullResponses = async () => {
    if (!this.token)
      throw Error('')
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
      if (entry.type == 'file' && entry.name.endsWith('_response.json')) {
        let jsonResponse = await this.downloadFile(entry.id, client)

      }
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