import type {
  IConfigComponent,
  ILoggerComponent,
  IHttpServerComponent,
  IBaseComponent,
  IMetricsComponent,
  IFetchComponent
} from '@well-known-components/interfaces'
import type { ICacheStorageComponent } from '@dcl/core-commons'
import type { IS3Component } from '@dcl/s3-component'
import { metricDeclarations } from './metrics.js'

export type GlobalContext = {
  components: AppComponents
}

export type MetricsDeclaration = keyof typeof metricDeclarations

// Components used in every environment
export type BaseComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
  server: IHttpServerComponent<GlobalContext>
  metrics: IMetricsComponent<MetricsDeclaration>
  fetcher: IFetchComponent
  statusChecks: IBaseComponent
}

// Components used at runtime
export type AppComponents = BaseComponents & {
  redis?: ICacheStorageComponent
  s3?: IS3Component
}

// Components used in tests
export type TestComponents = BaseComponents & {
  localFetch: IFetchComponent
  redis?: ICacheStorageComponent
  s3?: IS3Component
}

// Simplifies typings of HTTP handlers
export type HandlerContextWithPath<
  ComponentNames extends keyof AppComponents,
  Path extends string = any
> = IHttpServerComponent.PathAwareContext<
  IHttpServerComponent.DefaultContext<{
    components: Pick<AppComponents, ComponentNames>
  }>,
  Path
>
