import _ from 'lodash'
import zlib from 'zlib'
import unzipper from 'unzipper'
import fetch from 'node-fetch'
import AWS from 'aws-sdk'
import { Readable } from 'stream'
import { TYPE } from '@tradle/constants'
import Errors from '../../errors'
import * as Templates from '../templates'
import { appLinks } from '../../app-links'

import {
  Bot,
  Logger,
  ISMS,
  Applications,
  IOrganization
} from '../types'

const accessKeyId = ''
const secretAccessKey = ''
const region = 'us-east-1'

//const BUCKET = 'jacob.gins.athena'
//const ATHENA_DB = 'sampledb'
const ATHENA_OUTPUT = 'temp/athena'
const ORIGIN_PREFIX = 'temp/refdata/gb/psc_origin/'
const NEXT_BUCKETED_PREFIX = 'temp/refdata/gb/psc_next_bucketed/'
const PREFIX = 'refdata/gb/psc/'

const BUCKET_COUNT = 4
const MAX_UPLOAD_TIME = 600000 // 10 min

const athena = new AWS.Athena({ region, accessKeyId, secretAccessKey })
const s3 = new AWS.S3({ accessKeyId, secretAccessKey });

const ASPECTS = 'New BO'
const PROVIDER = 'PSC registry'
const CLIENT_ACTION_REQUIRED_CHECK = 'tradle.ClientActionRequiredCheck'

const DEAR_CUSTOMER = 'Dear Customer'
const DEFAULT_SMS_GATEWAY = 'sns'
type SMSGatewayName = 'sns'

const SENDER_EMAIL = 'support@tradle.io' // TODO

const BO_ONBOARD_MESSAGE = 'New BO onboarding'

const CONFIRMATION_EMAIL_DATA_TEMPLATE = {
  template: 'action',
  blocks: [
    { body: 'Hello {{name}}' },
    { body: 'Click below to start a new BO onboarding' },
    {
      action: {
        text: 'On Mobile',
        href: '{{mobileUrl}}'
      }
    },
    {
      action: {
        text: 'On Web',
        href: '{{webUrl}}'
      }
    }
  ],
  signature: '-{{orgName}} Team'
}
const getSMSClient = ({
  bot,
  gateway = DEFAULT_SMS_GATEWAY
}: {
  bot: Bot
  gateway: SMSGatewayName
}): ISMS => {
  if (gateway.toLowerCase() === 'sns') {
    return bot.snsUtils
  }

  throw new Errors.InvalidInput(`SMS gateway "${gateway}" not found`)
}

const renderConfirmationEmail = (data: ConfirmationEmailTemplateData) =>
  Templates.email.action(Templates.renderData(CONFIRMATION_EMAIL_DATA_TEMPLATE, data))

const genConfirmationEmail = ({
  provider,
  host,
  name,
  orgName,
  product,
  extraQueryParams = {}
}: GenConfirmationEmailOpts) => {
  const [mobileUrl, webUrl] = ['mobile', 'web'].map(platform => {
    return appLinks.getApplyForProductLink({
      provider,
      host,
      product,
      platform,
      ...extraQueryParams
    })
  })

  return renderConfirmationEmail({ name, mobileUrl, webUrl, orgName })
}

interface GenConfirmationEmailOpts {
  provider: string
  host: string
  name: string
  orgName: string
  extraQueryParams?: any
  product: string
}

interface ConfirmationEmailTemplateData {
  name: string
  mobileUrl: string
  webUrl: string
  orgName: string
}

export class ImportPsc {

  private bot: Bot
  private applications: Applications
  private org: IOrganization
  private logger: Logger
  private outputLocation: string
  private database: string

  constructor(bot: Bot, applications: Applications, org: IOrganization) {
    this.bot = bot
    this.applications = applications
    this.org = org
    this.logger = bot.logger
    this.outputLocation = this.bot.buckets.PrivateConf.id //BUCKET //
    this.database = this.bot.env.getStackResourceName('sec').replace(/\-/g, '_') //ATHENA_DB // 
  }

  sendConfirmationEmail = async (record: any, product: string) => {
    this.logger.debug('controlling person: preparing to send invite')

    const host = this.bot.apiBaseUrl
    const provider = await this.bot.getMyPermalink()

    const body = genConfirmationEmail({
      provider,
      host,
      name: DEAR_CUSTOMER,
      orgName: this.org.name,
      product
    })

    debugger
    try {
      await this.bot.mailer.send({
        from: SENDER_EMAIL,
        to: [record.companyemail],
        format: 'html',
        subject: `${BO_ONBOARD_MESSAGE} - ${record.name}`,
        body
      })
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error('failed to email controlling person', err)
    }
  }

  movePSC = async () => {
    let begin = new Date().getTime()
    //***** collect current links
    let links = await this.collectLinks()
    if (links.length == 0)
      return
    //**** collect bucket file names in gb/psc/ for table psc
    let inbucket = await this.currentInBucket()
    this.logger.debug('inbucket', inbucket.length)

    if (inbucket.length > 0) {
      let preserve = []
      for (let idx = 0; idx < links.length; idx++) {
        let link = links[idx]
        //**** compare dates
        let linkPrefix = link.substring(0, link.indexOf('.')) // .zip
        let loaded = this.findContainsInArray(linkPrefix, inbucket)
        if (loaded != null) {
          preserve.push(loaded)
          links.splice(idx--, 1)
        }
      }


      //**** delete files in gb/psc/ except preserve 
      await this.deleteInBucket(inbucket, preserve)

      this.logger.debug(`links: ${links}`);

      if (links.length == 0) {
        // nothing changed
        this.logger.debug('no new files, exiting')
        return;
      }

    }
    else
      this.logger.debug('no files in bucket, continue to upload')

    let now = new Date().getTime()
    this.logger.debug('starting upload')

    //**** load links into /gb/psc/ for psc table
    let cnt = 1;
    for (let link of links) {
      let s = new Date().getTime()
      this.logger.debug('start upload of', link)
      let times = 1
      let res: any
      while (true) {
        try {
          res = await fetch('http://download.companieshouse.gov.uk/' + link, { timeout: 5000 })
          this.logger.debug(`fetch returned stream, file ${cnt}`)
          break
        } catch (err) {
          this.logger.debug(`attempt ${times++}, fetch err`, err)
          if (times > 5)
            throw err
        }
      }
      let stream: Readable = res.body.pipe(unzipper.ParseOne()).pipe(zlib.createGzip())
      let key = ORIGIN_PREFIX + link.split('.')[0] + '.txt.gz'

      await s3.upload({ Bucket: this.outputLocation, Key: key, Body: stream }).promise()

      let f = new Date().getTime()
      this.logger.debug(`${cnt++}. file upload time ${f - s}\n`)
      if (f - begin > MAX_UPLOAD_TIME) {
        this.logger.debug('psc files upload time exceeded 10 min, taking a break')
        return;
      }
    }
    let fin = new Date().getTime()
    this.logger.debug('upload finished, time', (fin - now))

    //**** delete all files in upload/psc_next_bucketed/
    await this.deleteAllInNext()

    //**** create psc input bucket
    await this.createPscInputTable()

    //**** drop table orc_psc_next_bucketed and create as select from psc  
    await this.dropAndCreateNextTable()

    //*****find legalentity to notify about new psc records by 
    // comparing psc and orc_psc_next_bucketed tables
    // create checks and notify admin
    await this.notifyAdmin();

    //***** replace files from upload/psc_next_bucketed/ to upload/psc/
    await this.copyFromNext()

    let end = new Date().getTime()
    this.logger.debug(`total time (ms): ${end - begin}`)
  }


  collectLinks = async (): Promise<Array<string>> => {
    let pref = 'href="psc-snapshot-'
    const page = await fetch('http://download.companieshouse.gov.uk/en_pscdata.html')
    const html = await page.text()
    let idx1 = html.indexOf(pref)
    let links: Array<string> = []
    while (idx1 >= 0) {
      let idx2 = html.indexOf('"', idx1 + pref.length)
      let link = html.substring(idx1 + 6, idx2)
      links.push(link)
      idx1 = html.indexOf(pref, idx2 + 1)
    }
    return links
  }

  currentInBucket = async (): Promise<Array<string>> => {
    let params = {
      Bucket: this.outputLocation,
      Prefix: ORIGIN_PREFIX
    };
    let files = []
    try {
      let data = await s3.listObjectsV2(params).promise()

      for (let content of data.Contents) {
        //this.logger.debug(content.Key)
        if (content.Size == 0 || content.Key.indexOf('psc-snapshot-') < 0)
          continue
        files.push(content.Key)
      }
    } catch (err) {
      this.logger.debug(err.message)
    }
    return files
  }

  findContainsInArray = (token: string, array: Array<string>) => {
    for (let element of array) {
      if (element.indexOf(token) >= 0)
        return element
    }
    return null
  }

  deleteInBucket = async (keys: Array<string>, preserve: Array<string>) => {
    let toDelete = []
    for (let key of keys) {
      if (!preserve.includes(key))
        toDelete.push({ Key: key })
    }
    if (toDelete.length == 0) {
      this.logger.debug('no deletes in bucket')
      return
    }
    var params = {
      Bucket: this.outputLocation,
      Delete: {
        Objects: toDelete
      }
    }
    this.logger.debug(`deleting inBucket ${toDelete}`)
    try {
      let res = await s3.deleteObjects(params).promise();
      this.logger.debug(`deleted inBucket ${res}`)
    } catch (err) {
      this.logger.debug(err);
    }
  }

  deleteAllInNext = async () => {
    var param1 = {
      Bucket: this.outputLocation,
      Prefix: NEXT_BUCKETED_PREFIX
    };

    let data = await s3.listObjectsV2(param1).promise()
    let toDelete = []
    for (let content of data.Contents) {
      let key = content.Key
      toDelete.push({ Key: key })
    }

    this.logger.debug(JSON.stringify(toDelete))

    let param2 = {
      Bucket: this.outputLocation,
      Delete: {
        Objects: toDelete
      }
    }

    try {
      let res = await s3.deleteObjects(param2).promise();
      this.logger.debug('deletedAll', res)
    } catch (err) {
      this.logger.debug(err);
    }

  }

  dropAndCreateNextTable = async () => {
    let data: any = await this.executeDDL('DROP TABLE orc_psc_next_bucketed', 3000)

    if (!data || (data.ResultSet.ResultSetMetadata.ColumnInfo.length == 0)) {
      // no table
    }
    else
      this.logger.debug(JSON.stringify(data, null, 2))
    const create = `CREATE TABLE orc_psc_next_bucketed 
                    WITH (
                    format = \'ORC\', 
                    external_location = \'s3://${this.outputLocation}/${NEXT_BUCKETED_PREFIX}\', 
                    bucketed_by = ARRAY[\'company_number\'], 
                    bucket_count = ${BUCKET_COUNT})
      AS SELECT company_number, data FROM psc_origin`
    let res = await this.executeDDL(create, 10000, 60000)
    this.logger.debug(JSON.stringify(res, null, 2))
  }

  createPscInputTable = async () => {
    const create = `CREATE EXTERNAL TABLE IF NOT EXISTS psc_origin(
        \`company_number\` string, 
            data struct<address:struct<\`address_line_1\`:string,\`address_line_2\`:string,country:string,locality:string,\`postal_code\`:string,premises:string,region:string,\`care_of\`:string,po_box:string>,etag:string,identification:struct<\`country_registered\`:string,\`legal_authority\`:string,\`legal_form\`:string,\`place_registered\`:string,\`registration_number\`:string>,kind:string,links:struct<self:string>,name:string,\`natures_of_control\`:array<string>,\`notified_on\`:string,\`country_of_residence\`:string,\`date_of_birth\`:struct<month:int,year:int>,\`name_elements\`:struct<forename:string,surname:string,title:string,\`middle_name\`:string>,nationality:string,\`ceased_on\`:string,statement:string> 
            )
          ROW FORMAT SERDE 
            'org.openx.data.jsonserde.JsonSerDe' 
          WITH SERDEPROPERTIES ( 
            'paths'='company_number,data') 
          STORED AS INPUTFORMAT 
            'org.apache.hadoop.mapred.TextInputFormat' 
          OUTPUTFORMAT 
            'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat'
          LOCATION
            's3://${this.outputLocation}/${ORIGIN_PREFIX}'
          TBLPROPERTIES (
            'averageRecordSize'='1048', 
            'classification'='json', 
            'compressionType'='gzip', 
            'typeOfData'='file')`

    let res = await this.executeDDL(create, 2000)
    this.logger.debug(JSON.stringify(res, null, 2))
  }

  sleep = async (ms: number) => {
    await this._sleep(ms);
  }

  _sleep = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getExecutionId = async (sql: string): Promise<string> => {
    this.logger.debug("start query", sql)
    return new Promise((resolve, reject) => {
      let outputLocation = `s3://${this.outputLocation}/${ATHENA_OUTPUT}`
      let params = {
        QueryString: sql,
        ResultConfiguration: { OutputLocation: outputLocation },
        QueryExecutionContext: { Database: this.database }
      }

      /* Make API call to start the query execution */
      athena.startQueryExecution(params, (err, results) => {
        if (err) return reject(err)
        return resolve(results.QueryExecutionId)
      })
    })
  }

  checkStatus = async (id: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      athena.getQueryExecution({ QueryExecutionId: id }, (err, data) => {
        if (err) return reject(err)
        if (data.QueryExecution.Status.State === 'SUCCEEDED')
          return resolve('SUCCEEDED')
        else if (['FAILED', 'CANCELLED'].includes(data.QueryExecution.Status.State))
          return reject(JSON.stringify(data.QueryExecution.Status, null, 2))
        else return resolve('INPROCESS')
      })
    })
  }

  getResults = async (id: string): Promise<AWS.Athena.GetQueryResultsOutput> => {
    return new Promise((resolve, reject) => {
      athena.getQueryResults({ QueryExecutionId: id }, (err, data) => {
        if (err) return reject(err)
        return resolve(data)
      })
    })
  }

  executeDDL = async (sql: string, delay: number, wait: number = 10000) => {
    let id: string
    try {
      id = await this.getExecutionId(sql)
      this.logger.debug(`execution id ${id}`)
    } catch (err) {
      this.logger.debug(err)
      return undefined
    }

    await this.sleep(delay)
    let timePassed = delay
    while (true) {
      let result: string
      try {
        result = await this.checkStatus(id)
      } catch (err) {
        this.logger.debug(err)
        return undefined
      }
      if (result == 'SUCCEEDED')
        break;

      if (timePassed > wait) {
        this.logger.debug('tired of waiting')
        return undefined;
      }
      await this.sleep(1000)
      timePassed += 1000
    }
    try {
      let data = await this.getResults(id)
      this.logger.debug(`time passed: ${timePassed}, ${data}`)
      return data
    } catch (err) {
      this.logger.debug(err)
      return undefined
    }
  }

  processQueryResult = (data: AWS.Athena.GetQueryResultsOutput) => {
    var list = []
    if (!data || (data.ResultSet.ResultSetMetadata.ColumnInfo.length == 0)) {
      this.logger.debug('no records')
    }
    else {
      let header = this.buildHeader(data.ResultSet.ResultSetMetadata.ColumnInfo)
      let top_row = _.map(_.head(data.ResultSet.Rows).Data, (n) => { return n.VarCharValue })
      let resultSet = (_.difference(header, top_row).length > 0) ?
        data.ResultSet.Rows : _.drop(data.ResultSet.Rows)
      resultSet.forEach((item) => {
        list.push(_.zipObject(header, _.map(item.Data, (n) => { return n.VarCharValue })))
      })
    }
    return list
  }

  newBO = async () => {
    let changeQuery = `SELECT r.company_number, r.data.name, r.data.name_elements, r.data.natures_of_control,
                       r.data.kind, c.companyemail, c._link, c._author 
        FROM tradle_legal_legalentity c 
          inner join orc_psc_next_bucketed r on (c.registrationnumber = r.company_number)
          left join psc l on (r.company_number = l.company_number and  r.data.name = l.data.name)
        WHERE r.company_number is not null and r.data.name is not null and l.company_number is null
                    and c.companyemail is not null`

    let data: AWS.Athena.GetQueryResultsOutput = await this.executeDDL(changeQuery, 10000)
    let list = this.processQueryResult(data)
    for (let rdata of list) {
      rdata.name_elements = makeJson(rdata.name_elements)
      rdata.natures_of_control = makeJson(rdata.natures_of_control)
    }
    let newEntiites = await this.filterOutKnown(list)
    return newEntiites
  }

  filterOutKnown = async (list: Array<any>) => {
    let newEntities = []
    for (let rdata of list) {
      if (!rdata.kind)
        continue;
      let sql = `select name from tradle_legal_legalentitycontrollingperson 
                 where controllingentitycompanynumber = '${rdata.company_number}'`
      let data: AWS.Athena.GetQueryResultsOutput = await this.executeDDL(sql, 1000)
      let names = this.processQueryResult(data);

      for (let rec of names) {
        let name: string = rec.name.toLowerCase()

        if (rdata.kind == 'individual-person-with-significant-control') {
          let firstname: string = rdata.name_elements.forename.toLowerCase()
          let lastname: string = rdata.name_elements.surname.toLowerCase()
          if (this.notIncludesAny([firstname, lastname], name)) {
            newEntities.push(rdata)
            break
          }
        }
        else if (rdata.kind == 'corporate-entity-person-with-significant-control') {
          let corporate: string = rdata.name.toLowerCase()
          let words: Array<string> = corporate.split(' ')
          if (this.notIncludesAny(words, name)) {
            newEntities.push(rdata)
            break
          }
        }
      }
    }
    return newEntities
  }

  notIncludesAny = (tokens: Array<string>, inStr: string): boolean => {
    for (let token of tokens) {
      if (!inStr.includes(token)) {
        return false
      }
    }
    return true
  }

  notifyAdmin = async () => {
    let data: Array<any> = await this.newBO()
    if (data.length == 0)
      return
    this.logger.debug(`notifyAdmin about new ${data.length} BO's found in PSC`)
    for (let rdata of data) {

      let le_application = await this.getLeProductApplication(rdata)

      let checkR: any = {
        [TYPE]: CLIENT_ACTION_REQUIRED_CHECK,
        status: 'pass',
        provider: PROVIDER,
        application: le_application,
        dateChecked: Date.now(),
        aspects: ASPECTS,
        rawData: [
          {
            company_number: rdata.company_number,
            data: {
              kind: rdata.kind,
              name: rdata.name,
              natures_of_control: rdata.natures_of_control
            }
          }
        ]
      }
      const type = checkR[TYPE]
      let check = await this.bot
        .draft({ type })
        .set(checkR)
        .signAndSave()

      await this.sendConfirmationEmail(rdata, le_application.requestFor)

    }

  }

  getLeProductApplication = async (record) => {
    let msg = await this.bot.getMessageWithPayload({
      select: ['context', 'payload'],
      link: record._link,
      author: record._author,
      inbound: true
    })
    let { items } = await this.bot.db.find({
      filter: {
        EQ: {
          [TYPE]: 'tradle.Application',
          context: msg.context
        }
      }
    })
    return items && items[0]
  }

  copyFromNext = async () => {
    var s3 = new AWS.S3({ accessKeyId, secretAccessKey });
    var param1 = {
      Bucket: this.outputLocation,
      Prefix: NEXT_BUCKETED_PREFIX
    };

    let data = await s3.listObjectsV2(param1).promise()
    let toCopy = []
    for (let content of data.Contents) {
      let key = content.Key
      toCopy.push(key)
    }
    this.logger.debug(JSON.stringify(toCopy))

    let promises = []
    for (let key of toCopy) {
      let destKey = PREFIX + key.substring(key.indexOf('bucket-'))
      let params = {
        Bucket: this.outputLocation,
        CopySource: `${this.outputLocation}/${key}`,
        Key: destKey
      }
      promises.push(s3.copyObject(params).promise())
    }

    //let results = await allSettled(promises)
    //results.forEach(result => { this.logger.debug(JSON.stringify(result)) })

    for (let promise of promises)
      await promise
  }

  buildHeader = (columns: any) => {
    return _.map(columns, (i: any) => {
      return i.Name
    })
  }

  chunk = (arr: Array<any>, size: number) =>
    Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
      arr.slice(i * size, i * size + size)
    )

}

function makeJson(str: string) {
  let arr = Array.from(str)
  let idx = 1
  let obj: any = build(arr, idx)
  return obj.v
}

function build(arr: Array<string>, idx: number): any {
  let name = ''
  let obj = {}
  for (; idx < arr.length; idx++) {
    if (arr[idx] == '=') {
      if (arr[idx + 1] == '{') {
        let ret = build(arr, idx + 2)
        obj[name] = ret.v
        idx = ret.i
      } else if (arr[idx + 1] == '[') {
        let ret = buildStringArray(arr, idx + 2)
        obj[name] = ret.v
        name = ''
        idx = ret.i
      } else {
        let ret = buildString(arr, idx + 1)
        obj[name] = ret.v
        name = ''
        idx = ret.i
      }
    } else if (arr[idx] == '}') {
      return { v: obj, i: idx }
    } else if (arr[idx] == ',') {
      name = ''
      idx++
    } else {
      name += arr[idx]
    }
  }
  return obj
}

function buildStringArray(arr: Array<string>, idx: number) {
  let strArr = []
  let val = ''
  while (true) {
    if (arr[idx] == ',') {
      strArr.push(val)
      val = ''
      idx++ // skip space
    } else if (arr[idx] == ']') {
      return { v: strArr, i: idx }
    }
    val += arr[idx++]
  }
}

function buildString(arr: Array<string>, idx: number) {
  let val = ''
  while (true) {
    if (arr[idx] == ',') {
      if (val == 'null') val = ''
      return { v: val, i: idx + 1 } // skip space
    } else if (arr[idx] == '}') {
      if (val == 'null') val = ''
      return { v: val, i: idx - 1 }
    }
    val += arr[idx++]
  }
}
