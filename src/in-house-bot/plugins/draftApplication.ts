import _ from 'lodash'
import { CreatePlugin, IPluginLifecycleMethods } from '../types'
import { TYPE } from '@tradle/constants'
import { sendConfirmationEmail } from '../email-utils'
import { getAssociateResources, isSubClassOf } from '../utils'
export const name = 'draftApplication'

const APPLICATION = 'tradle.Application'
const PRODUCT_BUNDLE = 'tradle.ProductBundle'
const CHECK_OVERRIDE = 'tradle.CheckOverride'

const exclude = [
  'tradle.ProductRequest',
  'tradle.FormRequest',
  'tradle.FormError',
  'tradle.ApplicationSubmitted',
  'tradle.Verification',
  'tradle.OTP',
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
  let { conf } = pluginOpts
  const senderEmail = conf.senderEmail || components.conf.bot.senderEmail

  const plugin: IPluginLifecycleMethods = {
    getRequiredForms: async ({ user, application }) => {
      if (!application) return

      if (!application.forms || application.forms.length <= 1) {
        let pr = await bot.getResource(application.request)
        const { bundleId } = pr
        if (bundleId) {
          try {
            let bundle  = await bot.getResource({_link: bundleId, _permalink: bundleId, _t: PRODUCT_BUNDLE})
            if (bundle)
              return [PRODUCT_BUNDLE].concat(bot.models[pr.requestFor].forms)
          } catch (err) {
            debugger
          }
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
      let { forms } = applicationWithForms
      if (!forms.length) return
      let models = bot.models
      forms = forms
        .map(submission => submission.submission)
        .filter(form => !exclude.includes(form[TYPE]))

      let f = forms.find(form => productMap[form[TYPE]])
      let emailAddress

      if (!f && payload.parent) {
      // HACK -  need to send in chat not email when parent is known
        let parent = await bot.getResource(payload.parent, {backlinks: ['forms']})
        let parentForms = parent.forms
        .map(submission => submission.submission)
        .filter(form => !exclude.includes(form[TYPE]))

        f = parentForms.find(form => productMap[form[TYPE]])
        f = await bot.getResource(f)
        emailAddress = f[productMap[f[TYPE]]]
      }
      if (!f) return

      forms = await Promise.all(forms.map(form => bot.getResource(form)))
      let items = []
      let keepProperties = ['_t']
      forms = _.uniqBy(forms, '_permalink')

      forms.sort((a, b) => a._time - b._time)

      forms.forEach(form => {
        let type = form[TYPE]
        if (exclude.includes(type)) return
        if (isSubClassOf(CHECK_OVERRIDE, models[type], models)) return
        let emailProp = !emailAddress  &&  productMap[type]
        if (emailProp  &&  !emailAddress) {
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

      const { parentApp, associatedRes } = await getAssociateResources({application: payload, bot})
      let extraQueryParams = {
        bundleId: bundle.link
      }
      if (parentApp && associatedRes) {
        _.extend(extraQueryParams, {
          associatedResource: `${associatedRes[TYPE]}_${associatedRes._permalink}`,
          parentApplication: parentApp._permalink
        })
      }
      await sendConfirmationEmail({
        emailAddress,
        senderEmail,
        payload,
        bot,
        product: requestFor,
        subject: `Please review and complete the application for ${models[requestFor].title}`,
        name: 'Customer',
        extraQueryParams,
        message: '',
        template: CONFIRMATION_EMAIL_DATA_TEMPLATE
      })
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
