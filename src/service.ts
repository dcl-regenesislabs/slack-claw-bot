import { readFileSync, writeFileSync, existsSync, mkdirSync, watchFile } from 'node:fs'
import type { IS3Component } from '@dcl/s3-component'
import { Lifecycle } from '@well-known-components/interfaces'
import { setupRouter } from './controllers/routes.js'
import { AppComponents, GlobalContext, TestComponents } from './types.js'
import { initAgent, runAgent, syncAuth } from './agent.js'
import { startSlackBot } from './slack.js'
import { AgentScheduler } from './concurrency.js'
import { Cron } from 'croner'

export async function main(program: Lifecycle.EntryPointParameters<AppComponents | TestComponents>) {
  const { components, startComponents } = program
  const { config, logs, redis, s3 } = components
  const logger = logs.getLogger('service')

  // Pre-load config (WKC config is async — resolve upfront for downstream modules)
  const slackConfig = {
    slackBotToken: await config.requireString('SLACK_BOT_TOKEN'),
    slackAppToken: await config.requireString('SLACK_APP_TOKEN'),
    githubToken: await config.requireString('GITHUB_TOKEN'),
    anthropicOAuthRefreshToken: await config.getString('ANTHROPIC_OAUTH_REFRESH_TOKEN'),
    model: await config.getString('MODEL'),
    maxConcurrentAgents: (await config.getNumber('MAX_CONCURRENT_AGENTS')) ?? 3,
    logChannelId: await config.getString('LOG_CHANNEL_ID'),
    notionToken: await config.getString('NOTION_TOKEN'),
    notionShapeDbId: await config.getString('NOTION_SHAPE_DB_ID'),
    notionShapeParentId: await config.getString('NOTION_SHAPE_PARENT_ID'),
    sentryAuthToken: await config.getString('SENTRY_AUTH_TOKEN'),
    sentryOrg: await config.getString('SENTRY_ORG'),
    gitlabTokenDcl: await config.getString('GITLAB_TOKEN_DCL'),
    gitlabTokenOps: await config.getString('GITLAB_TOKEN_OPS'),
    s3,
    autoReplyChannels: new Map(
      ((await config.getString('AUTO_REPLY_CHANNEL_IDS')) ?? '')
        .split(',').map(s => s.trim()).filter(Boolean)
        .map(entry => {
          const [channelId, skill] = entry.split(':').map(s => s.trim())
          return [channelId, skill || 'general'] as [string, string]
        })
    ),
    cfApiToken: await config.getString('CF_API_TOKEN'),
    cfAccountId: await config.getString('CF_ACCOUNT_ID'),
    cfR2Bucket: await config.getString('CF_R2_BUCKET'),
    cfR2PublicUrl: await config.getString('CF_R2_PUBLIC_URL'),
    commsModeratorToken: await config.getString('COMMS_MODERATOR_TOKEN')
  }

  const globalContext: GlobalContext = { components }
  const router = await setupRouter(globalContext)
  components.server.use(router.middleware())
  components.server.use(router.allowedMethods())
  components.server.setContext(globalContext)

  await startComponents()

  logger.info('Initializing Claude agent...')
  await initAgent({
    anthropicOAuthRefreshToken: slackConfig.anthropicOAuthRefreshToken,
    githubToken: slackConfig.githubToken,
    model: slackConfig.model,
    redis,
    sentryAuthToken: slackConfig.sentryAuthToken,
    sentryOrg: slackConfig.sentryOrg,
    gitlabTokenDcl: slackConfig.gitlabTokenDcl,
    gitlabTokenOps: slackConfig.gitlabTokenOps,
    cfApiToken: slackConfig.cfApiToken,
    cfAccountId: slackConfig.cfAccountId,
    cfR2Bucket: slackConfig.cfR2Bucket,
    cfR2PublicUrl: slackConfig.cfR2PublicUrl,
    commsModeratorToken: slackConfig.commsModeratorToken
  })

  logger.info('Starting Slack bot...')
  await startSlackBot(slackConfig)

  // Schedule runner — checks schedules.json every 60s and fires due tasks
  await startScheduleRunner(slackConfig.slackBotToken, s3, logger)

  logger.info('Service started')
}

// ---------------------------------------------------------------------------
// Schedule runner — persists to S3 so schedules survive deploys
// ---------------------------------------------------------------------------

interface Schedule {
  id: string
  cron: string
  task: string
  description: string
  channel: string
  createdBy: string
  createdAt: string
  enabled: boolean
}

interface ScheduleFile {
  schedules: Schedule[]
}

export const SCHEDULES_PATH = 'data/schedules.json'
export const STATS_PATH = 'data/schedule-stats.json'

const S3_SCHEDULES_KEY = 'schedules/schedules.json'
const S3_STATS_KEY = 'schedules/schedule-stats.json'
const NO_OUTPUT_SENTINEL = 'NO_OUTPUT'

// Hash of last synced content — used to detect local changes made by the skill agent
let lastSyncedHash: string | null = null

export function contentHash(content: string): string {
  // Simple fast hash for change detection
  let h = 0
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0
  }
  return h.toString(36)
}

function ensureDir(filePath: string): void {
  const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '.'
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function readSchedules(): ScheduleFile {
  if (!existsSync(SCHEDULES_PATH)) return { schedules: [] }
  try {
    return JSON.parse(readFileSync(SCHEDULES_PATH, 'utf-8'))
  } catch {
    return { schedules: [] }
  }
}

// --- Run stats stored separately to avoid race conditions with the skill agent ---

export interface StatsEntry {
  runCount: number
  lastRunAt: string | null
  lastRunStatus: string | null
}

export type StatsFile = Record<string, StatsEntry>

export function readStats(): StatsFile {
  if (!existsSync(STATS_PATH)) return {}
  try {
    return JSON.parse(readFileSync(STATS_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

export function writeStatsLocal(stats: StatsFile): string {
  const json = JSON.stringify(stats, null, 2)
  ensureDir(STATS_PATH)
  writeFileSync(STATS_PATH, json, 'utf-8')
  return json
}

/** Sync local file to S3 if it changed since last sync. */
async function syncToS3IfChanged(s3: IS3Component, logger: any): Promise<void> {
  try {
    if (!existsSync(SCHEDULES_PATH)) return
    const json = readFileSync(SCHEDULES_PATH, 'utf-8')
    if (!json) return
    const hash = contentHash(json)
    if (hash === lastSyncedHash) return
    logger.info(`[schedule] Local file changed (hash ${lastSyncedHash} → ${hash}), uploading to S3...`)
    await s3.uploadObject(S3_SCHEDULES_KEY, json, 'application/json')
    lastSyncedHash = hash
    logger.info(`[schedule] Synced schedules to S3 successfully`)
  } catch (err) {
    logger.error(`[schedule] Failed to sync schedules to S3: ${err}`)
  }
}

/**
 * Update run stats in a SEPARATE file (schedule-stats.json) so we never
 * do a read-modify-write on schedules.json — which the skill agent also
 * writes to (create/delete). This eliminates the race condition where
 * updateScheduleStats could restore a schedule the agent just deleted.
 */
function updateScheduleStats(id: string, status: string, s3?: IS3Component, logger?: any): void {
  const stats = readStats()
  const prev = stats[id] || { runCount: 0, lastRunAt: null, lastRunStatus: null }
  stats[id] = {
    runCount: prev.runCount + 1,
    lastRunAt: new Date().toISOString(),
    lastRunStatus: status
  }
  const json = writeStatsLocal(stats)
  // Fire-and-forget S3 sync
  if (s3) {
    s3.uploadObject(S3_STATS_KEY, json, 'application/json').then(() => {
      // no hash tracking needed — stats file is only written by us
    }).catch((err) => {
      logger?.error(`[schedule] Failed to sync stats to S3: ${err}`)
    })
  }
}

/** Create a debounced sync function — collapses rapid file changes into one S3 upload. */
function debounceSync(s3: IS3Component, logger: any, delayMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      syncToS3IfChanged(s3, logger).catch((err) => {
        logger.error(`[schedule] Debounced sync error: ${err}`)
      })
    }, delayMs)
  }
}

async function startScheduleRunner(slackBotToken: string, s3: IS3Component | undefined, logger: any): Promise<void> {
  const scheduler = new AgentScheduler(1) // separate lane, max 1 concurrent

  logger.info(`[schedule] SCHEDULES_PATH resolved to: ${SCHEDULES_PATH}`)

  // Restore schedules from S3 on startup
  if (s3) {
    try {
      const remote = await s3.downloadObjectAsString(S3_SCHEDULES_KEY)
      if (remote) {
        ensureDir(SCHEDULES_PATH)
        writeFileSync(SCHEDULES_PATH, remote, 'utf-8')
        lastSyncedHash = contentHash(remote)
        const parsed = JSON.parse(remote) as ScheduleFile
        logger.info(`[schedule] Restored ${parsed.schedules.length} schedules from S3`)
      } else {
        logger.info(`[schedule] No schedules found in S3`)
        // If local file has schedules that never made it to S3, push them now
        if (existsSync(SCHEDULES_PATH)) {
          const localJson = readFileSync(SCHEDULES_PATH, 'utf-8')
          const localFile = JSON.parse(localJson) as ScheduleFile
          if (localFile.schedules.length > 0) {
            logger.info(`[schedule] Found ${localFile.schedules.length} local schedules not in S3, uploading...`)
            await s3.uploadObject(S3_SCHEDULES_KEY, localJson, 'application/json')
            lastSyncedHash = contentHash(localJson)
            logger.info(`[schedule] Synced local schedules to S3`)
          }
        }
      }
    } catch (err) {
      logger.error(`[schedule] Failed to restore schedules from S3: ${err}`)
    }

    // Restore stats from S3
    try {
      const remoteStats = await s3.downloadObjectAsString(S3_STATS_KEY)
      if (remoteStats) {
        ensureDir(STATS_PATH)
        writeFileSync(STATS_PATH, remoteStats, 'utf-8')
        logger.info(`[schedule] Restored schedule stats from S3`)
      }
    } catch (err) {
      logger.error(`[schedule] Failed to restore schedule stats from S3: ${err}`)
    }
  }

  // Watch the schedules file for changes and sync to S3 immediately.
  // This handles the case where the skill agent writes to the file — instead
  // of waiting up to 60s for the next interval tick, we detect the change
  // right away and push it to S3.
  if (s3) {
    const debouncedSync = debounceSync(s3, logger, 2_000)
    // Ensure the file exists so watchFile has something to watch
    ensureDir(SCHEDULES_PATH)
    if (!existsSync(SCHEDULES_PATH)) {
      writeFileSync(SCHEDULES_PATH, JSON.stringify({ schedules: [] }, null, 2), 'utf-8')
    }
    watchFile(SCHEDULES_PATH, { interval: 2_000 }, () => {
      logger.info(`[schedule] File change detected, triggering S3 sync...`)
      debouncedSync()
    })
    logger.info(`[schedule] Watching ${SCHEDULES_PATH} for changes`)
  }

  setInterval(async () => {
    const file = readSchedules()
    const enabled = file.schedules.filter((s) => s.enabled)
    logger.info(`[schedule] Tick — ${file.schedules.length} schedules, ${enabled.length} enabled`)

    // Sync any local changes (e.g. from skill agent creating/deleting schedules) to S3
    if (s3) {
      await syncToS3IfChanged(s3, logger)
    }

    if (!enabled.length) return

    const now = new Date()

    for (const schedule of enabled) {
      try {
        const cron = new Cron(schedule.cron)
        // Find the next scheduled time after (now - 60s); if it's in the past, it's due
        const since = new Date(now.getTime() - 60_000)
        const next = cron.nextRun(since)
        logger.info(`[schedule] "${schedule.description}" (${schedule.id}) — next after ${since.toISOString()}: ${next?.toISOString() ?? 'none'}`)
        if (!next || next > now) continue

        logger.info(`[schedule] Firing "${schedule.description}" (${schedule.id})`)

        const threadId = `schedule-${schedule.id}`
        const submission = scheduler.submit(threadId, async () => {
          try {
            const { text } = await runAgent({
              threadContent: schedule.task,
              triggeredBy: `schedule:${schedule.id}`
            })
            await syncAuth()

            // Post result to Slack unless sentinel
            if (text && !text.trim().startsWith(NO_OUTPUT_SENTINEL)) {
              await fetch('https://slack.com/api/chat.postMessage', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${slackBotToken}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  channel: schedule.channel,
                  text: (() => {
                    const footer = `\n\n_Schedule: ${schedule.description} · \`${schedule.cron}\` · ID: ${schedule.id}_`
                    const body = text.length > 3000 ? text.slice(0, 3000) + '\n...(truncated)' : text
                    return body + footer
                  })()
                })
              })
            }

            updateScheduleStats(schedule.id, 'ok', s3, logger)
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'unknown error'
            logger.error(`[schedule] Error running "${schedule.description}": ${msg}`)
            updateScheduleStats(schedule.id, `error: ${msg}`, s3, logger)
          }
        })

        if (submission.status === 'queued-behind-thread') {
          logger.warn(`[schedule] "${schedule.description}" still running, queued behind thread`)
        }
        submission.done.catch((err) => {
          logger.error(`[schedule] Unhandled rejection in "${schedule.description}": ${err}`)
        })
      } catch (err) {
        logger.error(`[schedule] Bad cron for "${schedule.id}": ${err}`)
      }
    }
  }, 60_000)

  logger.info(`[schedule] Runner started, checking ${SCHEDULES_PATH} every 60s (S3 sync: ${s3 ? 'enabled' : 'disabled'})`)
}
