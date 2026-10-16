export type Rule = {
  id: string
  keyword: string
  replacement: string
  isEnabled: boolean
  isCaseSensitive: boolean
  isWholeWord: boolean
}

export type RuleScope = 'session' | 'prompt'

export type Phase =
  | 'IDLE'
  | 'INTERCEPTED'
  | 'REVIEWING'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'BLOCKED'
  | 'ERROR'

declare module 'claude-code' {
  interface PluginState {
    // Only a redraw counter lives here: any plugin can read $.state, so the
    // prompt and the rules stay in the module's own memory.
    hush: { revision: number }
  }
}
