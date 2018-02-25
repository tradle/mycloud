import fs = require('fs')
import path = require('path')
import juice = require('juice')
import mkdirp = require('mkdirp')
import nunjucks = require('nunjucks')

const baseDir = path.join(__dirname, '../../assets/in-house-bot/templates')
const emailsSourceDir = path.join(baseDir, 'raw/emails')
const emailsTargetDir = path.join(baseDir, 'prerendered/emails')
// nunjucks.configure(emailsSourceDir, {
//   autoescape: true
// })

mkdirp.sync(emailsTargetDir)

fs.readdirSync(emailsSourceDir)
  .filter(file => file.endsWith('.html'))
  .map(file => {
    const template = fs.readFileSync(path.join(emailsSourceDir, file), { encoding: 'utf8' })
    return {
      name: path.parse(file).name,
      template: juice(template)
    }
  })
  .forEach(({ name, template }) => {
    const filePath = path.join(emailsTargetDir, `${name}.html`)
    const relPath = path.relative(process.cwd(), filePath)
    console.log(`writing: ${relPath}`)
    fs.writeFileSync(filePath, template, { encoding: 'utf8' })
  })

// import nunjucks = require('nunjucks')

// // nunjucks.configure(path.join(__dirname, '../../assets/in-house-bot/templates/emails'), {
// //   autoescape: true,
// //   // express: app,
// //   // watch: true
// // });

// nunjucks.configure(path.join(__dirname, '../../assets/in-house-bot/templates/emails'), {
//   autoescape: true,
//   cache: true,
//   // express: app,
//   // watch: true
// });

// const template = nunjucks.render('action.html{
//   action: {
//     text: 'Launch MyCloud',
//     href: 'launchUrl'
//   },
//   blocks: [
//     { body: 'Hi there,' },
//     { body: 'Click below to launch your Tradle MyCloud' }
//   ],
//   signature: 'Tradle Team',
//   twitter: 'tradles'
// })

// console.log(nunjucks.render('action.html'))
