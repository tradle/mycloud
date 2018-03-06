import path from 'path'
import fs from 'fs'

fs.readdirSync(__dirname).forEach(file => {
  if (file.endsWith('.test.js')) {
    require(path.join(__dirname, file))
  }
})
