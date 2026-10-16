import type { Rule } from '../../types'
import type { Draft } from '../core/privacy-controller'
import type { RuleIssue } from '../core/rule-validator'
import type { Kit } from './kit'
import type { PanelActions } from './privacy-panel'

type RuleEditorProps = {
  kit: Kit
  rules: readonly Rule[]
  issues: readonly RuleIssue[]
  countByRule: Readonly<Record<string, number>>
  draft: Draft
  isWide: boolean
  actions: PanelActions
}

export function RuleEditor({ kit, rules, issues, countByRule, draft, isWide, actions }: RuleEditorProps) {
  const { Box, Button, Input, Text } = kit
  const numberOf = new Map(rules.map((rule, index) => [rule.id, index + 1]))

  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="row" columnGap={2}>
        <Text bold>Rules</Text>
        <Text dimColor>{rules.length === 0 ? 'none yet' : String(rules.length)}</Text>
        {rules.length > 0 && (
          <Button key="clear" plain dimColor label="Clear rules" onPress={actions.clearRules} />
        )}
      </Box>
      {rules.map(rule => (
        <Box key={`row:${rule.id}`} flexDirection="column">
          <Box flexDirection={isWide ? 'row' : 'column'} columnGap={2}>
            <Box flexGrow={1}>
              <Input
                key={`kw:${rule.id}`}
                label={`${numberOf.get(rule.id)}. Keyword`}
                placeholder="text to hide"
                value={rule.keyword}
                submitLabel="next"
                onInput={keyword => actions.updateRule(rule.id, { keyword })}
                onSubmit={keyword => {
                  actions.updateRule(rule.id, { keyword })
                  actions.focus(`rp:${rule.id}`)
                }}
              />
            </Box>
            <Box flexGrow={1}>
              <Input
                key={`rp:${rule.id}`}
                label="Replace with"
                placeholder="[Placeholder]"
                value={rule.replacement}
                submitLabel="next"
                onInput={replacement => actions.updateRule(rule.id, { replacement })}
                onSubmit={replacement => {
                  actions.updateRule(rule.id, { replacement })
                  actions.focus('new-kw')
                }}
              />
            </Box>
          </Box>
          <Box flexDirection="row" columnGap={2} flexWrap="wrap">
            <Button
              key={`on:${rule.id}`}
              plain
              dimColor={!rule.isEnabled}
              label={rule.isEnabled ? 'Rule: on' : 'Rule: off'}
              onPress={() => actions.updateRule(rule.id, { isEnabled: !rule.isEnabled })}
            />
            <Button
              key={`case:${rule.id}`}
              plain
              dimColor={!rule.isCaseSensitive}
              label={rule.isCaseSensitive ? 'Case: exact' : 'Case: any'}
              onPress={() => actions.updateRule(rule.id, { isCaseSensitive: !rule.isCaseSensitive })}
            />
            <Button
              key={`word:${rule.id}`}
              plain
              dimColor={!rule.isWholeWord}
              label={rule.isWholeWord ? 'Match: whole word' : 'Match: inside words'}
              onPress={() => actions.updateRule(rule.id, { isWholeWord: !rule.isWholeWord })}
            />
            <Text dimColor>{rule.isEnabled ? `${countByRule[rule.id] ?? 0} found` : 'not applied'}</Text>
            <Button key={`rm:${rule.id}`} plain label="Remove" onPress={() => actions.removeRule(rule.id)} />
          </Box>
          {issues
            .filter(issue => issue.ruleId === rule.id)
            .map(issue => (
              <Text color={issue.isBlocking ? 'error' : 'warning'}>{issueText(issue, numberOf)}</Text>
            ))}
        </Box>
      ))}
      <Box flexDirection="column">
        <Box flexDirection={isWide ? 'row' : 'column'} columnGap={2}>
          <Box flexGrow={1}>
            <Input
              key="new-kw"
              autoFocus
              label="New keyword"
              placeholder="e.g. Mario Rossi"
              value={draft.keyword}
              submitLabel="next"
              onInput={keyword => actions.setDraft({ keyword })}
              onSubmit={keyword => {
                actions.setDraft({ keyword })
                actions.focus('new-rp')
              }}
            />
          </Box>
          <Box flexGrow={1}>
            <Input
              key="new-rp"
              label="Replace with"
              placeholder="e.g. [Person]"
              value={draft.replacement}
              submitLabel="add rule"
              onInput={replacement => actions.setDraft({ replacement })}
              onSubmit={replacement => {
                actions.setDraft({ replacement })
                actions.addDraftRule()
              }}
            />
          </Box>
        </Box>
        <Box flexDirection="row">
          <Button key="add" label="Add rule" onPress={actions.addDraftRule} />
        </Box>
      </Box>
    </Box>
  )
}

function issueText(issue: RuleIssue, numberOf: ReadonlyMap<string, number>): string {
  const other = issue.otherRuleId === undefined ? 'another rule' : `rule ${numberOf.get(issue.otherRuleId)}`
  switch (issue.kind) {
    case 'missing-keyword':
      return 'Type the text to hide, or remove this rule.'
    case 'missing-replacement':
      return 'Type a replacement, or remove this rule. Without one the keyword stays in the prompt.'
    case 'duplicate':
      return `Same as ${other}, so it is ignored.`
    case 'conflict':
      return `${other.charAt(0).toUpperCase()}${other.slice(1)} already replaces this keyword, so this rule is ignored.`
    case 'replacement-reveals-keyword':
      return 'The replacement still contains the keyword.'
  }
}
