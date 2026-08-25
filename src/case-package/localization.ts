import { constants } from 'node:fs'
import { open, readdir, type FileHandle } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import { compareCanonicalStrings } from '../compiler'
import {
  CASE_LOCALIZATION_MAX_CATALOGS,
  createCaseLocalizationBundle,
  parseCaseTranslationCatalog,
} from './localization-core'
import { CasePackageError, type CaseLocalizationBundle } from './types'

export * from './localization-core'

const LOCALE = /^[a-z]{2}(?:-[A-Z]{2})?$/
const CATALOG_FILE = /^[a-z]{2}(?:-[A-Z]{2})?\.yml$/
const MAX_CATALOG_BYTES = 256 * 1024
const MAX_TOTAL_CATALOG_BYTES = 4 * 1024 * 1024

function catalogError(
  code: 'E_I18N_FILE' | 'E_I18N_IDENTITY',
  message: string,
  path: string,
): never {
  throw new CasePackageError(code, message, path)
}

async function readCatalogFile(path: string): Promise<string> {
  let handle: FileHandle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    return catalogError('E_I18N_FILE', `Translation catalog must be a regular file: ${path}`, path)
  }
  try {
    const stats = await handle.stat()
    if (!stats.isFile()) {
      return catalogError('E_I18N_FILE', `Translation catalog must be a regular file: ${path}`, path)
    }
    if (stats.size > MAX_CATALOG_BYTES) {
      return catalogError(
        'E_I18N_FILE',
        `Translation catalog exceeds the ${MAX_CATALOG_BYTES}-byte file limit.`,
        path,
      )
    }
    const bytes = await handle.readFile()
    if (bytes.byteLength !== stats.size || bytes.byteLength > MAX_CATALOG_BYTES) {
      return catalogError('E_I18N_FILE', 'Translation catalog changed while being read.', path)
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return catalogError('E_I18N_FILE', 'Translation catalog must be valid UTF-8.', path)
    }
  } finally {
    await handle.close()
  }
}

export interface LoadCaseLocalizationOptions {
  i18nRoot: string
  caseId: string
  caseVersion: string
  defaultLocale: string
  referenceKeys: readonly string[]
}

/** Node filesystem adapter around the browser-safe localization core. */
export async function loadCaseLocalization(
  options: LoadCaseLocalizationOptions,
): Promise<CaseLocalizationBundle> {
  if (!LOCALE.test(options.defaultLocale)) {
    return catalogError(
      'E_I18N_IDENTITY',
      `Invalid default locale '${options.defaultLocale}'.`,
      options.i18nRoot,
    )
  }
  const entries = (await readdir(options.i18nRoot, { withFileTypes: true }))
    .sort((left, right) => compareCanonicalStrings(left.name, right.name))
  if (entries.length === 0 || entries.length > CASE_LOCALIZATION_MAX_CATALOGS) {
    return catalogError(
      'E_I18N_FILE',
      `i18n/ must contain between 1 and ${CASE_LOCALIZATION_MAX_CATALOGS} flat locale .yml files.`,
      options.i18nRoot,
    )
  }

  let totalBytes = 0
  const catalogs = []
  for (const entry of entries) {
    const path = join(options.i18nRoot, entry.name)
    if (!entry.isFile() || entry.isSymbolicLink() || !CATALOG_FILE.test(entry.name)) {
      return catalogError(
        'E_I18N_FILE',
        `Unexpected i18n entry '${entry.name}'; only flat <locale>.yml files are allowed.`,
        path,
      )
    }
    const sourceText = await readCatalogFile(path)
    totalBytes += Buffer.byteLength(sourceText, 'utf8')
    if (totalBytes > MAX_TOTAL_CATALOG_BYTES) {
      return catalogError(
        'E_I18N_FILE',
        `Translation catalogs exceed the ${MAX_TOTAL_CATALOG_BYTES}-byte package limit.`,
        options.i18nRoot,
      )
    }
    catalogs.push(parseCaseTranslationCatalog(sourceText, {
      sourcePath: path,
      expectedLocale: basename(entry.name, extname(entry.name)),
      caseId: options.caseId,
      caseVersion: options.caseVersion,
    }))
  }

  return createCaseLocalizationBundle({
    caseId: options.caseId,
    caseVersion: options.caseVersion,
    defaultLocale: options.defaultLocale,
    referenceKeys: options.referenceKeys,
    catalogs,
    sourcePath: options.i18nRoot,
  })
}
