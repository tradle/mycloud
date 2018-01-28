import path = require('path')
import fs = require('fs')

fs.readdirSync(__dirname).forEach(file => {
  if (file.endsWith('.test.js')) {
    require(path.join(__dirname, file))
  }
})
