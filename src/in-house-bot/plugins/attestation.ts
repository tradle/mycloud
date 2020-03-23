import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { title as getDisplayName } from '@tradle/build-resource'
import {
  CreatePlugin,
  IPluginLifecycleMethods,
  IWillJudgeAppArg,
  ITradleObject,
  IPBReq,
  Applications,
  Logger,
  Bot
} from '../types'

const ATTESTATION = 'tradle.Attestation'
const ATTESTATION_ITEM = 'tradle.AttestationItem'
const ATTESTATION_CHECK = 'tradle.AttestationCheck'
const FORM_REQUEST = 'tradle.FormRequest'
const PHOTO_ID = 'tradle.PhotoID'
const PERSONAL_INFO = 'tradle.PersonalInfo'
const ASPECTS = 'Attestation'

export const name = 'attestation'
const exclude = [
  'tradle.ProductRequest',
  FORM_REQUEST,
  'tradle.NextFormRequest',
  'tradle.Verification',
  'tradle.TermsAndConditions',
  'tradle.FormError'
]

class AttestationsAPI {
  private bot: Bot
  private logger: Logger
  private conf: any
  private applications: Applications
  private riskFactors: any
  constructor({ bot, conf, logger, applications }) {
    this.bot = bot
    this.conf = conf
    this.logger = logger
    this.applications = applications
    this.riskFactors = conf.riskFactors
  }
  async checkAttestation(req) {
    let { payload, application } = req
    let rejected = payload.items.filter(item => !item.confirmation)
    if (!rejected.length) return

    let noApplication = !application
    if (noApplication) {
      application = await this.bot.getResource(payload.application, { backlinks: ['forms'] })
      req.application = application
    }
    let { models } = this.bot

    let form = application.forms.find(
      form => form.submission[TYPE] === PHOTO_ID || form.submission[TYPE] === PERSONAL_INFO
    )
    await this.applications.createCheck(
      {
        [TYPE]: ATTESTATION_CHECK,
        status: 'warning',
        provider: application.applicantName,
        application: payload.parentApplication,
        attestedBy: form.submission,
        dateChecked: Date.now(),
        aspects: ASPECTS,
        form: payload,
        message: `Failed confirmation: rejected ${rejected
          .map(r => getDisplayName({ models, model: models[r.item[TYPE]], resource: r.item }))
          .join(', ')}`
      },
      req
    )
    if (noApplication) req.application = null
  }
}
export const createPlugin: CreatePlugin<void> = ({ bot, applications }, { logger, conf }) => {
  const attestationAPI = new AttestationsAPI({
    bot,
    conf,
    logger,
    applications
  })
  const plugin: IPluginLifecycleMethods = {
    name: 'attestation',

    // async onmessage(req: IPBReq) {
    //   let { application, payload } = req

    //   if (payload[TYPE] === ATTESTATION) {
    //     await attestationAPI.checkAttestation(req)
    //     return
    //   }
    //   if (!application) return
    //   let { products } = conf
    //   let { items, requestFor } = application
    //   if (!products || !products.includes(requestFor)) return

    //   if (!items) return
    //   items = await Promise.all(items.map(item => bot.getResource(item)))

    //   items = items.filter(item => products.includes(item[TYPE]))
    //   if (!items.length) return
    //   debugger
    // },
    async didApproveApplication(opts: IWillJudgeAppArg, certificate: ITradleObject) {
      let { application, user, req } = opts

      if (!application || !req) return

      let { requestFor, parent, associatedResource } = application
      if (!parent || !associatedResource) return

      let { products } = conf
      if (!products || !products.includes(requestFor)) return

      if (!parent.forms)
        parent = await bot.getResource(parent, { backlinks: ['forms', 'notifications'] })
      debugger
      let { forms } = parent
      forms = forms.filter(f => !exclude.includes(f.submission[TYPE]))
      associatedResource = await bot.getLatestResource(associatedResource)
      if (!associatedResource.isSeniorManager) return

      forms.sort((a, b) => b._time - a._time)
      forms = forms.map(f => f.submission)
      forms = _.uniqBy(forms, '_permalink')

      forms = await Promise.all(forms.map(f => bot.getResource(f)))

      let item = {
        [TYPE]: FORM_REQUEST,
        form: ATTESTATION,
        product: parent.requestFor,
        message: 'Please review and confirm',
        prefill: {
          [TYPE]: ATTESTATION,
          application,
          parentApplication: parent,
          items: forms.map(resource => {
            let props = bot.models[resource[TYPE]].properties
            let r: any = {}

            for (let p in resource) {
              if (props[p]) r[p] = resource[p]
            }
            r[TYPE] = resource[TYPE]
            // r._link = resource._link
            r._permalink = resource._permalink
            delete r.top
            delete r.parent
            return {
              [TYPE]: ATTESTATION_ITEM,
              // itemPermalink: resource._permalink,
              // itemLink: resource._link,
              item: r
            }
          })
        }
      }
      await applications.requestItem({
        item,
        application,
        req,
        user,
        message: 'Please review and confirm'
      })
    }
  }
  return {
    plugin
  }
}
