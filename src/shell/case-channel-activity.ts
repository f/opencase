import type { PublicCaseRuntimeState } from '../case-runtime/protocol'
import type { AppLocale } from '../ui-locale'
import type { InboxMessageViewModel } from './apps/types'

type PublicActivity = NonNullable<PublicCaseRuntimeState['activity']>[number]
type CompletedAffordance = PublicCaseRuntimeState['completedAffordances'][number]

interface OfficeMember {
  readonly name: string
  readonly avatarLabel: string
  readonly role: Readonly<Record<AppLocale, string>>
}

const OFFICE_ROSTER: readonly OfficeMember[] = [
  {
    name: 'Ece Aydın',
    avatarLabel: 'EA',
    role: { tr: 'Adli inceleme lideri', en: 'Forensics lead' },
  },
  {
    name: 'Deniz Kara',
    avatarLabel: 'DK',
    role: { tr: 'Saha koordinatörü', en: 'Field coordinator' },
  },
  {
    name: 'Melis Kaya',
    avatarLabel: 'MK',
    role: { tr: 'Dosya analisti', en: 'Case analyst' },
  },
  {
    name: 'Ozan Demir',
    avatarLabel: 'OD',
    role: { tr: 'Operasyon memuru', en: 'Operations officer' },
  },
]

const COPY = {
  tr: {
    detective: 'Dedektif',
    detectiveRole: 'Soruşturma sorumlusu',
    evidenceWithoutTitle: 'Yeni kanıt kaydını inceledim.',
    evidenceWithTitle: (title: string) => `Hımm, “${title}” kaydını inceledim.`,
    completedWithoutLabel: 'Bu adımı tamamladım.',
    completedWithLabel: (label: string) => `“${label}” adımını tamamladım.`,
    deductionWithoutLabel: 'Yeni bir çıkarım artık kanıtlarla destekleniyor.',
    deductionWithLabel: (label: string) => `Şu çıkarım artık kanıtlarla destekleniyor: “${label}”.`,
    evidenceComments: [
      'Bunu zaman çizelgesine ekleyelim. Detay önemli olabilir 🤔',
      'Tamam, bu kayıt tabloyu biraz daha netleştiriyor.',
      'İyi yakalamışsın. Bunun diğer bulgularla uyuşup uyuşmadığına bakalım.',
      'Not aldım. Bunu diğer kayıtlarla karşılaştırmak iyi olur.',
    ],
    actionComments: [
      'Tamam, bu adımın sonucu dosyada. Buradan devam edebiliriz.',
      'Bu sonuç tabloyu değiştiriyor olabilir. Notlarda yanında tutalım 🤔',
      'Anlaşıldı. Bunu sonraki görüşmede referans alabiliriz.',
      'Not ettim. Sonraki bulguyla birlikte tekrar bakalım.',
    ],
    deductionComments: [
      'Evet, kanıtlar bu değerlendirmeyi destekliyor gibi duruyor.',
      'Bu çıkarımı vaka notlarına açıkça ekleyelim.',
      'Tamam, artık bunu diğer bulgularla birlikte okuyabiliriz.',
      'Mantıklı. Bu bağlantıyı gözden kaçırmayalım 🤔',
    ],
    hint: (label: string) => `Belki sırada “${label}” adımına bakmalısın 🤔`,
  },
  en: {
    detective: 'Detective',
    detectiveRole: 'Lead investigator',
    evidenceWithoutTitle: 'I reviewed a new evidence record.',
    evidenceWithTitle: (title: string) => `Hmm, I reviewed the “${title}” record.`,
    completedWithoutLabel: 'I completed this step.',
    completedWithLabel: (label: string) => `I completed “${label}”.`,
    deductionWithoutLabel: 'A new deduction is now supported by the evidence.',
    deductionWithLabel: (label: string) => `The evidence now supports this deduction: “${label}”.`,
    evidenceComments: [
      'Let’s add this to the timeline. That detail may matter 🤔',
      'Okay, this record makes the picture a little clearer.',
      'Good catch. Let’s see if it matches the other findings.',
      'Noted. It would be good to compare this with the other records.',
    ],
    actionComments: [
      'Okay, the result is in the file. We can continue from here.',
      'This may change the picture. Let’s keep it next to the other notes 🤔',
      'Got it. We can refer to this in the next interview.',
      'Noted. Let’s look at it again with the next finding.',
    ],
    deductionComments: [
      'Yes, the evidence seems to support that assessment.',
      'Let’s add this deduction clearly to the case notes.',
      'Okay, now we can read this together with the other findings.',
      'Makes sense. Let’s not lose this connection 🤔',
    ],
    hint: (label: string) => `Maybe you should check “${label}” next 🤔`,
  },
} as const

type ActivityCopy = typeof COPY[AppLocale]

const HINT_SURFACE_PRIORITY: Readonly<Record<string, number>> = {
  phone: 0,
  inbox: 1,
  web: 2,
  files: 3,
}

/** Small stable hash used only to keep authored office chatter consistent after reloads. */
function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function normalizeOpening(
  opening: InboxMessageViewModel | readonly InboxMessageViewModel[],
): readonly InboxMessageViewModel[] {
  return Array.isArray(opening) ? opening : [opening as InboxMessageViewModel]
}

function officeMember(seed: string): OfficeMember {
  return OFFICE_ROSTER[stableHash(seed) % OFFICE_ROSTER.length]!
}

function uniquePublicDetails(values: readonly (string | undefined)[]): readonly string[] {
  const seen = new Set<string>()
  return values.flatMap((value) => {
    const text = value?.trim()
    if (!text || seen.has(text)) return []
    seen.add(text)
    return [text]
  })
}

function joinSummary(opening: string, details: readonly string[]): string {
  return details.length > 0 ? `${opening} ${details.join(' ')}` : opening
}

function completedForActivity(
  runtime: PublicCaseRuntimeState,
  activity: Extract<PublicActivity, { readonly kind: 'affordance-completed' }>,
  fallbackOccurrence: number,
): CompletedAffordance | undefined {
  const exact = runtime.completedAffordances.find((completed) => (
    completed.id === activity.affordanceId && completed.eventSequence === activity.sequence
  ))
  if (exact) return exact
  return runtime.completedAffordances.filter(({ id }) => id === activity.affordanceId)[fallbackOccurrence]
}

function detectiveSummary(
  activity: PublicActivity,
  runtime: PublicCaseRuntimeState,
  copy: ActivityCopy,
  fallbackOccurrence: number,
): { readonly body: string; readonly commentKind: 'evidence' | 'action' | 'deduction' } {
  if (activity.kind === 'evidence-observed') {
    const evidence = runtime.evidence.find(({ id }) => id === activity.evidenceId)
    const title = evidence?.title?.trim()
    const details = uniquePublicDetails([
      evidence?.description,
      ...(evidence?.findings.map(({ text }) => text) ?? []),
    ])
    return {
      body: joinSummary(
        title ? copy.evidenceWithTitle(title) : copy.evidenceWithoutTitle,
        details,
      ),
      commentKind: 'evidence',
    }
  }

  const completed = completedForActivity(runtime, activity, fallbackOccurrence)
  const label = completed?.label?.trim()
  const result = completed?.result?.trim()
  const isDeduction = completed?.intent.kind === 'deduce'
  const opening = isDeduction
    ? label ? copy.deductionWithLabel(label) : copy.deductionWithoutLabel
    : label ? copy.completedWithLabel(label) : copy.completedWithoutLabel
  return {
    body: joinSummary(opening, result ? [result] : []),
    commentKind: isDeduction ? 'deduction' : 'action',
  }
}

function officeComment(
  kind: 'evidence' | 'action' | 'deduction',
  copy: ActivityCopy,
  seed: string,
): string {
  const choices = kind === 'evidence'
    ? copy.evidenceComments
    : kind === 'deduction'
      ? copy.deductionComments
      : copy.actionComments
  return choices[stableHash(`${seed}:comment`) % choices.length]!
}

function currentHint(runtime: PublicCaseRuntimeState) {
  return runtime.affordances
    .map((affordance, index) => ({ affordance, index }))
    .filter(({ affordance }) => affordance.risk === 'normal' && Boolean(affordance.label?.trim()))
    .sort((left, right) => {
      const leftPriority = HINT_SURFACE_PRIORITY[left.affordance.surface] ?? Number.MAX_SAFE_INTEGER
      const rightPriority = HINT_SURFACE_PRIORITY[right.affordance.surface] ?? Number.MAX_SAFE_INTEGER
      return leftPriority - rightPriority || left.index - right.index
    })[0]?.affordance
}

/**
 * Builds the case-room conversation from player-safe runtime projections only.
 *
 * The helper is deliberately pure: the same opening message and public runtime
 * always produce the same coworkers, comments, ordering, and message ids.
 */
export function createCaseChannelActivityMessages(
  opening: InboxMessageViewModel | readonly InboxMessageViewModel[],
  runtime: PublicCaseRuntimeState,
  profileDisplayName: string,
  locale: AppLocale,
  formatTimestamp: (occurredAtMs: number) => string,
): readonly InboxMessageViewModel[] {
  const copy = COPY[locale]
  const detectiveName = profileDisplayName.trim() || copy.detective
  const orderedActivity = [...(runtime.activity ?? [])]
    .map((activity, index) => ({ activity, index }))
    .sort((left, right) => (
      left.activity.sequence - right.activity.sequence
      || left.activity.occurredAtMs - right.activity.occurredAtMs
      || left.index - right.index
    ))
  const occurrenceByAffordance = new Map<string, number>()
  const activityMessages = orderedActivity.flatMap(({ activity }) => {
    const fallbackOccurrence = activity.kind === 'affordance-completed'
      ? occurrenceByAffordance.get(activity.affordanceId) ?? 0
      : 0
    if (activity.kind === 'affordance-completed') {
      occurrenceByAffordance.set(activity.affordanceId, fallbackOccurrence + 1)
    }
    const seed = `${runtime.case.digest}:${activity.id}:${activity.sequence}`
    const summary = detectiveSummary(activity, runtime, copy, fallbackOccurrence)
    const coworker = officeMember(seed)
    const timestampLabel = formatTimestamp(activity.occurredAtMs)
    const idBase = `case-activity-${activity.sequence}-${stableHash(seed).toString(36)}`
    return [
      {
        id: `${idBase}:detective`,
        author: detectiveName,
        roleLabel: copy.detectiveRole,
        body: summary.body,
        timestampLabel,
        direction: 'outgoing' as const,
      },
      {
        id: `${idBase}:office`,
        author: coworker.name,
        roleLabel: coworker.role[locale],
        avatarLabel: coworker.avatarLabel,
        body: officeComment(summary.commentKind, copy, seed),
        timestampLabel,
        direction: 'incoming' as const,
      },
    ]
  })

  const hint = currentHint(runtime)
  const hintLabel = hint?.label?.trim()
  const hintSeed = hintLabel ? `${runtime.case.digest}:current-hint:${hintLabel}` : undefined
  const hintMember = hintSeed ? officeMember(hintSeed) : undefined
  const hintMessage: readonly InboxMessageViewModel[] = hintLabel && hintSeed && hintMember
    ? [{
        id: `case-hint-${stableHash(hintSeed).toString(36)}`,
        author: hintMember.name,
        roleLabel: hintMember.role[locale],
        avatarLabel: hintMember.avatarLabel,
        body: copy.hint(hintLabel),
        timestampLabel: formatTimestamp(runtime.clocks.caseTimeMs),
        direction: 'incoming',
      }]
    : []

  return [...normalizeOpening(opening), ...activityMessages, ...hintMessage]
}
