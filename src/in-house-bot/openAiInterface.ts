import { Configuration, OpenAIApi} from 'openai'
import AWS from 'aws-sdk'
import Promise from 'bluebird'
import { omitBy, uniqBy, mergeWith, isEqual, cloneDeep, size } from 'lodash'
import { IPBUser, Bot, IPBReq, Model, Logger } from './types'
import validateModels from '@tradle/validate-model'
import { TYPE, TYPES } from '@tradle/constants'
const {
  MONEY,
  FORM,
  SIMPLE_MESSAGE
} = TYPES

import { isSubClassOf } from './utils'
import { countTokens } from './docUtils'
const {
  isEnumProperty,
} = validateModels.utils

const FORM_REQUEST = 'tradle.FormRequest'
const PRODUCT_REQUEST = 'tradle.ProductRequest'
const LANGUAGE = 'tradle.Language'
const APPLICATION_SUBMISSION = 'tradle.ApplicationSubmission'

// const TEN_MINUTES = 36000000
const samplesS3 = new AWS.S3()
const UTF8 = 'utf-8'

export async function getChatGPTMessage({req, bot, conf, message, model, otherProperties, logger }:{req: IPBReq, bot: Bot, conf: any, message: any, model: any, otherProperties?:any, logger: Logger}) {
  const {openApiKey, AIGovernanceAndSupportFolder, providerSetup, AIGovernanceAndSupportBucket} = conf
  if (!openApiKey) return

  let api = new Configuration({apiKey: openApiKey})
  const openai = new OpenAIApi(api)
  const { models } = bot

  let { user, application, payload } = req
  if (model.id !== SIMPLE_MESSAGE)
    return await getChatGPTResponseForForm({message, openai, model, models, otherProperties, logger})

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
    items.sort((a, b) => b._time - a._time)
    items = uniqBy(items, 'message')
    for (let i=0; i<items.length; i++)
      messages.push({role: 'user', content: items[i].message})
  }
  let { setupContent } = await getSetupContent({user, bot, conf})

  messages.splice(0, 0, setupContent)
  messages.splice(1, 0, {role: 'user', content: 'All dates in JSON are in long format. Convert them using Date JS if asked.\n# Don\'t mention the word "JSON" in your response, you can use "data" instead'})

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

      let instructions = `You are a helpful user.
                         # Here are the forms data in JSON format.
                         # Note that the date properties here are of LONG type.
                         # Convert them to date format.`
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
      messages.push({role: 'user', content: `# Use these JSON data when asked for a particular property from any of the forms.`})
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
async function getChatGPTResponseForForm({message, openai, model, models, otherProperties, logger}:{message: any, openai:any, model: Model, models: any, otherProperties?: any, logger: Logger}) {
  // let properties = model && omitBy(model.properties, (value, key) => key.startsWith('_')).map(p => p.name).join(', ')
  let properties = model.properties
  let props = {}
  let enumProps = [], moneyProps = [], additionalPrompt
  if (otherProperties) {
    const { properties:oprops, enumProperties, moneyProperties } = otherProperties
    additionalPrompt = otherProperties.additionalPrompt
    if (oprops)
      props = oprops

    if (enumProperties) {
      for (let p in enumProperties) {
        let model = models[enumProperties[p]]
        if (!model) {
          // logger.debug(`${p} model does not exist`)
          continue
        }
        enumProps.push({name: p, ref: model.id})
      }
    }
    if (moneyProperties) {
      for (let p in moneyProperties)
        moneyProps.push(p)
    }
  }
  if (!size(props)) {
    for (let p in properties) {
      const property = properties[p]
      const { range, items, displayAs } = property
      if (p.charAt(0) === '_'        ||
          p.indexOf('_group') !== -1 ||
          range === 'photo'          ||
          range === 'json'           ||
          range === 'document'       ||
          displayAs                  ||
          (items && items.backlink)) continue
      props[p] = ''
      if (isEnumProperty({models, property}))
        enumProps.push({name: p, ref: property.ref})
      if (property.ref === MONEY)
        moneyProps.push(p)
    }
  }
  let propsStr = JSON.stringify(props)
  let sysMessageJson = {
    task: "You are a JSON creating machine!",
    taskRules: [
      "You are not allowed to produce invalid JSON.",
      "Please use the tokens to fill in the values for the properties in the JSON template below",
      "The tokens are from the articles of association document. Please extract as much information as possible in accordance with JSON template",
      "You are not allowed to add any new properties outside of the template",
      "Return the original JSON template if there is no relevant information found",
      "You are not allowed to override in JSON the existing values.",
      "If applicable, include currency symbol if present for these properties purchasePrice",
      "Return countries as two letter country code in ISO 3166 format.",
      "You must fill out as many properties of JSON as it is possible."
    ],
    JSON: `${propsStr}`
  }
  if (additionalPrompt)
    sysMessageJson.taskRules.push(`${additionalPrompt}`)
  if (enumProps.length) {
    enumProps.forEach(e => {
      if (models[e.ref].enum.length > 10) return
      let eenum = models[e.ref].enum
      sysMessageJson.taskRules.push(`If applicable, set value for "${e.name}" to one of the following categories: "${eenum.map(e => e.title).join(',')}". Try to map found value to the most suitable category in the list or if you can't find a suitable category indicate a category like "category name (New Category)".`)
    })
    sysMessageJson.taskRules.push(`Translate to English values for these properties: "${enumProps.map(e => e.name).join(',')}"`)
  }
  if (moneyProps.length)
    sysMessageJson.taskRules.push(`If applicable, include currency symbol if present for these properties ${moneyProps.join(',')}`)

    let sysMessage = JSON.stringify(sysMessageJson)

  let responses = []
  for (let i=0; i<message.length; i++) {

  let sysCnt = countTokens(sysMessage)
  let msgCnt = countTokens(message[i])
    if (!message[i].length) continue
    let messages = [
      {role: 'system', content: sysMessage},
      {role: 'user', content: `${message[i]}`}
    ]

    let response = await getResponse({openai, messages, logger})
    try {
      let val = response.content.trim()
      let v = JSON.parse(val)
      if (!isEqual(props, v))
        responses.push(v)
    } catch (err) {
      logger.debug(`openAiInterface: ChatGPT request failed for chunk ${i} JSON: ${response.content.trim()}`, err)  
      debugger
      return
    }
    // for (let i=0; i<NUMBER_OF_ATTEMPTS && (typeof response === 'string'); i++) {
    //   await Promise.delay(1500)
    //   response = await getResponse({openai, messages, requestID: response})
    //   responses.push(json)
    // }
  }
  if (responses.length)
    return makeResponse(responses, props, logger)
}
function makeResponse(responses, props, logger) {
  let result = cloneDeep(props)
logger.debug(`openAiInterface: response props: ${JSON.stringify(props)}`)  
  for (let i=0; i<responses.length; i++) {
    let res = responses[i]
    for (let p in res) {
      if (!Object.prototype.hasOwnProperty.call(props, p))
        delete res[p]
    }
    // result = mergeObjects(res, result)
    result = mergeWith(result, res, (a,b) => {
      try {
        if (Array.isArray(a))
          mergeObjectsArray(a, b, logger)
          // return arrayUnique(a.concat(b))
        if (typeof a === 'string') {
          if (!a.length) return b
          if (!b.length) return a
        }
      } catch (err) {
        logger.debug(`openAiInterface: response a: ${JSON.stringify(a)}, b: ${JSON.stringify(b)}`)  
        
      }
    })
  }

  return result
}
async function getResponse({openai, messages, requestID, logger}:{openai: any, messages: any, requestID?: string, logger: Logger}) {
  if (requestID)  {
    messages[0].content += `\nThis is the previously failed messages with ID ${requestID}`
    logger.debug(`openAiInterface: Error with OpenAI API: previous message failed`);
  }
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
      logger.debug(`openAiInterface: Error with OpenAI API: status=${status}, ${data.message}`);
      debugger
    } else {
      logger.debug(`openAiInterface: Error with OpenAI API request: ${error.message}`);
    }
    if (data.error.message.startsWith('This model\'s maximum context length is 4096 tokens')) {
      logger.debug(`openAiInterface: Error with OpenAI API request: ${data.message}`);
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
  if (!systemMessage)
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

function mergeObjectsArray(arr1, arr2, logger) {
  const mergedArray = [];
  const keysToMerge = ["positions", "shares"]; // Array properties to merge

  // Loop through objects in first array and add to merged array
  arr1.forEach((obj1) => {
    const matchedObjIndex = arr2.findIndex(
      (obj2) => JSON.stringify(obj1) === JSON.stringify(obj2)
    );
    if (matchedObjIndex !== -1) {
      // If an identical object exists in second array, merge the array properties
      keysToMerge.forEach((key) => {
        if (Array.isArray(obj1[key]) && Array.isArray(arr2[matchedObjIndex][key])) {
          const mergedArray = [...new Set([...obj1[key], ...arr2[matchedObjIndex][key]])];
          obj1[key] = mergedArray;
          arr2[matchedObjIndex][key] = mergedArray;
        }
      });
      mergedArray.push(obj1);
      arr2.splice(matchedObjIndex, 1);
    } else {
      mergedArray.push(obj1);
    }
  });
  if (Array.isArray(arr2)) {
    // Add any remaining objects from second array to merged array
    arr2.forEach((obj2) => {
      mergedArray.push(obj2);
    });
  }
  else
    logger.debug(`openAiInterface: Merge arrays: ${arr2} is not an array`)

  return mergedArray;
}
