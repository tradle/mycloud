import parse from 'yargs-parser'
import { ICommand, IDeploymentConf } from '../types'

export const command:ICommand = {
  name: 'genupdate',
  description: 'get a link to update your MyCloud',
  examples: [
    // '/getlaunchlink --name EasyBank --domain easybank.io',
    // '/getlaunchlink --name EasyBank --domain easybank.io --logo "https://s3.amazonaws.com/tradle-public-images/easy.png"',
    '/genupdate --provider <identityPermalink>',
    '/genupdate --stack-id <stackId> --admin-email <adminEmail>'
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

    let { provider, stackId, adminEmail } = args
    if (req.payload) { // incoming message
      if (provider) {
        if (!employeeManager.isEmployee(req.user)) {
          throw new Error(`oops, you don't have the security clearance`)
        }
      } else {
        if (req.user.friend) {
          provider = req.user.id
        }

        throw new Error(`hm, this operation isn't for you`)
      }
    }

    if (!(provider || (stackId && adminEmail))) {
      throw new Error('expected "--provider" or "--stack-id" + "--admin-email"')
    }

    if (provider) {
      const update = await deployment.genUpdatePackage({
        createdBy: provider
      })

      logger.debug('generated mycloud update link', { url: update.updateUrl })
      return update
    }

    const configuration = <IDeploymentConf>{ adminEmail }
    return deployment.genUpdatePackageForStack({ stackId, configuration })
  },
  sendResult: async ({ commander, req, to, args, result }) => {
    const { bot, logger } = this
    const { url, template, childDeployment, configuration } = result
    // const { hrEmail, adminEmail } = configuration
    await commander.sendSimpleMessage({
      req,
      to,
      message: `🚀 [Click to update your MyCloud](${url})`
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
