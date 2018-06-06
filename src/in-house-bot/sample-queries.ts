const listPhotoIds = `{
  rl_tradle_PhotoID(
    limit:5
    orderBy: {
      property: _time,
      desc: true
    }
  ) {
    edges {
      node {
        documentType {
          id
          title
        }
        scan {
          width
          height
          url
        }
        scanJson
      }
    }
  }
}`

const listSelfies = `{
  rl_tradle_Selfie(
    limit:5
    orderBy: {
      property: _time,
      desc: true
    }
  ) {
    edges {
      node {
        selfie {
          url
        }
      }
    }
  }
}`

const listApplications = `{
  rl_tradle_Application(
    limit:5
    orderBy: {
      property: _time,
      desc: true
    }
  ) {
    edges {
      node {
        _permalink
        _link
        _time
        _author
        _authorTitle
        _virtual
        time
        _t
        _s
        applicant {
          _t
          _link
          _permalink
        }
        relationshipManagers {
          _t
          _permalink
          _link
        }
        status
        dateStarted
        dateCompleted
        dateEvaluated
        dateModified
        context
        request {
          _t
          _permalink
          _link
        }
        requestFor
        checks {
          edges {
            node {
              provider
              status {
                id
                title
              }
            }
          }
        }
        submissions {
          edges {
            node {
              _t
              _link
              _permalink
              submission {
                _t
                _link
                _permalink
                _displayName
              }
            }
          }
        }
        certificate {
          _t
          _permalink
          _link
        }
        archived
      }
    }
  }
}`

const listNames = `{
  rl_tradle_Name(
    orderBy: {
      property: _time
    }
  ) {
    edges {
      node {
        givenName
        surname
      }
    }
  }
}`

const listVerifications = `{
  rl_tradle_Verification(
    orderBy: {
      property: _time,
      desc: true
    }
  ) {
    edges {
      node {
        _link
        document {
          _t
          _link
          _permalink
          _displayName
        }
        method
        dateVerified
        sources {
          _author
          _authorTitle
          method
        }
      }
    }
  }
}`

const listInboundMessages = `
# Note: SPECIFY AUTHOR AND/OR CONTEXT
# IN THE QUERY VARIABlES AT THE BOTTOM
query ($author: String, $context: String) {
  rl_tradle_Message(
    limit: 20,
    filter: {
      EQ: {
        _inbound: true
        _counterparty: $counterparty
        context: $context
      }
    },
    orderBy: {
      property: _time,
      desc: true
    }
  ) {
    edges {
      node {
        _author
        _recipient
        object
      }
    }
  }
}`

export default [
  {
    title: 'Photo IDs',
    query: listPhotoIds
  },
  {
    title: 'Selfies',
    query: listSelfies
  },
  {
    title: 'Application',
    query: listApplications
  },
  {
    title: 'Name forms',
    query: listNames
  },
  {
    title: 'Verifications',
    query: listVerifications
  },
  {
    title: 'Inbound messages',
    query: listInboundMessages
  }
]
