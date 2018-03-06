#!/usr/bin/env node

import _ from 'lodash'
import YAML from 'js-yaml'
import { interpolateTemplate } from '../cli/utils'
const [path, ...args] = process.argv.slice(2)

interpolateTemplate({ arg: args.join(' ') })
  .then(result => {
    const yml = YAML.load(result)
    const val = _.get(yml, path)
    if (typeof val === 'undefined') {
      throw new Error(`property path ${path} not found in yml`)
    }

    process.stdout.write(val)
  }, err => {
    process.stderr.write(err.stack)
    process.exit(1)
  })
