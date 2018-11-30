import { ICommand } from '../types'

export const command:ICommand = {
  name: 'genupdate',
  adminOnly: true,
  description: 'generate a MyCloud update package',
  examples: [
    '/genupdate --tag <versionTag> --stack-id <stackId> --provider [identityPermalink]',
    '/genupdate --tag <versionTag> --region <awsRegion> --manual',
  ],
  exec: async ({ commander, req, ctx, args }) => {
    const { deployment, productsAPI, employeeManager, logger } = commander
    if (!deployment) {
      throw new Error('"deployment" plugin not configured. Please add to plugins in bot.json')
    }

    let { provider, stackId, tag, manual, region } = args
    if (!(provider || manual)) {
      throw new Error('expected string "provider" or flag "manual"')
    }

    const { templateUrl } = await deployment.genUpdatePackageForStackWithVersion({
      tag,
      region,
      stackOwner: provider,
      stackId,
    })

    return { templateUrl }
  }
}
