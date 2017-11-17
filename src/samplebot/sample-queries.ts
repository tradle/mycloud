const listPhotoIds = `{
  rl_tradle_PhotoID(first:5) {
    edges {
      node {
        documentType {
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

const listApplications = `{
  rl_tradle_Application(first:5) {
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
          id
          title
        }
        relationshipManager {
          id
          title
        }
        status
        dateStarted
        dateCompleted
        dateEvaluated
        dateModified
        context
        request {
          id
          title
        }
        requestFor
        forms {
          id
          title
        }
        verificationsImported {
          item {
            id
            title
          }
          verification {
            id
            title
          }
        }
        verificationsIssued {
          item {
            id
            title
          }
          verification {
            id
            title
          }
        }
        certificate {
          id
          title
        }
        archived
      }
    }
  }
}`

const listNames = `{
  rl_tradle_Name {
    edges {
      node {
        givenName
        surname
      }
    }
  }
}`

const listVerifications = `{
  rl_tradle_Verification {
    edges {
      node {
        _link
        document {
          id
          title
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
    first: 20,
    filter: {
      EQ: {
        _inbound: true
        _author: $author
        context: $context
      }
    },
    orderBy: {
      property: time,
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
