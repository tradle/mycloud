import parse = require('yargs-parser')
import { ICommand, IDeploymentOpts } from '../types'

export const command:ICommand = {
  name: 'updatemycloud',
  description: 'get a link to update your MyCloud',
  examples: [
    // '/getlaunchlink --name EasyBank --domain easybank.io',
    // '/getlaunchlink --name EasyBank --domain easybank.io --logo "https://s3.amazonaws.com/tradle-public-images/easy.png"',
    '/updatemycloud --provider <identityPermalink>'
  ],
  exec: async ({ commander, req, ctx, args }) => {
    const { deployment, productsAPI, employeeManager, logger } = commander
    if (!deployment) {
      throw new Error('"deployment" plugin not configured. Please add to plugins in bot.json')
    }

    // const isPublic = await commander.bot.buckets.ServerlessDeployment.isPublic()
    // if (!isPublic) {
    //   throw new Error('deployment bucket is not public. No one will be able to use your template except you')
    // }

    let { provider } = args
    if (req.payload) { // incoming message
      if (provider) {
        if (!employeeManager.isEmployee(req.user)) {
          throw new Error(`oops, you don't have the security clearance`)
        }
      } else {
        if (req.user.friend) {
          provider = req.user.id
        } else {
          throw new Error(`hm, this operation isn't for you`)
        }
      }
    }

    const update = await deployment.createUpdate({
      createdBy: provider
    })

    logger.debug('generated mycloud update link', { updateUrl: update.updateUrl })
    return update
  },
  sendResult: async ({ commander, req, to, args, result }) => {
    const { bot, logger } = this
    const { updateUrl, childDeployment, configuration } = result
    // const { hrEmail, adminEmail } = configuration
    await commander.sendSimpleMessage({
      req,
      to,
      message: `🚀 [Click to update your MyCloud](${updateUrl})`
    })

    // try {
    //   await bot.mailer.send({
    //     from: conf.senderEmail,
    //     to: form.adminEmail,
    //     ...deployment.genLaunchEmail({ launchUrl })
    //   })

    //   emailed.admin = true
    // } catch (err) {
    //   logger.error(`failed to send email to admin`, {
    //     deploymentOpts,
    //     error: err.stack
    //   })
    // }
  }
}
