import _ from 'lodash'
import { Bot, Logger, CreatePlugin, IPluginLifecycleMethods } from '../types'
import { TYPE } from '@tradle/constants'
import { sendConfirmationEmail } from '../email-utils'

export const name = 'draftApplication'
const APPLICATION = 'tradle.Application'
const PRODUCT_BUNDLE = 'tradle.ProductBundle'

const exclude = [
  'tradle.ProductRequest',
  'tradle.FormRequest',
  'tradle.FormError',
  'tradle.ApplicationSubmitted',
  'tradle.Verification'
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
  let { bot, applications, commands, smsBasedVerifier } = components
  let { logger, conf } = pluginOpts
  const plugin: IPluginLifecycleMethods = {
    getRequiredForms: async ({ user, application }) => {
      if (!application) return

      if (!application.forms || application.forms.length <= 1) {
        let pr = await bot.getResource(application.request)
        if (pr.bundleId) {
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

      let applicationWithForms = await bot.getResource(payload, { backlinks: ['forms'] })
      debugger
      let { forms } = applicationWithForms
      if (!forms.length) return
      forms = forms
        .map(submission => submission.submission)
        .filter(form => !exclude.includes(form[TYPE]))

      forms = await Promise.all(forms.map(form => bot.getResource(form)))
      let items = []
      let models = bot.models
      let keepProperties = ['_t']
      forms = _.uniqBy(forms, '_permalink')
      forms.sort((a, b) => a._time - b._time)
      forms.forEach(form => {
        let type = form[TYPE]
        if (exclude.includes(type)) return
        let properties = models[type].properties
        let item: any = {}
        items.push(item)
        item._sourceId = form._permalink
        for (let p in form) {
          if (!properties[p] && !keepProperties.includes(p)) continue
          if (typeof form[p] === 'object' && form[p]._permalink) {
            item[p] = { ...form[p], _refId: form[p]._permalink }
          } else item[p] = form[p]
        }
      })
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
        emailAddress: 'ellen@tradle.io',
        senderEmail: 'noreply@tradle.io',
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
      // await applications.updateApplication(payload)
    },
    async willRequestForm({ application, formRequest }) {
      if (!application || formRequest.form !== PRODUCT_BUNDLE) return
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
