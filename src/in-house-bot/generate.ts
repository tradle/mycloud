import { Configuration, OpenAIApi} from 'openai'
import AWS from 'aws-sdk'
const samplesS3 = new AWS.S3()
const UTF8 = 'utf-8'

export default async function ({message,  messages, conf, language}) {
  const {openApiKey, AIGovernanceAndSupportFolder, providerSetup, AIGovernanceAndSupportBucket} = conf
  if (!openApiKey || !AIGovernanceAndSupportFolder || !AIGovernanceAndSupportBucket || !providerSetup) return
    
  let api = new Configuration({apiKey: openApiKey})
  const openai = new OpenAIApi(api)
  
  let orgMessage = await getFileFromS3(samplesS3,
    `${AIGovernanceAndSupportFolder}/${providerSetup}`,
    AIGovernanceAndSupportBucket)
  orgMessage += `\nTranslate all responds in ${language}`
  
  let systemContent = {role: "system", content: `${orgMessage}`}
  if (!messages.length)  
    messages.push(systemContent)
  
  else if (messages.length === 1  &&  messages[0].role !== 'system') 
    messages.splice(0, 0, systemContent)
  messages.push({role: "user", content: message})

  let msgs = messages.filter(m => m.role === 'system' || m.role === 'user')
  // messages.push({role: "user", content: `Translate the following English text to French$ ${message}`})
  try {
    let completion = await openai.createChatCompletion({      
        model: "gpt-3.5-turbo",
        temperature: 0.2,        
        messages: msgs
      })     
    messages.push(completion.data.choices[0].message)
    return messages
  } catch(error) {
    if (error.response) {
      console.log(error.response.status, error.response.data);
      debugger
    } else {
      console.log(`Error with OpenAI API request: ${error.message}`);
    }
  }
}
const getFileFromS3 = async (s3: AWS.S3, file: string, bucket: string): Promise<string> => {
  const params = {
    Bucket: bucket,
    Key: file
  }
  const data = await s3.getObject(params).promise()
  return data.Body.toString(UTF8)
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
