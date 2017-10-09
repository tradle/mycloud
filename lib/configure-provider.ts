const debug = require('debug')('tradle:sls:config')
import * as validateResource from '@tradle/validate-resource'
import { buckets, constants, models } from '../'
const { PUBLIC_CONF_BUCKET, TABLES_TO_PRECREATE } = constants
const KEY = PUBLIC_CONF_BUCKET.info

export async function setStyle (style) {
  debug('setting style', JSON.stringify(style, null, 2))

  validateResource({
    models,
    model: 'tradle.StylesPack',
    resource: style
  })

  const info = await buckets.PublicConf.getJSON(KEY)
  info.style = style
  await buckets.PublicConf.putJSON(KEY, info)
}

// should prob move this to samplebot
export async function preCreateTables ({ productsAPI, ids }) {
  const { models, bot } = productsAPI
  if (!Array.isArray(ids)) {
    const { products, productForCertificate } = models.biz
    ids = products.map(product => {
      const cert = productForCertificate[product]
      return (models.all[product].forms || [])
        .concat(cert ? cert.id : [])
    })
    .reduce((forms, batch) => forms.concat(batch), [])
    .concat(TABLES_TO_PRECREATE)
  }

  await Promise.all(ids.map(async (id) => {
    try {
      debug(`creating table ${id}`)
      await bot.db.tables[id].create()
    } catch (err) {
      // ignore if already exists
      if (err.name !== 'ResourceInUseException') {
        throw err
      }
    }
  }))
}
