import { getVar } from '../cli/get-template-var'

export const getCreateEvent = () => ({
  RequestType: 'Create',
  ResourceProperties: {
    name: getVar('stackParameters.OrgName'),
    domain: getVar('stackParameters.OrgDomain'),
    logo: getVar('stackParameters.OrgLogo'),
  }
})

if (!module.parent) {
  // @ts-ignore
  console.log(JSON.stringify(getCreateEvent()))
}
