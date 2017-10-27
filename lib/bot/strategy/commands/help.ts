const HELP_MENU_CUSTOMER = `**/help** - see this menu
**/products** - see the list of products
**/forgetme** - exercise your right to be forgotten`

const HELP_MENU_EMPLOYEE = `${HELP_MENU_CUSTOMER}
**/enableproduct [productId]** - enable a product
**/disableproduct [productId]** - disable a product
`

export default {
  name: 'help',
  description: 'show the command menu',
  exec: async function ({ context, req, command }) {
    const { employeeManager } = context
    const message = employeeManager.isEmployee(req.user)
      ? HELP_MENU_EMPLOYEE
      : HELP_MENU_CUSTOMER

    await context.sendSimpleMessage({ req, message })
  }
}
