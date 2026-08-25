import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FilesApp } from './FilesApp'
import type { FilesViewModel } from './types'

describe('FilesApp authorized asset presentation', () => {
  it('previews authorized media and exposes opaque open buttons without direct document links', () => {
    const model: FilesViewModel = {
      selectedRecordId: 'multi-media-record',
      affordances: [],
      records: [{
        id: 'multi-media-record',
        title: 'Multi media record',
        status: 'new',
        assets: [
          {
            id: 'photo',
            kind: 'image',
            label: 'Scene photo',
            mimeType: 'image/png',
            deliveryUrl: '/api/assets/photo',
          },
          {
            id: 'audio',
            kind: 'audio',
            label: 'Witness audio',
            mimeType: 'audio/mpeg',
            deliveryUrl: '/api/assets/audio',
          },
          {
            id: 'video',
            kind: 'video',
            label: 'Lobby video',
            mimeType: 'video/mp4',
            deliveryUrl: '/api/assets/video',
          },
          {
            id: 'document',
            kind: 'document',
            label: 'Audit report',
            mimeType: 'application/pdf',
            deliveryUrl: '/api/assets/document',
          },
        ],
      }],
    }

    const html = renderToStaticMarkup(
      <FilesApp model={model} onOpenAsset={() => undefined} />,
    )

    expect(html).toContain('<img')
    expect(html).toContain('src="/api/assets/photo"')
    expect(html).toContain('<audio controls="" preload="metadata" src="/api/assets/audio"')
    expect(html).toContain('<video controls="" preload="metadata" src="/api/assets/video"')
    expect(html).not.toContain('href="/api/assets/document"')
    expect(html).not.toContain('download=')
    expect(html.match(/<button type="button" class="detective-button detective-button--quiet">Aç<\/button>/g))
      .toHaveLength(4)
    expect(html.match(/<figure class="detective-asset"/g)).toHaveLength(4)
    expect(html).toContain('class="finder-toolbar"')
    expect(html).toContain('class="finder-sidebar"')
    expect(html).toContain('class="finder-file-list__columns"')
    expect(html).toContain('class="finder-inspector"')
    expect(html).toContain('placeholder="Kanıtlarda ara"')
    expect(html).toContain('Ad</span><span>Tür</span><span>Eklenme</span><span>Durum')
    expect(html).toContain('class="finder-folder"')
    expect(html).toContain('class="finder-search__icon"')
    expect(html).toContain('class="finder-sidebar-icon finder-sidebar-icon--clock"')
    expect(html).toContain('class="finder-file-icon finder-file-icon--document')
    expect(html).not.toContain('finder-chevron')
    expect(html).not.toContain('finder-inspector__action-icon')
  })
})
