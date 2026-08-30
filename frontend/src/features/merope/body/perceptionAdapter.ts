import type { PageContent } from '../../../contexts/PageContentContext'
import type { PerceptionSnapshot } from '../perception/registry'
import type { PerceptionAdapter } from './types'
import { capturePerceptionSnapshots } from '../perception/capture'

export class LocalPerceptionAdapter implements PerceptionAdapter {
  capture(input: {
    route: string
    page: unknown
    pageConsent: boolean
    selection?: string
  }): PerceptionSnapshot[] {
    return capturePerceptionSnapshots({
      route: input.route,
      page: (input.page as PageContent | null) ?? null,
      pageConsent: input.pageConsent,
      selection: input.selection,
    })
  }
}
