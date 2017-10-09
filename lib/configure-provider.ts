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
  if (!ids) {
    const { models, bot } = productsAPI
    const { products, productForCertificate } = models.biz
    ids = products.map(product => {
      return (models.all[product].forms || [])
        .concat(productForCertificate[product] || [])
    })
    .reduce((forms, batch) => forms.concat(batch), [])
    .concat(TABLES_TO_PRECREATE)
  }

  return await Promise.all(ids.map(async (id) => {
    try {
      await bot.db.tables[id].create()
    } catch (err) {
      // ignore if already exists
      if (err.name !== 'ResourceInUseException') {
        throw err
      }
    }
  }))
}
