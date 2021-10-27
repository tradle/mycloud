import _ from 'lodash'
import { Bot, Logger, CreatePlugin, IPluginLifecycleMethods } from '../types'
import { TYPE } from '@tradle/constants'
import { sendConfirmationEmail } from '../email-utils'

export const name = 'draftApplication'

const APPLICATION = 'tradle.Application'
const PRODUCT_BUNDLE = 'tradle.ProductBundle'
const LEGAL_ENTITY = 'tradle.legal.LegalEntity'

const exclude = [
  'tradle.ProductRequest',
  'tradle.FormRequest',
  'tradle.FormError',
  'tradle.ApplicationSubmitted',
  'tradle.Verification',
  'tradle.NextFormRequest'
]
const CONFIRMATION_EMAIL_DATA_TEMPLATE = {
  template: 'action',
  blocks: [
    { body: 'Hello {{name}}' },
    { body: '{{message}}' }, // 'Click below to complete your onboarding' },
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

export const createPlugin: CreatePlugin<void> = (components, pluginOpts) => {
  let { bot } = components
  let { logger, conf } = pluginOpts
  const senderEmail = conf.senderEmail || components.conf.bot.senderEmail

  const plugin: IPluginLifecycleMethods = {
    getRequiredForms: async ({ user, application }) => {
      if (!application) return

      if (!application.forms || application.forms.length <= 1) {
        let pr = await bot.getResource(application.request)
        if (pr.bundleId  &&  pr.bundleId.split('_') === PRODUCT_BUNDLE) {
          // debugger
          return [PRODUCT_BUNDLE].concat(bot.models[pr.requestFor].forms)
        }
      }
    },
    async onmessage(req) {
      // useRealSES(bot)
      let { payload } = req
      if (payload[TYPE] !== APPLICATION) return
      if (!payload.draftCompleted) return

      let productMap = conf[payload.requestFor]
      if (!productMap) return

      let applicationWithForms = await bot.getResource(payload, { backlinks: ['forms'] })
      debugger
      let { forms } = applicationWithForms
      if (!forms.length) return
      let models = bot.models
      forms = forms
        .map(submission => submission.submission)
        .filter(form => !exclude.includes(form[TYPE]))

      let f = forms.find(form => productMap[form[TYPE]])  
      if (!f) return

      forms = await Promise.all(forms.map(form => bot.getResource(form)))
      let items = []
      let keepProperties = ['_t']
      forms = _.uniqBy(forms, '_permalink')

      let emailAddress

      forms.sort((a, b) => a._time - b._time)
      forms.forEach(form => {
        let type = form[TYPE]
        if (exclude.includes(type)) return
        let emailProp = productMap[type]
        if (emailProp  &&  !emailAddress) {
          debugger
          emailAddress = form[emailProp]
        }
        let properties = models[type].properties
        let item: any = {}
        items.push(item)
        item._sourceId = form._permalink
        for (let p in form) {
          if (!properties[p] && !keepProperties.includes(p)) continue
          if (form[p] === null) {
            debugger
            continue
          }
          if (typeof form[p] === 'object' && form[p]._permalink) {
            item[p] = { ...form[p], _refId: form[p]._permalink }
          } else item[p] = form[p]
        }
      })
      if (!emailAddress) return
      debugger
      const requestFor = payload.requestFor
      let bundle = await bot
        .draft({
          type: PRODUCT_BUNDLE
        })
        .set({
          items,
          requestFor
        })
        .signAndSave()

      await sendConfirmationEmail({
        emailAddress,
        senderEmail,
        payload,
        bot,
        product: requestFor,
        subject: `Please review and complete the application for ${models[requestFor].title}`,
        name: 'Customer',
        extraQueryParams: {
          bundleId: bundle.link
        },
        message: '',
        template: CONFIRMATION_EMAIL_DATA_TEMPLATE
      })
      debugger
    },
    async willRequestForm({ application, formRequest }) {
      if (!application || formRequest.form !== PRODUCT_BUNDLE) return
      let productMap = conf[application.requestFor]
      if (!productMap) return
      let pr = await bot.getResource(application.request)
      if (!pr.bundleId) return
      let bundle = await bot.db.findOne({
        filter: {
          EQ: {
            [TYPE]: PRODUCT_BUNDLE,
            _permalink: pr.bundleId
          }
        }
      })
      if (!bundle) return
      // application.processingDataBundle = true
      formRequest.message = `Please review and complete the application for **${
        bot.models[application.requestFor].title
      }**`
      formRequest.prefill = {
        [TYPE]: PRODUCT_BUNDLE,
        items: bundle.items
      }
    }
  }
  return {
    plugin
  }
}
