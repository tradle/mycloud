import { Configuration, OpenAIApi} from 'openai'
import AWS from 'aws-sdk'
import Promise from 'bluebird'
import { omitBy, uniqBy } from 'lodash'
import { IPBUser, Bot, IPBReq, Model } from './types'
import validateModels from '@tradle/validate-model'
import { TYPE, TYPES } from '@tradle/constants'
const {
  MONEY,
  FORM,
  SIMPLE_MESSAGE
} = TYPES

import { isSubClassOf } from './utils'
import { execute } from 'graphql'
import { message } from '../typeforce-types'
const {
  isEnumProperty,
} = validateModels.utils

const FORM_REQUEST = 'tradle.FormRequest'
const PRODUCT_REQUEST = 'tradle.ProductRequest'
const LANGUAGE = 'tradle.Language'
const APPLICATION_SUBMISSION = 'tradle.ApplicationSubmission'

const NUMBER_OF_ATTEMPTS = 3

// const TEN_MINUTES = 36000000
const samplesS3 = new AWS.S3()
const UTF8 = 'utf-8'

export async function getChatGPTMessage({req, bot, conf, message }:{req: IPBReq, bot: Bot, conf: any, message: any}) {
  const {openApiKey, AIGovernanceAndSupportFolder, providerSetup, AIGovernanceAndSupportBucket} = conf
  if (!openApiKey) return

  let api = new Configuration({apiKey: openApiKey})
  const openai = new OpenAIApi(api)
  const { models } = bot

  let { user, application, payload } = req
  if (payload[TYPE] !== SIMPLE_MESSAGE) 
    return await convertObjectToJson({message, openai, model: bot.models[payload[TYPE]], models})
  let query = {
    orderBy: {
      property: '_time',
      desc: false
    },
    filter: {
      EQ: {
        [TYPE]: SIMPLE_MESSAGE,
        _author: user.id
      },
      // GT: {
      //   _time: application.submissions[application.submissions.length - 1]._time
      // }
    }
  }
  let {items } = await bot.db.find(query)
  let messages = []
  let startTime = application && application.dateStarted || 0
  let lastSubmissionTime = application && application.submissions[0]._time || Date.now()
  if (items.length) {
    items = items.filter(item => item._time > startTime && item._time <= lastSubmissionTime)
    items = uniqBy(items, 'message')
    for (let i=0; i<items.length; i++)
      messages.push({role: 'user', content: items[i].message})
  }
  let { setupContent } = await getSetupContent({user, bot, conf})

  messages.splice(0, 0, setupContent)
  messages.splice(1, 0, {role: 'user', content: 'All dates in JSON are in long format. Please convert them using Date JS if asked.'})
  if (application) {
    let { submissions, forms } = application
    if (submissions.length === 50) {
      let aquery = {
        orderBy: {
          property: '_time',
          desc: false
        },
        filter: {
          EQ: {
            [TYPE]: APPLICATION_SUBMISSION,
            'application._permalink': application._permalink
          },
          NEQ: {
            'submission._t': 'tradle.SimpleMessage'
          }
          // GT: {
          //   _time: startTime
          // },
          // LT: {
          //   _time: lastSubmissionTime
          // }
        }
      }
      ;({items:submissions } = await bot.db.find(aquery))
      forms = submissions.filter(sub => isSubClassOf(FORM, models[sub.submission[TYPE]], models))
      forms = uniqBy(forms, 'submission._permalink')
    }
    let fr = submissions.filter(sub => sub.submission[TYPE] === FORM_REQUEST)
    let formRequests:any = uniqBy(fr.map(f => f.submission), '_displayName')
    if (formRequests.length > 2)
      formRequests = formRequests.slice(-2)
    formRequests = await Promise.all(formRequests.map(f => bot.getResource(f)))
    for (let i=0; i<formRequests.length; i++) {
      let f = formRequests[i]
      if (AIGovernanceAndSupportFolder && AIGovernanceAndSupportBucket && providerSetup) {
        let formMessage = await getFileFromS3(samplesS3,
          `${AIGovernanceAndSupportFolder}/${f.form}.txt`,
          AIGovernanceAndSupportBucket)
        if (formMessage) {
          messages.push({role: 'user', content: formMessage})
        }
      }
    }
    if (forms) {
      forms = await Promise.all(forms.map(f => bot.getResource(f.submission)))
      let fforms = forms.filter(f => f[TYPE] !== PRODUCT_REQUEST)
             .map(f => omitBy(f, (value, key) => key.startsWith('_') &&  key !== TYPE))

      let instructions = `You are a helpful user.\n Here are the forms data in JSON format. Please note that the date properties here are of LONG type. Please convert them to date format if asked`
      messages.push({role: 'user', content: instructions})
      fforms.forEach(f => {
        let props = models[f[TYPE]].properties
        for (let p in f) {
          if (typeof f[p] !== 'object') continue
          if (isEnumProperty({models, property: props[p]}) &&  props[p].ref !== MONEY)
            f[p] = f[p].title
        }
        f[TYPE] = models[f[TYPE]].title

        messages.push({role: 'user', content: `${JSON.stringify(f, null, 2)}`})
      })
      messages.push({role: 'user', content: `Please use them when asked for a particular property from any of the forms.`})
    }
  }
  try {
    // await addModeration (openai, message, msgs, language)
    messages.push({role: "user", content: message})

    let completion = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        temperature: 0.2,
        messages
      })
    let response = completion.data.choices[0].message
    return response.content.trim()
  } catch(error) {
    const { status, data } = error.response
    if (error.response) {
      console.log(status, data);
      debugger
    } else {
      console.log(`Error with OpenAI API request: ${error.message}`);
    }
    if (data.error.message.startsWith('This model\'s maximum context length is 4096 tokens')) {
      // let messegesStr = messages.map(m => m.content).join(' ')
      debugger
    }
  }
}
async function convertObjectToJson({message, openai, model, models}:{message: string, openai:any, model: Model, models: any}) {
  // let properties = model && omitBy(model.properties, (value, key) => key.startsWith('_')).map(p => p.name).join(', ')
  let properties = model.properties
  let props = {}
  let enumProps = [], moneyProps = []
  for (let p in properties) {
    const property = properties[p]
    const { range, items, displayAs } = property
    if (p.charAt(0) === '_'        || 
        p.indexOf('_group') !== -1 || 
        range === 'photo'          ||
        range === 'json'           ||
        range === 'document'       ||
        displayAs                 ||
        (items && items.backlink)) continue
    props[p] = ''
    if (isEnumProperty({models, property}))
      enumProps.push({name: p, ref: property.ref})
    if (property.ref === MONEY)
      moneyProps.push(p)  
  }
  let sysMessage = `I will give you a list of tokens and you will have to fill out this JSON: ${JSON.stringify(props)}.`
  if (enumProps.length) {
    enumProps.forEach(e => {
      if (models[e.ref].enum.length > 10) return
      let eenum = models[e.ref].enum
      sysMessage += `\nPlease set value for "${e.name}" to one of the following: "${eenum.map(e => e.title).join(',')}"`       
    })
    sysMessage += `\nPlease translate to English values for these properties: "${enumProps.map(e => e.name).join(',')}"` 
  } 
  if (moneyProps.length) 
    sysMessage += `\nPlease include currency symbol if present for these properties ${moneyProps.join(',')}`
  
  let messages = [
    {role: 'system', content: sysMessage},
    {role: 'user', content: `${message.slice(1, message.length - 1)}`}
  ]
  let response = await getResponse({openai, messages})
  for (let i=0; i<NUMBER_OF_ATTEMPTS && (typeof response === 'string'); i++) {
    await Promise.delay(1500)
    response = await getResponse({openai, messages, requestID: response})     
  }
  
  // try {
  //   let completion = await openai.createChatCompletion({
  //     model: "gpt-3.5-turbo",
  //     temperature: 0.2,
  //     messages
  //   })
  //  let response = completion.data.choices[0].message
  if (typeof response === 'object')
    return response.content.trim()
}  
async function getResponse({openai, messages, requestID}:{openai: any, messages: any, requestID?: string}) {
  if (requestID)
    messages[0].content += `\nThis is the previously failed messages with ID ${requestID}`
  try {
    let completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      temperature: 0.2,
      messages
    })
    return completion.data.choices[0].message
    // let response = completion.data.choices[0].message
    // return response.content.trim()
  } catch(error) {
    const { status, data } = error.response
    if (error.response) {
      if (status === 429) {
        let { message } = data.error
        let idx = message.indexOf(' request ID ')
        if (idx !== -1)  {
          let idx1 = message.indexOf(' ', idx + 12)          
          return message.slice(idx, idx1)
        }
      }
      console.log(status, data);
      debugger
    } else {
      console.log(`Error with OpenAI API request: ${error.message}`);
    }
    if (data.error.message.startsWith('This model\'s maximum context length is 4096 tokens')) {
      // let messegesStr = messages.map(m => m.content).join(' ')
      debugger
    }
  }
}
async function getSetupContent({ user, bot, conf}: {user: IPBUser, bot: Bot, conf: any}) {
  const {AIGovernanceAndSupportFolder, providerSetup, AIGovernanceAndSupportBucket} = conf

  let systemMessage
  if (AIGovernanceAndSupportFolder && AIGovernanceAndSupportBucket && providerSetup) {
    systemMessage = await getFileFromS3(samplesS3,
      `${AIGovernanceAndSupportFolder}/${providerSetup}`,
      AIGovernanceAndSupportBucket)
  }
  else
    systemMessage = 'You are a helpful assistent'

  let language
  if (user.language) {
    let langR = bot.models[LANGUAGE].enum.find(l => l.id === user.language)
    language = langR.id
  }
  else
    language = 'English'

  systemMessage += `\nTranslate all responds in ${language}`
  let setupContent = {role: 'system', content: `${systemMessage}`}
  return { setupContent }
}
async function getFileFromS3(s3: AWS.S3, file: string, bucket: string) {
  const params = {
    Bucket: bucket,
    Key: file
  }
  try {
    const data = await s3.getObject(params).promise()
    let date = new Date(data.LastModified).getTime()
    // return { content: data.Body.toString(UTF8), modified: new Date(data.LastModified).getTime() }
    return data.Body.toString(UTF8)
  } catch (err) {
    // debugger
  }
}
async function addModeration (openai, message, msgs, language){
  let moderationResponse = await openai.createModeration({input: message})
  let flagged = moderationResponse.data.results[0].flagged
  if (!flagged) {
    msgs.push({role: "user", content: message})
    return msgs
  }
  let categories = moderationResponse.data.results[0].categories
  let category
  for (let c in categories) {
    if (categories[c]) {
      category = c
      break
    }
  }
  return [
    {role: "system", content: `Translate to ${language}`},
    {role: "user", content: `Message didn't pass moderation for "${category}"`}
  ]
}

