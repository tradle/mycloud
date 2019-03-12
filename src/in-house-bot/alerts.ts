import Errors from '../errors'
import { compareTags } from '../utils'
import {
  SNSUtils,
  VersionInfo,
  Bot,
  Logger,
  IOrganization,
  LowFundsInput,
  ITradleObject,
  ResourceStub,
  MiniVersionInfo,
  IChildDeployment
} from './types'

interface VersionEmailInput {
  current: VersionInfo
  update: VersionInfo
  org: IOrganization
}

export class Alerts {
  private snsUtils: SNSUtils
  private adminAlertsTopic: string
  private logger: Logger
  private org: IOrganization
  private bot: Bot
  constructor({ bot, org, logger }: { bot: Bot; org: IOrganization; logger: Logger }) {
    this.snsUtils = bot.snsUtils
    this.adminAlertsTopic = bot.serviceMap.Topic.AdminAlerts
    this.logger = logger
    this.org = org
    this.bot = bot
  }

  public updateAvailable = async ({
    current,
    update
  }: {
    current: VersionInfo
    update: VersionInfo
  }) => {
    this.logger.debug('alerting admin about available update')
    if (compareTags(current.tag, update.tag) >= 0) {
      throw new Errors.InvalidInput(
        `expected update version ${update.tag} to be greater than current version ${current.tag}`
      )
    }

    const { org } = this
    const body = generateVersionAlertEmailText({ org, current, update })
    await this._emailAdmin({
      subject: generateVersionAlertSubject({ org, current, update }),
      body
    })
  }

  public lowFunds = async ({
    blockchain,
    networkName,
    address,
    balance = 0,
    minBalance = this.bot.blockchain.minBalance
  }: LowFundsInput) => {
    await this._emailAdmin({
      subject: `${this.org.name} MyCloud blockchain balance low`,
      body: `Dude,

This is your MyCloud. Fill me up regular please:

Current Balance: ${balance}
Minimum Balance for happiness: ${minBalance}
Blockchain: ${blockchain}
Network: ${networkName}
Address: ${address}

Grumpily,
Your MyCloud
`
    })
  }

  public childUpdated = async ({ from, to }: { from: IChildDeployment; to: IChildDeployment }) => {
    const { identity } = from
    if (!identity) return

    const friend = await this.bot.friends.getByIdentityPermalink(identity._permalink)
    const fromTag = from.version.tag
    const toTag = to.version.tag
    await this._emailAdmin({
      subject: `[MyCloud.UPDATED]: ${friend.name} ${fromTag} -> ${toTag}`,
      body: `Dearest,

This is your MyCloud. One of your children has updated their MyCloud

From version: ${fromTag}   (#${from.version.commit})
To version:   ${toTag}     (#${to.version.commit})

The culprit:

Name: ${friend.name}
Identity: ${identity._permalink}
Domain: ${friend.domain}
Org: ${friend.org._displayName || friend.org._permalink}
StackId: ${to.stackId}
API Url: ${to.apiUrl}
`
    })
  }

  public childRolledBack = async ({
    from,
    to
  }: {
    from?: IChildDeployment
    to: IChildDeployment
  }) => {
    const { identity } = to
    if (!identity) return

    const friend = await this.bot.friends.getByIdentityPermalink(identity._permalink)
    const { version } = to
    await this._emailAdmin({
      subject: `[MyCloud.ROLLBACK]: ${friend.name} rolled back MyCloud (${version.tag})`,
      body: `Yo,

This is your MyCloud. One of your children has attempted to update their MyCloud, but rolled back.

Version rolled back to:   ${version.tag}     (#${version.commit})

The culprit:

Name: ${friend.name}
Identity: ${identity._permalink}
Domain: ${friend.domain}
Org: ${friend.org._displayName || friend.org._permalink}
StackId: ${to.stackId}
API Url: ${to.apiUrl}
`
    })
  }

  public childLaunched = async (childDeployment: IChildDeployment) => {
    const { identity } = childDeployment
    if (!identity) return

    const friend = await this.bot.friends.getByIdentityPermalink(identity._permalink)
    const { tag } = childDeployment.version
    await this._emailAdmin({
      subject: `[MyCloud.NEW]: ${friend.name} (${tag})`,
      body: `Yo,

This is your MyCloud. You have a new baby:

Name: ${friend.name}
Identity: ${identity._permalink}
Domain: ${friend.domain}
Org: ${friend.org._displayName || friend.org._permalink}
StackId: ${childDeployment.stackId}
API Url: ${childDeployment.apiUrl}
`
    })
  }

  private _emailAdmin = async ({ subject, body }) => {
    await this.snsUtils.publish({
      topic: this.adminAlertsTopic,
      subject,
      message: {
        default: body,
        email: body
      }
    })
  }
}

export const generateVersionAlertSubject = ({ org, current, update }: VersionEmailInput) => {
  return `${org.name} MyCloud update available: ${current.tag} -> ${update.tag}`
}

export const generateVersionAlertEmailText = ({ org, current, update }: VersionEmailInput) => {
  let greeting = `Dear Admin`
  if (Math.random() < 0.1) {
    greeting += '(can I call you Ad?)'
  }

  return `${greeting},

This is your ${org.name} MyCloud speaking. I hope you're well.

The Tradle mothership has just informed me there's an update available: ${update.tag}

I'm currently at version ${current.tag}

To see what changed from ${current.tag} to ${update.tag}, look here:
https://github.com/tradle/serverless/blob/master/CHANGELOG.md

Updating me requires installing the tradleconf tool, which you can find here:
https://github.com/tradle/configure-tradle

Once you've installed tradleconf, run this command:
tradleconf update --tag ${update.tag}

Make me young again,
Your MyCloud
`
}
