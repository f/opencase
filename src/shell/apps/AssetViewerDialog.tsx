import { useEffect, useState } from 'react'
import downloadIcon from 'lucide-static/icons/download.svg'
import eyeIcon from 'lucide-static/icons/eye.svg'
import xIcon from 'lucide-static/icons/x.svg'

import { AccessibleModal } from '../../AccessibleModal'
import type { AuthorizedAssetViewModel } from './types'

export interface AssetViewerDialogProps {
  readonly asset: AuthorizedAssetViewModel
  readonly onClose: () => void
}

type ViewerState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly url: string }
  | { readonly status: 'error' }

const KIND_LABELS: Readonly<Record<AuthorizedAssetViewModel['kind'], string>> = {
  image: 'Görsel',
  audio: 'Ses',
  video: 'Video',
  document: 'Belge',
  file: 'Dosya',
}

export function AssetViewerDialog({ asset, onClose }: AssetViewerDialogProps) {
  const [viewer, setViewer] = useState<ViewerState>({ status: 'loading' })
  const kindLabel = KIND_LABELS[asset.kind]
  const viewerDescription = asset.description ?? `${kindLabel} türündeki vaka dosyasının güvenli önizlemesi.`

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    setViewer({ status: 'loading' })

    if (!asset.deliveryUrl) {
      setViewer({ status: 'error' })
      return () => controller.abort()
    }

    void fetch(asset.deliveryUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Asset unavailable')
        return response.blob()
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setViewer({ status: 'ready', url: objectUrl })
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setViewer({ status: 'error' })
      })

    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [asset.deliveryUrl])

  return (
    <AccessibleModal
      className="modal-overlay asset-viewer-dialog"
      dialogClassName="modal-surface modal-surface--viewer asset-viewer-dialog__window"
      modalKind="asset"
      labelledBy="asset-viewer-title"
      describedBy="asset-viewer-description"
      onDismiss={onClose}
      dismissOnBackdrop
    >
        <header className="asset-viewer-dialog__toolbar">
          <div className="asset-viewer-dialog__controls">
            <button type="button" aria-label="Kapat" onClick={onClose}>
              <img src={xIcon} alt="" />
            </button>
          </div>
          <div className="asset-viewer-dialog__title">
            <h2 id="asset-viewer-title">{asset.label}</h2>
            <span>{kindLabel} · Kanıt önizleme</span>
          </div>
          <span className="asset-viewer-dialog__mode" aria-hidden="true"><img src={eyeIcon} alt="" /></span>
        </header>

        <div className="asset-viewer-dialog__content" aria-busy={viewer.status === 'loading' || undefined}>
          {viewer.status === 'loading' ? (
            <div className="asset-viewer-dialog__state" role="status" aria-live="polite">
              <i aria-hidden="true" />
              <strong>Dosya açılıyor…</strong>
              <span>Güvenli önizleme hazırlanıyor.</span>
            </div>
          ) : viewer.status === 'error' ? (
            <div className="asset-viewer-dialog__state is-error" role="alert">
              <strong>Dosya açılamadı.</strong>
              <span>Önizlemeyi kapatıp tekrar deneyin.</span>
            </div>
          ) : asset.kind === 'image' ? (
            <img src={viewer.url} alt={asset.description ?? asset.label} />
          ) : asset.kind === 'audio' ? (
            <audio controls src={viewer.url} aria-label={asset.label} />
          ) : asset.kind === 'video' ? (
            <video controls src={viewer.url} aria-label={asset.label} />
          ) : asset.kind === 'document' ? (
            <iframe src={viewer.url} title={asset.label} tabIndex={-1} />
          ) : (
            <a className="asset-viewer-dialog__download" href={viewer.url} download={asset.label}>
              <img src={downloadIcon} alt="" /> Dosyayı indir
            </a>
          )}
        </div>
        <footer className="asset-viewer-dialog__footer">
          <span><img src={eyeIcon} alt="" /> {kindLabel}</span>
          <p id="asset-viewer-description">{viewerDescription}</p>
        </footer>
    </AccessibleModal>
  )
}
