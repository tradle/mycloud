import { omit } from 'lodash'
import ModelsPack = require('@tradle/models-pack')
import { TYPE, SIG } from '@tradle/constants'
import buildResource = require('@tradle/build-resource')
import validateResource = require('@tradle/validate-resource')
import Errors = require('../errors')
import { addLinks } from '../crypto'
import { ResourceStub, ParsedResourceStub } from '../types'

const { parseStub } = validateResource.utils
const MODELS_PACK = 'tradle.ModelsPack'

export default function addConvenienceMethods (bot) {
  bot.getResource = async ({ type, permalink }: ParsedResourceStub) => {
    return await bot.db.get({
      [TYPE]: type,
      _permalink: permalink
    })
  }

  bot.getResourceByStub = async (stub:ResourceStub) => {
    return await bot.getResource(parseStub(stub))
  }

  bot.resolveEmbeds = bot.objects.resolveEmbeds
  bot.presignEmbeddedMediaLinks = bot.objects.presignEmbeddedMediaLinks

  // bot.loadEmbeddedResource = function (url) {
  //   return uploads.get(url)
  // }

  bot.createNewVersion = async (resource) => {
    const latest = buildResource.version(resource)
    const signed = await bot.sign(latest)
    addLinks(signed)
    return signed
  }

  bot.signAndSave = async (resource) => {
    const signed = await bot.sign(resource)
    addLinks(signed)
    await bot.save(signed)
    return signed
  }

  bot.versionAndSave = async (resource) => {
    const newVersion = await bot.createNewVersion(resource)
    await bot.save(newVersion)
    return newVersion
  }

  bot.reSign = function reSign (object) {
    return bot.sign(omit(object, [SIG]))
  }

//   bot.getLatestModelsPack = async (domain:string) => {
//     return await bot.buckets.PrivateConf.getJSON(getModelsPackConfId(domain))
//     // return await bot.db.findOne({
//     //   orderBy: {
//     //     property: '_time',
//     //     desc: true
//     //   },
//     //   filter: {
//     //     EQ: {
//     //       [TYPE]: MODELS_PACK,
//     //       _author
//     //     }
//     //   }
//     // })
//   }

//   bot.saveModelsPack = async (pack) => {
//     const domain = ModelsPack.getDomain(pack)
//     const friend = await bot.friends.getByDomain(domain)
//     if (friend._identityPermalink !== pack._author) {
//       throw new Error(`ignoring ModelsPack sent by ${pack._author}.
// Domain ${domain} belongs to ${friend._identityPermalink}`)
//     }

//     try {
//       ModelsPack.validate(pack)
//       await bot.buckets.PrivateConf.putJSON(getModelsPackConfId(pack), pack)
//     } catch (err) {
//       bot.logger.error(`received invalid ModelsPack from ${pack._author}`, Errors.export(err))
//     }
//   }
}

// const getModelsPackConfId = domainOrPack => {
//   if (typeof domainOrPack === 'string') {
//     return `modelspack:${domainOrPack}`
//   }

//   if (domainOrPack[TYPE] === MODELS_PACK) {
//     return getModelsPackConfId(ModelsPack.getDomain(domainOrPack))
//   }

//   throw new Error('expected domain or ModelsPack')
// }
