import fs from 'fs-extra'
import crypto from 'crypto'
import AWS from 'aws-sdk'

import {
  Bot,
  Logger,
} from '../types'

import { TYPE } from '@tradle/constants'
import { enumValue } from '@tradle/build-resource'

const accessKeyId = ''
const secretAccessKey = ''

const TEMP = '/tmp/' // use lambda temp dir

const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'

const s3 = new AWS.S3({ accessKeyId, secretAccessKey });

export class ImportPitchbookData {

  private bot: Bot
  private logger: Logger
  private outputLocation: string


  constructor(bot: Bot) {
    this.bot = bot
    this.logger = bot.logger
    this.outputLocation = this.bot.buckets.PrivateConf.id //BUCKET //
  }

  move = async () => {
    this.logger.debug("importPitchbookData called")
    let current: Array<string> = await this.list()
    await this.moveFile('Company.csv', 'company', 'company', current)
    await this.moveFile('Fund.csv', 'fund', 'fund', current)
    await this.moveFile('LimitedPartner.csv', 'limited_partner', 'lp', current)
    await this.moveFile('CompanyToFundRelation.csv', 'company_fund_relation', undefined, current)
    await this.moveFile('FundToLimitedPartnerRelation.csv', 'company_lp_relation', undefined, current)
  }

  list = async (): Promise<Array<string>> => {
    let params = {
      Bucket: this.outputLocation,
      Prefix: 'refdata/pitchbook/'
    }
    let keys = []
    let data = await s3.listObjectsV2(params).promise()

    for (let content of data.Contents) {
      keys.push(content.Key)
    }
    return keys
  }

  moveFile = async (fileName: string, table: string, id: string, current: Array<string>) => {
    this.logger.debug('importPitchbookData ' + fileName)
    try {
      let localfile = TEMP + 'pitchbook/' + fileName
      let key = `refdata/pitchbook/${table}/${fileName}`
      fs.ensureDirSync(TEMP + 'pitchbook')
      await this.s3download('temp/pitchbook/' + fileName, localfile)
      this.logger.debug('importPitchbookData moved file for ' + fileName)
      let md5: string = await this.checksumFile('MD5', localfile)
      this.logger.debug('importPitchbookData calculated md5 for ' + fileName + ', md5=' + md5)

      if (current.includes(key)) {
        // check md5
        let hash = await this.currentMD5(key)
        if (md5 == hash) {
          fs.unlinkSync(localfile)
          this.logger.debug(`importPitchbookData, do not import ${fileName} data, no change`)
          return
        }
      }

      let rstream: fs.ReadStream = fs.createReadStream(localfile)

      let contentToPost = {
        Bucket: this.outputLocation,
        Key: key,
        Metadata: { md5 },
        Body: rstream
      }
      this.logger.debug('importPitchbookData about to upload for ' + fileName)
      let res = await s3.upload(contentToPost).promise()

      if (id) await this.createDataSourceRefresh(`pitchbook.${id}`)

      this.logger.debug(`importPitchbookData imported ${fileName} data`)
      fs.unlinkSync(localfile)
    } catch (err) {
      this.logger.error(`importPitchbookData failed for ${fileName}`, err)
    }
  }

  currentMD5 = async (key: string) => {
    var params = {
      Bucket: this.outputLocation,
      Key: key
    }
    let resp = await s3.headObject(params).promise()
    return resp.Metadata.md5
  }

  s3download = async (key: string, localDest: string) => {
    let params = {
      Bucket: this.outputLocation,
      Key: key
    }
    let file = fs.createWriteStream(localDest)
    return new Promise((resolve, reject) => {
      s3.getObject(params).createReadStream()
        .on('end', () => {
          return resolve()
        })
        .on('error', (error) => {
          return reject(error)
        }).pipe(file)
    })
  }

  createDataSourceRefresh = async (name: string) => {
    let provider = enumValue({
      model: this.bot.models[REFERENCE_DATA_SOURCES],
      value: name
    })
    let resource = {
      [TYPE]: DATA_SOURCE_REFRESH,
      name: provider,
      timestamp: Date.now()
    }
    await this.bot.signAndSave(resource)
  }

  checksumFile = (algorithm: string, path: string): Promise<string> => {
    return new Promise((resolve, reject) =>
      fs.createReadStream(path)
        .on('error', reject)
        .pipe(crypto.createHash(algorithm)
          .setEncoding('hex'))
        .once('finish', function () {
          resolve(this.read())
        })
    )
  }

  writeStreamToPromise = (stream: fs.WriteStream) => {
    return new Promise((resolve, reject) => {
      stream.on('finish', resolve).on('error', reject)
    })
  }
}  