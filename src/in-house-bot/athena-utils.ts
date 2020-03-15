import {
  Bot,
  Logger
} from './types'

import _ from 'lodash'

import AWS from 'aws-sdk'

const ATHENA_OUTPUT = 'temp/athena'

export class AthenaHelper {
  private bot: Bot
  private athena: AWS.Athena

  private logger: Logger

  private usedby: string

  constructor(bot: Bot, logger: Logger, athena: AWS.Athena, usedby: string) {
    this.bot = bot
    this.logger = logger
    this.athena = athena
    this.usedby = usedby
  }

  buildHeader = (columns: any) => {
    return _.map(columns, (i: any) => {
      return i.Name
    })
  }

  public getExecutionId = async (sql: string): Promise<string> => {
    this.logger.debug(`${this.usedby} getExecutionId with ${sql}`)
    const outputLocation = `s3://${this.bot.buckets.PrivateConf.id}/${ATHENA_OUTPUT}`
    const database = this.bot.env.getStackResourceName('sec').replace(/\-/g, '_')
    let params = {
      QueryString: sql,
      ResultConfiguration: { OutputLocation: outputLocation },
      QueryExecutionContext: { Database: database }
    }
    let results = await this.athena.startQueryExecution(params).promise()
    return results.QueryExecutionId
  }

  public checkStatus = async (id: string): Promise<boolean> => {
    let data = await this.athena.getQueryExecution({ QueryExecutionId: id }).promise()
    if (data.QueryExecution.Status.State === 'SUCCEEDED')
      return true
    else if (['FAILED', 'CANCELLED'].includes(data.QueryExecution.Status.State))
      throw new Error(`Query status: ${JSON.stringify(data.QueryExecution.Status)}`)
    else
      return false
  }

  public getResults = async (id: string) => {
    let data: any = await this.athena.getQueryResults({ QueryExecutionId: id }).promise()
    let list = []
    let header = this.buildHeader(data.ResultSet.ResultSetMetadata.ColumnInfo)
    let top_row = _.map((_.head(data.ResultSet.Rows) as any).Data, (n: any) => {
      return n.VarCharValue
    })
    let resultSet =
      _.difference(header, top_row).length > 0 ? data.ResultSet.Rows : _.drop(data.ResultSet.Rows)
    resultSet.forEach(item => {
      list.push(
        _.zipObject(
          header,
          _.map(item.Data, (n: any) => {
            return n.VarCharValue
          })
        )
      )
    })
    return list
  }
}

export async function sleep(ms: number) {
  await this._sleep(ms)
}

function _sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function pitchbookLimitedPartners(find: Array<any>): Array<any> {
  let list = []
  for (let row of find) {
    let pscLike = {
      data: {
        address:
        {
          address_line_1: row["hq address line 1"],
          address_line_2: row["hq address line 2"],
          country: row["hq country"],
          locality: row["hq city"],
          postal_code: row["hq post code"],
          region: row["hq state/province"],
        },
        identification:
        {
          country_registered: row["hq country"],
          place_registered: row["hq location"],
        },
        kind: "corporate-entity-person-with-significant-control",
        name: row["limited partner name"],
        natures_of_control: []
      }
    }
    let natures_of_control: string
    if (row.percent < '25')
      natures_of_control = 'ownership-of-shares-0-to-25-percent'
    else if (row.percent >= '25' && row.percent < '50')
      natures_of_control = 'ownership-of-shares-25-to-50-percent'
    else if (row.percent >= '50' && row.percent < '75')
      natures_of_control = 'ownership-of-shares-50-to-75-percent'
    else
      natures_of_control = 'ownership-of-shares-75-to-100-percent'
    pscLike.data.natures_of_control.push(natures_of_control)

    list.push(pscLike)

    pscLike["hq phone"] = row["hq phone"]
    pscLike["hq email"] = row["hq email"]
    pscLike["primary contact phone"] = row["primary contact phone"]
    pscLike["limited partner type"] = row["limited partner type"]
    pscLike["aum"] = row["aum"]
    pscLike["year founded"] = row["year founded"]
    pscLike["primary contact"] = row["primary contact"]
    pscLike["primary contact title"] = row["primary contact title"]
    pscLike["primary contact email"] = row["primary contact email"]
    pscLike["website"] = row["website"]

  }
  return list
}

export function pitchbookFunds(find: Array<any>): Array<any> {
  let list = []
  for (let row of find) {
    let pscLike = {
      data: {
        address: {
          country: row["fund country"],
          locality: row["fund city"],
          region: row["fund state/province"]
        },
        identification: {
          country_registered: row["fund country"],
          place_registered: row["fund location"],
        },
        kind: "corporate-entity-person-with-significant-control",
        name: row["fund name"],
        natures_of_control: []
      }
    }

    let natures_of_control: string
    if (row.percent < '25')
      natures_of_control = 'ownership-of-shares-0-to-25-percent'
    else if (row.percent >= '25' && row.percent < '50')
      natures_of_control = 'ownership-of-shares-25-to-50-percent'
    else if (row.percent >= '50' && row.percent < '75')
      natures_of_control = 'ownership-of-shares-50-to-75-percent'
    else
      natures_of_control = 'ownership-of-shares-75-to-100-percent'
    pscLike.data.natures_of_control.push(natures_of_control)

    pscLike["lps"] = row["lps"]
    pscLike["fund sps"] = row["fund sps"]
    pscLike["fund partners"] = row["fund partners"]
    pscLike["fund no."] = row["fund no."]
    pscLike["first fund"] = row["first fund"]
    pscLike["vintage"] = row["vintage"]
    pscLike["fund status"] = row["fund status"]
    pscLike["fund size"] = row["fund size"]
    pscLike["fund size group"] = row["fund size group"]
    pscLike["fund type"] = row["fund type"]
    pscLike["fund type"] = row["fund type"]
    pscLike["close date"] = row["close date"]
    pscLike["open date"] = row["open date"]
    pscLike["fund target size low"] = row["fund target size low"]
    pscLike["fund target size high"] = row["fund target size high"]
    pscLike["fund target size"] = row["fund target size"]

    list.push(pscLike)
  }
  return list
}

export function leiRelations(find: Array<any>): Array<any> {
  let list = []
  for (let row of find) {
    if (row.relationshiptype == 'IS_ULTIMATELY_CONSOLIDATED_BY')
      continue
    let pscLike = {
      data: {
        address: {
          address_line_1: row.legaladdress.firstaddressline,
          address_line_2: row.legaladdress.additionaladdressline,
          postal_code: row.legaladdress.postalcode,
          country: row.legaladdress.country,
          locality: row.legaladdress.city,
          region: row.legaladdress.region
        },
        identification: {
          country_registered: row.legaljurisdiction
        },
        kind: "corporate-entity-person-with-significant-control",
        name: row.legalname,
        natures_of_control: []
      }
    }

    let natures_of_control: string
    if (row.percent && row.percent.length > 0) {
      let value = Number(row.percent)
      if (value < 25)
        natures_of_control = 'ownership-of-shares-0-to-25-percent'
      if (value >= 25 && value < 50)
        natures_of_control = 'ownership-of-shares-25-to-50-percent'
      else if (value >= 50 && value < 75)
        natures_of_control = 'ownership-of-shares-50-to-75-percent'
      else if (value >= 75)
        natures_of_control = 'ownership-of-shares-75-to-100-percent'
      pscLike["percentageOfOwnership"] = row.percent
    }
    pscLike.data.natures_of_control.push(natures_of_control)

    pscLike["lei"] = row.lei
    pscLike["status"] = row.status
    pscLike["relation Start Date"] = row.relationstartdate
    pscLike["initial Registration Date"] = row.initialregistrationdate
    pscLike["last Update Date"] = row.lastupdatedate
    pscLike["validation Sources"] = row.validationsources

    pscLike["relationship Type"] = row.relationshiptype
    pscLike["headquarters Address"] = row.headquartersaddress

    list.push(pscLike)
  }
  return list
}

export const converters = {
  pitchbookLimitedPartners,
  pitchbookFunds,
  leiRelations
}

export function convertRecords(arr: Array<any>) {
  if (arr.length > 0) {
    arr.forEach(rdata => {
      for (let key of Object.keys(rdata)) {
        if (rdata[key] && typeof rdata[key] === 'string')
          rdata[key] = makeJson(rdata[key])
      }
    })
  }
}

function makeJson(str: string) {
  if (str.charAt(0) != '{')
    return str
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