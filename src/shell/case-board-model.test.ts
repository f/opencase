import { describe, expect, it, vi } from 'vitest'

import type { FilesViewModel, PhoneViewModel } from './apps'
import { createCaseBoardViewModel } from './case-board-model'

const phone: PhoneViewModel = {
  clockLabel: '21:00',
  contacts: [{
    id: 'listed-contact',
    name: 'Deniz Kaya',
    roleLabel: 'Tanık',
    phoneNumber: '+90 555 000 00 00',
    actions: [{ action: 'interview', label: 'Ara', available: true }],
  }],
  recentCalls: [{
    id: 'old-call',
    contactId: 'not-listed',
    contactName: 'Gizli Kişi',
    timestampLabel: '21:00',
    direction: 'incoming',
  }],
}

const files: FilesViewModel = {
  records: [{
    id: 'public-record',
    title: 'Lobi kamera kaydı',
    sourceLabel: 'Görsel',
    summary: 'The board must not copy this detail into storage.',
    findings: ['Private-looking result should not become a pin field.'],
    status: 'observed',
    assets: [{
      id: 'authorized-image',
      kind: 'image',
      label: 'Görsel 1',
      deliveryUrl: '/api/demo/session/asset?opaque=one',
    }, {
      id: 'authorized-audio',
      kind: 'audio',
      label: 'Ses 1',
      deliveryUrl: '/api/demo/session/asset?opaque=two',
    }, {
      id: 'image-without-delivery',
      kind: 'image',
      label: 'Kilitli görsel',
    }],
    metadata: [],
  }],
  affordances: [],
}

describe('case board public model', () => {
  it('uses only listed Phone contacts and host-authorized Finder images', () => {
    const model = createCaseBoardViewModel('Gece Vardiyası', phone, files)

    expect(model.pins).toEqual([
      {
        id: 'person:listed-contact',
        kind: 'person',
        name: 'Deniz Kaya',
        roleLabel: 'Tanık',
      },
      {
        id: 'evidence:public-record:authorized-image',
        kind: 'evidence',
        title: 'Lobi kamera kaydı',
        sourceLabel: 'Görsel',
        statusLabel: 'İncelendi',
        asset: {
          ...files.records[0]!.assets[0],
          label: 'Lobi kamera kaydı',
        },
      },
    ])
    expect(JSON.stringify(model)).not.toContain('Gizli Kişi')
    expect(JSON.stringify(model)).not.toContain('Private-looking')
    expect(JSON.stringify(model)).not.toContain('+90 555')
    expect(JSON.stringify(model)).not.toContain('interview')
  })

  it('does not guess asset URLs', () => {
    const getter = vi.fn()
    const missing = createCaseBoardViewModel('Vaka', { ...phone, contacts: [] }, {
      ...files,
      records: [{
        ...files.records[0]!,
        assets: [{
          id: 'unavailable',
          kind: 'image',
          label: 'Unavailable',
          get deliveryUrl() { getter(); return undefined },
        }],
      }],
    })
    expect(missing.pins).toEqual([])
    expect(getter).toHaveBeenCalled()
  })
})
