
export const PREAUTH = 'preauth'
export const AUTH = 'auth'
export const MESSAGE = 'message'
export const RESOURCE_ASYNC = 'resourcestream'
export const COMMAND = 'command'

// various http-based confirmations (e.g. email confirmation)
export const CONFIRMATION = 'confirmation'

// deployment
export const DEPLOYMENT_PINGBACK = 'deployment:pingback'
export const DEPLOYMENT_UPDATE_STACK = 'deployment:update_stack'
export const STACK_UPDATED = 'deployment:stack_updated'
export const CHILD_STACK_STATUS_CHANGED = 'deployment:child_stack_status'
// export const UPDATE_STACK = 'deployment:update_stack'

export const SCHEDULER = 'scheduler'

// remediation
export const REMEDIATION_COMMAND = 'remediation:utils'

// onfido
export const ONFIDO_REGISTER_WEBHOOK = 'onfido:register_webhook'
export const ONFIDO_PROCESS_WEBHOOK_EVENT = 'onfido:webhook'

// document checker
export const DOCUMENT_CHECKER_WEBHOOK_EVENT = 'documentChecker:webhook'
export const DOCUMENT_CHECKER_JOB = 'documentChecker:poll'
