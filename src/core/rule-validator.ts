import type { Rule } from '../../types'

export type RuleIssueKind =
  | 'missing-keyword'
  | 'missing-replacement'
  | 'duplicate'
  | 'conflict'
  | 'replacement-reveals-keyword'

export type RuleIssue = {
  ruleId: string
  kind: RuleIssueKind
  /** A blocking issue keeps the prompt from being sent until it is fixed. */
  isBlocking: boolean
  /** For `duplicate` and `conflict`: the earlier rule that wins. */
  otherRuleId?: string
}

export type RuleCheck = {
  /** The rules the engine applies: enabled, complete, keyword trimmed, first of each keyword. */
  applied: readonly Rule[]
  issues: readonly RuleIssue[]
  isBlocked: boolean
}

export function checkRules(rules: readonly Rule[]): RuleCheck {
  const applied: Rule[] = []
  const issues: RuleIssue[] = []
  const firstByIdentity = new Map<string, Rule>()

  for (const rule of rules) {
    if (!rule.isEnabled) continue
    const keyword = rule.keyword.trim()
    if (keyword === '' && rule.replacement === '') continue
    if (keyword === '') {
      issues.push({ ruleId: rule.id, kind: 'missing-keyword', isBlocking: true })
      continue
    }
    // An empty replacement would leave the keyword in the prompt, so the
    // rule blocks sending instead of silently doing nothing.
    if (rule.replacement === '') {
      issues.push({ ruleId: rule.id, kind: 'missing-replacement', isBlocking: true })
      continue
    }

    const identity = identityOf({ ...rule, keyword })
    const earlier = firstByIdentity.get(identity)
    if (earlier !== undefined) {
      const kind = earlier.replacement === rule.replacement ? 'duplicate' : 'conflict'
      issues.push({ ruleId: rule.id, kind, isBlocking: false, otherRuleId: earlier.id })
      continue
    }
    firstByIdentity.set(identity, rule)

    if (fold(rule.replacement).includes(fold(keyword))) {
      issues.push({ ruleId: rule.id, kind: 'replacement-reveals-keyword', isBlocking: false })
    }
    applied.push({ ...rule, keyword })
  }

  return { applied, issues, isBlocked: issues.some(issue => issue.isBlocking) }
}

function identityOf(rule: Rule): string {
  const keyword = rule.keyword.normalize('NFC')
  const spelled = rule.isCaseSensitive ? keyword : keyword.toLowerCase()

  return `${rule.isCaseSensitive ? 'c' : 'i'}${rule.isWholeWord ? 'w' : 'p'}:${spelled}`
}

function fold(text: string): string {
  return text.normalize('NFC').toLowerCase()
}
