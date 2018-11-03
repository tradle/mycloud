import fs from 'fs'
import path from 'path'
import YAML from 'js-yaml'
import transform from 'lodash/transform'

const cfDir = path.resolve(__dirname, '../../cloudformation')
const files = {
  tables: 'tables.yml',
  buckets: 'buckets.yml',
  iam: 'iam.yml',
  autoscaleEvents: 'autoscale-events-table.yml',
  autoscaleBucket0: 'autoscale-bucket-table.yml',
}

type ResourceSets = {
  tables: any
  buckets: any
  iam: any
  autoscaleEvents: any
  autoscaleBucket0: any
}

export const resources = transform(files, (result, fileName, setName) => {
  const set = YAML.safeLoad(fs.readFileSync(path.join(cfDir, fileName))).Resources
  if (setName === 'tables') {
    Object.keys(set).forEach(name => {
      delete set[name].Properties.TableName
    })
  }

  // Object.keys(set).forEach(name => {
  //   set[name] = set[name].Properties
  // })

  result[setName] = set
}, {}) as ResourceSets
