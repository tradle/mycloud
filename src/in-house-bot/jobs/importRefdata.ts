import zlib from 'zlib'
import fetch from 'node-fetch'
import AWS from 'aws-sdk'

import {
  Bot,
  Logger,
} from '../types'

const accessKeyId = ''
const secretAccessKey = ''

//const BUCKET = 'jacob.gins.athena'
//const ATHENA_DB = 'sampledb'

const GB_PREFIX = 'refdata/gb/'
const DE_PREFIX = 'refdata/de/'

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
    await this.moveBafin()
    await this.moveUKFile('EMDAgents', 'emd_agents')
    await this.moveUKFile('EMoneyFirms', 'e_money_firms')
    await this.moveUKFile('CreditInstitutions', 'credit_institutions')
    await this.moveUKFile('PSDFirms', 'firms_psd_perm')
  }

  moveBafin = async () => {
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

    let get = await fetch('https://portal.mvp.bafin.de/database/InstInfo/sucheForm.do' + u)

    let contentToPost = {
      Bucket: this.outputLocation,
      Key: `${DE_PREFIX}export.csv.gz`,
      Body: get.body.pipe(zlib.createGzip())
    }

    let res = await s3.upload(contentToPost).promise()
    this.logger.debug('imported BaFIN data')
  }

  moveUKFile = async (name: string, table: string) => {
    let get = await fetch(`https://register.fca.org.uk/ShPo_registerdownload?file=${name}`)
    let html = await get.text()
    let idx1 = html.indexOf('.handleRedirect(')
    let idx2 = html.indexOf('\'', idx1 + 18)
    get = await fetch('https://register.fca.org.uk' + html.substring(idx1 + 17, idx2))

    let contentToPost = {
      Bucket: this.outputLocation,
      Key: `${GB_PREFIX}${table}/${name}.csv.gz`,
      Body: get.body.pipe(zlib.createGzip())
    }
    let res = await s3.upload(contentToPost).promise()
    this.logger.debug(`imported ${name} data`)
  }
}