"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPhotoIds = `{
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
}`;
exports.listApplications = `{
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
}`;
exports.listNames = `{
  rl_tradle_Name {
    edges {
      node {
        givenName
        surname
      }
    }
  }
}`;
//# sourceMappingURL=sample-queries.js.map