import crypto = require('crypto')
import buildResource = require('@tradle/build-resource')
import baseModels = require('../../models')
import { pick, omit, isPromise, stableStringify } from '../../utils'

const BASE_MODELS_IDS = Object.keys(baseModels)

const hashObject = (obj) => hashString('sha256', stableStringify(obj))

const hashString = (algorithm, data) => crypto.createHash(algorithm).update(data).digest('hex')

const modelsToArray = (models) => {
  return Object.keys(models)
    .sort(compareAlphabetical)
    .map(id => models[id])
}

const compareAlphabetical = (a, b) => {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

const objToArray = new Map()
const arrToHash = new Map()

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
  propertyName=defaultPropertyName,
  identifier,
  send
}: {
  user: any,
  models: any,
  propertyName: string,
  identifier: string,
  send: (pack:any) => Promise<any>
}) => {
  if (!user[propertyName] || typeof user[propertyName] !== 'object') {
    user[propertyName] = {}
  }

  const modelsHash = user[propertyName][identifier]
  let modelsArray
  if (Array.isArray(models)) {
    modelsArray = models
  } else {
    modelsArray = objToArray.get(models)
    if (!modelsArray) {
      modelsArray = modelsToArray(models)
      objToArray.set(models, modelsArray)
    }
  }

  let hash = arrToHash.get(modelsArray)
  if (!hash) {
    hash = hashObject(modelsArray)
    arrToHash.set(modelsArray, hash)
  }

  if (hash === modelsHash) return

  user[propertyName][identifier] = hash
  const pack = buildResource({
    models: baseModels,
    model: 'tradle.ModelsPack',
    resource: {
      models: modelsArray
    }
  })
  .toJSON()

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

    // return adjustIdentifierForUser({ employeeManager, user, identifier })
    return identifier
  }
}

// export const adjustIdentifierForUser = ({ employeeManager, user, identifier }) => {
//   if (!identifier) identifier = getDefaultIdentifierFromUser(user)

//   return employeeManager.isEmployee(user) ? 'e:' + identifier : identifier
// }

export const createGetModelsForUser = ({ productsAPI, employeeManager }) => {
  const employeeModels = omit(productsAPI.models.all, BASE_MODELS_IDS)
  const customerModels = omit(
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
