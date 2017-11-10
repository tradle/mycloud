export type ExecCommandFunction = ({
  context: Commands,
  req: any,
  command:string
}) => Promise<void>

export interface Command {
  name: string
  description: string
  exec: ExecCommandFunction
  disabled?: boolean
}
