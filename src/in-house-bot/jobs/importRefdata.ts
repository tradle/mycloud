import fs from 'fs-extra'
import zlib from 'zlib'
import crypto from 'crypto'
import fetch from 'node-fetch'
import AWS from 'aws-sdk'

import {
  Bot,
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

const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'

const s3 = new AWS.S3({ accessKeyId, secretAccessKey });

export class ImportRefdata {

  private bot: Bot
  private logger: Logger
  private outputLocation: string

  constructor(bot: Bot) {
    this.bot = bot
    this.logger = bot.logger
    this.outputLocation = this.bot.buckets.PrivateConf.id //BUCKET //
  }

  move = async () => {
    this.logger.debug("ImportRefData called")
    let current: Array<string> = await this.list()
    await this.moveUKFile('EMDAgents', 'emd_agents', current)
    await this.moveUKFile('EMoneyFirms', 'e_money_firms', current)
    await this.moveUKFile('CreditInstitutions', 'credit_institutions', current)
    await this.moveUKFile('PSDFirms', 'firms_psd_perm', current)
    await this.moveBafin(current)
  }

  moveBafin = async (current: Array<string>) => {
    this.logger.debug('ImportRefData: moveBufin called')

    fs.ensureDirSync(TEMP + DE_PREFIX)

    var response = await fetch('https://portal.mvp.bafin.de/database/InstInfo/sucheForm.do', {
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
    let get = await fetch(path, {
      method: 'get',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3',
        'Accept- Encoding': 'gzip, deflate, br',
        'Accept- Language': 'en-US,en;q=0.9',
        'Cache - Control': 'no-cache',
        Host: 'portal.mvp.bafin.de',
        Pragma: 'no-cache',
        'Sec - Fetch - Site': 'none',
        'Upgrade - Insecure - Requests': '1',
        'User - Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36'
      }
    })
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
      if (md5 == hash) {
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

  moveUKFile = async (name: string, table: string, current: Array<string>) => {
    try {
      fs.ensureDirSync(TEMP + GB_PREFIX + table)

      let get = await fetch(`https://register.fca.org.uk/ShPo_registerdownload?file=${name}`)
      let html = await get.text()
      let idx1 = html.indexOf('.handleRedirect(')
      let idx2 = html.indexOf('\'', idx1 + 18)
      get = await fetch('https://register.fca.org.uk' + html.substring(idx1 + 17, idx2))

      let key = `${GB_PREFIX}${table}/${name}.csv.gz`
      let file = TEMP + key

      let fout: fs.WriteStream = fs.createWriteStream(file)
      let promise = this.writeStreamToPromise(fout)
      get.body.pipe(zlib.createGzip()).pipe(fout)
      await promise
      let md5: string = await this.checksumFile('MD5', file)

      if (current.includes(key)) {
        // check md5
        let hash = await this.currentMD5(key)
        if (md5 == hash) {
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
      let res = await s3.upload(contentToPost).promise()

      await this.createDataSourceRefresh(`fca.${name}`)

      this.logger.debug(`imported ${name} data`)
      fs.unlinkSync(file)
    } catch (err) {
      this.logger.error(`moveUKFile for ${name}`, err)
    }
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

  list = async (): Promise<Array<string>> => {
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

  currentMD5 = async (key: string) => {
    var params = {
      Bucket: this.outputLocation,
      Key: key
    }
    let resp = await s3.headObject(params).promise()
    return resp.Metadata.md5
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

  writeStreamToPromise = (stream: fs.WriteStream) => {
    return new Promise((resolve, reject) => {
      stream.on('finish', resolve).on('error', reject)
    })
  }

}