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

import { enumValue, buildResourceStub } from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const accessKeyId = ''
const secretAccessKey = ''
const region = 'us-east-1'

//const BUCKET = 'jacob.gins.athena'
//const ATHENA_DB = 'adv'
const ATHENA_OUTPUT = 'temp/athena'
const ORIGIN_PREFIX = 'temp/refdata/gb/basic_company_data_origin/'
const TMP_BUCKETED_PREFIX = 'temp/refdata/gb/basic_company_data_tmp_bucketed/'
const PREFIX = 'refdata/gb/basic_company_data/'

const BUCKET_COUNT = 4
const MAX_UPLOAD_TIME = 600000 // 10 min

const athena = new AWS.Athena({ region, accessKeyId, secretAccessKey })
const s3 = new AWS.S3({ accessKeyId, secretAccessKey });

const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'
const ORDER_BY_TIMESTAMP_DESC = {
  property: 'timestamp',
  desc: true
}

export class ImportBasicCompanyData {

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

  moveBasic = async () => {
    let begin = new Date().getTime()
    //***** collect current links
    let links = await this.collectLinks()
    if (links.length == 0)
      return
    //**** collect bucket file names in gb/basic_/ for table basic_
    let inbucket = await this.currentInBucket()
    this.logger.debug('importBasicCompanyData inbucket', inbucket.length)

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
        this.logger.debug('importBasicCompanyData no new files, exiting')
        return;
      }

    }
    else
      this.logger.debug('importBasicCompanyData no files in bucket, continue to upload')

    let now = new Date().getTime()
    this.logger.debug('importBasicCompanyData starting upload')

    //**** load links into /gb/psc/ for psc table
    let cnt = 1;
    for (let link of links) {
      let s = new Date().getTime()
      this.logger.debug('importBasicCompanyData start upload of', link)
      let times = 1
      let res: any
      while (true) {
        try {
          res = await fetch('http://download.companieshouse.gov.uk/' + link, { timeout: 5000 })
          this.logger.debug(`importBasicCompanyData fetch returned stream, file ${cnt}`)
          break
        } catch (err) {
          this.logger.debug(`importBasicCompanyData attempt ${times++}, fetch err`, err)
          if (times > 5)
            throw err
        }
      }
      let stream: Readable = res.body.pipe(unzipper.ParseOne()).pipe(zlib.createGzip())
      let key = ORIGIN_PREFIX + link.split('.')[0] + '.csv.gz'

      await s3.upload({ Bucket: this.outputLocation, Key: key, Body: stream }).promise()

      let f = new Date().getTime()
      this.logger.debug(`${cnt++}. importBasicCompanyData file upload time ${f - s}\n`)
      if (f - begin > MAX_UPLOAD_TIME) {
        this.logger.debug('importBasicCompanyData files upload time exceeded 10 min, taking a break')
        return;
      }
    }
    let fin = new Date().getTime()
    this.logger.debug('importBasicCompanyData upload finished, time', (fin - now))

    //**** delete all files in upload/psc_next_bucketed/
    await this.deleteAllInTmp()

    //**** create psc input bucket
    await this.createBasicCompanyDataInputTable()

    //**** drop table orc_psc_next_bucketed and create as select from psc  
    await this.dropAndCreateTmpTable()

    //*** create data source refresh resource */
    await this.createDataSourceRefresh()

    //***** replace files from upload/psc_next_bucketed/ to upload/psc/
    await this.copyFromTmp()

    let end = new Date().getTime()
    this.logger.debug(`importBasicCompanyData total time (ms): ${end - begin}`)
  }

  deleteAllInTmp = async () => {
    var param1 = {
      Bucket: this.outputLocation,
      Prefix: TMP_BUCKETED_PREFIX
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

  copyFromTmp = async () => {
    var s3 = new AWS.S3({ accessKeyId, secretAccessKey });
    var param1 = {
      Bucket: this.outputLocation,
      Prefix: TMP_BUCKETED_PREFIX
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

    for (let promise of promises)
      await promise
  }

  createDataSourceRefresh = async () => {
    let provider = enumValue({
      model: this.bot.models[REFERENCE_DATA_SOURCES],
      value: 'companiesHouse'
    })
    let resource = {
      [TYPE]: DATA_SOURCE_REFRESH,
      name: provider,
      timestamp: Date.now()
    }
    await this.bot.signAndSave(resource)
  }

  collectLinks = async (): Promise<Array<string>> => {
    let pref = 'href="BasicCompanyData-'
    const page = await fetch('http://download.companieshouse.gov.uk/en_output.html')
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
        if (content.Size == 0 || content.Key.indexOf('BasicCompanyData-') < 0)
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
      this.logger.debug('importBasicCompanyData no deletes in bucket')
      return
    }
    var params = {
      Bucket: this.outputLocation,
      Delete: {
        Objects: toDelete
      }
    }
    this.logger.debug(`importBasicCompanyData deleting inBucket ${toDelete}`)
    try {
      let res = await s3.deleteObjects(params).promise();
      this.logger.debug(`importBasicCompanyData deleted inBucket ${res}`)
    } catch (err) {
      this.logger.debug(err);
    }
  }

  dropAndCreateTmpTable = async () => {
    let data: any = await this.executeDDL('DROP TABLE basic_company_data_tmp_bucketed', 3000)

    if (!data || (data.ResultSet.ResultSetMetadata.ColumnInfo.length == 0)) {
      // no table
    }
    else
      this.logger.debug(JSON.stringify(data, null, 2))
    const create = `CREATE TABLE basic_company_data_tmp_bucketed 
                    WITH (
                    format = \'ORC\', 
                    external_location = \'s3://${this.outputLocation}/${TMP_BUCKETED_PREFIX}\', 
                    bucketed_by = ARRAY[\'companynumber\'], 
                    bucket_count = ${BUCKET_COUNT})
      AS SELECT 
        companyname, 
        companynumber, 
        "regaddress.careof", 
        "regaddress.pobox", 
        "regaddress.addressline1", 
        "regaddress.addressline2", 
        "regaddress.posttown", 
        "regaddress.county", 
        "regaddress.country", 
        "regaddress.postcode", 
        companycategory, 
        companystatus, 
        countryoforigin, 
        dissolutiondate, 
        incorporationdate, 
        "accounts.accountrefday", 
        "accounts.accountrefmonth", 
        "accounts.nextduedate", 
        "accounts.lastmadeupdate", 
        "accounts.accountcategory", 
        "returns.nextduedate", 
        "returns.lastmadeupdate", 
        "mortgages.nummortcharges", 
        "mortgages.nummortoutstanding", 
        "mortgages.nummortpartsatisfied", 
        "mortgages.nummortsatisfied", 
        "siccode.sictext_1", 
        "siccode.sictext_2", 
        "siccode.sictext_3", 
        "siccode.sictext_4", 
        "limitedpartnerships.numgenpartners", 
        "limitedpartnerships.numlimpartners", 
        uri, 
        "previousname_1.condate", 
        "previousname_1.companyname", 
        "previousname_2.condate", 
        "previousname_2.companyname", 
        "previousname_3.condate", 
        "previousname_3.companyname", 
        "previousname_4.condate", 
        "previousname_4.companyname", 
        "previousname_5.condate", 
        "previousname_5.companyname", 
        "previousname_6.condate", 
        "previousname_6.companyname", 
        "previousname_7.condate", 
        "previousname_7.companyname", 
        "previousname_8.condate", 
        "previousname_8.companyname", 
        "previousname_9.condate", 
        "previousname_9.companyname", 
        "previousname_10.condate", 
        "previousname_10.companyname", 
        confstmtnextduedate, 
        confstmtlastmadeupdate  
      FROM basic_company_data_origin`
    let res = await this.executeDDL(create, 10000, 60000)
    this.logger.debug(JSON.stringify(res, null, 2))
  }

  createBasicCompanyDataInputTable = async () => {
    const create = `CREATE EXTERNAL TABLE IF NOT EXISTS basic_company_data_origin(
      \`companyname\` string, 
      \`companynumber\` string, 
      \`regaddress.careof\` string, 
      \`regaddress.pobox\` string, 
      \`regaddress.addressline1\`, 
      \`regaddress.addressline2\`, 
      \`regaddress.posttown\` string, 
      \`regaddress.county\` string, 
      \`regaddress.country\` string, 
      \`regaddress.postcode\` string, 
      \`companycategory\` string, 
      \`companystatus\` string, 
      \`countryoforigin\` string, 
      \`dissolutiondate\` string, 
      \`incorporationdate\` string, 
      \`accounts.accountrefday\` string, 
      \`accounts.accountrefmonth\` string, 
      \`accounts.nextduedate\` string, 
      \`accounts.lastmadeupdate\` string, 
      \`accounts.accountcategory\` string, 
      \`returns.nextduedate\` string, 
      \`returns.lastmadeupdate\` string, 
      \`mortgages.nummortcharges\` string, 
      \`mortgages.nummortoutstanding\` string, 
      \`mortgages.nummortpartsatisfied\` string, 
      \`mortgages.nummortsatisfied\` string, 
      \`siccode.sictext_1\` string, 
      \`siccode.sictext_2\` string, 
      \`siccode.sictext_3\` string, 
      \`siccode.sictext_4\` string, 
      \`limitedpartnerships.numgenpartners\`, 
      \`limitedpartnerships.numlimpartners\`, 
      \`uri\` string, 
      \`previousname_1.condate\`, 
      \`previousname_1.companyname\`, 
      \`previousname_2.condate\`', 
      \`previousname_2.companyname\`, 
      \`previousname_3.condate\` string, 
      \`previousname_3.companyname\` string, 
      \`previousname_4.condate\` string, 
      \`previousname_4.companyname\` string, 
      \`previousname_5.condate\` string, 
      \`previousname_5.companyname\` string, 
      \`previousname_6.condate\` string, 
      \`previousname_6.companyname\` string, 
      \`previousname_7.condate\` string, 
      \`previousname_7.companyname\` string, 
      \`previousname_8.condate\` string, 
      \`previousname_8.companyname\` string, 
      \`previousname_9.condate\` string, 
      \`previousname_9.companyname\` string, 
      \`previousname_10.condate\` string, 
      \`previousname_10.companyname\` string, 
      \`confstmtnextduedate\` string, 
      \`confstmtlastmadeupdate\` string)
    ROW FORMAT SERDE 
      'org.apache.hadoop.hive.serde2.OpenCSVSerde' 
    WITH SERDEPROPERTIES ( 
      'escapeChar'='\\', 
      'quoteChar'='\"', 
      'separatorChar'=',') 
    STORED AS INPUTFORMAT 
      'org.apache.hadoop.mapred.TextInputFormat' 
    OUTPUTFORMAT 
      'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat'
    LOCATION
      's3://${this.outputLocation}/${ORIGIN_PREFIX}'
    TBLPROPERTIES (
      'classification'='csv', 
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
    this.logger.debug("importBasicCompanyData start query", sql)
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
    this.logger.debug('importBasicCompanyData executeDDL')
    let id: string
    try {
      id = await this.getExecutionId(sql)
      this.logger.debug(`importBasicCompanyData executeDDL execution id ${id}`)
    } catch (err) {
      this.logger.error('importBasicCompanyData executeDDL error', err)
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
      this.logger.debug(`importBasicCompanyData executeDDL time passed: ${timePassed}, ${data}`)
      return data
    } catch (err) {
      this.logger.error('importBasicCompanyData executeDDL err', err)
      return undefined
    }
  }

}  