import fetch from 'node-fetch'
import AWS from 'aws-sdk'

import {
  Bot,
  Logger,
} from '../types'

import { TYPE } from '@tradle/constants'
import { enumValue } from '@tradle/build-resource'

const CZ_PREFIX = 'refdata/cz/'
const CZ_PREFIX_TEMP = 'temp/refdata/cz/'
const TIME_LIMIT = 11 * 60 * 1000

const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'

const s3 = new AWS.S3()

export class ImportCzechData {

  private bot: Bot
  private logger: Logger
  private outputLocation: string

  constructor(bot: Bot) {
    this.bot = bot
    this.logger = bot.logger
    this.outputLocation = this.bot.buckets.PrivateConf.id //BUCKET //
  }

  private inputList = async (): Promise<string[]> => {
    let input = []
    const url = 'https://dataor.justice.cz/api/3/action/package_list'
    const resp = await fetch(url)
    const json = await resp.json()
    if (!json.success) {
      this.logger.debug("ImportCzech inputList no success")
      return;
    }
    for (let el of json.result) {
      if (el.includes('-actual-') && el.endsWith('-2020'))
        input.push(el + '.csv.gz')
    }
    return input
  }

  private loadedList = async (): Promise<string[]> => {
    let params = {
      Bucket: this.outputLocation,
      Prefix: CZ_PREFIX_TEMP
    }
    let keys = []
    let data = await s3.listObjectsV2(params).promise()

    for (let content of data.Contents) {
      keys.push(content.Key)
    }
    return keys
  }

  public move = async () => {
    this.logger.debug("ImportCzech called")
    let start = Date.now()

    let current: string[] = await this.loadedList()
    this.logger.debug("ImportCzech loaded: " + current)
    let input: string[] = await this.inputList()
    this.logger.debug("ImportCzech input: " + input)
    let moved = false
    for (let el in input) {
      let now = Date.now()
      if (now - start < TIME_LIMIT) {
        this.logger.debug("ImportCzech run out of time limit")
        break
      }
      if (!current.includes(CZ_PREFIX_TEMP + el)) {
        await this.moveElementList(el)
        moved = true
      }
    }

    this.logger.debug("ImportCzech finished")
    if (!moved)
      return
  }

  private moveElementList = async (file: string) => {
    this.logger.debug(`importCzech: moveList called for ${file}`)
    const singleUrl = `https://dataor.justice.cz/api/file/${file}.csv.gz`
    let rstream = await fetch(singleUrl)

    const contentToPost: AWS.S3.Types.PutObjectRequest = {
      Bucket: this.outputLocation,
      Key: CZ_PREFIX_TEMP + file,
      Body: rstream
    }
    this.logger.debug(`importCzech: uploading ${file}`)
    let res = await s3.upload(contentToPost).promise()
    this.logger.debug(`importCzech: uploaded ${file}`)
  }

}