import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  unlink,
  type FileHandle,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { CaseSaveStorage, CaseSaveStorageKey } from '../../src/case-runtime'

const MAX_SAVE_BYTES = 32 * 1024 * 1024

export interface FileCaseSaveStorage extends CaseSaveStorage {
  /** Trusted diagnostic only. Never return this path through the HTTP API. */
  pathFor(key: CaseSaveStorageKey): string
}

function canonicalKey(key: CaseSaveStorageKey): string {
  return JSON.stringify({
    saveId: key.saveId,
    caseId: key.caseId,
    caseVersion: key.caseVersion,
    kernelIrDigest: key.kernelIrDigest,
  })
}

function fileName(key: CaseSaveStorageKey): string {
  const digest = createHash('sha256').update(canonicalKey(key)).digest('hex')
  return `${digest}.kernel-save.json`
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const stats = await lstat(directory)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error('Demo save storage must be a real directory, not a symbolic link.')
  }
  await chmod(directory, 0o700)
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      null,
    )
    if (bytesWritten <= 0) throw new Error('Failed to write the local demo save.')
    offset += bytesWritten
  }
}

export function createFileCaseSaveStorage(dataDirectory: string): FileCaseSaveStorage {
  const directory = resolve(dataDirectory)
  const pathFor = (key: CaseSaveStorageKey): string => join(directory, fileName(key))

  return Object.freeze({
    pathFor,

    async read(key: CaseSaveStorageKey): Promise<string | undefined> {
      await ensurePrivateDirectory(directory)
      const path = pathFor(key)
      let handle: FileHandle
      try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
      try {
        const stats = await handle.stat()
        if (!stats.isFile() || stats.size > MAX_SAVE_BYTES) {
          throw new Error('Stored demo save is not a valid regular save file.')
        }
        const bytes = await handle.readFile()
        if (bytes.byteLength !== stats.size || bytes.byteLength > MAX_SAVE_BYTES) {
          throw new Error('Stored demo save changed while it was being read.')
        }
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } finally {
        await handle.close()
      }
    },

    async write(key: CaseSaveStorageKey, serializedSave: string): Promise<void> {
      await ensurePrivateDirectory(directory)
      const bytes = new TextEncoder().encode(serializedSave)
      if (bytes.byteLength > MAX_SAVE_BYTES) {
        throw new Error(`Demo save exceeds the ${MAX_SAVE_BYTES}-byte limit.`)
      }
      const destination = pathFor(key)
      const temporary = join(directory, `.${fileName(key)}.${process.pid}.${randomUUID()}.tmp`)
      let handle: FileHandle | undefined
      try {
        handle = await open(temporary, 'wx', 0o600)
        await writeAll(handle, bytes)
        await handle.sync()
        await handle.close()
        handle = undefined
        await rename(temporary, destination)
      } finally {
        await handle?.close().catch(() => undefined)
        await unlink(temporary).catch(() => undefined)
      }
    },

    async delete(key: CaseSaveStorageKey): Promise<void> {
      await ensurePrivateDirectory(directory)
      await unlink(pathFor(key)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    },
  })
}
