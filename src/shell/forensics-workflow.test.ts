import { describe, expect, it } from 'vitest'

import {
  appendForensicsRequest,
  createAsyncForensicsRequest,
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

const contactRequest = createAsyncForensicsRequest({
  affordanceId: 'opaque-lookup',
  subjectLabel: 'Tanığı bul',
  requestBody: 'Ece, tanık için iletişim kaydını kontrol eder misin?',
  requestedAtWallMs: 2_000,
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

  it('persists generic async interactions without treating shell state as contact truth', () => {
    const state = appendForensicsRequest(EMPTY_FORENSICS_WORKFLOW, contactRequest)
    expect(parseForensicsWorkflow(state)).toEqual(state)
    expect(state.requests[0]).toMatchObject({
      kind: 'async-interaction',
      affordanceId: 'opaque-lookup',
      status: 'waiting',
    })
    expect(JSON.stringify(state)).not.toContain('listed')

    const duplicate = appendForensicsRequest(state, {
      ...contactRequest,
      id: 'duplicate-contact-request',
    })
    expect(duplicate).toBe(state)
  })

  it('rejects malformed async interaction records', () => {
    expect(parseForensicsWorkflow({
      schema: FORENSICS_WORKFLOW_SCHEMA,
      requests: [
        { ...contactRequest, id: 'missing-body', requestBody: '' },
        { ...contactRequest, id: 'half-contact', status: 'complete', replyBody: 'Tamam.', revealedActorId: 'witness' },
      ],
    }).requests).toEqual([])
  })

  it('derives a bounded animation duration from the reply words', () => {
    expect(forensicsReplyDurationMs('İnceleme tamam.')).toBeGreaterThan(900)
    expect(forensicsReplyDurationMs('İnceleme tamam. Üç ayrı bulgu doğrulandı.'))
      .toBeGreaterThan(forensicsReplyDurationMs('İnceleme tamam.'))
  })
})
