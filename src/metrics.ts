import { IMetricsComponent } from '@well-known-components/interfaces'
import { validateMetricsDeclaration } from '@well-known-components/metrics'
import { getDefaultHttpMetrics } from '@well-known-components/http-server'
import { metricDeclarations as logsMetricsDeclarations } from '@well-known-components/logger'

export const metricDeclarations = {
  ...getDefaultHttpMetrics(),
  ...logsMetricsDeclarations,
  slack_agent_runs_total: {
    help: 'Count of agent runs triggered via Slack',
    type: IMetricsComponent.CounterType,
    labelNames: ['status']
  }
}

// Type assertion — fails at compile time if metric declarations are invalid
validateMetricsDeclaration(metricDeclarations)
