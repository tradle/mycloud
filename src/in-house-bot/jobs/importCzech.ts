import fetch from 'node-fetch'
import AWS from 'aws-sdk'
import fs from 'fs-extra'

import {
  Bot,
  Logger,
} from '../types'

import {
  sleep,
  AthenaHelper
} from '../athena-utils'

import { TYPE } from '@tradle/constants'
import { enumValue } from '@tradle/build-resource'

const CZ_COMPANIES_PREFIX = 'refdata/cz/companies/'
const CZ_PREFIX_TEMP = 'temp/refdata/cz/companies_origin/'
const CZ_PREFIX_ORC_TEMP = 'temp/refdata/cz/companies_orc/'
const TEMP = '/tmp/' // use lambda temp dir
const TIME_LIMIT = 11 * 60 * 1000
const BUCKET_COUNT = 4

const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'

const s3 = new AWS.S3()

export class ImportCzechData {

  private bot: Bot
  private logger: Logger
  private outputLocation: string
  private athenaHelper: AthenaHelper
  private athena: AWS.Athena

  constructor(bot: Bot) {
    this.bot = bot
    this.logger = bot.logger
    this.outputLocation = this.bot.buckets.PrivateConf.id //BUCKET //
    this.athena = new AWS.Athena() //{ region, accessKeyId, secretAccessKey })
    this.athenaHelper = new AthenaHelper(bot, this.logger, this.athena, 'importCzech')
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

    let create = false
    if (await this.checkFiles() === BUCKET_COUNT) {
      this.logger.debug('ImportCzech target bucket filled')
      return
    }
    create = true

    let current: string[] = await this.loadedList()
    this.logger.debug("ImportCzech loaded: " + current)
    let input: string[] = await this.inputList()
    this.logger.debug("ImportCzech input: " + input)
    let moved = false
    for (let el of input) {
      let now = Date.now()
      if (now - start > TIME_LIMIT) {
        this.logger.debug("ImportCzech run out of time limit")
        break
      }
      if (!current.includes(CZ_PREFIX_TEMP + el)) {
        await this.moveElementList(el)
        moved = true
      }
    }

    if (!moved && !create)
      return

    await this.createOriginTable()
    await this.deleteAllInNext()
    await this.dropAndCreateNextTable()
    await this.copyFromNext()
    await this.createTable()
    this.logger.debug("ImportCzech finished")
  }

  private s3downloadhttp = async (key: string, localDest: string) => {
    let url = `http://referencedata.tradle.io.s3-website-us-east-1.amazonaws.com/${key}`
    this.logger.debug(`importCzech s3downloadhttp time from ${url}`)
    try {
      let get = await fetch(url)
      let fout = fs.createWriteStream(localDest)
      let promise = this.writeStreamToPromise(fout)
      get.body.pipe(fout)
      await promise
    } catch (err) {
      this.logger.error(`importCzech s3downloadhttp error`, err)
      return
    }
    let stats = fs.statSync(localDest)
    let fileSizeInBytes = stats["size"]
    this.logger.debug(`importCzech s3downloadhttp downloaded file of size ${fileSizeInBytes}`)
  }
  private moveElementList = async (file: string) => {
    this.logger.debug(`importCzech: moveList called for ${file}`)

    let localfile = TEMP + 'companies/' + file
    fs.ensureDirSync(TEMP + 'companies')

    const singleUrl = `https://dataor.justice.cz/api/file/${file}`
    let get = await fetch(singleUrl, { timeout: 5000 })

    //await this.s3downloadhttp(`public/cz/companies/2020/${file}`, localfile)

    let fout = fs.createWriteStream(localfile)
    let promise = this.writeStreamToPromise(fout)
    get.body.pipe(fout)
    await promise

    let rstream: fs.ReadStream = fs.createReadStream(localfile)

    const contentToPost: AWS.S3.Types.PutObjectRequest = {
      Bucket: this.outputLocation,
      Key: CZ_PREFIX_TEMP + file,
      Body: rstream
    }
    this.logger.debug(`importCzech: uploading ${file}`)
    let res = await s3.upload(contentToPost).promise()
    this.logger.debug(`importCzech: uploaded ${file}`)
    fs.unlinkSync(localfile)
  }

  private writeStreamToPromise = (stream: fs.WriteStream) => {
    return new Promise((resolve, reject) => {
      stream.on('finish', resolve).on('error', reject)
    })
  }

  private createTable = async () => {
    this.logger.debug('importCzech createTable() called')
    let createTab = `CREATE EXTERNAL TABLE IF NOT EXISTS czech_data (
         ico string, 
         name string, 
         data string, 
         ceasedate string, 
         recorddate string)
      CLUSTERED BY ( ico) 
      INTO ${BUCKET_COUNT} BUCKETS
      ROW FORMAT SERDE 
        'org.apache.hadoop.hive.ql.io.orc.OrcSerde' 
      STORED AS INPUTFORMAT 
        'org.apache.hadoop.hive.ql.io.orc.OrcInputFormat' 
      OUTPUTFORMAT 
        'org.apache.hadoop.hive.ql.io.orc.OrcOutputFormat'
      LOCATION
      's3://${this.outputLocation}/${CZ_COMPANIES_PREFIX}'
      TBLPROPERTIES ('has_encrypted_data'='false')`

    await this.executeDDL(createTab, 2000)
  }

  private createOriginTable = async () => {
    this.logger.debug('importCzech createOriginTable() called')
    let createTab = `CREATE EXTERNAL TABLE IF NOT EXISTS czech_data_origin (
        ico string,
        name string,
        data string,
        ceasedate string,
        recorddate string
      )
      ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.OpenCSVSerde'
      WITH SERDEPROPERTIES (
        'separatorChar' = ',',
        'quoteChar' = '"',
        'escapeChar' = '\\\\'
      )
      STORED AS TEXTFILE
      LOCATION
        's3://${this.outputLocation}/${CZ_PREFIX_TEMP}'
      TBLPROPERTIES (
        'skip.header.line.count'='1',
        'classification'='csv', 
        'compressionType'='gzip', 
        'typeOfData'='file')`

    await this.executeDDL(createTab, 2000)
  }

  private dropAndCreateNextTable = async () => {
    this.logger.debug('importCzech dropAndCreateNextTable() called')
    let data: any = await this.executeDDL('DROP TABLE czech_data_origin_bucketed', 3000)

    const create = `CREATE TABLE czech_data_origin_bucketed 
                    WITH (
                    format = 'ORC', 
                    external_location = 's3://${this.outputLocation}/${CZ_PREFIX_ORC_TEMP}', 
                    bucketed_by = ARRAY['ico'], 
                    bucket_count = ${BUCKET_COUNT})
      AS SELECT ico, name, data, ceasedate, recorddate FROM czech_data_origin`
    let res = await this.executeDDL(create, 10000, 120000)
    this.logger.debug('importCzech dropAndCreateNextTable: ' + JSON.stringify(res, null, 2))
  }

  private deleteAllInNext = async () => {
    this.logger.debug('importCzech deleteAllInNext() called')
    let param1 = {
      Bucket: this.outputLocation,
      Prefix: CZ_PREFIX_ORC_TEMP
    };

    let data = await s3.listObjectsV2(param1).promise()

    let toDelete = []
    for (let content of data.Contents) {
      let key = content.Key
      toDelete.push({ Key: key })
    }
    if (toDelete.length === 0)
      return

    let param2 = {
      Bucket: this.outputLocation,
      Delete: {
        Objects: toDelete
      }
    }

    try {
      let res = await s3.deleteObjects(param2).promise();
      this.logger.debug('importCzech deleteAllInNext finished', res)
    } catch (err) {
      this.logger.error('importCzech deleteAllInNext error', err);
    }

  }

  private copyFromNext = async () => {
    this.logger.debug('importCzech copyFromNext() called')
    let param = {
      Bucket: this.outputLocation,
      Prefix: CZ_PREFIX_ORC_TEMP
    };

    let data = await s3.listObjectsV2(param).promise()
    let toCopy = []
    for (let content of data.Contents) {
      let key = content.Key
      toCopy.push(key)
    }
    this.logger.debug('importCzech to copy' + JSON.stringify(toCopy))

    let promises = []
    for (let key of toCopy) {
      let destKey = CZ_COMPANIES_PREFIX + key.substring(key.indexOf('bucket-'))
      let params = {
        Bucket: this.outputLocation,
        CopySource: `${this.outputLocation}/${key}`,
        Key: destKey
      }
      promises.push(s3.copyObject(params).promise())
    }

    for (let promise of promises)
      await promise
  }


  private checkFiles = async (): Promise<number> => {
    this.logger.debug('importCzech checkFiles() called')
    let param = {
      Bucket: this.outputLocation,
      Prefix: CZ_COMPANIES_PREFIX
    };

    let data = await s3.listObjectsV2(param).promise()
    let cnt = 0
    for (let content of data.Contents) {
      cnt++
    }
    return cnt
  }


  public executeDDL = async (sql: string, delay: number, wait: number = 10000) => {
    let id: string
    this.logger.debug(`importCzech executeDDL() called with sql ${sql}`)

    try {
      id = await this.athenaHelper.getExecutionId(sql)
      this.logger.debug('importCzech athena execution id', id)
    } catch (err) {
      this.logger.error('importCzech athena error', err)
      return undefined
    }

    await sleep(delay)
    let timePassed = delay
    while (true) {
      let result = false
      try {
        result = await this.athenaHelper.checkStatus(id)
      } catch (err) {
        this.logger.error('importCzech athena error', err)
        return undefined
      }
      if (result) break

      if (timePassed > wait) {
        this.logger.debug('importCzech athena tired of waiting')
        return undefined
      }
      await sleep(1000)
      timePassed += 1000
    }
    try {
      let list: any[] = await this.athenaHelper.getResults(id)
      this.logger.debug(`importCzech athena query result contains ${list.length} rows`)
      return { status: true, error: null, data: list }
    } catch (err) {
      this.logger.error('importCzech athena error', err)
      return undefined
    }
  }
}