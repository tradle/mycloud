import {
  Bot,
  Logger,
  IBotConf,
} from '../types'

import { TYPE } from '@tradle/constants'
import { enumValue } from '@tradle/build-resource'
//import BoxSDK from 'box-node-sdk'
import fetch from 'node-fetch'
import validateResource from '@tradle/validate-resource'
import dateformat from 'dateformat'

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
    let entries
    let cnt = 0;
    while (true) {
      try {
        entries = await this.folderEntries('0')
        break;
      } catch (err) {
        if (++cnt < 3)
          this.sleep(10000)
        else
          break
      }
    }
    let responsesFolderId: string
    let processedResponsesFolderId: string
    for (let entry of entries) {
      if (entry.name == RESPONSES) {
        responsesFolderId = entry.id
      }
      else if (entry.name == PROCESSED_RESPONSES) {
        processedResponsesFolderId = entry.id
      }
    }

    /*
    const client: any = BoxSDK.getBasicClient(this.token)
    let res = await client.folders.get('0')
   
    for (let elem of res.item_collection.entries) {
      if (RESPONSES == elem.name) {
        responsesFolderId = elem.id
      }
      else if (PROCESSED_RESPONSES == elem.name) {
        processedResponsesFolderId = elem.id
      }
    }
    */

    if (!responsesFolderId) {
      this.logger.error('roarFeedback could not find box folder RESPONSES')
      return
    }
    if (!processedResponsesFolderId) {
      this.logger.error('roarFeedback could not find box folder PROCESSED_RESPONSES')
      return
    }

    //let folder = await client.folders.get(responsesFolderId)
    //for (let entry of folder.item_collection.entries) {
    let folderEntries = await this.folderEntries(responsesFolderId)
    for (let entry of folderEntries) {
      let name: string = entry.name
      if (entry.type == 'file' && name.endsWith('_response.json')) {
        let permalink = name.substring(0, name.indexOf('_'))
        let check: any = await this.findCheck(permalink)
        if (!check)
          continue

        let jsonResponse: any = await this.download(entry.id)
        if (this.trace)
          this.logger.debug(`roarFeedback handling response: ${JSON.stringify(jsonResponse, null, 2)}`)

        let status: any
        let message: string
        if (jsonResponse.RecommendtoOnBoard) {
          status = jsonResponse.RecommendtoOnBoard == 'YES' ? 'pass' : 'fail'
          message = jsonResponse.RecommendtoOnBoard == 'YES' ? 'Recommended for onboarding' : 'Not recommended for onboarding'
        }
        else
          status = 'error'

        let statusEnum = enumValue({
          model: this.bot.models[STATUS],
          value: status
        })

        check.responseData = sanitize(jsonResponse).sanitized
        check.responseData.receivedDate = dateformat(new Date(), 'yyyy-mm-dd HH:MM:ss')
        check.status = statusEnum
        if (message)
          check.message = message
        if (this.trace)
          this.logger.debug(`roarFeedback updating check with response ${JSON.stringify(check, null, 2)}`)
        else
          this.logger.debug(`roarFeedback updating check with response`)
        await this.bot.versionAndSave(check)
        this.logger.debug('roarFeedback check updated')

        // move file to processed responses
        //await client.files.move(entry.id, processedResponsesFolderId)
        await this.move(entry.id, processedResponsesFolderId)
        this.logger.debug('roarFeedback moved request into processed')
      }
    }
  }

  move = async (fileid: string, destinationFolderId: string) => {
    let link = 'https://api.box.com/2.0/files/' + fileid
    let attr = '{\"parent\":{\"id\":\"' + destinationFolderId + '\"}}'
    const res = await fetch(link, {
      method: 'put',
      headers: {
        'Authorization': 'Bearer ' + this.token
      },
      body: attr
    })
  }

  download = async (fileid: string): Promise<any> => {
    let link = 'https://api.box.com/2.0/files/' + fileid + '/content'
    const res = await fetch(link, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + this.token
      }
    })
    let text = await res.text()
    let json: any
    try {
      json = JSON.parse(text)
    } catch (err) {
      json = { error: text }
    }
    return json
  }

  folderEntries = async (folderid: string) => {
    let link = 'https://api.box.com/2.0/folders/' + folderid + '/items'
    const r = await fetch(link, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + this.token
      }
    })
    let respJson = await r.json()
    return respJson.entries
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
      //this.logger.error(`roarFeedback failed to find check matching to ${permalink}`)
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

  sleep = async (ms: number) => {
    await this._sleep(ms);
  }

  _sleep = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}