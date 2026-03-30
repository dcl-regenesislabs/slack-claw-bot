import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import {
  createServerComponent,
  createStatusCheckComponent,
  instrumentHttpServerWithPromClientRegistry
} from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createFetchComponent } from '@well-known-components/fetch-component'
import { createRedisComponent } from '@dcl/redis-component'
import { createS3Component } from '@dcl/s3-component'
import { AppComponents, GlobalContext } from './types.js'
import { metricDeclarations } from './metrics.js'

export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const logs = await createLogComponent({ metrics })

  const server = await createServerComponent<GlobalContext>({ config, logs }, {})

  const statusChecks = await createStatusCheckComponent({ server, config })
  const fetcher = createFetchComponent()

  const redisHost = await config.getString('REDIS_HOST')
  const redis = redisHost ? await createRedisComponent(redisHost, { logs }) : undefined

  // Map S3_BUCKET → AWS_S3_BUCKET_NAME for @dcl/s3-component compatibility
  const s3Bucket = await config.getString('S3_BUCKET')
  let s3: AppComponents['s3']
  if (s3Bucket) {
    process.env.AWS_S3_BUCKET_NAME = s3Bucket
    s3 = await createS3Component({ config })
  }

  await instrumentHttpServerWithPromClientRegistry({ metrics, server, config, registry: metrics.registry! })

  return {
    config,
    logs,
    server,
    metrics,
    fetcher,
    statusChecks,
    ...(redis ? { redis } : {}),
    ...(s3 ? { s3 } : {})
  }
}
