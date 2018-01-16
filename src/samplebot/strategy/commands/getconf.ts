import _ = require('lodash')
import yn = require('yn')
import parse = require('yargs-parser')
import { toggleProduct } from '../utils'

import { ICommand } from '../../../types'

export const command:ICommand = {
  name: 'getconf',
  description: 'get current bot configuration',
  examples: [
    '/getconf'
  ],
  exec: async ({ context, req, args }) => {
    const { conf } = context
    return _.pick(conf.products, ['enabled', 'approveAllEmployees', 'autoApprove'])
  }
}
