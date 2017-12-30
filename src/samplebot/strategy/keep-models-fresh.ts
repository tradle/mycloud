import _ = require('lodash')
import ModelsPack = require('@tradle/models-pack')
import baseModels = require('../../models')
import { isPromise, stableStringify } from '../../utils'

const BASE_MODELS_IDS = Object.keys(baseModels)
const mapModelsToPack = new Map()

export const defaultPropertyName = 'modelsHash'
export const getDefaultIdentifierFromUser = (user) => user.id
export const getDefaultIdentifierFromReq = ({ user }) => getDefaultIdentifierFromUser(user)

export const keepModelsFreshPlugin = ({
  getModelsForUser,
  propertyName=defaultPropertyName,
  // unique identifier for counterparty
  // which will be used to track freshness.
  // defaults to user.id
  getIdentifier=getDefaultIdentifierFromReq,
  send
}: {
  getModelsForUser: Function,
  send: ({ req, object }) => Promise<any>
  getIdentifier?: (req:any) => string,
  propertyName?: string,
}) => {
  // modelsObject => modelsArray
  // modelsArray => modelsHash
  return async (req) => {
    const identifier = getIdentifier(req)
    const { user } = req
    let models = getModelsForUser(user)
    if (isPromise(models)) {
      models = await models
    }

    await sendModelsPackIfUpdated({
      user,
      models: getModelsForUser(user),
      propertyName,
      identifier,
      send: object => send({ req, object })
    })
  }
}

export const sendModelsPackIfUpdated = async ({
  user,
  models,
  send,
  identifier,
  propertyName=defaultPropertyName,
}: {
  user: any,
  models: any,
  send: (pack:any) => Promise<any>,
  identifier?: string,
  propertyName?: string
}) => {
  if (!identifier) identifier = getDefaultIdentifierFromUser(user)

  if (!user[propertyName] || typeof user[propertyName] !== 'object') {
    user[propertyName] = {}
  }

  const versionId = user[propertyName][identifier]
  let pack = mapModelsToPack.get(models)
  if (!pack) {
    pack = ModelsPack.pack(models)
    mapModelsToPack.set(models, pack)
  }

  if (pack.versionId === versionId) return

  user[propertyName][identifier] = pack.versionId
  return await send(pack)
}

export const createGetIdentifierFromReq = ({ employeeManager }) => {
  return req => {
    const { user, message } = req
    const { originalSender } = message
    let identifier = getDefaultIdentifierFromUser(user)
    if (originalSender) {
      identifier += ':' + originalSender
    }

    return identifier
  }
}

export const createGetModelsForUser = ({ productsAPI, employeeManager }) => {
  const employeeModels = _.omit(productsAPI.models.all, BASE_MODELS_IDS)
  const customerModels = _.omit(
    productsAPI.models.all,
    Object.keys(productsAPI.models.private.all)
      .concat(BASE_MODELS_IDS)
  )

  employeeModels['tradle.OnfidoVerification'] = baseModels['tradle.OnfidoVerification']
  customerModels['tradle.OnfidoVerification'] = baseModels['tradle.OnfidoVerification']

  return user => {
    if (employeeManager.isEmployee(user)) {
      return employeeModels
    }

    return customerModels
  }
}
