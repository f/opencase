import { describe, expect, it } from 'vitest'

import {
  appendForensicsRequest,
  createForensicsRequest,
  EMPTY_FORENSICS_WORKFLOW,
  FORENSICS_WORKFLOW_SCHEMA,
  forensicsReplyDurationMs,
  parseForensicsWorkflow,
  readForensicsWorkflow,
  updateForensicsRequest,
} from './forensics-workflow'

const request = createForensicsRequest({
  evidenceId: 'public-record',
  evidenceTitle: 'Kamera kaydı',
  requestedAtWallMs: 1_000,
  requestedAtCaseMs: 120_000,
  requestedLabel: '21:02',
})

describe('forensics workflow persistence', () => {
  it('rejects malformed state and drops malformed request records', () => {
    expect(parseForensicsWorkflow(null)).toEqual(EMPTY_FORENSICS_WORKFLOW)
    expect(parseForensicsWorkflow({ schema: 'private/v9', requests: [request] }))
      .toEqual(EMPTY_FORENSICS_WORKFLOW)
    expect(parseForensicsWorkflow({
      schema: FORENSICS_WORKFLOW_SCHEMA,
      requests: [
        request,
        { ...request, id: '', evidenceId: '../../../case.yml' },
        { ...request, id: 'premature-reply', replyBody: 'Future finding' },
      ],
    }).requests).toEqual([request])

    const hostileStorage = { getItem: () => '{not-json' }
    expect(readForensicsWorkflow(hostileStorage, 'workflow')).toEqual(EMPTY_FORENSICS_WORKFLOW)
  })

  it('keeps one waiting request per evidence and allows a retry after failure', () => {
    const once = appendForensicsRequest(EMPTY_FORENSICS_WORKFLOW, request)
    expect(appendForensicsRequest(once, { ...request, id: 'duplicate' })).toBe(once)

    const failed = updateForensicsRequest(once, request.id, (current) => ({
      ...current,
      status: 'failed',
      replyBody: 'İncelemeyi tamamlayamadım.',
    }))
    const retried = appendForensicsRequest(failed, { ...request, id: 'retry' })
    expect(retried.requests.map(({ status }) => status)).toEqual(['failed', 'waiting'])
  })

  it('derives a bounded animation duration from the reply words', () => {
    expect(forensicsReplyDurationMs('İnceleme tamam.')).toBeGreaterThan(900)
    expect(forensicsReplyDurationMs('İnceleme tamam. Üç ayrı bulgu doğrulandı.'))
      .toBeGreaterThan(forensicsReplyDurationMs('İnceleme tamam.'))
  })
})
