import type {
  CaseBoardViewModel,
  FilesViewModel,
  PhoneViewModel,
} from './apps'

/**
 * Builds the board palette strictly from presentation-safe app models.
 * Hidden actors and inaccessible evidence cannot appear because neither is
 * present in the public Phone/Finder projection. Asset URLs are never stored.
 */
export function createCaseBoardViewModel(
  heading: string,
  phone: PhoneViewModel,
  files: FilesViewModel,
): CaseBoardViewModel {
  return {
    heading,
    pins: [
      ...phone.contacts.map((contact) => ({
        id: `person:${contact.id}`,
        kind: 'person' as const,
        name: contact.name,
        ...(contact.roleLabel ? { roleLabel: contact.roleLabel } : {}),
        ...(contact.initials ? { initials: contact.initials } : {}),
      })),
      ...files.records.flatMap((record) => record.assets.flatMap((asset) => {
        if (asset.kind !== 'image') return []
        if (!asset.thumbnailUrl && !asset.deliveryUrl) return []
        return [{
          id: `evidence:${record.id}:${asset.id}`,
          kind: 'evidence' as const,
          title: record.title,
          ...(record.sourceLabel ? { sourceLabel: record.sourceLabel } : {}),
          statusLabel: record.status === 'observed' ? 'İncelendi' : 'Yeni',
          asset: { ...asset, label: record.title },
        }]
      })),
    ],
  }
}
