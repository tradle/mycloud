import {
  Bot,
  Logger
} from '../types'

import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { enumValue } from '@tradle/build-resource'

import validateResource from '@tradle/validate-resource'

import AWS from 'aws-sdk'
import remapKeys from 'remap-keys'

import {
  convertRecords,
  converters,
  AthenaHelper
} from '../athena-utils'
import { mergeIntoAWSConfig } from '@tradle/aws-common-utils'

// @ts-ignore
const { sanitize } = validateResource.utils

const STATUS = 'tradle.Status'

const PSC_PROVIDER = 'http://download.companieshouse.gov.uk/en_pscdata.html'
const PITCHBOOK_PROVIDER = 'PitchBook Data, Inc.'
const LEI_PROVIDER = 'GLEIF – Global Legal Entity Identifier Foundation'
const IRS_PROVIDER = 'IRS'

const BENEFICIAL_OWNER_CHECK = 'tradle.BeneficialOwnerCheck'
const FATCA_CHECK = 'tradle.FATCARegistrationCheck'
const LEI_CHECK = 'tradle.LEICheck'

const PENDING_INFO = 'pendingInfo'

interface PendingInfo {
  id: string
  func?: string,
  remapKeys?: any
}

const athena = new AWS.Athena()

export class PendingChecksChaser {
  private bot: Bot
  private logger: Logger

  private athenaHelper: AthenaHelper
  private trace: boolean

  private PASS: object
  private FAIL: object


  constructor(bot: Bot) {
    this.bot = bot
    this.logger = bot.logger

    this.athenaHelper = new AthenaHelper(this.bot, this.logger, athena, 'pendingChecksChaser')

    this.PASS = enumValue({
      model: this.bot.models[STATUS],
      value: 'pass'
    })

    this.FAIL = enumValue({
      model: this.bot.models[STATUS],
      value: 'fail'
    })

  }

  public chase = async () => {
    this.logger.debug('pendingChecksChaser begins')
    await this.chaseType(BENEFICIAL_OWNER_CHECK, [PSC_PROVIDER, PITCHBOOK_PROVIDER, LEI_PROVIDER])
    await this.chaseType(LEI_CHECK, [LEI_PROVIDER])
    // await this.chaseType(FATCA_CHECK, [IRS_PROVIDER])
  }

  private chaseType = async (type: string, providers: string[]) => {
    this.logger.debug(`pendingChecksChaser type ${type} starts`)
    let checks: any[] = await this.getChecks(type, providers)
    this.logger.debug(`pendingChecksChaser for type ${type} found ${checks.length} pending`)
    for (let check of checks) {
      let rawData: any
      let pendigInfo: PendingInfo[] = check[PENDING_INFO]
      let readyCnt = 0;
      for (let info of pendigInfo) {
        if (await this.athenaHelper.checkStatus(info.id)) {
          readyCnt++;
          let list = await this.readData(info)
          if (list.length > 0) {
            rawData = list
          }
          this.logger.debug(`pendingChecksChaser for type ${type} found ${list.length} results for ${info.id}`)
        }
      }
      if (!rawData && readyCnt === pendigInfo.length) {
        // fail
        check.status = this.FAIL
        check.resultDetails = 'no match found'
        this.logger.debug(`pendingChecksChaser for type ${type}, provider ${check.provider} updating to fail`)
        await this.bot.versionAndSave(check)
      }
      else if (rawData) {
        check.status = this.PASS
        check.rawData = sanitize(rawData).sanitized
        check.resultDetails = 'match found'
        this.logger.debug(`pendingChecksChaser for type ${type}, provider ${check.provider} updating to pass`)
        await this.bot.versionAndSave(check)
      }
    }
  }

  private readData = async (info: PendingInfo) => {
    let list = await this.athenaHelper.getResults(info.id)
    if (list.length > 0) {
      convertRecords(list)
      if (info.func) {
        converters[info.func](list)
      }
      /*
      else if (info.remapKeys) {
        let newList = []
        for (let row of list) {
          let remapedRow = remapKeys(row, info.remapKeys)
          // date convert from string
          for (let propertyName in remapedRow) {
            if (propertyName.endsWith('Date')) {
              let val = remapedRow[propertyName]
              remapedRow[propertyName] = new Date(val).getTime()
            }
          }
          newList.push(remapedRow)
        }
        return newList
      }
      */
    }
    return list
  }
  private getChecks = async (type: string, providers: string[]) => {
    let eqClause = {
      [TYPE]: type,
      'status.id': 'tradle.Status_pending'
    }
    const { items } = await this.bot.db.find({
      filter: {
        EQ: eqClause,
        GTE: {
          '_time': Date.now() - 10 * 60 * 1000 // 10 min
        },
        IN: {
          'provider': providers
        }
      }
    })
    return items
  }
}   