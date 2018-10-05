import { ICommand } from '../types'

export const command:ICommand = {
  name: 'list-employees',
  adminOnly: true,
  examples: [
    '/list-employees'
  ],
  description: 'list current employees',
  exec: async ({ commander, req }) => {
    return await commander.employeeManager.list()
  }
}
