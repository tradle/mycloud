import path from 'path'
import nunjucks from 'nunjucks'
import Errors from '../errors'

type Render = (args:any) => string

interface IAction {
  text: string
  href: string
}

interface IContentBlock {
  body: string
}

interface IActionEmailArgs {
  action: IAction,
  blocks: IContentBlock[]
  signature: string
  twitter: string
}

type RenderActionEmail = (args:IActionEmailArgs) => string
type Templates = {
  [name: string]: Render
}

type AllTemplates = {
  [category: string]: Templates
}

interface IConfirmationPageArgs {
  blocks: IContentBlock[]
  signature: string
}

const nunjucksConf = {
  autoescape: false,
  cache: true
}

const baseDir = path.join(__dirname, '../../assets/in-house-bot/templates/prerendered')
const env = {
  email: nunjucks.configure(path.join(baseDir, 'emails'), nunjucksConf),
  page: nunjucks.configure(path.join(baseDir, 'pages'), nunjucksConf)
}

const withAutoEscape = nunjucks.configure({
  autoescape: true
})

const withoutAutoEscape = nunjucks.configure({
  autoescape: false
})

export const email:Templates = {
  action: (data:IActionEmailArgs) => env.email.render('action.html', data)
}

export const page:Templates = {
  confirmation: (data:IConfirmationPageArgs) => env.page.render('confirmation.html', data)
}

export const renderString = withAutoEscape.renderString.bind(withAutoEscape)
export const renderStringNoAutoEscape = withoutAutoEscape.renderString.bind(withoutAutoEscape)
export const renderData = (dataTemplate, data) => {
  try {
    const rendered = renderString(JSON.stringify(dataTemplate), data)
    return JSON.parse(rendered)
  } catch (err) {
    Errors.rethrowAs(err, new Errors.InvalidInput('invalid values in data template'))
  }
}

type TemplateType = 'email' | 'string'
