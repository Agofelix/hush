import type { Elements } from 'claude-code'

/** The element tables that can edit rules: both have `Input`. */
export type Kit = Elements['terminal'] | Elements['desktop']

/** At or above this many body columns a rule's two fields sit side by side. */
export const WIDE_COLUMNS = 72
