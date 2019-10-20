import AWS from 'aws-sdk'
//import _ from 'lodash'
import fs from 'fs'
//import { allSettled } from '../../utils'

import {
  Bot,
  Logger,
} from '../types'

const TEMP = '/tmp/' // use lambda temp dir
const TYPES_DIR = TEMP + 'types/'
const accessKeyId = ''
const secretAccessKey = ''
const region = 'us-east-1'
const BUCKET = 'jacob.gins.athena'

const OBJECTS_BUCKET = 'tdl-svb-ltd-dev-buckets-wza9q831y5q8-objects-m3rienvohb6a'
const DATADUMP_FOLDER = 'datadump/' //TODO change to data_export 
const MARKER = 'marker'

const ATHENA_DB = 'sampledb'
const ATHENA_OUTPUT_LOCATION = `s3://${BUCKET}/temp/`

const POLL_INTERVAL = 1000
const TIME_LIMIT = 600000 // 10 min

const athena = new AWS.Athena({ region, accessKeyId, secretAccessKey })
const targetS3 = new AWS.S3({ accessKeyId, secretAccessKey })
const objectsS3 = new AWS.S3({ accessKeyId, secretAccessKey })


const TYPE_FILTER = ['tradle.ModelsPack', 'tradle.Message']

export class AthenaFeed {
  private bot: Bot
  private logger: Logger
  private outputLocation: string
  private inputLocation: string
  private database: string

  constructor(bot: Bot) {
    this.bot = bot
    this.logger = bot.logger
    this.outputLocation = this.bot.buckets.PrivateConf.id //
    this.inputLocation = this.bot.buckets.Objects.id //
    this.database = this.bot.env.getStackResourceName('sec') // ATHENA_DB
  }

  datadumpFilenames = async (names: Array<string>, contToken: string) => {
    let params = {
      Bucket: this.outputLocation,
      Prefix: DATADUMP_FOLDER,
      ContinuationToken: contToken
    }

    try {
      let data = await targetS3.listObjectsV2(params).promise()

      for (let content of data.Contents) {
        if (content.Size == 0)
          continue
        names.push(content.Key)
      }
      if (data.IsTruncated) {
        await this.datadumpFilenames(names, data.NextContinuationToken)
      }
    } catch (err) {
      this.logger.debug(err)
    }
  }

  // collect object names
  objectsBucketFilenames = async (files: Array<{ name: string, time: number }>,
    contToken: string) => {

    let params = {
      Bucket: this.inputLocation,
      Prefix: '',
      ContinuationToken: contToken
    }

    try {
      let data = await objectsS3.listObjectsV2(params).promise()

      for (let content of data.Contents) {
        if (content.Size == 0)
          continue
        files.push({ name: content.Key, time: content.LastModified.getTime() })
      }
      if (data.IsTruncated) {
        await this.objectsBucketFilenames(files, data.NextContinuationToken)
      }
    } catch (err) {
      this.logger.error(err)
    }
  }

  getFile = async (s3: AWS.S3, file: string, bucket: string): Promise<string> => {
    var params = {
      Bucket: bucket,
      Key: file
    }
    const data = await s3.getObject(params).promise()
    return data.Body.toString();
  }

  writeStreamToPromise = (stream: any) => {
    return new Promise((resolve, reject) => {
      stream.on('finish', resolve).on('error', reject)
    })
  }

  readStreamToPromise = (stream: any) => {
    return new Promise((resolve, reject) => {
      stream.on('end', resolve).on('error', reject)
    })
  }

  public objectsDump = async () => {
    // prepare directory in temp
    !fs.existsSync(TYPES_DIR) && fs.mkdirSync(TYPES_DIR);

    let objectFiles = []
    let start = new Date().getTime()
    await this.objectsBucketFilenames(objectFiles, undefined)
    this.logger.debug(`number of object files ${objectFiles.length}`)
    objectFiles.sort((one, two) => one.time > two.time ? 1 : -1)

    // collect datadump file names
    let dump = []
    await this.datadumpFilenames(dump, undefined)

    let idx = 0
    if (dump.includes(DATADUMP_FOLDER + MARKER)) {
      let last = await this.getFile(targetS3, DATADUMP_FOLDER + MARKER, BUCKET)
      this.logger.debug(`last marker ${last}`)
      for (; idx < objectFiles.length; idx++) {
        let obj = objectFiles[idx]
        if (obj.name == last)
          break;
      }
      idx++
      if (idx == objectFiles.length) {
        this.logger.debug('all documents are processed')
        return
      }
      this.logger.debug(`start from ${idx}`)
    }

    let map = new Map<string, fs.WriteStream>()

    for (; idx < objectFiles.length; idx++) {
      let obj = objectFiles[idx]
      let str: string
      try {
        str = await this.getFile(objectsS3, obj.name, this.inputLocation)
      } catch (err) {
        this.logger.error(`error getFile, idx=${idx}, err=${err}`)
        idx--;
        break;
      }
      let json = JSON.parse(str);
      let type = json._t
      if (!this.bot.models[type])
        continue
      if (TYPE_FILTER.includes(type))
        continue
      let stream = map.get(type)
      if (!stream) {
        let table = type.toLowerCase().replace(/\./g, '_')
        let inbucket = `${DATADUMP_FOLDER}${table}/${type}`
        if (dump.includes(inbucket)) {
          try {
            await this.s3download(this.outputLocation, inbucket, TYPES_DIR + type)
          } catch (err) {
            this.logger.error(`error s3download, idx=${idx}, type=${type}, err=${err}`)
            idx--;
            break;
          }
        }
        stream = fs.createWriteStream(TYPES_DIR + type, { flags: 'a' })
        map.set(type, stream)
      }
      stream.write(str)
      stream.write('\n')
      if (idx % 500 == 0) {
        this.logger.debug(`processed idx=${idx}`)
        let time = new Date().getTime()
        if (time - start > TIME_LIMIT) {
          // time to break and write out all collected + write out last processed file as a marker
          this.logger.debug('time is running out, the rest will process at next invocation')
          break
        }
      }
    }
    if (idx == objectFiles.length)
      idx--

    console.log(`last processed: ${idx}`)
    let marker = objectFiles[idx].name

    let promises = []
    for (let [type, stream] of map) {
      promises.push(this.writeStreamToPromise(stream))
    }

    for (let [type, stream] of map) {
      stream.end()
    }

    //allSettled(promises) // ready to upload to s3
    for (let promise of promises) {
      await promise
    }
    // marker ready to upload to s3
    for (let [type, stream] of map) {
      await this.upload(type)
    }
    await this.putMarker(marker)
    this.logger.debug('datadump refreshed')

    // create athena tables
    let num = 0
    for (let [type, stream] of map) {
      let model = this.bot.models[type]
      if (model) {
        let sql: string = this.genCreateTable(type, model)
        if (!sql)
          continue
        await this.executeDDL(sql, 500)
        this.logger.debug(`${++num} tables created`)
      }
      else {
        this.logger.debug(`cannot create table for missing type ${type}`)
      }
    }
    let time = new Date().getTime()
    this.logger.debug(`total time(sec): ${(time - start) / 1000}`)
  }

  s3download = async (bucketName: string, keyName: string, localDest: string) => {
    if (typeof localDest == 'undefined') {
      localDest = keyName;
    }
    let params = {
      Bucket: bucketName,
      Key: keyName
    }
    let file = fs.createWriteStream(localDest)
    return new Promise((resolve, reject) => {
      targetS3.getObject(params).createReadStream()
        .on('end', () => {
          return resolve()
        })
        .on('error', (error) => {
          return reject(error)
        }).pipe(file)
    })
  }

  upload = async (model: string) => {
    let table = model.toLowerCase().replace(/\./g, '_')
    let stream = fs.createReadStream(TYPES_DIR + model)
    var contentToPost = {
      Bucket: `${this.outputLocation}/${DATADUMP_FOLDER}${table}`,
      Key: model,
      Body: stream
    }
    let res = await targetS3.upload(contentToPost).promise()
  }

  putMarker = async (last: string) => {
    var contentToPost = {
      Bucket: this.outputLocation,
      Key: `${DATADUMP_FOLDER}${MARKER}`,
      Body: last
    }
    let res = await targetS3.putObject(contentToPost).promise()
  }

  genCreateTable = (type: string, model: any) => {
    let table = type.toLowerCase().replace(/\./g, '_')

    let createTable = `CREATE EXTERNAL TABLE IF NOT EXISTS ${table} (\n`

    for (let name of Object.keys(model.properties)) {
      let dbtype = 'string' // default
      let element = model.properties[name]
      let type = element['type']
      if (type == 'array')
        continue
      if (type == 'object') {
        let ref = element['ref']
        if (!ref)
          continue
        let refModel = this.bot.models[ref]
        if (refModel.subClassOf == 'tradle.Enum')
          dbtype = 'struct<id:string,title:string>'
        else
          dbtype = 'struct<`_t`:string,`_permalink`:string,`_link`:string,`_displayname`:string>'
      }
      else if (type == 'date')
        dbtype = 'bigint'
      createTable += `  \`${name.toLowerCase()}\` ${dbtype},\n`
    }
    createTable +=
      `\`_s\` string,
    \`_time\` bigint,
    \`_author\` string,
    \`_pv\` string,
    \`_sigpubkey\` string,
    \`_link\` string,
    \`_permalink\` string,
    \`_o\` string,
    \`_org\` string,
    \`_r\` string,
    \`_p\` string,
    \`_ph\` string,
    \`_v\` int,
    \`_prevlink\` string,
    \`_orgsig\` string,
    \`_seal\`  struct<link:string,permalink:string,headerhash:string,
               forresource:struct<\`_link\`:string,\`_permalink\`:string,\`_t\`:string>,
               txid:string,address:string,blockchain:string,network:string,counterparty:string,
               basepubkey:struct<pub:struct<type:string,data:array<int>>,
               curve:string>,\`_t\`:string,\`_time\`:bigint,prevheaderhash:string,addressforprev:string>
   )
   ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
   STORED AS
      INPUTFORMAT 'org.apache.hadoop.mapred.TextInputFormat'
      OUTPUTFORMAT 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat'
   LOCATION
    's3://${this.outputLocation}/${DATADUMP_FOLDER}${table}/'
   TBLPROPERTIES (
     'classification'='json',
     'compressionType'='none',
     'typeOfData'='file')`

    this.logger.debug(createTable)
    return createTable
  }

  sleep = async (ms: number) => {
    await this._sleep(ms);
  }

  _sleep = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getExecutionId = async (sql: string): Promise<string> => {

    return new Promise((resolve, reject) => {
      let outputLocation = `s3://${this.outputLocation}/temp`
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
          return reject(new Error(`${JSON.stringify(data.QueryExecution.Status, null, 2)}`))
        else return resolve('INPROCESS')
      })
    })
  }

  getResults = async (id: string) => {
    return new Promise((resolve, reject) => {
      athena.getQueryResults({ QueryExecutionId: id }, (err, data) => {
        if (err) return reject(err)
        return resolve(data)
      })
    })
  }

  executeDDL = async (sql: string, delay: number) => {
    let id: string
    try {
      id = await this.getExecutionId(sql)
      this.logger.debug(`execution id ${id}`)
    } catch (err) {
      this.logger.error(err)
      return undefined
    }

    await this.sleep(delay)
    let timePassed = delay
    while (true) {
      let result: string
      try {
        result = await this.checkStatus(id)
      } catch (err) {
        this.logger.error(err)
        return undefined
      }
      if (result == 'SUCCEEDED')
        break;

      if (timePassed > 10000) {
        this.logger.debug('tired fo waiting')
        return undefined;
      }
      await this.sleep(250)
      timePassed += 250
    }
    try {
      let data = await this.getResults(id)
      this.logger.debug(`time passed: ${timePassed}, got data ${data}`)
      return data
    } catch (err) {
      this.logger.error(err)
      return undefined
    }
  }

}


