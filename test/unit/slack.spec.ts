import { markdownToMrkdwn } from '../../src/slack.js'

describe('markdownToMrkdwn', () => {
  it('converts bold markdown to mrkdwn', () => {
    expect(markdownToMrkdwn('**bold**')).toBe('*bold*')
  })

  it('converts markdown links to mrkdwn links', () => {
    expect(markdownToMrkdwn('[click](https://example.com)')).toBe('<https://example.com|click>')
  })

  it('handles multiple conversions in one string', () => {
    const input = '**hello** and [link](https://x.com)'
    expect(markdownToMrkdwn(input)).toBe('*hello* and <https://x.com|link>')
  })

  it('returns plain text unchanged', () => {
    expect(markdownToMrkdwn('just text')).toBe('just text')
  })

  it('returns empty string unchanged', () => {
    expect(markdownToMrkdwn('')).toBe('')
  })

  it('leaves single asterisks untouched', () => {
    expect(markdownToMrkdwn('a * b * c')).toBe('a * b * c')
  })
})
