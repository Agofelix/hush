import type { Rule } from '../../types'

export type Segment = {
  text: string
  /** Set on a segment that replaced a match: the rule that produced it. */
  ruleId?: string
  /** The range of the original text this segment stands for. */
  start: number
  end: number
}

export type Anonymized = {
  /** Exactly the concatenation of `segments`: what the preview shows is what is sent. */
  text: string
  segments: readonly Segment[]
  replacementCount: number
  countByRule: Readonly<Record<string, number>>
}

type Candidate = { start: number; end: number; order: number }

const WORD_CLASS = '[\\p{L}\\p{M}\\p{N}\\p{Pc}]'
const WORD_CHAR = /^[\p{L}\p{M}\p{N}\p{Pc}]$/u
const SYNTAX_CHARS = /[\\^$.*+?()[\]{}|/]/g

/**
 * Replaces every occurrence of each rule's keyword in one pass over the
 * original text. Matches are found on the original only, so a replacement
 * is never matched again by another rule.
 *
 * Overlaps are settled leftmost first, then longest first, then by rule
 * order: "Mario Rossi" wins over "Rossi" where both start together.
 */
export function anonymize(original: string, rules: readonly Rule[]): Anonymized {
  const applied = rules.filter(rule => rule.isEnabled && rule.keyword.trim() !== '')
  const candidates: Candidate[] = applied.flatMap((rule, order) =>
    findOccurrences(original, rule).map(([start, end]) => ({ start, end, order })),
  )
  candidates.sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || a.order - b.order,
  )

  const segments: Segment[] = []
  const countByRule: Record<string, number> = {}
  let cursor = 0
  for (const candidate of candidates) {
    if (candidate.start < cursor) continue
    const rule = applied[candidate.order]
    if (rule === undefined) continue
    if (candidate.start > cursor) {
      segments.push({ text: original.slice(cursor, candidate.start), start: cursor, end: candidate.start })
    }
    segments.push({ text: rule.replacement, ruleId: rule.id, start: candidate.start, end: candidate.end })
    countByRule[rule.id] = (countByRule[rule.id] ?? 0) + 1
    cursor = candidate.end
  }
  if (cursor < original.length) {
    segments.push({ text: original.slice(cursor), start: cursor, end: original.length })
  }

  const replacementCount = Object.values(countByRule).reduce((sum, count) => sum + count, 0)

  return { text: segments.map(segment => segment.text).join(''), segments, replacementCount, countByRule }
}

function findOccurrences(text: string, rule: Rule): Array<[number, number]> {
  const pattern = new RegExp(patternFor(rule), rule.isCaseSensitive ? 'gu' : 'giu')
  const found: Array<[number, number]> = []
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    found.push([match.index, match.index + match[0].length])
    // Restart one code point later so that overlapping occurrences of the
    // same keyword are candidates too, and the overlap rules decide.
    pattern.lastIndex = match.index + ((text.codePointAt(match.index) ?? 0) > 0xffff ? 2 : 1)
  }

  return found
}

function patternFor(rule: Rule): string {
  const keyword = rule.keyword.trim()
  // Composed and decomposed accents look the same on screen: match both
  // without normalizing the prompt itself, which must reach Claude as typed.
  const forms = [...new Set([keyword.normalize('NFC'), keyword.normalize('NFD')])]

  return forms.map(form => boundedLiteral(form, rule.isWholeWord)).join('|')
}

function boundedLiteral(keyword: string, isWholeWord: boolean): string {
  const literal = keyword
    .split(/\s+/u)
    .map(part => part.replace(SYNTAX_CHARS, '\\$&'))
    .join('\\s+')
  if (!isWholeWord) return `(?:${literal})`

  const chars = [...keyword]
  const head = WORD_CHAR.test(chars[0] ?? '') ? `(?<!${WORD_CLASS})` : ''
  const tail = WORD_CHAR.test(chars[chars.length - 1] ?? '') ? `(?!${WORD_CLASS})` : ''

  return `(?:${head}${literal}${tail})`
}
