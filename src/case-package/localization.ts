import Ajv, { type ErrorObject } from 'ajv'
import { constants } from 'node:fs'
import { open, readdir, type FileHandle } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { parseAllDocuments, visit } from 'yaml'

import caseI18nSchema from '../../schema/case-i18n.v0.1.schema.json'
import {
  canonicalJson,
  canonicalize,
  compareCanonicalStrings,
  hashCanonical,
  type LocalizedText,
  type PublicCaseManifest,
} from '../compiler'
import type { CasePresentationCatalog } from '../case-runtime'
import {
  CasePackageError,
  type CaseLocalizationBundle,
  type CaseTranslationCatalog,
  type LocalizedManifestSelection,
} from './types'

const LOCALE = /^[a-z]{2}(?:-[A-Z]{2})?$/
const CATALOG_FILE = /^[a-z]{2}(?:-[A-Z]{2})?\.yml$/
const MAX_CATALOGS = 32
const MAX_CATALOG_BYTES = 256 * 1024
const MAX_TOTAL_CATALOG_BYTES = 4 * 1024 * 1024

type AnyRecord = Record<string, unknown>

const ajv = new Ajv({ allErrors: true, strict: false, verbose: true })
const validateCatalog = ajv.compile(caseI18nSchema)

function record(value: unknown): AnyRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as AnyRecord
    : {}
}

function schemaPath(error: ErrorObject): string {
  const suffix = error.keyword === 'required'
    ? `/${String(error.params.missingProperty).replaceAll('~', '~0').replaceAll('/', '~1')}`
    : error.keyword === 'additionalProperties'
      ? `/${String(error.params.additionalProperty).replaceAll('~', '~0').replaceAll('/', '~1')}`
      : ''
  return `${error.instancePath}${suffix}` || '/'
}

function catalogError(
  code: 'E_I18N_FILE' | 'E_I18N_YAML' | 'E_I18N_SCHEMA' | 'E_I18N_IDENTITY' | 'E_I18N_MISSING_MESSAGE',
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

function parseCatalog(sourceText: string, path: string): AnyRecord {
  const documents = parseAllDocuments(sourceText, {
    customTags: [],
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  })
  if (documents.length !== 1) {
    return catalogError(
      'E_I18N_YAML',
      `Translation catalog must contain exactly one YAML document; found ${documents.length}.`,
      path,
    )
  }
  const document = documents[0]!
  const problems = [...document.errors, ...document.warnings]
  let hasAlias = false
  let hasExplicitTag = false
  visit(document, {
    Alias() {
      hasAlias = true
    },
    Node(_key, node) {
      if ('tag' in node && typeof node.tag === 'string' && node.tag.length > 0) {
        hasExplicitTag = true
      }
    },
  })
  if (problems.length > 0 || hasAlias || hasExplicitTag) {
    const detail = problems.map(({ message }) => message).join('; ')
    return catalogError(
      'E_I18N_YAML',
      hasAlias
        ? 'YAML aliases are not allowed in translation catalogs.'
        : hasExplicitTag
          ? 'Explicit YAML tags are not allowed in translation catalogs.'
          : `Invalid translation catalog YAML: ${detail}`,
      path,
    )
  }
  const value = document.toJS({ maxAliasCount: 0 }) as unknown
  if (!validateCatalog(value)) {
    const first = [...(validateCatalog.errors ?? [])].sort((left, right) =>
      compareCanonicalStrings(schemaPath(left), schemaPath(right)) ||
      compareCanonicalStrings(left.keyword, right.keyword),
    )[0]
    const at = first ? schemaPath(first) : '/'
    return catalogError(
      'E_I18N_SCHEMA',
      `Translation catalog schema violation at ${at}: ${first?.message ?? 'invalid document'}.`,
      path,
    )
  }
  return value as AnyRecord
}

export interface LoadCaseLocalizationOptions {
  i18nRoot: string
  caseId: string
  caseVersion: string
  defaultLocale: string
  referenceKeys: readonly string[]
}

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
  if (entries.length === 0 || entries.length > MAX_CATALOGS) {
    return catalogError(
      'E_I18N_FILE',
      `i18n/ must contain between 1 and ${MAX_CATALOGS} flat locale .yml files.`,
      options.i18nRoot,
    )
  }

  const catalogs: Record<string, CaseTranslationCatalog> = {}
  let totalBytes = 0
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
    const source = parseCatalog(sourceText, path)
    const locale = String(source.locale)
    const expectedLocale = basename(entry.name, extname(entry.name))
    const identity = record(source.case)
    if (locale !== expectedLocale) {
      return catalogError(
        'E_I18N_IDENTITY',
        `Catalog locale '${locale}' must match filename '${entry.name}'.`,
        path,
      )
    }
    if (identity.id !== options.caseId || identity.version !== options.caseVersion) {
      return catalogError(
        'E_I18N_IDENTITY',
        `Catalog targets ${String(identity.id)}@${String(identity.version)}, expected ${options.caseId}@${options.caseVersion}.`,
        path,
      )
    }
    const messages = canonicalize(source.messages) as Record<string, string>
    const normalized = {
      schema: 'case-i18n/v0.1' as const,
      case: { id: options.caseId, version: options.caseVersion },
      locale,
      messages,
    }
    catalogs[locale] = {
      ...normalized,
      sourcePath: path,
      digest: hashCanonical(normalized),
    }
  }

  const defaultCatalog = catalogs[options.defaultLocale]
  if (!defaultCatalog) {
    return catalogError(
      'E_I18N_IDENTITY',
      `Default catalog '${options.defaultLocale}.yml' is required by case.locale.`,
      options.i18nRoot,
    )
  }
  for (const key of options.referenceKeys) {
    if (defaultCatalog.messages[key] === undefined) {
      return catalogError(
        'E_I18N_MISSING_MESSAGE',
        `Default locale '${options.defaultLocale}' is missing translation key '${key}'.`,
        defaultCatalog.sourcePath,
      )
    }
  }
  const locales = Object.keys(catalogs).sort(compareCanonicalStrings)
  return {
    defaultLocale: options.defaultLocale,
    locales,
    catalogs,
    referenceKeys: [...options.referenceKeys].sort(compareCanonicalStrings),
    digest: hashCanonical({
      defaultLocale: options.defaultLocale,
      catalogs: locales.map((locale) => ({ locale, digest: catalogs[locale]!.digest })),
    }),
  }
}

export function negotiateCaseLocale(
  localization: CaseLocalizationBundle,
  requestedLocale: string,
): string {
  if (localization.catalogs[requestedLocale]) return requestedLocale
  const base = requestedLocale.split('-')[0] ?? ''
  if (base !== requestedLocale && localization.catalogs[base]) return base
  return localization.defaultLocale
}

function effectiveMessages(
  localization: CaseLocalizationBundle,
  locale: string,
): Record<string, string> {
  const defaultMessages = localization.catalogs[localization.defaultLocale]!.messages
  const selectedMessages = localization.catalogs[locale]!.messages
  return Object.fromEntries(
    localization.referenceKeys.map((key) => [
      key,
      selectedMessages[key] ?? defaultMessages[key]!,
    ]),
  )
}

export function createCasePresentationCatalog(
  localization: CaseLocalizationBundle,
  requestedLocale: string,
): CasePresentationCatalog {
  const locale = negotiateCaseLocale(localization, requestedLocale)
  return Object.freeze({
    defaultLocale: localization.defaultLocale,
    locale,
    messages: Object.freeze(effectiveMessages(localization, locale)),
  })
}

export function resolveLocalizedText(
  localization: CaseLocalizationBundle,
  requestedLocale: string,
  text: LocalizedText,
): string {
  if (typeof text === 'string') return text
  const presentation = createCasePresentationCatalog(localization, requestedLocale)
  const value = presentation.messages[text.$text]
  if (value === undefined) {
    throw new CasePackageError(
      'E_I18N_MISSING_MESSAGE',
      `Translation key '${text.$text}' is not declared by this case.`,
    )
  }
  return value
}

function localizeValue(value: unknown, messages: Readonly<Record<string, string>>): unknown {
  if (Array.isArray(value)) return value.map((item) => localizeValue(item, messages))
  if (!value || typeof value !== 'object') return value
  const object = value as AnyRecord
  if (Object.keys(object).length === 1 && typeof object.$text === 'string') {
    const message = messages[object.$text]
    if (message === undefined) {
      throw new CasePackageError(
        'E_I18N_MISSING_MESSAGE',
        `Public manifest references missing translation key '${object.$text}'.`,
      )
    }
    return message
  }
  return Object.fromEntries(
    Object.entries(object).map(([key, child]) => [key, localizeValue(child, messages)]),
  )
}

export function localizePublicCaseManifest(
  manifest: PublicCaseManifest,
  localization: CaseLocalizationBundle,
  requestedLocale: string,
): LocalizedManifestSelection {
  const presentation = createCasePresentationCatalog(localization, requestedLocale)
  const localized = localizeValue(manifest, presentation.messages) as PublicCaseManifest
  const withoutIntegrity = canonicalize({
    ...localized,
    case: { ...localized.case, locale: presentation.locale },
    integrity: undefined,
  }) as Omit<PublicCaseManifest, 'integrity'>
  const localizedManifest: PublicCaseManifest = {
    ...withoutIntegrity,
    integrity: {
      algorithm: 'sha256',
      assets: manifest.integrity.assets,
      manifest: hashCanonical(withoutIntegrity),
    },
  }
  return {
    requestedLocale,
    locale: presentation.locale,
    manifest: localizedManifest,
  }
}

export function canonicalLocalizedManifest(manifest: PublicCaseManifest): string {
  return canonicalJson(manifest)
}
