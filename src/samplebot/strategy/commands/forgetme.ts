import { ICommand } from '../../../types'

export const command:ICommand = {
  name: 'forgetme',
  examples: [
    '/forgetme'
  ],
  description: 'exercise your right to be forgotten',
  exec: async function ({ context, req }) {
    const { productsAPI } = context
    await productsAPI.forgetUser(req)
  }
}
