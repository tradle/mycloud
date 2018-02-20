// #!/usr/bin/env node
import { getLaunchStackUrl } from '../utils'

const LAUNCH_STACK_BASE_URL = 'https://console.aws.amazon.com/cloudformation/home'
const REGIOn = 'us-east-1'

console.log(getLaunchStackUrl({
  templateURL: process.argv[2],
  region: 'us-east-1',
  stackName: 'tradle'
}))
