import decompress from 'decompress'
import decompressTargz from 'decompress-targz'
import fs from 'fs-extra'
import fetch from 'node-fetch'
import zlib from 'zlib'

import AWS from 'aws-sdk'

import {
  Bot,
  Logger,
} from '../types'

import { TYPE } from '@tradle/constants'

import { enumValue } from '@tradle/build-resource'

const TEMP = '/tmp/' // use lambda temp dir
const MAXMIND_DIR = TEMP + 'maxmind'

const MAXMIND = 'maxmind/GeoLite2-City.mmdb.gz'

const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'

const accessKeyId = ''
const secretAccessKey = ''

const s3 = new AWS.S3({ accessKeyId, secretAccessKey });


//const lookup = await maxmind.open<CityResponse>('/path/to/GeoLite2-City.mmdb');
//let response:CityResponse = lookup.get('70.23.200.119')

export class ImportMaxmindDb {
  private bot: Bot
  private logger: Logger
  private outputLocation: string

  constructor(bot: Bot) {
    this.bot = bot
    this.logger = bot.logger
    this.outputLocation = this.bot.buckets.PrivateConf.id
  }

  execute = async () => {
    let nextMD5 = await this.MD5OfLink()
    let currentMD5 = await this.MD5OfUploaded(MAXMIND)
    if (currentMD5 == nextMD5)
      return
    await this.download()
    await this.decomp()
    await this.findAndupload(nextMD5)
    await this.createDataSourceRefresh()
    this.cleanup()
  }

  createDataSourceRefresh = async () => {
    let provider = enumValue({
      model: this.bot.models[REFERENCE_DATA_SOURCES],
      value: 'maxmind'
    })
    let resource = {
      [TYPE]: DATA_SOURCE_REFRESH,
      name: provider,
      timestamp: Date.now()
    }
    await this.bot.signAndSave(resource)
  }

  MD5OfLink = async () => {
    let link = 'https://geolite.maxmind.com/download/geoip/database/GeoLite2-City.tar.gz.md5'
    try {
      const res = await fetch(link);
      let md5 = await res.text()
      return md5
    } catch (err) {
      if (err.statusCode == 404)
        return undefined
      throw err
    }
  }

  MD5OfUploaded = async (key: string) => {
    var params = {
      Bucket: this.outputLocation,
      Key: key
    }
    let resp = await s3.headObject(params).promise()
    return resp.Metadata.md5
  }

  download = async () => {
    // prepare directory in temp
    !fs.existsSync(MAXMIND_DIR) && fs.mkdirSync(MAXMIND_DIR);

    let link = 'https://geolite.maxmind.com/download/geoip/database/GeoLite2-City.tar.gz'
    const fileStream = fs.createWriteStream(MAXMIND_DIR + '/GeoLite2-City.tar.gz');
    const res = await fetch(link);

    await new Promise((resolve, reject) => {
      res.body.pipe(fileStream);
      res.body.on('error', (err) => {
        reject(err)
      })
      fileStream.on('finish', function () {
        resolve();
      })
    })
  }

  decomp = async () => {
    let dist = MAXMIND_DIR + '/dist'
    !fs.existsSync(dist) && fs.mkdirSync(dist)
    await decompress(MAXMIND_DIR + '/GeoLite2-City.tar.gz', dist, {
      plugins: [
        decompressTargz()
      ]
    })
  }

  findAndupload = async (md5: string) => {
    let dist = MAXMIND_DIR + '/dist'
    let list: Array<string> = fs.readdirSync(dist)

    for (let oneof of list) {
      let file = dist + '/' + oneof;
      var stat = fs.statSync(file);
      if (stat && stat.isDirectory() && oneof.startsWith('GeoLite2-City_')) {
        let db = file + '/GeoLite2-City.mmdb'
        if (fs.existsSync(db)) {
          let gzip = zlib.createGzip();
          let inp = fs.createReadStream(db);
          var out = fs.createWriteStream(db + '.gz');
          let writePromise = this.writeStreamToPromise(out)
          inp.pipe(gzip).pipe(out);
          await writePromise
          await this.upload(db, md5)
          break;
        }
      }
    }
  }

  upload = async (path: string, md5: string) => {
    let stream = fs.createReadStream(path)
    let contentToPost = {
      Bucket: this.outputLocation,
      Key: MAXMIND,
      Metadata: { md5 },
      Body: stream
    }
    let res = await s3.upload(contentToPost).promise()
  }

  cleanup = () => {
    fs.removeSync(MAXMIND_DIR)
  }

  writeStreamToPromise = (stream: any) => {
    return new Promise((resolve, reject) => {
      stream.on('finish', resolve).on('error', reject)
    })
  }

}









