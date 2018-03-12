import _ from 'lodash'
import ModelsPack from '@tradle/models-pack'
import baseModels from '../../models'
import { isPromise, stableStringify } from '../../utils'
import { MODELS_HASH_PROPERTY as PROPERTY } from '../constants'

const BASE_MODELS_IDS = Object.keys(baseModels)
const mapModelsToPack = new Map()

export const name = 'keepModelsFresh'
export const getDefaultIdentifierFromReq = ({ user }) => user.id
export const createPlugin = ({
  getModelsPackForUser,
  // unique identifier for counterparty
  // which will be used to track freshness.
  // defaults to user.id
  getIdentifier=getDefaultIdentifierFromReq,
  send
}: {
  getModelsPackForUser: (user) => any,
  send: ({ req, to, object }) => Promise<any>
  getIdentifier?: (req:any) => string
}) => {
  // modelsObject => modelsArray
  // modelsArray => modelsHash
  const onmessage = async (req) => {
    const identifier = getIdentifier(req)
    const { user } = req
    let modelsPack = getModelsPackForUser(user)
    if (isPromise(modelsPack)) {
      modelsPack = await modelsPack
    }

    if (!modelsPack) return

    await sendModelsPackIfUpdated({
      user,
      modelsPack,
      identifier,
      send: object => send({ req, to: user, object })
    })
  }

  return {
    onmessage
  }
}

export const sendModelsPackIfUpdated = async ({
  user,
  modelsPack,
  send,
  identifier
}: {
  user: any,
  modelsPack: any,
  send: (pack:any) => Promise<any>,
  identifier?: string
}):Promise<boolean> => {
  if (!identifier) identifier = user.id

  if (!user[PROPERTY] || typeof user[PROPERTY] !== 'object') {
    user[PROPERTY] = {}
  }

  const versionId = user[PROPERTY][identifier]
  if (modelsPack.versionId === versionId) {
    return false
  }

  user[PROPERTY][identifier] = modelsPack.versionId
  await send(modelsPack)
  return true
}

export const createGetIdentifierFromReq = ({ employeeManager }) => {
  return req => {
    const { user, message } = req
    const { originalSender } = message
    let identifier = user.id
    if (originalSender) {
      identifier += ':' + originalSender
    }

    return identifier
  }
}

export const createModelsPackGetter = ({ bot, productsAPI, employeeManager }) => {
  return async (user) => {
    if (employeeManager.isEmployee(user)) {
      return await bot.modelStore.getCumulativeModelsPack()
    }

    return bot.modelStore.myModelsPack
  }
}
