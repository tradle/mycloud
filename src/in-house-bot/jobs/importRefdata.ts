import fs from 'fs-extra'
import zlib from 'zlib'
import crypto from 'crypto'
import fetch from 'node-fetch'
import AWS from 'aws-sdk'

import {
  Bot,
  IBotConf,
  Logger,
} from '../types'

import { TYPE } from '@tradle/constants'
import { enumValue } from '@tradle/build-resource'

const accessKeyId = ''
const secretAccessKey = ''

//const BUCKET = 'jacob.gins.athena'
//const ATHENA_DB = 'sampledb'

const TEMP = '/tmp/' // use lambda temp dir

const GB_PREFIX = 'refdata/gb/'
const DE_PREFIX = 'refdata/de/'
const FATCA_PREFIX = 'refdata/fatca/ffi_list/'

const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'

const JOBS = 'jobs'
const EMDAgents = 'EMDAgents'
const EMoneyFirms = 'EMoneyFirms'
const CreditInstitutions = 'CreditInstitutions'
const FirmsWithPSDPermissions = 'FirmsWithPSDPermissions'

const s3 = new AWS.S3({ accessKeyId, secretAccessKey });

export class ImportRefdata {

  private bot: Bot
  private logger: Logger
  private outputLocation: string
  private importRefdataConf: any

  constructor(bot: Bot, conf: IBotConf) {
    this.bot = bot
    this.logger = bot.logger
    this.outputLocation = this.bot.buckets.PrivateConf.id //BUCKET //

    let jobs: any = conf[JOBS]
    if (jobs) {
      this.importRefdataConf = jobs.ImportRefdata
    }
  }

  public move = async () => {
    this.logger.debug("ImportRefData called")
    let current: string[] = await this.list()
    if (this.importRefdataConf) {
      await this.moveUKFile('EMDAgents', this.importRefdataConf[EMDAgents], 'emd_agents', current)
      await this.moveUKFile('EMoneyFirms', this.importRefdataConf[EMoneyFirms], 'e_money_firms', current)
      await this.moveUKFile('CreditInstitutions', this.importRefdataConf[CreditInstitutions], 'credit_institutions', current)
      await this.moveUKFile('FirmsWithPSDPermissions', this.importRefdataConf[FirmsWithPSDPermissions], 'firms_psd_perm', current)
    }
    await this.moveBafin(current)
    await this.moveFFIList(current)
  }

  private moveFFIList = async (current: string[]) => {
    this.logger.debug('ImportRefData: moveFFIList called')
    fs.ensureDirSync(TEMP + FATCA_PREFIX)
    let path = 'https://apps.irs.gov/app/fatcaFfiList/data/FFIListFull.csv'
    let get = await fetch(path)
    let name = `${FATCA_PREFIX}FFIListFull.csv.gz`
    let file = TEMP + name
    let fout = fs.createWriteStream(file)
    let promise = this.writeStreamToPromise(fout)
    get.body.pipe(zlib.createGzip()).pipe(fout)
    await promise
    this.logger.debug('ImportRefData: moveFFIList downloded into temp')

    let md5: string = await this.checksumFile('MD5', file)
    this.logger.debug(`ImportRefData: computed md5 ${md5}`)
    if (current.includes(name)) {
      // check md5
      let hash = await this.currentMD5(name)
      this.logger.debug(`ImportRefData: current md5 ${hash}`)
      if (md5 === hash) {
        fs.unlinkSync(file)
        this.logger.debug('ImportRefData: do not import FFIList data, no change')
        return
      }
    }

    let rstream = fs.createReadStream(file)

    const contentToPost: AWS.S3.Types.PutObjectRequest = {
      Bucket: this.outputLocation,
      Key: name,
      Metadata: { md5 },
      Body: rstream
    }
    this.logger.debug('ImportRefData: uploading FFIList data')
    let res = await s3.upload(contentToPost).promise()
    await this.createDataSourceRefresh('ffilist')
    this.logger.debug('ImportRefData: imported FFIList data')
    fs.unlinkSync(file)
  }

  private moveBafin = async (current: string[]) => {
    this.logger.debug('ImportRefData: moveBufin called')

    fs.ensureDirSync(TEMP + DE_PREFIX)

    let response = await fetch('https://portal.mvp.bafin.de/database/InstInfo/sucheForm.do', {
      method: 'post',
      body: 'sucheButtonInstitut=Search',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://portal.mvp.bafin.de/database/InstInfo/sucheForm.do?locale=en_GB'
      }
    })
    let html = await response.text()
    let csvidx = html.indexOf('\"><span class=\"export csv\"')
    let qidx = html.lastIndexOf('?', csvidx)
    let u = html.substring(qidx, csvidx).replace(/&amp;/g, '&');
    let path = 'https://portal.mvp.bafin.de/database/InstInfo/sucheForm.do' + u
    this.logger.debug(`ImportRefData: moveBufin get ${path}`)
    let get = await fetch(path)
    let name = `${DE_PREFIX}export.csv.gz`
    let file = TEMP + name
    let fout = fs.createWriteStream(file)
    let promise = this.writeStreamToPromise(fout)
    get.body.pipe(zlib.createGzip()).pipe(fout)
    await promise
    this.logger.debug('ImportRefData: moveBufin downloded into temp')
    let md5: string = await this.checksumFile('MD5', file)
    this.logger.debug(`ImportRefData: computed md5 ${md5}`)
    if (current.includes(name)) {
      // check md5
      let hash = await this.currentMD5(name)
      this.logger.debug(`ImportRefData: current md5 ${hash}`)
      if (md5 === hash) {
        fs.unlinkSync(file)
        this.logger.debug('ImportRefData: do not import Bafin data, no change')
        return
      }
    }

    let rstream = fs.createReadStream(file)

    const contentToPost: AWS.S3.Types.PutObjectRequest = {
      Bucket: this.outputLocation,
      Key: name,
      Metadata: { md5 },
      Body: rstream
    }
    this.logger.debug('ImportRefData: uploading BaFIN data')
    let res = await s3.upload(contentToPost).promise()
    await this.createDataSourceRefresh('bafin')
    this.logger.debug('ImportRefData: imported BaFIN data')
    fs.unlinkSync(file)
  }

  private moveUKFile = async (name: string, fileKey: string, table: string, current: string[]) => {
    this.logger.debug('moveUKFile ' + name)
    try {
      fs.ensureDirSync(TEMP + GB_PREFIX + table)

      let i = 0
      let get
      while (true) {
        try {
          get = await fetch(`https://register.fca.org.uk/servlet/servlet.FileDownload?file=${fileKey}`)
          break
        } catch (err) {
          if (i++ > 5) throw err
        }
      }
      const status = get.status
      if (status >= 400 && status < 500) {
        // error to report
        this.logger.error(`importRefdata failed download with status ${status} for ${name}, fileKey=${fileKey}`)
        return
      }
      else if (status >= 500) {
        // maybe next time

        return
      }
  
      let key = `${GB_PREFIX}${table}/${name}.csv.gz`
      let file = TEMP + key

      let fout: fs.WriteStream = fs.createWriteStream(file)
      let promise = this.writeStreamToPromise(fout)
      get.body.pipe(zlib.createGzip()).pipe(fout)
      await promise
      this.logger.debug('moveUKFile downloaded into file for ' + name)
      let md5: string = await this.checksumFile('MD5', file)
      this.logger.debug('moveUKFile calculated md5 for ' + name + ', md5=' + md5)
      if (current.includes(key)) {
        // check md5
        let hash = await this.currentMD5(key)
        if (md5 === hash) {
          fs.unlinkSync(file)
          this.logger.debug(`do not import ${name} data, no change`)
          return
        }
      }

      let rstream: fs.ReadStream = fs.createReadStream(file)

      let contentToPost = {
        Bucket: this.outputLocation,
        Key: key,
        Metadata: { md5 },
        Body: rstream
      }
      this.logger.debug('moveUKFile about to upload for ' + name)
      let res = await s3.upload(contentToPost).promise()

      await this.createDataSourceRefresh(`fca.${name}`)

      this.logger.debug(`moveUKFile imported ${name} data`)
      fs.unlinkSync(file)
    } catch (err) {
      this.logger.error(`moveUKFile failed for ${name}`, err)
    }
  }

  private checksumFile = (algorithm: string, path: string): Promise<string> => {
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

  private list = async (): Promise<string[]> => {
    let params = {
      Bucket: this.outputLocation,
      Prefix: 'refdata/'
    }
    let keys = []
    let data = await s3.listObjectsV2(params).promise()

    for (let content of data.Contents) {
      keys.push(content.Key)
    }
    return keys
  }

  private currentMD5 = async (key: string) => {
    let params = {
      Bucket: this.outputLocation,
      Key: key
    }
    let resp = await s3.headObject(params).promise()
    return resp.Metadata.md5
  }

  private createDataSourceRefresh = async (name: string) => {
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

  private writeStreamToPromise = (stream: fs.WriteStream) => {
    return new Promise((resolve, reject) => {
      stream.on('finish', resolve).on('error', reject)
    })
  }

}