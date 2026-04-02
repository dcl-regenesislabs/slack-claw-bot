import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { jest } from '@jest/globals'
import { discoverAgents, resolveModel, runWithConcurrency, createSubagentTool } from '../../src/subagent.js'
import type { ModelRegistry } from '@mariozechner/pi-coding-agent'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'subagent-test-'))
}

function writeAgentMd(dir: string, filename: string, content: string): void {
  writeFileSync(join(dir, filename), content, 'utf-8')
}

// Minimal ModelRegistry stub
function stubModelRegistry(found: object | null = { id: 'claude-sonnet-4-6' }): ModelRegistry {
  return {
    find: jest.fn().mockReturnValue(found),
    list: jest.fn().mockReturnValue([]),
    register: jest.fn(),
  } as unknown as ModelRegistry
}

// ---------------------------------------------------------------------------
// discoverAgents
// ---------------------------------------------------------------------------

describe('discoverAgents', () => {
  let agentsDir: string

  beforeEach(() => {
    agentsDir = makeTempDir()
  })

  afterEach(() => {
    rmSync(agentsDir, { recursive: true, force: true })
  })

  it('discovers a valid agent .md file with frontmatter', () => {
    writeAgentMd(agentsDir, 'reviewer.md', [
      '---',
      'name: code-reviewer',
      'description: Reviews code for quality',
      '---',
      '',
      'You are a code reviewer.',
    ].join('\n'))

    const agents = discoverAgents(agentsDir)
    expect(agents).toHaveLength(1)
    expect(agents[0].name).toBe('code-reviewer')
    expect(agents[0].description).toBe('Reviews code for quality')
    expect(agents[0].systemPrompt).toContain('You are a code reviewer.')
    expect(agents[0].model).toBeUndefined()
    expect(agents[0].tools).toBeUndefined()
  })

  it('parses tools from frontmatter', () => {
    writeAgentMd(agentsDir, 'worker.md', [
      '---',
      'name: worker',
      'description: A worker agent',
      'tools: read, write, bash',
      '---',
      '',
      'Worker prompt.',
    ].join('\n'))

    const agents = discoverAgents(agentsDir)
    expect(agents).toHaveLength(1)
    expect(agents[0].tools).toEqual(['read', 'write', 'bash'])
  })

  it('parses model from frontmatter', () => {
    writeAgentMd(agentsDir, 'fast.md', [
      '---',
      'name: fast-agent',
      'description: Fast agent',
      'model: haiku',
      '---',
      '',
      'Fast prompt.',
    ].join('\n'))

    const agents = discoverAgents(agentsDir)
    expect(agents).toHaveLength(1)
    expect(agents[0].model).toBe('haiku')
  })

  it('sets model to undefined when model is "inherit"', () => {
    writeAgentMd(agentsDir, 'inherit.md', [
      '---',
      'name: inherit-agent',
      'description: Inherits parent model',
      'model: inherit',
      '---',
      '',
      'Inherit prompt.',
    ].join('\n'))

    const agents = discoverAgents(agentsDir)
    expect(agents).toHaveLength(1)
    expect(agents[0].model).toBeUndefined()
  })

  it('skips files without name in frontmatter', () => {
    writeAgentMd(agentsDir, 'no-name.md', [
      '---',
      'description: Missing name field',
      '---',
      '',
      'No name.',
    ].join('\n'))

    const agents = discoverAgents(agentsDir)
    expect(agents).toHaveLength(0)
  })

  it('skips files without description in frontmatter', () => {
    writeAgentMd(agentsDir, 'no-desc.md', [
      '---',
      'name: no-desc-agent',
      '---',
      '',
      'No description.',
    ].join('\n'))

    const agents = discoverAgents(agentsDir)
    expect(agents).toHaveLength(0)
  })

  it('skips non-.md files', () => {
    writeFileSync(join(agentsDir, 'readme.txt'), 'not an agent', 'utf-8')
    writeFileSync(join(agentsDir, 'config.json'), '{}', 'utf-8')

    const agents = discoverAgents(agentsDir)
    expect(agents).toHaveLength(0)
  })

  it('recursively discovers agents in subdirectories', () => {
    const subDir = join(agentsDir, 'research')
    mkdirSync(subDir, { recursive: true })

    writeAgentMd(subDir, 'researcher.md', [
      '---',
      'name: researcher',
      'description: Researches topics',
      '---',
      '',
      'Research prompt.',
    ].join('\n'))

    const agents = discoverAgents(agentsDir)
    expect(agents).toHaveLength(1)
    expect(agents[0].name).toBe('researcher')
  })

  it('discovers multiple agents across directories', () => {
    writeAgentMd(agentsDir, 'a.md', [
      '---',
      'name: agent-a',
      'description: Agent A',
      '---',
      '',
      'A.',
    ].join('\n'))

    const subDir = join(agentsDir, 'nested')
    mkdirSync(subDir)
    writeAgentMd(subDir, 'b.md', [
      '---',
      'name: agent-b',
      'description: Agent B',
      '---',
      '',
      'B.',
    ].join('\n'))

    const agents = discoverAgents(agentsDir)
    expect(agents).toHaveLength(2)
    const names = agents.map(a => a.name).sort()
    expect(names).toEqual(['agent-a', 'agent-b'])
  })

  it('returns empty array for non-existent directory', () => {
    const agents = discoverAgents('/tmp/does-not-exist-xyz-12345')
    expect(agents).toEqual([])
  })

  it('returns empty array for empty directory', () => {
    const agents = discoverAgents(agentsDir)
    expect(agents).toEqual([])
  })

  it('stores the file path of each discovered agent', () => {
    writeAgentMd(agentsDir, 'test.md', [
      '---',
      'name: test-agent',
      'description: Test agent',
      '---',
      '',
      'Test.',
    ].join('\n'))

    const agents = discoverAgents(agentsDir)
    expect(agents[0].filePath).toBe(join(agentsDir, 'test.md'))
  })
})

// ---------------------------------------------------------------------------
// resolveModel
// ---------------------------------------------------------------------------

describe('resolveModel', () => {
  it('maps "haiku" to claude-haiku-4-5', () => {
    const registry = stubModelRegistry()
    resolveModel('haiku', 'claude-sonnet-4-6', registry)
    expect(registry.find).toHaveBeenCalledWith('anthropic', 'claude-haiku-4-5')
  })

  it('maps "sonnet" to claude-sonnet-4-6', () => {
    const registry = stubModelRegistry()
    resolveModel('sonnet', 'claude-sonnet-4-6', registry)
    expect(registry.find).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-6')
  })

  it('maps "opus" to claude-opus-4-6', () => {
    const registry = stubModelRegistry()
    resolveModel('opus', 'claude-sonnet-4-6', registry)
    expect(registry.find).toHaveBeenCalledWith('anthropic', 'claude-opus-4-6')
  })

  it('falls back to parentModelId when agentModel is undefined', () => {
    const registry = stubModelRegistry()
    resolveModel(undefined, 'claude-sonnet-4-6', registry)
    expect(registry.find).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-6')
  })

  it('passes through unknown model names as-is', () => {
    const registry = stubModelRegistry()
    resolveModel('claude-custom-model', 'claude-sonnet-4-6', registry)
    expect(registry.find).toHaveBeenCalledWith('anthropic', 'claude-custom-model')
  })

  it('returns null when registry cannot find the model', () => {
    const registry = stubModelRegistry(null)
    const result = resolveModel('haiku', 'claude-sonnet-4-6', registry)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// runWithConcurrency
// ---------------------------------------------------------------------------

describe('runWithConcurrency', () => {
  it('processes all items', async () => {
    const items = [1, 2, 3, 4, 5]
    const results = await runWithConcurrency(items, 4, async (n) => n * 2)
    expect(results).toEqual([2, 4, 6, 8, 10])
  })

  it('returns results in order even with varying delays', async () => {
    const items = [30, 10, 20]
    const results = await runWithConcurrency(items, 3, async (ms) => {
      await new Promise(r => setTimeout(r, ms))
      return ms
    })
    expect(results).toEqual([30, 10, 20])
  })

  it('respects concurrency limit', async () => {
    let running = 0
    let maxRunning = 0
    const items = [1, 2, 3, 4, 5, 6]

    await runWithConcurrency(items, 2, async () => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise(r => setTimeout(r, 10))
      running--
    })

    expect(maxRunning).toBeLessThanOrEqual(2)
  })

  it('handles empty array', async () => {
    const results = await runWithConcurrency([], 4, async () => 'nope')
    expect(results).toEqual([])
  })

  it('handles limit greater than items', async () => {
    const items = [1, 2]
    const results = await runWithConcurrency(items, 10, async (n) => n)
    expect(results).toEqual([1, 2])
  })

  it('propagates errors', async () => {
    const items = [1, 2, 3]
    await expect(
      runWithConcurrency(items, 2, async (n) => {
        if (n === 2) throw new Error('fail on 2')
        return n
      })
    ).rejects.toThrow('fail on 2')
  })
})

// ---------------------------------------------------------------------------
// createSubagentTool
// ---------------------------------------------------------------------------

describe('createSubagentTool', () => {
  let agentsDir: string

  beforeEach(() => {
    agentsDir = makeTempDir()
    writeAgentMd(agentsDir, 'test-agent.md', [
      '---',
      'name: test-agent',
      'description: A test agent',
      '---',
      '',
      'Test prompt.',
    ].join('\n'))
    writeAgentMd(agentsDir, 'another-agent.md', [
      '---',
      'name: another-agent',
      'description: Another test agent',
      '---',
      '',
      'Another prompt.',
    ].join('\n'))
  })

  afterEach(() => {
    rmSync(agentsDir, { recursive: true, force: true })
  })

  it('returns a tool definition with correct metadata', () => {
    const tool = createSubagentTool({
      agentsDir,
      authStorage: {} as any,
      modelRegistry: stubModelRegistry(),
      parentModelId: 'claude-sonnet-4-6',
    })

    expect(tool.name).toBe('subagent')
    expect(tool.label).toBe('Sub-agent')
    expect(tool.description).toContain('test-agent')
    expect(tool.description).toContain('another-agent')
  })

  it('lists discovered agent names in the description', () => {
    const tool = createSubagentTool({
      agentsDir,
      authStorage: {} as any,
      modelRegistry: stubModelRegistry(),
      parentModelId: 'claude-sonnet-4-6',
    })

    expect(tool.description).toContain('Available agents:')
    expect(tool.description).toContain('test-agent')
    expect(tool.description).toContain('another-agent')
  })

  it('execute returns error for unknown agent names', async () => {
    const tool = createSubagentTool({
      agentsDir,
      authStorage: {} as any,
      modelRegistry: stubModelRegistry(),
      parentModelId: 'claude-sonnet-4-6',
    })

    const result = await tool.execute(
      'call-1',
      { cwd: '/tmp', tasks: [{ agent: 'nonexistent-agent', task: 'do something' }] },
      new AbortController().signal,
      () => {},
      {} as any
    )

    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('Unknown agent "nonexistent-agent"')
    expect(text).toContain('Available:')
  })

  it('has a parameters schema with cwd and tasks', () => {
    const tool = createSubagentTool({
      agentsDir,
      authStorage: {} as any,
      modelRegistry: stubModelRegistry(),
      parentModelId: 'claude-sonnet-4-6',
    })

    expect(tool.parameters).toBeDefined()
    expect(tool.parameters.properties).toHaveProperty('cwd')
    expect(tool.parameters.properties).toHaveProperty('tasks')
  })

  it('handles empty agents directory gracefully', () => {
    const emptyDir = makeTempDir()
    try {
      const tool = createSubagentTool({
        agentsDir: emptyDir,
        authStorage: {} as any,
        modelRegistry: stubModelRegistry(),
        parentModelId: 'claude-sonnet-4-6',
      })
      expect(tool.name).toBe('subagent')
      expect(tool.description).toContain('Available agents:')
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })
})
