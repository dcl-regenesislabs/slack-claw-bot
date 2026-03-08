import { buildPrompt } from '../../src/prompt.js'

describe('buildPrompt', () => {
  it('wraps content in slack-thread tags', () => {
    const result = buildPrompt('hello world')
    expect(result).toContain('<slack-thread>\nhello world\n</slack-thread>')
  })

  it('includes dry-run notice when dryRun is true', () => {
    const result = buildPrompt('hello', true)
    expect(result.startsWith('IMPORTANT: Do not execute any commands.')).toBe(true)
  })

  it('has no dry-run notice when dryRun is false', () => {
    const result = buildPrompt('hello', false)
    expect(result).not.toContain('IMPORTANT:')
  })

  it('has no dry-run notice when dryRun is undefined', () => {
    const result = buildPrompt('hello')
    expect(result).not.toContain('IMPORTANT:')
  })

  it('preserves multiline content', () => {
    const content = 'line one\nline two\nline three'
    const result = buildPrompt(content)
    expect(result).toContain(content)
  })

  it('includes triggeredBy when provided', () => {
    const result = buildPrompt('hello', false, 'Alice')
    expect(result).toContain('Triggered by: Alice')
  })

  it('omits triggeredBy when not provided', () => {
    const result = buildPrompt('hello')
    expect(result).not.toContain('Triggered by:')
  })
})
