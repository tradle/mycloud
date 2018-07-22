#!/bin/bash

set -euo pipefail

npm version $1
git push -u
git push --follow-tags
