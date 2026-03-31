import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import {
  SCHEDULES_PATH,
  STATS_PATH,
  readSchedules,
  readStats,
  writeStatsLocal,
} from '../../src/service.js'

/**
 * Tests that schedule run stats are stored in a separate file from schedule
 * definitions, preventing the race condition where updateScheduleStats could
 * overwrite a concurrent deletion made by the skill agent.
 */
describe('schedule stats isolation', () => {
  // Back up original files and restore after tests
  let origSchedules: string | null = null
  let origStats: string | null = null

  beforeAll(() => {
    if (existsSync(SCHEDULES_PATH)) origSchedules = readFileSync(SCHEDULES_PATH, 'utf-8')
    if (existsSync(STATS_PATH)) origStats = readFileSync(STATS_PATH, 'utf-8')
  })

  afterAll(() => {
    if (origSchedules !== null) writeFileSync(SCHEDULES_PATH, origSchedules, 'utf-8')
    else if (existsSync(SCHEDULES_PATH)) rmSync(SCHEDULES_PATH)

    if (origStats !== null) writeFileSync(STATS_PATH, origStats, 'utf-8')
    else if (existsSync(STATS_PATH)) rmSync(STATS_PATH)
  })

  beforeEach(() => {
    mkdirSync('data', { recursive: true })
  })

  it('updating stats does not modify schedules.json', () => {
    // Set up two schedules
    const schedules = {
      schedules: [
        { id: 'aaa111', cron: '0 9 * * *', task: 'task a', description: 'Schedule A', channel: 'C1', createdBy: 'user', createdAt: '2026-01-01T00:00:00Z', enabled: true },
        { id: 'bbb222', cron: '0 12 * * *', task: 'task b', description: 'Schedule B', channel: 'C1', createdBy: 'user', createdAt: '2026-01-01T00:00:00Z', enabled: true },
      ]
    }
    writeFileSync(SCHEDULES_PATH, JSON.stringify(schedules, null, 2), 'utf-8')

    // Simulate updateScheduleStats writing to the stats file
    writeStatsLocal({ aaa111: { runCount: 1, lastRunAt: '2026-03-31T09:00:00Z', lastRunStatus: 'ok' } })

    // Verify schedules.json was NOT modified
    const afterSchedules = readSchedules()
    expect(afterSchedules.schedules).toHaveLength(2)
    expect(afterSchedules.schedules.map(s => s.id)).toEqual(['aaa111', 'bbb222'])
  })

  it('deleting a schedule does not affect stats', () => {
    // Set up schedules and stats
    const schedules = {
      schedules: [
        { id: 'aaa111', cron: '0 9 * * *', task: 'task a', description: 'Schedule A', channel: 'C1', createdBy: 'user', createdAt: '2026-01-01T00:00:00Z', enabled: true },
        { id: 'bbb222', cron: '0 12 * * *', task: 'task b', description: 'Schedule B', channel: 'C1', createdBy: 'user', createdAt: '2026-01-01T00:00:00Z', enabled: true },
      ]
    }
    writeFileSync(SCHEDULES_PATH, JSON.stringify(schedules, null, 2), 'utf-8')
    writeStatsLocal({
      aaa111: { runCount: 3, lastRunAt: '2026-03-31T09:00:00Z', lastRunStatus: 'ok' },
      bbb222: { runCount: 1, lastRunAt: '2026-03-31T12:00:00Z', lastRunStatus: 'ok' },
    })

    // Simulate skill agent deleting schedule bbb222 (writes only to schedules.json)
    const modified = { schedules: schedules.schedules.filter(s => s.id !== 'bbb222') }
    writeFileSync(SCHEDULES_PATH, JSON.stringify(modified, null, 2), 'utf-8')

    // Stats file should be untouched
    const stats = readStats()
    expect(stats['aaa111']?.runCount).toBe(3)
    expect(stats['bbb222']?.runCount).toBe(1)

    // Schedules file should only have aaa111
    const afterSchedules = readSchedules()
    expect(afterSchedules.schedules).toHaveLength(1)
    expect(afterSchedules.schedules[0].id).toBe('aaa111')
  })

  it('simulates the race condition scenario — stats update after delete does not restore deleted schedule', () => {
    // Initial state: two schedules
    const schedules = {
      schedules: [
        { id: 'aaa111', cron: '0 9 * * *', task: 'task a', description: 'Schedule A', channel: 'C1', createdBy: 'user', createdAt: '2026-01-01T00:00:00Z', enabled: true },
        { id: 'bbb222', cron: '0 12 * * *', task: 'task b', description: 'Schedule B', channel: 'C1', createdBy: 'user', createdAt: '2026-01-01T00:00:00Z', enabled: true },
      ]
    }
    writeFileSync(SCHEDULES_PATH, JSON.stringify(schedules, null, 2), 'utf-8')

    // Step 1: Skill agent deletes bbb222
    const afterDelete = { schedules: schedules.schedules.filter(s => s.id !== 'bbb222') }
    writeFileSync(SCHEDULES_PATH, JSON.stringify(afterDelete, null, 2), 'utf-8')

    // Step 2: Schedule runner updates stats for aaa111 (previously this would
    // have re-read schedules.json and written back the full array, potentially
    // restoring bbb222 if it had read the file before the delete)
    writeStatsLocal({
      aaa111: { runCount: 5, lastRunAt: '2026-03-31T09:00:00Z', lastRunStatus: 'ok' }
    })

    // Verify: schedules.json still has only aaa111
    const finalSchedules = readSchedules()
    expect(finalSchedules.schedules).toHaveLength(1)
    expect(finalSchedules.schedules[0].id).toBe('aaa111')

    // Verify: stats are correctly updated
    const finalStats = readStats()
    expect(finalStats['aaa111']?.runCount).toBe(5)
  })

  it('readStats returns empty object when file does not exist', () => {
    if (existsSync(STATS_PATH)) rmSync(STATS_PATH)
    expect(readStats()).toEqual({})
  })
})
