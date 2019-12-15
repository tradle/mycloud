import maxmind, { CityResponse } from 'maxmind';
import fs from 'fs'
import zlib from 'zlib'

import AWS from 'aws-sdk'

import { TYPE } from '@tradle/constants'

// @ts-ignore
import {
  getStatusMessageForCheck,
  doesCheckNeedToBeCreated
} from '../utils'

import {
  Bot,
  CreatePlugin,
  Applications,
  IPluginLifecycleMethods,
  ITradleObject,
  IPBApp,
  IPBReq,
  Logger
} from '../types'

import { enumValue, buildResourceStub } from '@tradle/build-resource'

const ON_TYPE = 'tradle.PhotoID'

const IP_ADDRESS_CHECK = 'tradle.IPAddressCheck'
const PROVIDER = 'MaxMind, Inc'
const ASPECTS = 'Fraud prevention'
const COMMERCIAL = 'commercial'

const TEMP = '/tmp/' // use lambda temp dir
const MAXMIND_DIR = TEMP + 'geoloc'

const accessKeyId = ''
const secretAccessKey = ''

const REFERENCE_DATA_SOURCES = 'tradle.ReferenceDataSources'
const DATA_SOURCE_REFRESH = 'tradle.DataSourceRefresh'

const ORDER_BY_TIMESTAMP_DESC = {
  property: 'timestamp',
  desc: true
}

const s3 = new AWS.S3({ accessKeyId, secretAccessKey });

interface IIPAddressCheck {
  application: IPBApp
  status: any
  payload: ITradleObject
  req: IPBReq
}

export class IPAddressCheckAPI {
  private bot: Bot
  private conf: any
  private applications: Applications
  private logger: Logger
  private outputLocation: string

  constructor({ bot, conf, applications, logger }) {
    this.bot = bot
    this.conf = conf
    this.applications = applications
    this.logger = logger
    this.outputLocation = this.bot.buckets.PrivateConf.id
  }

  findDataSource = async () => {
    return await this.bot.db.findOne({
      filter: {
        EQ: {
          [TYPE]: DATA_SOURCE_REFRESH,
          name: enumValue({
            model: this.bot.models[REFERENCE_DATA_SOURCES],
            value: 'maxmind'
          })
        },
        orderBy: ORDER_BY_TIMESTAMP_DESC
      }
    });
  }

  ipAddressLookupAndMatch = async (ip: string, payload: ITradleObject) => {
    let availabledb = await this.checkAvailability()
    if (!availabledb)
      return { status: 'error', message: 'MaxmindDb is not available', rawData: undefined }

    let maxminddb = MAXMIND_DIR + '/GeoLite2-City.mmdb'
    const lookup = await maxmind.open<CityResponse>(maxminddb);
    let find: CityResponse = lookup.get(ip)

    if (!find) {
      return { status: 'fail', message: `No address found for IP: ${ip}`, rawData: undefined }
    }
    else if (find.city.names.en == payload.city &&
      find.subdivisions[0].iso_code == payload.region &&
      find.country.iso_code == payload.country.id.split('_')[1]) {

      return { status: 'pass', message: undefined, rawData: find }
    }
    else {
      return { status: 'fail', message: 'No address Geo location match', rawData: find }
    }
  }

  checkAvailability = async (): Promise<boolean> => {
    !fs.existsSync(MAXMIND_DIR) && fs.mkdirSync(MAXMIND_DIR)
    let maxminddb = MAXMIND_DIR + '/GeoLite2-City.mmdb'
    if (!fs.existsSync(maxminddb)) {
      await this.s3download('maxmind/GeoLite2-City.mmdb.gz', maxminddb)
    }
    return fs.existsSync(maxminddb)
  }

  s3download = async (keyName: string, localDest: string) => {
    let params = {
      Bucket: this.outputLocation,
      Key: keyName
    }
    let file = fs.createWriteStream(localDest)
    let writePromise = this.writeStreamToPromise(file)
    await new Promise((resolve, reject) => {
      s3.getObject(params).createReadStream()
        .on('end', () => {
          return resolve()
        })
        .on('error', (error) => {
          return reject(error)
        }).pipe(zlib.createInflate()).pipe(file)
    })
    return writePromise
  }

  writeStreamToPromise = (stream: any) => {
    return new Promise((resolve, reject) => {
      stream.on('finish', resolve).on('error', reject)
    })
  }

  createCheck = async ({ application, status, payload, req }: IIPAddressCheck) => {
    // debugger
    let dataSourceLink = await this.findDataSource()

    let resource: any = {
      [TYPE]: IP_ADDRESS_CHECK,
      status: status.status,
      sourceType: COMMERCIAL,
      provider: PROVIDER,
      application,
      dateChecked: new Date().getTime(),
      aspects: ASPECTS,
      form: payload
    }

    if (dataSourceLink) resource.dataSource = buildResourceStub({ resource: dataSourceLink, models: this.bot.models })

    resource.message = getStatusMessageForCheck({ models: this.bot.models, check: resource })
    if (status.message) resource.resultDetails = status.message
    if (status.rawData) resource.rawData = status.rawData

    this.logger.debug(`${PROVIDER} Creating ipAddressCheck`)
    await this.applications.createCheck(resource, req)
    this.logger.debug(`${PROVIDER} Created ipAddressCheck`)
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const ipAddressCheckAPI = new IPAddressCheckAPI({ bot, conf, applications, logger })
  // debugger
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      logger.debug('ipAddressCheck called onmessage')
      if (req.skipChecks) return
      const { application, payload } = req
      if (!application) return

      if (ON_TYPE != payload[TYPE]) return

      if (!payload.country || !payload.region || payload.city)
        return

      logger.debug('ipAddressCheck before doesCheckNeedToBeCreated')
      let createCheck = await doesCheckNeedToBeCreated({
        bot,
        type: IP_ADDRESS_CHECK,
        application,
        provider: PROVIDER,
        form: payload,
        propertiesToCheck: ['country', 'region', 'city'],
        prop: 'form',
        req
      })
      logger.debug(`ipAddressCheck after doesCheckNeedToBeCreated with createCheck=${createCheck}`)

      if (!createCheck) return

      let ip = '38.96.131.224' // hardcoded IP 
      let status = await ipAddressCheckAPI.ipAddressLookupAndMatch(ip, payload)
      await ipAddressCheckAPI.createCheck({ application, status, payload, req })
    }
  }
  return { plugin }
}