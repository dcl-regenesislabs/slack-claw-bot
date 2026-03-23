import {
  isPublicChannel,
  isNoLearning,
  truncateForInjection,
  buildSummaryPrompt,
  buildCompressionPrompt,
  MAX_INJECT_CHARS,
  MAX_INPUT_CHARS,
} from '../../src/memory.js'

describe('isPublicChannel', () => {
  it('returns true for public channels (C prefix)', () => {
    expect(isPublicChannel('C123ABC')).toBe(true)
  })

  it('returns false for DMs (D prefix)', () => {
    expect(isPublicChannel('D123ABC')).toBe(false)
  })

  it('returns false for group DMs (G prefix)', () => {
    expect(isPublicChannel('G123ABC')).toBe(false)
  })
})

describe('isNoLearning', () => {
  it('returns true when text starts with NO_LEARNING', () => {
    expect(isNoLearning('NO_LEARNING')).toBe(true)
  })

  it('returns true with leading whitespace before NO_LEARNING', () => {
    expect(isNoLearning('  NO_LEARNING')).toBe(true)
    expect(isNoLearning('\nNO_LEARNING')).toBe(true)
  })

  it('returns false for normal summary text', () => {
    expect(isNoLearning('The user asked for a PR review and gave feedback.')).toBe(false)
  })

  it('returns false when NO_LEARNING appears mid-string', () => {
    expect(isNoLearning('Some text NO_LEARNING here')).toBe(false)
  })
})

describe('truncateForInjection', () => {
  it('returns content unchanged when within limit', () => {
    const content = 'short content'
    expect(truncateForInjection(content)).toBe(content)
  })

  it('returns content unchanged when exactly at limit', () => {
    const content = 'x'.repeat(MAX_INJECT_CHARS)
    expect(truncateForInjection(content)).toBe(content)
  })

  it('truncates and appends notice when over limit', () => {
    const content = 'x'.repeat(MAX_INJECT_CHARS + 500)
    const result = truncateForInjection(content)
    expect(result.length).toBeLessThan(content.length)
    expect(result).toContain('[... global context truncated for length]')
    expect(result.startsWith('x'.repeat(MAX_INJECT_CHARS))).toBe(true)
  })
})

describe('buildSummaryPrompt', () => {
  it('includes thread and response content in the prompt', () => {
    const result = buildSummaryPrompt('user asked something', 'bot replied something')
    expect(result).toContain('user asked something')
    expect(result).toContain('bot replied something')
  })

  it('truncates threadContent when over MAX_INPUT_CHARS', () => {
    const longThread = 'a'.repeat(MAX_INPUT_CHARS + 1000)
    const result = buildSummaryPrompt(longThread, 'short response')
    expect(result).not.toContain(longThread)
    expect(result).toContain('[... truncated]')
  })

  it('truncates agentResponse when over MAX_INPUT_CHARS', () => {
    const longResponse = 'b'.repeat(MAX_INPUT_CHARS + 1000)
    const result = buildSummaryPrompt('short thread', longResponse)
    expect(result).not.toContain(longResponse)
    expect(result).toContain('[... truncated]')
  })

  it('does not truncate inputs within limit', () => {
    const thread = 'a'.repeat(MAX_INPUT_CHARS)
    const response = 'b'.repeat(MAX_INPUT_CHARS)
    const result = buildSummaryPrompt(thread, response)
    expect(result).toContain(thread)
    expect(result).toContain(response)
  })
})

describe('buildCompressionPrompt', () => {
  it('includes the document content in the prompt', () => {
    const content = '## Learnings\n- Something important\n'
    const result = buildCompressionPrompt(content)
    expect(result).toContain(content)
  })

  it('mentions the target size limit', () => {
    const result = buildCompressionPrompt('some content')
    expect(result).toContain('3000')
  })
})
