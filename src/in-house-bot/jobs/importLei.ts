import _ from 'lodash'
import zlib from 'zlib'
import JSONStream from 'JSONStream'
import csv from 'csv-parser'
import unzipper from 'unzipper'
import fetch from 'node-fetch'
import AWS from 'aws-sdk'

import fs from 'fs-extra'
import crypto from 'crypto'

import {
  Bot,
  Logger,
  ISMS,
  Applications,
  IOrganization
} from '../types'

import { TYPE } from '@tradle/constants'

import { enumValue, buildResourceStub } from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils

const TEMP = '/tmp/' // use lambda temp dir

const ATHENA_OUTPUT = 'temp/athena'

const LEI_ORIGIN_NODE_PREFIX = 'temp/refdata/lei/lei_node_origin/'
const LEI_NEXT_NODE_PREFIX = 'temp/refdata/lei/lei_next_node/'
const LEI_NODE_PREFIX = 'refdata/lei/lei_node/'

const LEI_ORIGIN_RELATION_PREFIX = 'temp/refdata/lei/lei_relation_origin/'
const LEI_NEXT_RELATION_PREFIX = 'temp/refdata/lei/lei_next_relation/'
const LEI_RELATION_PREFIX = 'refdata/lei/lei_relation/'

const athena = new AWS.Athena() //{ region, accessKeyId, secretAccessKey })
const s3 = new AWS.S3();

const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'
const ORDER_BY_TIMESTAMP_DESC = {
  property: 'timestamp',
  desc: true
}

const mapTop = {
  0: 'LEI',
  1: 'LegalName',
  3: 'OtherEntityName',
  190: 'LegalJurisdiction',
  198: 'Status',
  204: 'InitialRegistrationDate',
  205: 'LastUpdateDate'
}

const mapHeadquartersAddress = {
  46: 'FirstAddressLine',
  50: 'AdditionalAddressLine',
  53: 'City',
  54: 'Region',
  55: 'Country',
  56: 'PostalCode',
}

const mapLegalAddress = {
  34: 'FirstAddressLine',
  38: 'AdditionalAddressLine',
  41: 'City',
  42: 'Region',
  43: 'Country',
  44: 'PostalCode',
}

export class ImportLei {

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

  createDataSourceRefresh = async () => {
    let provider = enumValue({
      model: this.bot.models[REFERENCE_DATA_SOURCES],
      value: 'lei'
    })
    let resource = {
      [TYPE]: DATA_SOURCE_REFRESH,
      name: provider,
      timestamp: Date.now()
    }
    await this.bot.signAndSave(resource)
  }

  move = async () => {
    this.logger.debug("importLei called")
    let begin = Date.now()
    let current: Array<string> = []
    try {
      current = await this.list()
      this.logger.debug(`importLeiData list returned ${current.length} elements`)
    } catch (err) {
      this.logger.error('importLeiData failed list', err)
    }
    let changeNode = await this.moveFile(LEI_ORIGIN_NODE_PREFIX, current, 'lei_node.txt.gz')
    if (changeNode) {
      await this.createLeiNodeInputTable()
      await this.deleteAllInNextNode()
      await this.dropAndCreateNextNodeTable()
      await this.createLeiNodeTable()
      await this.copyFromNextNode()
      let end = Date.now()
      this.logger.debug(`importLei finished moving node only in ${(end - begin) / 1000} sec`)
      return
    }

    let changeRelations = await this.moveFile(LEI_ORIGIN_RELATION_PREFIX, current, 'lei_relation.txt.gz')


    if (changeRelations) {
      await this.createLeiRelationInputTable()
      await this.deleteAllInNextRelation()
      await this.dropAndCreateNextRelationTable()
      await this.createLeiRelationTable()
      await this.copyFromNextRelation()

      await this.createDataSourceRefresh()
    }

    let end = Date.now()
    this.logger.debug(`importLei finished in ${(end - begin) / 1000} sec`)
  }

  moveFile = async (s3location: string, current: Array<string>, outputFile: string): Promise<boolean> => {
    this.logger.debug('importLei ' + outputFile)
    try {
      let key = `${s3location}${outputFile}`
      fs.ensureDirSync(TEMP + 'lei')

      let out = TEMP + 'lei/' + outputFile

      await this.s3downloadhttp('public/lei/' + outputFile, out)

      /*
      if (fileName.includes('rr_')) {
        await this.convertRelation(url, out)
      }
      else {
        await this.convertNode(url, out)
      }
      */
      let md5: string = await this.checksumFile('MD5', out)
      this.logger.debug('importLei calculated md5 for ' + out + ', md5=' + md5)

      if (current.includes(key)) {
        // check md5
        let hash = await this.currentMD5(key)
        this.logger.debug(`importLei, current md5 for ${key} = ${hash}`)
        if (md5 == hash) {
          fs.removeSync(out)
          this.logger.debug(`importLei, do not import ${outputFile} data, no change`)
          return false
        }
      }

      let rstream: fs.ReadStream = fs.createReadStream(out)

      let contentToPost = {
        Bucket: this.outputLocation,
        Key: key,
        Metadata: { md5 },
        Body: rstream
      }
      this.logger.debug(`importLei about to upload for ${outputFile}`)
      let res = await s3.upload(contentToPost).promise()

      this.logger.debug(`importLei imported ${outputFile} data`)
      fs.removeSync(out)
      return true
    } catch (err) {
      this.logger.error(`importLei failed for ${outputFile}`, err)
      return false
    }
  }

  convertRelation = async (url: string, outputFile: string) => {
    this.logger.debug(`importLei convertRelation start from ${url} into ${outputFile}`)
    try {
      let outputStream: fs.WriteStream = fs.createWriteStream(outputFile)
      let writePromise = this.writeStreamToPromise(outputStream)
      let get = await fetch(url)
      await new Promise((resolve, reject) => {
        var compress = zlib.createGzip();
        const unzipper = require('unzipper')
        compress.pipe(outputStream)
        get.body.pipe(unzipper.ParseOne()).pipe(JSONStream.parse(['relations', true, 'RelationshipRecord']))
          .on('data', function (data: any) {
            let rec: any = {
              startNode: data.Relationship.StartNode.NodeID.$,
              endNode: data.Relationship.EndNode.NodeID.$,
              relationshipType: data.Relationship.RelationshipType.$,
              status: data.Relationship.RelationshipStatus.$
            }
            if (data.Relationship.RelationshipPeriods && data.Relationship.RelationshipPeriods.RelationshipPeriod &&
              data.Relationship.RelationshipPeriods.RelationshipPeriod.length > 1 && data.Relationship.RelationshipPeriods.RelationshipPeriod[1].StartDate)
              rec.relationStartDate = data.Relationship.RelationshipPeriods.RelationshipPeriod[1].StartDate.$

            if (data.Relationship.RelationshipQuantifiers && data.Relationship.RelationshipQuantifiers.RelationshipQuantifier.QuantifierAmount.$)
              rec.percent = data.Relationship.RelationshipQuantifiers.RelationshipQuantifier.QuantifierAmount.$

            rec.initialRegistrationDate = data.Registration.InitialRegistrationDate.$
            rec.lastUpdateDate = data.Registration.LastUpdateDate.$
            rec.validationSources = data.Registration.ValidationSources.$
            compress.write(JSON.stringify(rec) + '\n')
          })
          .on('end', function () {
            compress.end()
            resolve()
          })
          .on('error', function (err) {
            reject(err)
          })
      })
      await writePromise
      this.logger.debug(`importLei convertRelation ends`)
    } catch (err) {
      this.logger.error(`importLei convertRelation ends with error`, err)
    }
  }

  convertNode = async (url: string, output: string) => {
    this.logger.debug(`importLei converNode start from ${url} into ${output}`)
    try {
      let get = await fetch(url)
      let compress = zlib.createGzip()
      let writeStream: fs.WriteStream = fs.createWriteStream(output)
      let promise = this.writeStreamToPromise(writeStream)
      await new Promise((resolve, reject) => {
        let cnt = 0
        compress.pipe(writeStream)
        get.body.pipe(unzipper.ParseOne())
          .pipe(csv({ skipLines: 1, headers: false }))
          .on('data', (data: any) => {
            let extract: any = {}
            cnt++
            for (let key of Object.keys(mapTop)) {
              let part = data[key]
              let name = mapTop[key]
              extract[name] = part
            }
            extract.LegalAddress = {}
            for (let key of Object.keys(mapLegalAddress)) {
              let part = data[key]
              let name = mapLegalAddress[key]
              extract.LegalAddress[name] = part
            }
            extract.HeadquartersAddress = {}
            for (let key of Object.keys(mapHeadquartersAddress)) {
              let part = data[key]
              let name = mapHeadquartersAddress[key]
              extract.HeadquartersAddress[name] = part
            }
            compress.write(JSON.stringify(extract) + '\n')
            if (cnt % 1000 == 0)
              this.logger.debug(`importLei converNode wrote ${cnt} records`)
          })
          .on('end', () => {
            compress.end()
            resolve()
          })
          .on('error', (err) => {
            reject(err)
          })
      })
      await promise
      this.logger.debug(`importLei converNode ends`)
    } catch (err) {
      this.logger.error(`importLei converNode ends with error`, err)
    }
  }

  createLeiNodeInputTable = async () => {
    const create = `CREATE EXTERNAL TABLE IF NOT EXISTS lei_node_origin(
          lei string, 
          legalname string, 
          otherentityname string, 
          legaljurisdiction string, 
          status string, 
          initialregistrationdate string, 
          lastupdatedate string, 
          legaladdress struct<firstaddressline:string,additionaladdressline:string,city:string,region:string,country:string,postalcode:string>, 
          headquartersaddress struct<firstaddressline:string,additionaladdressline:string,city:string,region:string,country:string,postalcode:string>
          )
          ROW FORMAT SERDE 
            'org.openx.data.jsonserde.JsonSerDe' 
          WITH SERDEPROPERTIES ( 
            'paths'='HeadquartersAddress,InitialRegistrationDate,LEI,LastUpdateDate,LegalAddress,LegalJurisdiction,LegalName,OtherEntityName,Status'
          ) 
          STORED AS INPUTFORMAT 
            'org.apache.hadoop.mapred.TextInputFormat' 
          OUTPUTFORMAT 
            'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat'
          LOCATION
            's3://${this.outputLocation}/${LEI_ORIGIN_NODE_PREFIX}'
          TBLPROPERTIES (
            'classification'='json', 
            'compressionType'='gzip', 
            'typeOfData'='file')`

    let res = await this.executeDDL(create, 2000)
    this.logger.debug('importLei createLeiNodeInputTable: ' + JSON.stringify(res, null, 2))
  }

  createLeiNodeTable = async () => {
    const create = `CREATE EXTERNAL TABLE IF NOT EXISTS lei_node(
          lei string, 
          legalname string, 
          otherentityname string, 
          legaljurisdiction string, 
          status string, 
          initialregistrationdate string, 
          lastupdatedate string, 
          legaladdress struct<firstaddressline:string,additionaladdressline:string,city:string,region:string,country:string,postalcode:string>, 
          headquartersaddress struct<firstaddressline:string,additionaladdressline:string,city:string,region:string,country:string,postalcode:string>
          )
    CLUSTERED BY ( 
        lei) 
    INTO 1 BUCKETS  
    ROW FORMAT SERDE 
      'org.apache.hadoop.hive.ql.io.orc.OrcSerde' 
    STORED AS INPUTFORMAT 
      'org.apache.hadoop.hive.ql.io.orc.OrcInputFormat' 
    OUTPUTFORMAT 
      'org.apache.hadoop.hive.ql.io.orc.OrcOutputFormat'
    LOCATION
      's3://${this.outputLocation}/${LEI_NODE_PREFIX}'
    TBLPROPERTIES (
      'has_encrypted_data'='false')`
    let res = await this.executeDDL(create, 2000)
    this.logger.debug('importLei createLeiNodeTable: ' + JSON.stringify(res, null, 2))
  }

  createLeiRelationInputTable = async () => {
    const create = `CREATE EXTERNAL TABLE IF NOT EXISTS lei_relation_origin(
          startnode string, 
          endnode string, 
          relationshiptype string, 
          status string, 
          relationstartdate string, 
          initialregistrationdate string, 
          lastupdatedate string, 
          validationsources string, 
          percent string
          )
          ROW FORMAT SERDE 
            'org.openx.data.jsonserde.JsonSerDe' 
          WITH SERDEPROPERTIES ( 
            'paths'='endNode,initialRegistrationDate,lastUpdateDate,percent,relationStartDate,relationshipType,startNode,status,validationSources'
          ) 
          STORED AS INPUTFORMAT 
            'org.apache.hadoop.mapred.TextInputFormat' 
          OUTPUTFORMAT 
            'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat'
          LOCATION
            's3://${this.outputLocation}/${LEI_ORIGIN_RELATION_PREFIX}'
          TBLPROPERTIES (
            'classification'='json', 
            'compressionType'='gzip', 
            'typeOfData'='file')`

    let res = await this.executeDDL(create, 2000)
    this.logger.debug('importLei createLeiRelationInputTable: ' + JSON.stringify(res, null, 2))
  }

  dropAndCreateNextNodeTable = async () => {
    let data: any = await this.executeDDL('DROP TABLE lei_next_node', 3000)

    if (!data || (data.ResultSet.ResultSetMetadata.ColumnInfo.length == 0)) {
      // no table
    }
    else
      this.logger.debug(JSON.stringify(data, null, 2))
    const create = `CREATE TABLE lei_next_node 
                    WITH (
                    format = \'ORC\', 
                    external_location = \'s3://${this.outputLocation}/${LEI_NEXT_NODE_PREFIX}\', 
                    bucketed_by = ARRAY[\'lei\'], 
                    bucket_count = 1
                   )
          AS SELECT * FROM lei_node_origin`
    let res = await this.executeDDL(create, 10000, 120000)
    this.logger.debug('importLei dropAndCreateNextNodeTable: ' + JSON.stringify(res, null, 2))
  }

  dropAndCreateNextRelationTable = async () => {
    let data: any = await this.executeDDL('DROP TABLE lei_next_relation', 3000)

    if (!data || (data.ResultSet.ResultSetMetadata.ColumnInfo.length == 0)) {
      // no table
    }
    else
      this.logger.debug(JSON.stringify(data, null, 2))
    const create = `CREATE TABLE lei_next_relation 
                    WITH (
                    format = \'ORC\', 
                    external_location = \'s3://${this.outputLocation}/${LEI_NEXT_RELATION_PREFIX}\', 
                    bucketed_by = ARRAY[\'startnodelei\'], 
                    bucket_count = 1
                   )
          AS SELECT s.lei as startnodelei, s.legaljurisdiction as startnodejurisdiction, s.legalname as startnodelegalname,
                s.otherentityname as startnodeothername, e.*, r.relationstartdate, r.validationsources, 
                r.relationshiptype, r.percent
          FROM lei_node s, lei_relation_origin r, lei_node e
          WHERE s.lei = r.startnode and r.endnode = e.lei`
    let res = await this.executeDDL(create, 10000, 120000)
    this.logger.debug('importLei dropAndCreateNextRelationTable: ' + JSON.stringify(res, null, 2))
  }

  createLeiRelationTable = async () => {
    const create = `CREATE EXTERNAL TABLE IF NOT EXISTS lei_relation(
      startnodelei string, 
      startnodejurisdiction string, 
      startnodelegalname string, 
      startnodeothername string, 
      lei string, 
      legalname string, 
      otherentityname string, 
      legaljurisdiction string, 
      status string, 
      initialregistrationdate string, 
      lastupdatedate string, 
      legaladdress struct<firstaddressline:string,additionaladdressline:string,city:string,region:string,country:string,postalcode:string>, 
      headquartersaddress struct<firstaddressline:string,additionaladdressline:string,city:string,region:string,country:string,postalcode:string>, 
      relationstartdate string, 
      validationsources string, 
      relationshiptype string, 
      percent string)
    CLUSTERED BY ( 
        startnodelei) 
    INTO 1 BUCKETS  
    ROW FORMAT SERDE 
      'org.apache.hadoop.hive.ql.io.orc.OrcSerde' 
    STORED AS INPUTFORMAT 
      'org.apache.hadoop.hive.ql.io.orc.OrcInputFormat' 
    OUTPUTFORMAT 
      'org.apache.hadoop.hive.ql.io.orc.OrcOutputFormat'
    LOCATION
      's3://${this.outputLocation}/${LEI_RELATION_PREFIX}'
    TBLPROPERTIES (
      'has_encrypted_data'='false')`
    let res = await this.executeDDL(create, 2000)
    this.logger.debug('importLei createLeiRelationTable: ' + JSON.stringify(res, null, 2))
  }

  deleteAllInNextRelation = async () => {
    var param1 = {
      Bucket: this.outputLocation,
      Prefix: LEI_NEXT_RELATION_PREFIX
    }

    let data = await s3.listObjectsV2(param1).promise()
    let toDelete = []
    for (let content of data.Contents) {
      let key = content.Key
      toDelete.push({ Key: key })
    }
    if (toDelete.length == 0)
      return

    let param2 = {
      Bucket: this.outputLocation,
      Delete: {
        Objects: toDelete
      }
    }

    try {
      let res = await s3.deleteObjects(param2).promise();
      this.logger.debug('importLei deleteAllInNextRelation', res)
    } catch (err) {
      this.logger.error('importLei deleteAllInNextRelation', err);
    }

  }

  deleteAllInNextNode = async () => {
    var param1 = {
      Bucket: this.outputLocation,
      Prefix: LEI_NEXT_NODE_PREFIX
    }

    let data = await s3.listObjectsV2(param1).promise()
    let toDelete = []
    for (let content of data.Contents) {
      let key = content.Key
      toDelete.push({ Key: key })
    }
    if (toDelete.length == 0)
      return

    let param2 = {
      Bucket: this.outputLocation,
      Delete: {
        Objects: toDelete
      }
    }

    try {
      let res = await s3.deleteObjects(param2).promise();
      this.logger.debug('importLei deleteAllInNextNode', res)
    } catch (err) {
      this.logger.error('importLei deleteAllInNextNode', err);
    }

  }


  copyFromNextRelation = async () => {
    var param = {
      Bucket: this.outputLocation,
      Prefix: LEI_NEXT_RELATION_PREFIX
    }

    let data = await s3.listObjectsV2(param).promise()
    let toCopy = []
    for (let content of data.Contents) {
      let key = content.Key
      toCopy.push(key)
    }
    this.logger.debug('importLei copyFromNextRelation' + JSON.stringify(toCopy))

    let promises = []
    for (let key of toCopy) {
      let destKey = LEI_RELATION_PREFIX + key.substring(key.indexOf('bucket-'))
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

  copyFromNextNode = async () => {
    var param = {
      Bucket: this.outputLocation,
      Prefix: LEI_NEXT_NODE_PREFIX
    }

    let data = await s3.listObjectsV2(param).promise()
    let toCopy = []
    for (let content of data.Contents) {
      let key = content.Key
      toCopy.push(key)
    }
    this.logger.debug('importLei copyFromNextNode' + JSON.stringify(toCopy))

    let promises = []
    for (let key of toCopy) {
      let destKey = LEI_NODE_PREFIX + key.substring(key.indexOf('bucket-'))
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

  sleep = async (ms: number) => {
    await this._sleep(ms);
  }

  _sleep = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getExecutionId = async (sql: string): Promise<string> => {
    this.logger.debug(`importLei start query: ${sql}`)
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
    this.logger.debug('importLei executeDDL')
    let id: string
    try {
      id = await this.getExecutionId(sql)
      this.logger.debug(`importLei executeDDL execution id ${id}`)
    } catch (err) {
      this.logger.error('importLei executeDDL error', err)
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
      this.logger.debug(`importLei executeDDL for id=${id} time passed: ${timePassed}, ${data}`)
      return data
    } catch (err) {
      this.logger.error('importLei executeDDL err for id=${id}', err)
      return undefined
    }
  }


  list = async (): Promise<Array<string>> => {
    let params = {
      Bucket: this.outputLocation,
      Prefix: 'temp/refdata/lei/'
    }
    let keys = []
    let data = await s3.listObjectsV2(params).promise()

    for (let content of data.Contents) {
      keys.push(content.Key)
    }
    return keys
  }

  s3downloadhttp = async (key: string, localDest: string) => {
    let url = `http://referencedata.tradle.io.s3-website-us-east-1.amazonaws.com/${key}`
    let get = await fetch(url)
    let fout = fs.createWriteStream(localDest)
    let promise = this.writeStreamToPromise(fout)
    get.body.pipe(fout)
    await promise
    this.logger.debug(`importLei s3downloadhttp finished with ${key}`)
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

  currentMD5 = async (key: string) => {
    var params = {
      Bucket: this.outputLocation,
      Key: key
    }
    let resp = await s3.headObject(params).promise()
    return resp.Metadata.md5
  }

  writeStreamToPromise = (stream: fs.WriteStream) => {
    return new Promise((resolve, reject) => {
      stream.on('finish', resolve).on('error', reject)
    })
  }
}  