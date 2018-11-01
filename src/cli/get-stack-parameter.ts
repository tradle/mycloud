
import { getVar } from './get-template-var'
export const parameterExistingDeploymentBucket = () => getVar('stackParameters.ExistingDeploymentBucket') || ''
