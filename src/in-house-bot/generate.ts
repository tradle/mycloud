import { Configuration, OpenAIApi} from 'openai'
import AWS from 'aws-sdk'
const samplesS3 = new AWS.S3()
const UTF8 = 'utf-8'

const systemMessage = `
You are sales assistent for company CODEX. You will answer question for products and company offers. I will provide below the marketing materials of CODEX. Please use them to answer questions.
CODEX Execution GmbH
Service Portfolio
Service Portfolio
Seite 2
Bank Account
Foundation of Company
Company Domicile
Inbound and Triage
Business Plan
Legal & Compliance
Information Technology
Director Services
Finance & Accounting
HR Services
Outbound Services
Expats Relocation Marketing / CI
Project Management
ICO / TGE Support Administration Services
Company Set-Up Business Support
CODEX
Execution GmbH
Your Codex Execution
SPOC support: CEO
experience combined
with execution
excellence
Company set-up
CODEX
Execution GmbH Seite 3
Bank Account
• Bank account with a
Swiss/Liechtenstein bank
Foundation of Company
• Foundation of AG, GmbH or a
Foundation
• Opening of capital account with a
Swiss/Liechtenstein bank
Company Domicile
• Temporary and long-term offices,
tailored to your needs
(assessment)
Business Plan
• Support to create a business plan
which is required e.g. for
Foundation of Company, Bank
Account, Work/Residence Permits
Legal & Compliance
• legal/compliance/tax structure
• CH compliant Governance
framework
Information Technology
• Company IT infrastructure
• Server- and cloud solutions
Director Services
• Board of Directors
• Board of Trustees
Expats Relocation
• Work and residence permit for EU
and non-EU citizens
• Relocation of spouse/children
members
• Temporary/long-term housing
• Insurances, Car, Phone, Internet,
TV
ICO / TGE Support
• Due diligence processes
• White paper support
• ICO assistance
Business Support
CODEX
Execution GmbH Seite 4
Outbound Services
• Client surveys
• Client mailings/gifts
Finance and Accounting
• Chart of accounts
• Accounting (including
cryptocurrency), Payroll, VAT,
Withholding tax, AHV
• Financial reporting
• Audit
Inbound and Triage
• Mail collection
• Forwarding
HR Services
• Recruiting support
• Insurances
• Contracts
• HR-Admin
• Payroll
Project Management
• Program and project management
services
Administration Services
• Personal assistant
• Support services
Marketing / CI
• Marketing campaigns
• Corporate Identity
Codex Execution TGE End-to-End Offering
Pre-Sale
TGE
Post-TGE
Design
Preparation
TGE Governance: Reporting and Risk Management
Advertising Investor Lock-In KYC Receive Funds Issue tokens
Investor, Market, Public Relations
Legal, Tax, Compliance
Organization Design
Role definition
Contracts
IP/Patents
Business Design Ecosystem Design
Go To Market Design
Marketing, Columns, Sales approach
Jurisdictions, Compliance requirements
Promises and legal agreements
Corporate Structure
Business Idea
White Paper
Business Plan
Business Model
Business Set-up
Setting up optimal entity
Tax and regulatory rulings
Tech Dev., Prototype, Testing
Communication
Advertising Investor Lock-In KYC Receive Funds Issue tokens Communication
TGE preparations / Platform Selection
KYC procedure TGE structuring
ICO Platform: Wallets, Conversions, Bank Accounts
Ecosystem build-up
Pilot Fishing / Analysts Opinions
Analysts Token Holders To the public
Asset Management
Liquidity Management Arbitrage
Go To Market
Sales & marketing materials
Pitch-Deck
Website and Social Media
Events
Protocol selection
Smart contract design
Apps and Transactions
Financial Model
Token economics
Token mechanics
Liquidity Management
Investment Case
Governance
Not for distribution
Thanks for your attention.
`

export default async function ({message,  messages, conf, language}) {
  const {openApiKey, AIGovernanceAndSupportFolder, providerSetup, AIGovernanceAndSupportBucket} = conf
  if (!openApiKey) return
    
  let api = new Configuration({apiKey: openApiKey})
  const openai = new OpenAIApi(api)
  
  let orgMessage
  if (AIGovernanceAndSupportFolder && AIGovernanceAndSupportBucket && providerSetup)
    orgMessage = await getFileFromS3(samplesS3,
      `${AIGovernanceAndSupportFolder}/${providerSetup}`,
      AIGovernanceAndSupportBucket)
  else
    orgMessage = systemMessage
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
