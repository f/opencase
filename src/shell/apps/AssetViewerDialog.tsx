import { useEffect, useState } from 'react'
import downloadIcon from 'lucide-static/icons/download.svg'
import eyeIcon from 'lucide-static/icons/eye.svg'
import xIcon from 'lucide-static/icons/x.svg'

import { AccessibleModal } from '../../AccessibleModal'
import { useUiCopy, type AppLocale } from '../../ui-locale'
import type { AuthorizedAssetViewModel } from './types'

export interface AssetViewerDialogProps {
  readonly asset: AuthorizedAssetViewModel
  readonly onClose: () => void
}

type ViewerState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly url: string }
  | { readonly status: 'error' }

interface AssetViewerCopy {
  readonly kinds: Readonly<Record<AuthorizedAssetViewModel['kind'], string>>
  readonly description: (kind: string) => string
  readonly close: string
  readonly evidencePreview: string
  readonly opening: string
  readonly preparing: string
  readonly failed: string
  readonly retry: string
  readonly download: string
}

const COPY: Readonly<Record<AppLocale, AssetViewerCopy>> = {
  tr: {
    kinds: { image: 'Görsel', audio: 'Ses', video: 'Video', document: 'Belge', file: 'Dosya' },
    description: (kind) => `${kind} türündeki vaka dosyasının güvenli önizlemesi.`,
    close: 'Kapat',
    evidencePreview: 'Kanıt önizleme',
    opening: 'Dosya açılıyor…',
    preparing: 'Güvenli önizleme hazırlanıyor.',
    failed: 'Dosya açılamadı.',
    retry: 'Önizlemeyi kapatıp tekrar deneyin.',
    download: 'Dosyayı indir',
  },
  en: {
    kinds: { image: 'Image', audio: 'Audio', video: 'Video', document: 'Document', file: 'File' },
    description: (kind) => `Secure preview of the case ${kind.toLocaleLowerCase('en-US')}.`,
    close: 'Close',
    evidencePreview: 'Evidence preview',
    opening: 'Opening file…',
    preparing: 'Preparing secure preview.',
    failed: 'Could not open the file.',
    retry: 'Close the preview and try again.',
    download: 'Download file',
  },
}

export function AssetViewerDialog({ asset, onClose }: AssetViewerDialogProps) {
  const [viewer, setViewer] = useState<ViewerState>({ status: 'loading' })

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

  return <AssetViewerDialogContent asset={asset} viewer={viewer} onClose={onClose} />
}

function AssetViewerDialogContent({ asset, viewer, onClose }: {
  readonly asset: AuthorizedAssetViewModel
  readonly viewer: ViewerState
  readonly onClose: () => void
}) {
  const copy = useUiCopy(COPY)
  const kindLabel = copy.kinds[asset.kind]
  const viewerDescription = asset.description ?? copy.description(kindLabel)

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
            <button type="button" aria-label={copy.close} onClick={onClose}>
              <img src={xIcon} alt="" />
            </button>
          </div>
          <div className="asset-viewer-dialog__title">
            <h2 id="asset-viewer-title">{asset.label}</h2>
            <span>{kindLabel} · {copy.evidencePreview}</span>
          </div>
          <span className="asset-viewer-dialog__mode" aria-hidden="true"><img src={eyeIcon} alt="" /></span>
        </header>

        <div className="asset-viewer-dialog__content" aria-busy={viewer.status === 'loading' || undefined}>
          {viewer.status === 'loading' ? (
            <div className="asset-viewer-dialog__state" role="status" aria-live="polite">
              <i aria-hidden="true" />
              <strong>{copy.opening}</strong>
              <span>{copy.preparing}</span>
            </div>
          ) : viewer.status === 'error' ? (
            <div className="asset-viewer-dialog__state is-error" role="alert">
              <strong>{copy.failed}</strong>
              <span>{copy.retry}</span>
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
              <img src={downloadIcon} alt="" /> {copy.download}
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
