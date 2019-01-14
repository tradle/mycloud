import { ICommand } from '../types'
import Errors from '../../errors'

export const command:ICommand = {
  name: 'revoke-product-certificate',
  adminOnly: true,
  examples: [
    '/revoke-product-certificate --certificate-model-id <certificateModelId> --my-product-id <myProductId>'
  ],
  description: 'revoke a product certificate',
  exec: async ({ commander, req, args }) => {
    const { certificateModelId, myProductId } = args
    if (!certificateModelId) {
      throw new Errors.InvalidInput('expected --certificate-model-id <modelId>')
    }

    if (!myProductId) {
      throw new Errors.InvalidInput('expected --my-product-id <myProductId>')
    }

    return await commander.applications.revokeProductCertificateWithMyProductId({
      req,
      certificateModelId,
      myProductId,
    })
  }
}
