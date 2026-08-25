import Ajv, { type ErrorObject } from 'ajv'
import { parseAllDocuments, visit } from 'yaml'

import caseI18nSchema from '../../schema/case-i18n.v0.1.schema.json'
import {
  canonicalJson,
  canonicalize,
  compareCanonicalStrings,
  hashCanonical,
} from '../compiler/canonical'
import type { LocalizedText, PublicCaseManifest } from '../compiler/types'
import type { CasePresentationCatalog } from '../case-runtime/protocol'
import {
  CasePackageError,
  type CaseLocalizationBundle,
  type CaseTranslationCatalog,
  type LocalizedManifestSelection,
} from './types'

const LOCALE = /^[a-z]{2}(?:-[A-Z]{2})?$/
export const CASE_LOCALIZATION_MAX_CATALOGS = 32

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

export interface ParseCaseTranslationCatalogOptions {
  readonly sourcePath: string
  readonly expectedLocale?: string
  readonly caseId: string
  readonly caseVersion: string
}

/** Parse one translation catalog without touching a filesystem. */
export function parseCaseTranslationCatalog(
  sourceText: string,
  options: ParseCaseTranslationCatalogOptions,
): CaseTranslationCatalog {
  const source = parseCatalog(sourceText, options.sourcePath)
  const locale = String(source.locale)
  const identity = record(source.case)
  if (options.expectedLocale !== undefined && locale !== options.expectedLocale) {
    return catalogError(
      'E_I18N_IDENTITY',
      `Catalog locale '${locale}' must match filename '${options.expectedLocale}.yml'.`,
      options.sourcePath,
    )
  }
  if (identity.id !== options.caseId || identity.version !== options.caseVersion) {
    return catalogError(
      'E_I18N_IDENTITY',
      `Catalog targets ${String(identity.id)}@${String(identity.version)}, expected ${options.caseId}@${options.caseVersion}.`,
      options.sourcePath,
    )
  }
  const normalized = {
    schema: 'case-i18n/v0.1' as const,
    case: { id: options.caseId, version: options.caseVersion },
    locale,
    messages: canonicalize(source.messages) as Record<string, string>,
  }
  return {
    ...normalized,
    sourcePath: options.sourcePath,
    digest: hashCanonical(normalized),
  }
}

export interface CreateCaseLocalizationBundleOptions {
  readonly caseId: string
  readonly caseVersion: string
  readonly defaultLocale: string
  readonly referenceKeys: readonly string[]
  readonly catalogs: readonly CaseTranslationCatalog[]
  /** Error location used when no individual catalog is responsible. */
  readonly sourcePath?: string
}

/** Validate and combine already parsed catalogs into a deterministic bundle. */
export function createCaseLocalizationBundle(
  options: CreateCaseLocalizationBundleOptions,
): CaseLocalizationBundle {
  const sourcePath = options.sourcePath ?? 'i18n/'
  if (!LOCALE.test(options.defaultLocale)) {
    return catalogError(
      'E_I18N_IDENTITY',
      `Invalid default locale '${options.defaultLocale}'.`,
      sourcePath,
    )
  }
  if (options.catalogs.length === 0 || options.catalogs.length > CASE_LOCALIZATION_MAX_CATALOGS) {
    return catalogError(
      'E_I18N_FILE',
      `i18n/ must contain between 1 and ${CASE_LOCALIZATION_MAX_CATALOGS} flat locale .yml files.`,
      sourcePath,
    )
  }

  const catalogs: Record<string, CaseTranslationCatalog> = {}
  for (const catalog of options.catalogs) {
    if (catalog.case.id !== options.caseId || catalog.case.version !== options.caseVersion) {
      return catalogError(
        'E_I18N_IDENTITY',
        `Catalog targets ${catalog.case.id}@${catalog.case.version}, expected ${options.caseId}@${options.caseVersion}.`,
        catalog.sourcePath,
      )
    }
    if (catalogs[catalog.locale]) {
      return catalogError(
        'E_I18N_IDENTITY',
        `Duplicate translation catalog for locale '${catalog.locale}'.`,
        catalog.sourcePath,
      )
    }
    catalogs[catalog.locale] = catalog
  }

  const defaultCatalog = catalogs[options.defaultLocale]
  if (!defaultCatalog) {
    return catalogError(
      'E_I18N_IDENTITY',
      `Default catalog '${options.defaultLocale}.yml' is required by case.locale.`,
      sourcePath,
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
