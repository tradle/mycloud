const fs = require('fs')
const path = require('path')
const YAML = require('js-yaml')
const serverlessYmlPath = path.join(__dirname, '../../../serverless.yml')
const serverlessYml = YAML.load(fs.readFileSync(serverlessYmlPath), { encoding: 'utf8' })

module.exports = serverlessYml
