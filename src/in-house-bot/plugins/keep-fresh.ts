import { sha256 } from '../../crypto'

function defaultGetIdentifier (req) {
  return req.user.id
}

export const name = 'keepFresh'
export const createPlugin = ({
  object,
  propertyName,
  // unique identifier for counterparty
  // which will be used to track freshness.
  // defaults to user.id
  getIdentifier=defaultGetIdentifier,
  send
}) => {
  const hash = sha256(object, 'hex')
  const onmessage = async (req) => {
    const identifier = getIdentifier(req)
    const { user } = req
    if (!user[propertyName]) {
      user[propertyName] = {}
    }

    const container = user[propertyName]
    const savedHash = container[identifier]
    if (hash === savedHash) return

    container[identifier] = hash
    await send({ req, to: user, object, isFirstTime: !savedHash })
  }

  return {
    onmessage
  }
}
