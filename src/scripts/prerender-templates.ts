import fs from 'fs'
import path from 'path'
import juice from 'juice'
import mkdirp from 'mkdirp'
// import nunjucks from 'nunjucks'

const baseDir = path.join(__dirname, '../../assets/in-house-bot/templates')

;['emails', 'pages'].forEach(dir => {
  const sourceDir = path.join(baseDir, `raw/${dir}`)
  const targetDir = path.join(baseDir, `prerendered/${dir}`)
  // nunjucks.configure(sourceDir, {
  //   autoescape: true
  // })

  mkdirp.sync(targetDir)

  fs.readdirSync(sourceDir)
    .filter(file => file.endsWith('.html'))
    .map(file => {
      const template = fs.readFileSync(path.join(sourceDir, file), { encoding: 'utf8' })
      return {
        name: path.parse(file).name,
        template: juice(template)
      }
    })
    .forEach(({ name, template }) => {
      const filePath = path.join(targetDir, `${name}.html`)
      const relPath = path.relative(process.cwd(), filePath)
      console.log(`writing: ${relPath}`)
      fs.writeFileSync(filePath, template, { encoding: 'utf8' })
    })
})

// import * as Templates from '../in-house-bot/templates'
// import nunjucks from 'nunjucks'

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

// const template = Templates.email.action({
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

// console.log(template)
