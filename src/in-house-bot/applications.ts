import { TYPE, PERMALINK } from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import { parseStub } from '../utils'
import Errors from '../errors'
import {
  Bot,
  IBotComponents,
  DatedValue,
  IConf,
  Remediation,
  Deployment,
  IPluginOpts,
  IPluginLifecycleMethods,
  IPBReq
} from './types'

interface ICreateCheckOpts {
  props: any
  req?: IPBReq
}

export class Applications {
  private components: IBotComponents
  private get bot() {
    return this.components.bot
  }

  constructor(components: IBotComponents) {
    this.components = components
  }

  public createCheck = async ({ props, req }: ICreateCheckOpts) => {
    const { bot, productsAPI } = this.components
    const { models } = bot
    const type = props[TYPE]
    if (!(type && props.application)) {
      throw new Error('expected type and "application"')
    }

    const application = await (typeof props.application === 'string'
      ? bot.getResource({ type, permalink: props.application })
      : bot.getResourceByStub(props.application))

    const resource = await bot.createResource({ ...props, application })
    application.checks.push(buildResource.stub({ resource, models }))
    if (!req) {
      await productsAPI.saveNewVersionOfApplication({ application })
    }

    return resource
  }

  public updateCheck = async (opts) => {
    return await this.bot.updateResource(opts)
  }

  public judgeApplication = async ({ req, application, approve }) => {
    const { bot, productsAPI } = this.components
    const judge = req && req.user
    application = await productsAPI.getApplication(application)

    const user = await bot.users.get(parseStub(application.applicant).permalink)
    const method = approve ? 'approveApplication' : 'denyApplication'
    try {
      await productsAPI[method]({ req, judge, user, application })
    } catch (err) {
      Errors.ignore(err, Errors.Duplicate)
      throw new Error(`application already has status: ${application.status}`)
    }

    if (req) return

    await productsAPI.saveNewVersionOfApplication({ user, application })
    await bot.users.merge(user)
  }

  public approve = async (opts) => {
    return this.judgeApplication({ ...opts, approve: true })
  }

  public deny = async (opts) => {
    return this.judgeApplication({ ...opts, approve: false })
  }
}
