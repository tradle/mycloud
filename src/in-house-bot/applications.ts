// @ts-ignore
import Promise from 'bluebird'
import groupBy from 'lodash/groupBy'
import maxBy from 'lodash/maxBy'
import pick from 'lodash/pick'
import omit from 'lodash/omit'
import uniqBy from 'lodash/uniqBy'
import flatMap from 'lodash/flatMap'
import flatten from 'lodash/flatten'
import isEmpty from 'lodash/isEmpty'
import buildResource from '@tradle/build-resource'
import validateResource from '@tradle/validate-resource'
import { parseStub } from '../utils'
import { isPassedCheck, removeRoleFromUser } from './utils'
import Errors from '../errors'
import { mixin as modelsMixin } from '../models-mixin'
import { TYPE, PERMALINK } from '../constants'
import { TYPES } from './constants'
import {
  Bot,
  ResourceStub,
  ParsedResourceStub,
  IPBReq,
  IPBApp,
  ITradleObject,
  ITradleCheck,
  IPBUser,
  ApplicationSubmission,
  Logger,
  IMyProduct,
  IHasModels,
  IUser,
  Model,
  UpdateResourceOpts
} from './types'

interface IPBJudgeAppOpts {
  req?: IPBReq
  application: string | IPBApp | ResourceStub
  approve?: boolean
}

interface IPropertyInfo {
  name: string
  message?: string
}

interface RequestItemOpts {
  item: string | ITradleObject
  message?: string
  req?: IPBReq
  user?: IPBUser
  application?: IPBApp
  other?: any
}

const {
  APPLICATION,
  APPLICATION_SUBMISSION,
  MY_EMPLOYEE_ONBOARDING,
  ASSIGN_RELATIONSHIP_MANAGER,
  PRODUCT_REQUEST
} = TYPES

const PRUNABLE_FORMS = [ASSIGN_RELATIONSHIP_MANAGER, PRODUCT_REQUEST]

type AppInfo = {
  application: IPBApp
}

export class Applications implements IHasModels {
  private bot: Bot
  private productsAPI: any
  private employeeManager: any
  private logger: Logger
  public get models() {
    return this.bot.models
  }

  // IHasModels
  public buildResource: (model: string | Model) => any
  public buildStub: (resource: ITradleObject) => ResourceStub
  public validateResource: (resource: ITradleObject) => any
  public validatePartialResource: (resource: ITradleObject) => void
  public getModel: (id: string) => Model

  constructor({
    bot,
    productsAPI,
    employeeManager
  }: {
    bot: Bot
    productsAPI: any
    employeeManager: any
  }) {
    modelsMixin(this)
    this.bot = bot
    this.productsAPI = productsAPI
    this.employeeManager = employeeManager
    this.logger = bot.logger.sub('applications')
  }

  public createCheck = async props => {
    const { bot, productsAPI } = this
    const { models } = bot
    const type = props[TYPE]
    if (!(type && props.application)) {
      throw new Error('expected type and "application"')
    }

    return await bot
      .draft({ type })
      .set(props)
      .signAndSave()
  }

  public updateCheck = async (opts: UpdateResourceOpts) => {
    const result = await this.bot.updateResource(opts)
    return result.resource
  }
  public judgeApplication = async ({ req, application, approve }: IPBJudgeAppOpts) => {
    const { bot, productsAPI } = this
    application = (await productsAPI.getApplication(application)) as IPBApp

    const user = await this._getApplicantFromApplication(application)
    let judge
    if (req && this._isSenderEmployee(req)) {
      judge = req.user
    }

    const method = approve ? 'approveApplication' : 'denyApplication'
    try {
      await productsAPI[method]({ req, judge, user, application })
    } catch (err) {
      Errors.ignore(err, Errors.Duplicate)
      Errors.rethrowAs(err, new Error(`application already has status: ${application.status}`))
    }

    if (approve) {
      // maybe this should be done asynchronously on resource stream
      // verify unverified
      await this.issueVerifications({ req, user, application, send: true })
    }

    if (req) return

    await this._commitApplicationUpdate({ application })
  }

  public updateApplication = async application => {
    await this._commitApplicationUpdate({ application })
  }

  public approve = async opts => {
    return this.judgeApplication({ ...opts, approve: true })
  }

  public deny = async opts => {
    return this.judgeApplication({ ...opts, approve: false })
  }

  public verify = async opts => {
    return await this.productsAPI.verify(opts)
  }

  public haveAllFormsBeenVerified = async ({ application }: AppInfo) => {
    const unverified = await this.getUnverifiedForms({ application })
    return !unverified.length
  }

  public getUnverifiedForms = async ({ application }: AppInfo) => {
    const appSubs = application.forms || []
    if (!appSubs.length) return []

    const formStubs = getCustomerFormStubs({ application })
    const verifications = await this.getVerificationsForApplication({ application })
    const verified = verifications.map(verification => parseStub(verification.document))
    return formStubs.filter(stub => {
      const { permalink } = parseStub(stub)
      return !verified.find(form => form.permalink === permalink)
    })
  }

  public getVerificationsForApplication = async ({ application }: AppInfo) => {
    const { verifications = [] } = application
    return await Promise.map(verifications, appSub => this.bot.getResource(appSub.submission))
  }

  public getCustomerForms = async ({ application }: AppInfo) => {
    const stubs = getCustomerFormStubs({ application })
    return await Promise.all(stubs.map(stub => this.bot.getResource(stub)))
  }

  public getVerificationsForCustomerForms = async ({ application }: AppInfo) => {
    const stubs = (application.verifications || []).map(appSub => appSub.submission)
    return await Promise.all(stubs.map(stub => this.bot.getResource(stub)))
  }

  public getCustomerFormsAndVerifications = async ({ application }: AppInfo) => {
    return {
      forms: await this.getCustomerForms({ application }),
      verifications: await this.getVerificationsForCustomerForms({ application })
    }
  }

  public issueVerifications = async ({
    req,
    user,
    application,
    send
  }: {
    req?: IPBReq
    user: IPBUser
    application: IPBApp
    send?: boolean
  }) => {
    const stubs = getCustomerFormsAndVerificationStubs({ application })
    const formStubs = stubs.forms
    if (!formStubs.length) return []

    const verifications = await Promise.all(
      stubs.verifications.map(stub => this.bot.getResource(stub))
    )

    // avoid building increasingly tall trees of verifications
    const sourcesOnly = flatMap(verifications, v => (isEmpty(v.sources) ? v : v.sources))
    return await formStubs.map(async formStub => {
      const sources = sourcesOnly.filter(
        v => parseStub(v.document).link === parseStub(formStub).link
      )
      // if (!sources.length) {
      //   this.logger.debug('not issuing verification for form, as no source verifications found', formStub)
      //   return
      // }

      const verification = await this.productsAPI.verify({
        req,
        user,
        application,
        object: formStub,
        verification: { sources },
        send
      })

      await this.bot.sealIfNotBatching({
        counterparty: user.id,
        object: verification
      })

      return verification
    })
  }

  public sealFormsForApplication = async ({ application }: AppInfo) => {
    const forms = await this.getCustomerForms({ application })
    const counterparty = getApplicantPermalink(application)
    // avoid re-sealing
    const subs = forms.filter(sub => !sub._seal)
    // verifications are sealed in issueVerifications
    await Promise.all(subs.map(object => this.bot.sealIfNotBatching({ counterparty, object })))
  }

  public createSealsForApprovedApplication = async ({ application }: AppInfo) => {
    const { bot } = this
    const promises = [this.sealFormsForApplication({ application })]

    const { certificate } = application
    if (certificate && !certificate._seal) {
      const sealCert = bot.getResource(certificate).then(object =>
        bot.sealIfNotBatching({
          counterparty: getApplicantPermalink(application),
          object
        })
      )

      promises.push(sealCert)
    }

    return await Promise.all(promises).then(results => flatten(results))
  }

  public organizeSubmissions = (application: IPBApp) => {
    this.productsAPI.state.organizeSubmissions(application)
    return application
  }

  public requestEdit = async opts => {
    const { req = {}, item } = opts
    if (item && item[TYPE]) {
      this.validatePartialResource(item)
    }

    return await this.productsAPI.requestEdit({
      ...opts,
      application: opts.application || req.application,
      applicant: opts.applicant || req.applicant
    })
  }

  public requestItem = async (opts: RequestItemOpts) => {
    return await this.productsAPI.requestItem(opts)
  }

  public getLatestChecks = async ({ application }: AppInfo): Promise<ITradleCheck[]> => {
    const { checks = [] } = application
    if (!checks.length) return []

    const bodies = await Promise.all(
      checks
        // get latest version of those checks
        .map(stub => omit(parseStub(stub), 'link'))
        .map(stub => this.bot.getResource(stub))
    )

    const timeDesc = bodies.slice().sort((a, b) => b._time - a._time)
    return uniqBy(timeDesc, TYPE)
  }

  public haveAllChecksPassed = async ({ application }: AppInfo) => {
    const { checks = [] } = application
    if (!checks.length) return true

    const checkResources = await this.getLatestChecks({ application })
    const byAPI: any = groupBy(checkResources, 'provider')
    const latest = Object.keys(byAPI).map(provider => byAPI[provider].pop())
    const allPassed = latest.every(check => isPassedCheck(check))
    this.logger.silly('have all checks passed?', {
      application: application._permalink,
      checks: latest.map(check => this.buildStub(check))
    })

    return allPassed
  }

  public createVerification = async ({
    req,
    application,
    verification
  }: {
    verification: ITradleObject
    application?: IPBApp
    req?: IPBReq
  }) => {
    verification = await this.bot.sign(verification)
    const promiseSave = this.bot.save(verification)
    if (application) {
      // we're not sending this verification yet,
      // so we need to create the ApplicationSubmission manually
      await this.createApplicationSubmission({ application, submission: verification })
    }

    this.productsAPI.importVerification({ application, verification })
    this.logger.debug('created verification', {
      verification: verification._permalink,
      application: application._permalink,
      document: verification.document._permalink
    })

    await promiseSave
    return verification
  }

  public createApplicationSubmission = async ({
    application,
    submission
  }: {
    application: IPBApp
    submission: ITradleObject
  }) => {
    const resource = await this.bot
      .draft({ type: APPLICATION_SUBMISSION })
      .set({
        application,
        submission,
        context: application.context
      })
      .sign()

    const signed = resource.toJSON()
    this.productsAPI.state.addSubmission({ application, submission: signed })
    await resource.save()
    return signed
  }
  public deactivateChecks = async ({
    application,
    type,
    form
  }: {
    application: IPBApp
    type: string
    form?: ITradleObject
  }) => {
    const checksOfType = application.checks.filter(check => check[TYPE] === type)
    const checks = await Promise.all(checksOfType.map(check => this.bot.getResource(check)))
    const deactivatedChecks = checks.filter(check => {
      if (check.isInactive) return false
      // by check type
      if (!form) return true
      // by check type and form
      if (check.form && check.form[PERMALINK] === form[PERMALINK]) return true
    })

    if (!deactivatedChecks.length) return

    await Promise.all(
      deactivatedChecks.map(check =>
        this.bot.versionAndSave({
          ...check,
          isInactive: true
        })
      )
    )
  }
  // public getChecks = async (application:IPBApp) => {
  //   const stubs = (application.checks || application.submissions || []).map(appSub => appSub.submission)
  //   return Promise.all(stubs.map(this.bot.getResource))
  // }

  public createApplication = async ({
    user,
    application,
    req
  }: {
    req?: IPBReq
    user: IPBUser
    application: ITradleObject
  }) => {
    const res = await this.bot
      .draft({ type: APPLICATION })
      .set(application)
      .signAndSave()

    const signed = res.toJSON({ virtual: true })
    if (!user.applications) {
      user.applications = []
    }

    this.productsAPI.state.addApplication({ user, application: signed })
    if (!req) {
      await this.bot.users.merge(pick(user, ['id', 'applications']))
    }

    return signed
  }

  public getCustomerFormStubs = getCustomerFormStubs

  public listEmployees = async () => {
    return this.employeeManager.list()
  }

  public fireEmployee = async ({ req, myProductId }: { req?: IPBReq; myProductId: string }) => {
    const revokedCertificate = await this.revokeProductCertificateWithMyProductId({
      req,
      certificateModelId: MY_EMPLOYEE_ONBOARDING,
      myProductId
    })

    const owner = parseStub(revokedCertificate.owner)
    await this.bot.send({
      to: owner.permalink,
      object: revokedCertificate
    })
  }

  public getProductCertificateByMyProductId = async ({
    certificateModelId,
    myProductId
  }: {
    certificateModelId: string
    myProductId: string
  }): Promise<IMyProduct> => {
    const model = this.getModel(certificateModelId)
    if (!model.properties.myProductId) {
      throw new Errors.InvalidInput(`model ${certificateModelId} has no property "myProductId"`)
    }

    return await this.bot.db.findOne({
      filter: {
        EQ: {
          [TYPE]: certificateModelId,
          myProductId,
          _author: await this.bot.getMyPermalink()
        }
      }
    })
  }

  public revokeProductCertificateWithMyProductId = async ({
    req,
    certificateModelId,
    myProductId
  }: {
    req?: IPBReq
    certificateModelId: string
    myProductId: string
  }): Promise<IMyProduct> => {
    const certificate = await this.getProductCertificateByMyProductId({
      certificateModelId,
      myProductId
    })
    return await this.revokeProductCertificate({ req, certificate })
  }

  public revokeProductCertificate = async ({
    req,
    certificate
  }: {
    req?: IPBReq
    certificate: IMyProduct
  }): Promise<IMyProduct> => {
    const type = certificate[TYPE]
    const { properties } = this.models[type]
    if (!properties.revoked) {
      throw new Errors.InvalidInput(`model "${type}" has no property "revoked"`)
    }

    const promiseRevoke = this.bot.versionAndSave({
      ...certificate,
      revoked: true
    })

    let promiseFireEmployee
    if (certificate[TYPE] === MY_EMPLOYEE_ONBOARDING) {
      const userId = parseStub(certificate.owner).permalink
      promiseFireEmployee = this._removeEmployeeRole({ req, userId })
    }

    const { cert } = await Promise.props({
      cert: promiseRevoke,
      fire: promiseFireEmployee
    })

    return cert
  }

  private _removeEmployeeRole = async ({ req, userId }: { req?: IPBReq; userId: string }) => {
    const user = await this.bot.users.get(userId)
    if (removeRoleFromUser(user, 'employee')) {
      await this.bot.users.save(user)
    }
  }

  private _getApplicantFromApplication = async (application: IPBApp) => {
    return await this.bot.users.get(application.applicant._permalink)
  }

  private _commitApplicationUpdate = async ({
    application,
    user
  }: {
    application: IPBApp
    user?: IPBUser
  }) => {
    if (!user) {
      user = await this._getApplicantFromApplication(application)
    }
    if (!user.applications) {
      this.logger.debug(`user does not have this application yet - ${application.requestFor}`)
      return
    }

    await this.productsAPI.saveNewVersionOfApplication({ user, application })
    await this.bot.users.save(user)
  }

  private _isSenderEmployee = (req: IPBReq) => {
    const { user } = req
    if (!user) return

    return this.employeeManager.isEmployee(user)
  }

  // public requestEdit = async (opts: {
  //   req?: IPBReq
  //   user?: IPBUser
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

const getCustomerSubmissions = ({ forms }: { forms: ApplicationSubmission[] }) => {
  if (!forms) return []
  return forms.filter(f => !PRUNABLE_FORMS.includes(f.submission[TYPE]))
}

const getCustomerFormStubs = ({ application }: AppInfo) => {
  const { forms = [] } = application
  return getCustomerSubmissions({ forms }).map(s => s.submission)
}

// const getApplicationWithCustomerSubmittedForms = (application: IPBApp):IPBApp => ({
//   ...application,
//   forms: getCustomerSubmissions({
//     forms: application.forms || []
//   })
// })

const getCustomerFormsAndVerificationStubs = ({ application }: AppInfo) => ({
  forms: getCustomerFormStubs({ application }),
  verifications: (application.verifications || []).map(appSub => appSub.submission)
})

const getLatestVerifications = ({ verifications }) => {
  verifications = verifications.filter(v => !v.revoked)
  if (!verifications.length) return verifications

  const perForm = groupBy(verifications, v => parseStub(v.document).permalink)
  return Object.keys(perForm).map(formPermalink => maxBy(perForm[formPermalink], '_time'))
}

const getApplicantPermalink = (application: IPBApp) => parseStub(application.applicant).permalink
