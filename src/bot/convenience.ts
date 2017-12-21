import { omit } from 'lodash'
import { TYPE, SIG } from '@tradle/constants'
import buildResource = require('@tradle/build-resource')
import validateResource = require('@tradle/validate-resource')
import { addLinks } from '../crypto'
import { ResourceStub, ParsedResourceStub } from '../types'

const { parseStub } = validateResource.utils

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
}
