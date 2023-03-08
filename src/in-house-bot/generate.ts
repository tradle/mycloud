import { Configuration, OpenAIApi} from 'openai'
import AWS from 'aws-sdk'
import { TYPE } from '@tradle/constants'
const FORM_REQUEST = 'tradle.FormRequest'
const TEN_MINUTES = 36000000
const samplesS3 = new AWS.S3()
const UTF8 = 'utf-8'

export default async function ({application, message, bot, conf, language}) {
  const {openApiKey, AIGovernanceAndSupportFolder, providerSetup, AIGovernanceAndSupportBucket} = conf
  if (!openApiKey) return  

  let api = new Configuration({apiKey: openApiKey})
  const openai = new OpenAIApi(api)
  let messages, formDescriptions, setupMessageTime
  if (!application) 
    messages = []
  else {
    let { conversation } = application
    if (!conversation) {
      (conversation = {messages: []})
      application.conversation = conversation
    }
    ({ messages, formDescriptions=[], setupMessageTime } = conversation)
  }
  let systemMessage, setSystemMessage
  if (AIGovernanceAndSupportFolder && AIGovernanceAndSupportBucket && providerSetup) {
    if (setupMessageTime && Date.now() - setupMessageTime < TEN_MINUTES) 
      systemMessage = messages[0].content    
    else {
      systemMessage = await getFileFromS3(samplesS3,
        `${AIGovernanceAndSupportFolder}/${providerSetup}`,
        AIGovernanceAndSupportBucket)
      setSystemMessage = true
    }
  }   
  else
    systemMessage = 'You are a helpful assistent'
  systemMessage += `\nTranslate all responds in ${language}`

  let systemContent = {role: "system", content: `${systemMessage}`}

  if (!messages.length)  
    messages.push(systemContent)
  else
    messages.splice(0, 1, systemContent) 
  if (application) {
    let formRequests = application.submissions.filter(sub => sub.submission[TYPE] === FORM_REQUEST)
    let lastFormRequest = await bot.getResource(formRequests[0].submission)
    let lastForm = lastFormRequest.form
    if (formDescriptions.indexOf(lastForm) === -1) {
      formDescriptions.push(lastForm)
      if (AIGovernanceAndSupportFolder && AIGovernanceAndSupportBucket && providerSetup) {
        let formMessage = await getFileFromS3(samplesS3,
          `${AIGovernanceAndSupportFolder}/${lastForm}.txt`,
          AIGovernanceAndSupportBucket)              
        if (formMessage) {
          messages.push({role: "user", content: formMessage})
        }  
      }  
    }    
  } 
  // messages.push({role: "user", content: `Translate the following English text to French$ ${message}`})
  try {
    let msgs = messages.filter(m => m.role === 'system' || m.role === 'user')
    // let moderationResponse = await openai.createModeration({input: message})
    // let flagged = moderationResponse.data.results[0].flagged
    // if (flagged) {
    //   let categories = moderationResponse.data.results[0].categories
    //   let category
    //   for (let c in categories) {
    //     if (categories[c]) {
    //       category = c
    //       break
    //     }
    //   }
    //   msgs = [
    //     {role: "system", content: `Translate to ${language}`},
    //     {role: "user", content: `Message didn't pass moderation for "${category}"`}
    //   ]    
    // }  
    // else 
      msgs.push({role: "user", content: message})    
    
    let completion = await openai.createChatCompletion({      
        model: "gpt-3.5-turbo",
        temperature: 0.2,        
        messages: msgs
      })     
    let response = completion.data.choices[0].message  
    if (application) {  
      // if (!flagged) 
        application.conversation.messages = msgs              
      application.conversation.formDescriptions = formDescriptions
      if (setSystemMessage)
        application.conversation.setupMessageTime = Date.now()
    }
    return response.content.trim()
  } catch(error) {
    const { status, data } = error.response
    if (error.response) {
      console.log(status, data);
      debugger
    } else {
      console.log(`Error with OpenAI API request: ${error.message}`);
    }
  }
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
    debugger
  }
}

// var parentMessageId, conversationId

// async function gptResponse ({apiKey, text, logger,  application}) {

//   const api = new ChatGPTAPI({
//     apiKey
//   })

//   try {
//     let completion
//     if (parentMessageId)
//      completion = await api.sendMessage(text, {
//         conversationId,
//         parentMessageId
//       });
//     else
//       completion = await api.sendMessage(text)
//     logger.debug("Completion", completion);
//     parentMessageId = completion.parentMessageId
//     conversationId = completion.conversationId
//   } catch(error) {
//     // Consider adjusting the error handling logic for your use case
//     if (error.response) {
//       logger.debug(error.response.status, error.response.data);
//       debugger
//     } else {
//       logger.debug(`Error with OpenAI API request: ${error.message}`);
//     }
//   }
// }
