
export function createPlugin ({ conf, logger }) {

  const willRequestForm = ({ to, application, formRequest }) => {
    const appSpecific = application && conf[application.requestFor]
    const { form } = formRequest

    let lens
    if (appSpecific) {
      lens = appSpecific[form]
    }

    if (!lens) {
      lens = conf[form]
    }

    if (lens) {
      logger.debug(`updated lens on form request for: ${form}`)
      formRequest.lens = lens
    }
  }

  return {
    willRequestForm
  }
}

