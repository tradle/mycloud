#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = 'false'

import path from 'path'
import fs from 'fs'
import { resources } from '../cli/resources'

// const getTableDefinitions = () => {
//   const yml = require('../cli/serverless-yml')
//   const { stackName } = yml.custom
//   const { Resources } = yml.resources
//   const tableNames = Object.keys(Resources)
//     .filter(name => Resources[name].Type === 'AWS::DynamoDB::Table')

//   const map = {}
//   for (const name of tableNames) {
//     const table = Resources[name]
//     map[name] = table
//     table.Properties.TableName = table.Properties.TableName.replace(stackName, '{stackName}')
//   }

//   return map
// }

const defFilePath = path.resolve(__dirname, '../../src/definitions.json')
fs.writeFile(defFilePath, JSON.stringify(resources.tables, null, 2), err => {
  if (err) throw err
})
