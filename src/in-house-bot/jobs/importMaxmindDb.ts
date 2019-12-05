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

const TEMP = '/tmp/' // use lambda temp dir
const MAXMIND_DIR = TEMP + 'maxmind'

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
    await this.download()
    await this.decomp()
    await this.findAndupload()
    this.cleanup()
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

  findAndupload = async () => {
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
          await this.upload(db)
          break;
        }
      }
    }
  }

  upload = async (path: string) => {
    let stream = fs.createReadStream(path)
    let contentToPost = {
      Bucket: this.outputLocation,
      Key: 'maxmind/GeoLite2-City.mmdb.gz',
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









