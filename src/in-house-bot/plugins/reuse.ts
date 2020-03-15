import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import {
  CreatePlugin,
  IPBReq,
  IPluginLifecycleMethods,
  Applications,
  Logger,
  Bot,
  IPBApp,
  ITradleCheck
} from '../types'
import { getLatestChecks } from '../utils'
import { getEnumValueId } from '../../utils'

const APPLICATION = 'tradle.Application'
const CP = 'tradle.legal.LegalEntityControllingPerson'
const LEGAL_ENTITY = 'tradle.legal.LegalEntity'
const REUSE_CHECK = 'tradle.ReuseOfDataCheck'
const COUNTRY = 'tradle.Country'
const ASPECTS = 'Reusing previously onboarded entity'
const PROVIDER = 'Tradle'

export class ReuseAPI {
  private bot: Bot
  private applications: Applications
  private logger: Logger
  constructor({ bot, applications, logger }) {
    this.bot = bot
    this.applications = applications
    this.logger = logger
  }
  public async handleCompany({ req }) {
    let { application, payload } = req
    const { models } = this.bot

    const countryCode = getEnumValueId({
      model: models[COUNTRY],
      value: payload.controllingEntityCountry
    })
    let { controllingEntityCompanyNumber } = payload
    if (controllingEntityCompanyNumber.length < 8) {
      if (countryCode === 'GB') {
        if (/^\d/.test(controllingEntityCompanyNumber) && controllingEntityCompanyNumber.length < 8)
          controllingEntityCompanyNumber = controllingEntityCompanyNumber.padStart(8, '0')
      }
    }
    let items
    try {
      ;({ items } = await this.bot.db.find({
        filter: {
          EQ: {
            [TYPE]: LEGAL_ENTITY,
            registrationNumber: controllingEntityCompanyNumber
          }
        }
      }))
    } catch (err) {
      this.logger.error('Search for LE to reuse', err)
      debugger
    }
    if (!items || !items.length) return items
    items = items.filter(
      item => getEnumValueId({ model: models[COUNTRY], value: item.country }) === countryCode
    )
    return items
  }
  public async handlePerson({ req }) {
    let { application, payload } = req
    let {
      prefilledName,
      controllingEntityDateOfBirth,
      controllingEntityCountryOfResidence
    } = payload
    let items
    try {
      ;({ items } = await this.bot.db.find({
        filter: {
          EQ: {
            [TYPE]: CP,
            prefilledName
          }
        }
      }))
    } catch (err) {
      this.logger.error('Search for CP to reuse', err)
      debugger
    }
    if (!items || !items.length) return items
    let dateOfBirth = new Date(controllingEntityDateOfBirth)
    let dobYear = dateOfBirth.getFullYear()
    let dobMon = dateOfBirth.getMonth()
    items = items.filter(item => {
      if (item.controllingEntityCountryOfResidence.id !== controllingEntityCountryOfResidence.id)
        return false
      let d = new Date(item.controllingEntityDateOfBirth)
      return d.getFullYear() === dobYear && d.getMonth() === dobMon
    })

    // items = items.filter(
    //   item => getEnumValueId({ model: models[COUNTRY], value: item.country }) === countryCode
    // )
    // if (!items.length) return
    return items
  }
}
export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { conf, logger }) => {
  const reuseAPI = new ReuseAPI({ bot, applications, logger })
  const plugin: IPluginLifecycleMethods = {
    async onmessage(req: IPBReq) {
      let { application, payload } = req
      if (!application || application.draft) return

      if (payload[TYPE] !== CP) return
      let latestChecks: any = req.latestChecks || (await getLatestChecks({ application, bot }))
      if (
        latestChecks &&
        latestChecks.find(
          check => check[TYPE] === REUSE_CHECK && check.form._permalink === payload._permalink
        )
      )
        return

      let resources
      if (payload.controllingEntityCompanyNumber) resources = await reuseAPI.handleCompany({ req })
      else if (payload.controllingEntityDateOfBirth)
        resources = await reuseAPI.handlePerson({ req })
      else return
      if (!resources || !resources.length) return

      let items: any
      try {
        ;({ items } = await bot.db.find({
          filter: {
            EQ: {
              [TYPE]: APPLICATION,
              status: 'approved'
            },
            NULL: {
              associatedResource: false
            },
            IN: {
              'associatedResource._permalink': resources.map(item => item._permalink)
            }
          }
        }))
      } catch (err) {
        debugger
      }
      // debugger
      items = items.filter((a: IPBApp) => {
        if (a && !a.draft && a.status === 'approved') return true
        else return false
      })
      if (!items || !items.length) return

      items.sort((a: IPBApp, b: IPBApp) => b._time - a._time)
      // debugger
      let resource: any = {
        [TYPE]: REUSE_CHECK,
        status: 'warning',
        provider: PROVIDER,
        application,
        dateChecked: Date.now(), //rawData.updated_at ? new Date(rawData.updated_at).getTime() : new Date().getTime(),
        aspects: ASPECTS,
        form: payload,
        message: 'Please make a decision if data can be reused.',
        reusableApplication: items[0]
      }

      await applications.createCheck(resource, req)
    }
  }

  return { plugin }
}
