import { ICommand } from '../types'
import Errors from '../../errors'

export const command:ICommand = {
  name: 'fire-employee',
  adminOnly: true,
  examples: [
    '/fire-employee --my-product-id <myProductId>'
  ],
  description: 'fire an employee',
  exec: async ({ commander, req, args }) => {
    const { myProductId } = args
    if (!myProductId) {
      throw new Errors.InvalidInput('expected --my-product-id <myProductId>')
    }

    return await commander.applications.fireEmployee({ req, myProductId })
  }
}
