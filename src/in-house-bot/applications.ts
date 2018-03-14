import { TYPE, PERMALINK } from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import { parseStub } from '../utils'
import Errors from '../errors'
import {
  Bot,
  ResourceStub,
  IPBReq,
  IPBApp,
  ITradleObject,
  IUser
} from './types'

interface ICreateCheckOpts {
  props: any
  req?: IPBReq
}

interface IPBJudgeAppOpts {
  req?: IPBReq
  application: string|IPBApp|ResourceStub
  approve?: boolean
}

interface IPropertyInfo {
  name: string
  message?: string
}

export class Applications {
  private bot: Bot
  private productsAPI: any
  constructor({ bot, productsAPI }: {
    bot: Bot
    productsAPI: any
  }) {
    this.bot = bot
    this.productsAPI = productsAPI
  }

  public createCheck = async ({ props, req }: ICreateCheckOpts) => {
    const { bot, productsAPI } = this
    const { models } = bot
    const type = props[TYPE]
    if (!(type && props.application)) {
      throw new Error('expected type and "application"')
    }

    const application = await this.productsAPI.getApplication(props.application)
    const resource = await bot.createResource({ ...props, application })
    if (!application.checks) {
      application.checks = []
    }

    application.checks.push(this.stub(resource))
    if (!req) {
      await this._commitApplicationUpdate({ application })
    }

    return resource
  }

  public updateCheck = async (opts) => {
    const result = await this.bot.updateResource(opts)
    const check = result.resource
    if (!result.changed) return check
    if (!check.application) return check

    const application = await this.bot.getResource(parseStub(check.application))
    const idx = application.checks.find(stub => {
      return parseStub(stub).permalink === check._permalink
    })

    if (idx === -1) return check

    application.checks[idx] = this.stub(check)
    if (opts.req) return

    await this._commitApplicationUpdate({ application })
    return check
  }

  public judgeApplication = async ({ req, application, approve }: IPBJudgeAppOpts) => {
    const { bot, productsAPI } = this
    const judge = req && req.user
    application = await productsAPI.getApplication(application) as IPBApp

    const user = await this.getApplicantFromApplication(application)
    const method = approve ? 'approveApplication' : 'denyApplication'
    try {
      await productsAPI[method]({ req, judge, user, application })
    } catch (err) {
      Errors.ignore(err, Errors.Duplicate)
      throw new Error(`application already has status: ${application.status}`)
    }

    if (req) return

    await this._commitApplicationUpdate({ application })
  }

  public approve = async (opts) => {
    return this.judgeApplication({ ...opts, approve: true })
  }

  public deny = async (opts) => {
    return this.judgeApplication({ ...opts, approve: false })
  }

  public requestEdit = async (opts) => {
    return await this.productsAPI.requestEdit(opts)
  }

  private stub = (resource: ITradleObject) => {
    return buildResource.stub({
      models: this.bot.models,
      resource
    })
  }

  private getApplicantFromApplication = async (application: IPBApp) => {
    return await this.bot.users.get(parseStub(application.applicant).permalink)
  }

  private _commitApplicationUpdate = async ({ application, user }: {
    application: IPBApp
    user?: IUser
  }) => {
    if (!user) {
      user = await this.getApplicantFromApplication(application)
    }

    await this.productsAPI.saveNewVersionOfApplication({ user, application })
    await this.bot.users.save(user)
  }

  // public requestEdit = async (opts: {
  //   req?: IPBReq
  //   user?: IUser
  //   application?: IPBApp
  //   item: ITradleObject
  //   properties?: IPropertyInfo[]
  // }) => {
  //   const { req, properties, errors } = opts
  //   let {
  //     item,
  //     user = req.user,
  //     application = req.application,
  //     prefill
  //   } = opts

  //   if (application && !application.context) {
  //     application = this.productsAPI.getApplication(application)
  //   }

  //   const details = {}
  //   if (properties) {

  //   }

  //   const editOpts = { req, user, item, details }

  //   return await this.productsAPI.requestEdit(editOpts)
  // }
  // public listProducts = () => {

  // }
}
