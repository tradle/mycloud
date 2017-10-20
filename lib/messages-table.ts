import * as clone from 'clone'
import { createTable } from '@tradle/dynamodb'

export function createTable ({ models, tables, prefix }: { models, tables, prefix:string }) {
  const model = models['tradle.Message']
  const inbox = createTable({
    models,
    model,
    tableName: tables.Inbox.name,
    forbidScan: true,
    prefix,
    // TODO: load these from serverless-yml
    hashKey: '_author',
    rangeKey: 'time',
    indexes: [
      {
        hashKey: '_link',
        rangeKey: 'time',
        name: '_link',
        type: 'global',
        projection: {
          ProjectionType: 'KEYS_ONLY'
        }
      },
      {
        hashKey: 'context',
        rangeKey: 'time',
        name: 'context',
        type: 'global',
        projection: {
          ProjectionType: 'KEYS_ONLY'
        }
      }
    ]
  })

  const outbox = createTable({
    models,
    model,
    tableName: tables.Outbox.name,
    forbidScan: true,
    prefix,
    // TODO: load these from serverless-yml
    hashKey: '_recipient',
    rangeKey: 'time',
    indexes: [
      {
        hashKey: '_payloadLink',
        rangeKey: 'time',
        name: '_payloadLink',
        type: 'global',
        projection: {
          ProjectionType: 'KEYS_ONLY'
        }
      },
      {
        hashKey: 'context',
        rangeKey: 'time',
        name: 'context',
        type: 'global',
        projection: {
          ProjectionType: 'KEYS_ONLY'
        }
      }
    ]
  })

  const getBoxFromFilter = query => {
    const { filter={} } = query
    const { EQ={} } = filter
    if (typeof EQ._inbound !== 'boolean') {
      throw new Error('expected "_inbound" property in "EQ"')
    }

    return EQ._inbound ? inbox : outbox
  }

  const sanitizeQuery = (query) => {
    query = clone(query)
    delete query.filter.EQ._inbound
    return query
  }

  const execQuery = async (method:string, query:any) => {
    const box = getBoxFromFilter(query)
    return box[method](sanitizeQuery(query))
  }

  const find = query => execQuery('find', query)
  const findOne = query => execQuery('findOne', query)
  const get =  async ({ _inbound, ...query }) => {
    const box = _inbound ? inbox : outbox
    return box.get(query)
  }

  const table = {
    get,
    search: find,
    find,
    findOne
  }

  ;['put', 'batchPut', 'latest'].forEach(method => {
    table[method] = async () => {
      throw new Error(`"${method}" is not supported on tradle.Message table`)
    }
  })

  return table
}
