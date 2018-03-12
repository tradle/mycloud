import _ from 'lodash'
import { TYPE } from '@tradle/constants'
import { Conf } from '../configure'
import { parseId, parseStub } from '../../utils'
import { Bot, Logger, IPBApp, IPBReq, CreatePlugin } from '../types'
import baseModels from '../../models'

const objModelProps = baseModels['tradle.Object'].properties
const myProductProps = baseModels['tradle.MyProduct'].properties
const IGNORE_PROPS = Object.keys(objModelProps).concat(Object.keys(myProductProps))
const getLatestForms = forms => {
  const stubs = forms.map(parseStub)
  return stubs.reverse().reduce((uniq, stub) => {
    if (!uniq[stub.type]) {
      uniq[stub.type] = stub
    }

    return uniq
  }, {})
}

export const name = 'fill-myproduct'
export class FillMyProductPlugin {
  private bot: Bot
  private conf: any
  private logger: Logger
  constructor({ bot, conf, logger }: {
    bot: Bot
    conf: any
    logger: Logger
  }) {
    this.bot = bot
    this.conf = conf
    this.logger = logger
  }

  public willIssueCertificate = async ({ user, application, certificate }) => {
    const { models } = this.bot
    const model = models[certificate[TYPE]]
    if (!model) {
      this.logger.error('missing model for product certificate', { id: model.id })
      return
    }

    const propsToFill = _.difference(Object.keys(model.properties), IGNORE_PROPS)
    if (!propsToFill.length) return

    const stubs = getLatestForms(application.forms)
    const propToModel = {}
    const modelToProps = {}
    const stubsNeeded = stubs.filter(({ type }) => {
      const { id, properties } = models[type]
      return propsToFill.some(prop => {
        if (propToModel[prop]) return
        if (!(prop in properties)) return

        propToModel[prop] = model
        if (!modelToProps[id]) {
          modelToProps[id] = []
        }

        modelToProps[id].push(prop)
        return true
      })
    })

    const forms = await Promise.all(stubsNeeded.map(stub => this.bot.objects.get(stub)))
    for (const form of forms) {
      const props = modelToProps[form[TYPE]]
      _.extend(certificate, _.pick(form, props))
    }
  }
}

export const createPlugin:CreatePlugin = ({ bot }, { conf, logger }) => ({
  plugin: new FillMyProductPlugin({ bot, conf, logger })
})

// export const validateConf = async ({ conf, pluginConf }: {
//   conf: Conf,
//   pluginConf: any
// }) => {
//   const modelsPack = await conf.modelStore.getCumulativeModelsPack({ force: true })
//   const { lenses=[] } = modelsPack || []
//   const lensesById = _.groupBy(lenses, 'id')
//   for (let type in pluginConf) {
//     let vals = pluginConf[type]
//     for (let subType in vals) {
//       let lensId = vals[subType]
//       if (lensId) {
//         let lens = lensesById[lensId]
//         if (!lens) throw new Error(`missing lens: ${lensId}`)
//       }
//     }
//   }
// }
