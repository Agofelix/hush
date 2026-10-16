import { describe, expect, test } from 'claude-code/testing'

import { anonymize } from '../src/core/replacement-engine'
import { checkRules } from '../src/core/rule-validator'
import type { Rule } from '../types'

let lastId = 0

function rule(keyword: string, replacement: string, overrides: Partial<Rule> = {}): Rule {
  lastId += 1

  return {
    id: `r${lastId}`,
    keyword,
    replacement,
    isEnabled: true,
    isCaseSensitive: false,
    isWholeWord: true,
    ...overrides,
  }
}

const PEC =
  "Dovrai scrivere una pec da parte della nostra società per l'amministratore delegato di Mercedes Spa, scrivendo che la nostra ultima Mercedes acquistata non rispetta i requisiti del contratto, pertanto si chiede di intervenire"

describe('replacement engine', () => {
  test('replaces a single keyword everywhere, as in the PEC example', () => {
    const result = anonymize(PEC, [rule('Mercedes', '[Cliente]')])

    expect(result.text).toBe(
      "Dovrai scrivere una pec da parte della nostra società per l'amministratore delegato di [Cliente] Spa, scrivendo che la nostra ultima [Cliente] acquistata non rispetta i requisiti del contratto, pertanto si chiede di intervenire",
    )
    expect(result.replacementCount).toBe(2)
  })

  test('counts every occurrence of a keyword', () => {
    const only = rule('Rossi', '[Persona]')
    const result = anonymize('Rossi, Rossi e ancora Rossi.', [only])

    expect(result.text).toBe('[Persona], [Persona] e ancora [Persona].')
    expect(result.countByRule[only.id]).toBe(3)
  })

  test('applies several rules in one pass', () => {
    const result = anonymize('Mario Rossi abita in Via Roma 25, P.IVA IT12345678901.', [
      rule('Mario Rossi', '[Persona]'),
      rule('Via Roma 25', '[Indirizzo]'),
      rule('IT12345678901', '[PartitaIVA]'),
    ])

    expect(result.text).toBe('[Persona] abita in [Indirizzo], P.IVA [PartitaIVA].')
    expect(result.replacementCount).toBe(3)
  })

  test('matches without regard to case by default', () => {
    const result = anonymize('mercedes, MERCEDES, MeRcEdEs', [rule('Mercedes', 'X')])

    expect(result.text).toBe('X, X, X')
  })

  test('matches only the exact case when the rule asks for it', () => {
    const result = anonymize('Mercedes, mercedes', [rule('Mercedes', 'X', { isCaseSensitive: true })])

    expect(result.text).toBe('X, mercedes')
  })

  test('matches whole words by default and inside words when asked', () => {
    const text = 'Mercedes-Benz, Mercedesland, AMercedes, Mercedes_x'

    expect(anonymize(text, [rule('Mercedes', 'X')]).text).toBe(
      'X-Benz, Mercedesland, AMercedes, Mercedes_x',
    )
    expect(anonymize(text, [rule('Mercedes', 'X', { isWholeWord: false })]).text).toBe(
      'X-Benz, Xland, AX, X_x',
    )
  })

  test('treats accented letters as letters of the word', () => {
    const result = anonymize('La Società Perché e la società perché.', [
      rule('società', '[S]'),
      rule('perché', '[P]'),
    ])

    expect(result.text).toBe('La [S] [P] e la [S] [P].')
    expect(anonymize('Perchéx', [rule('perché', '[P]')]).text).toBe('Perchéx')
  })

  test('matches composed and decomposed accents and keeps the prompt unnormalized', () => {
    const decomposed = 'Société Générale'
    const composed = 'Société Générale'

    expect(anonymize(`a ${decomposed} b`, [rule(composed, '[Banca]')]).text).toBe('a [Banca] b')
    expect(anonymize(`a ${composed} b`, [rule(decomposed, '[Banca]')]).text).toBe('a [Banca] b')

    const untouched = `café ${composed}`
    expect(anonymize(untouched, [rule('nothing', 'x')]).text).toBe(untouched)
  })

  test('handles other scripts and characters outside the basic plane', () => {
    expect(anonymize('Встреча в МОСКВА и Москва.', [rule('москва', '[Città]')]).text).toBe(
      'Встреча в [Città] и [Città].',
    )
    expect(
      anonymize('会议在東京举行', [rule('東京', '[城市]', { isWholeWord: false })]).text,
    ).toBe('会议在[城市]举行')
    expect(anonymize('id 𝒳secret𝒳 end 𝒳secret𝒳', [rule('𝒳secret𝒳', '[K]', { isWholeWord: false })]).text).toBe(
      'id [K] end [K]',
    )
    expect(anonymize('🔒 Progetto Aurora 🔒', [rule('Progetto Aurora', '[P]')]).text).toBe('🔒 [P] 🔒')
  })

  test('settles overlapping rules longest first, whatever their order', () => {
    const text = 'Mercedes Spa ha venduto una Mercedes.'
    const company = rule('Mercedes Spa', '[Azienda]')
    const brand = rule('Mercedes', '[Marchio]')

    expect(anonymize(text, [company, brand]).text).toBe('[Azienda] ha venduto una [Marchio].')
    expect(anonymize(text, [brand, company]).text).toBe('[Azienda] ha venduto una [Marchio].')
  })

  test('settles partly overlapping rules leftmost first', () => {
    const result = anonymize('foo bar baz', [rule('bar baz', '[B]'), rule('foo bar', '[A]')])

    expect(result.text).toBe('[A] baz')
  })

  test('gives an identical span to the earlier rule', () => {
    const first = rule('Rossi', '[Uno]')
    const second = rule('rossi', '[Due]')
    const result = anonymize('Rossi', [first, second])

    expect(result.text).toBe('[Uno]')
    expect(result.countByRule[second.id]).toBeUndefined()
  })

  test('replaces once when two rules are duplicates', () => {
    const first = rule('Mercedes', '[Cliente]')
    const copy = rule('Mercedes', '[Cliente]')
    const check = checkRules([first, copy])

    expect(anonymize('Mercedes e Mercedes', check.applied).text).toBe('[Cliente] e [Cliente]')
    expect(check.issues).toEqual([
      { ruleId: copy.id, kind: 'duplicate', isBlocking: false, otherRuleId: first.id },
    ])
    expect(check.isBlocked).toBe(false)
  })

  test('keeps the first of two conflicting mappings and reports the second', () => {
    const first = rule('Mercedes', '[Cliente]')
    const second = rule('MERCEDES', '[Marchio]')
    const check = checkRules([first, second])

    expect(anonymize('una Mercedes', check.applied).text).toBe('una [Cliente]')
    expect(check.issues[0]?.kind).toBe('conflict')
    expect(check.issues[0]?.otherRuleId).toBe(first.id)
  })

  test('ignores empty and disabled rules and blocks incomplete ones', () => {
    const text = 'Mercedes'

    expect(anonymize(text, [rule('', 'X'), rule('   ', 'Y')]).text).toBe('Mercedes')
    expect(anonymize(text, [rule('Mercedes', 'X', { isEnabled: false })]).text).toBe('Mercedes')

    const noKeyword = rule('', '[X]')
    const noReplacement = rule('Mercedes', '')
    const blank = rule('', '')
    const check = checkRules([noKeyword, noReplacement, blank])

    expect(check.applied).toHaveLength(0)
    expect(check.isBlocked).toBe(true)
    expect(check.issues.map(issue => issue.kind)).toEqual(['missing-keyword', 'missing-replacement'])
    expect(checkRules([blank, rule('Mercedes', '', { isEnabled: false })]).isBlocked).toBe(false)
  })

  test('trims the keyword the person typed', () => {
    const check = checkRules([rule('  Mercedes  ', '[C]')])

    expect(check.applied[0]?.keyword).toBe('Mercedes')
    expect(anonymize('la Mercedes nuova', check.applied).text).toBe('la [C] nuova')
  })

  test('warns when the replacement still shows the keyword', () => {
    const check = checkRules([rule('Mercedes', '[mercedes]')])

    expect(check.issues[0]?.kind).toBe('replacement-reveals-keyword')
    expect(check.isBlocked).toBe(false)
  })

  test('keeps every space, tab and punctuation mark outside the matches', () => {
    const text = '  Mercedes\t,  (Mercedes)!  \t'

    expect(anonymize(text, [rule('Mercedes', 'X')]).text).toBe('  X\t,  (X)!  \t')
  })

  test('keeps line breaks and lets a phrase match across one', () => {
    const text = 'Gentile Mario\nRossi,\r\nla Mercedes\r\nè pronta.\n'
    const result = anonymize(text, [rule('Mario Rossi', '[Persona]'), rule('Mercedes', '[Cliente]')])

    expect(result.text).toBe('Gentile [Persona],\r\nla [Cliente]\r\nè pronta.\n')
    expect(anonymize('Mario Rossi', [rule('Mario Rossi', '[P]')]).text).toBe('[P]')
  })

  test('reads keywords literally, regular expression characters included', () => {
    const keyword = 'a.b*c(d)[e]{f}|g^$\\h/i?+'

    expect(anonymize(`x ${keyword} y`, [rule(keyword, '[K]', { isWholeWord: false })]).text).toBe('x [K] y')
    expect(anonymize('aXb*c(d)[e]{f}|g^$\\h/i?+', [rule(keyword, '[K]')]).text).toBe(
      'aXb*c(d)[e]{f}|g^$\\h/i?+',
    )
    expect(anonymize('C++ e c++', [rule('C++', '$&$1')]).text).toBe('$&$1 e $&$1')
  })

  test('never runs a replacement through another rule', () => {
    const result = anonymize('Mercedes', [rule('Mercedes', '[Cliente]'), rule('Cliente', '[Persona]')])

    expect(result.text).toBe('[Cliente]')
  })

  test('treats a placeholder already in the prompt as ordinary text', () => {
    expect(anonymize('[Cliente] e Mercedes', [rule('Mercedes', '[Cliente]')]).text).toBe(
      '[Cliente] e [Cliente]',
    )
    expect(anonymize('[Cliente] e Mercedes', [rule('Cliente', '[Persona]')]).text).toBe(
      '[[Persona]] e Mercedes',
    )
  })

  test('handles a very long prompt', () => {
    const block = 'Il cliente Mercedes Spa ha scritto a Mario Rossi.\n'
    const text = block.repeat(20_000)
    const started = Date.now()
    const result = anonymize(text, [rule('Mercedes Spa', '[Azienda]'), rule('Mario Rossi', '[Persona]')])

    expect(result.replacementCount).toBe(40_000)
    expect(result.text).toBe('Il cliente [Azienda] ha scritto a [Persona].\n'.repeat(20_000))
    expect(Date.now() - started).toBeLessThan(4000)
  })

  test('the text is always the exact concatenation of the preview segments', () => {
    const result = anonymize(PEC, [rule('Mercedes Spa', '[A]'), rule('contratto', '[C]')])

    expect(result.text).toBe(result.segments.map(segment => segment.text).join(''))
    expect(result.segments.filter(segment => segment.ruleId !== undefined)).toHaveLength(2)
  })

  test('leaves no occurrence of an applied keyword whole', () => {
    let seed = 7
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648

      return seed / 2147483648
    }
    const pick = (alphabet: readonly string[], length: number) =>
      Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('')
    const isWord = (char: string | undefined) => char !== undefined && /[\p{L}\p{M}\p{N}\p{Pc}]/u.test(char)
    // A plain reference matcher, independent of the engine's regular expressions.
    const occurrences = (text: string, one: Rule) => {
      const found: Array<[number, number]> = []
      const keyword = one.isCaseSensitive ? one.keyword : one.keyword.toLowerCase()
      const haystack = one.isCaseSensitive ? text : text.toLowerCase()
      for (let at = 0; at + keyword.length <= text.length; at += 1) {
        if (haystack.slice(at, at + keyword.length) !== keyword) continue
        const end = at + keyword.length
        const isBounded =
          !one.isWholeWord ||
          ((!isWord(keyword[0]) || !isWord(text[at - 1])) &&
            (!isWord(keyword[keyword.length - 1]) || !isWord(text[end])))
        if (isBounded) found.push([at, end])
      }

      return found
    }

    for (let round = 0; round < 400; round += 1) {
      const rules = Array.from({ length: 3 }, () =>
        rule(pick(['a', 'b', 'A', 'B', 'à', '.'], 1 + Math.floor(random() * 3)), '#', {
          isWholeWord: random() < 0.5,
          isCaseSensitive: random() < 0.5,
        }),
      )
      const text = pick(['a', 'b', 'A', 'B', ' ', 'à', '\n', '.'], 40)
      const result = anonymize(text, rules)
      const replaced = result.segments.filter(segment => segment.ruleId !== undefined)

      for (const one of rules) {
        for (const [start, end] of occurrences(text, one)) {
          const isCovered = replaced.some(segment => segment.start < end && start < segment.end)
          expect(isCovered, `round ${round}: "${one.keyword}" at ${start} in ${JSON.stringify(text)}`).toBe(true)
        }
      }
    }
  })
})
