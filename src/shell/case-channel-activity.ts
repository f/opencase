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
    evidenceWithoutTitle: [
      'hmm, yeni kanıta baktım 👀',
      'yeni bir kayıt düştü, açtım 🕵️',
      'dur, burada yeni bir şey var 🧐',
      'okey, yeni kanıtı kontrol ettim 🔎',
    ],
    evidenceWithTitle: [
      (title: string) => `hmm, “${title}” kaydına baktım 👀`,
      (title: string) => `şu “${title}” kaydını açtım 🕵️`,
      (title: string) => `dur, “${title}” tarafında bir şey var 🧐`,
      (title: string) => `okey, “${title}” kaydını kontrol ettim 🔎`,
    ],
    completedWithoutLabel: [
      'tamam, bu adım bitti ✅',
      'şu işi hallettim 👌',
      'bir adım daha tamam 🫡',
      'okey, bu iş tamamlandı 👍',
    ],
    completedWithLabel: [
      (label: string) => `tamam, “${label}” işini hallettim ✅`,
      (label: string) => `az önce “${label}” adımını geçtim 👀`,
      (label: string) => `okey, “${label}” tamam 👌`,
      (label: string) => `şu “${label}” işi de bitti 🫡`,
    ],
    deductionWithoutLabel: [
      'hmm, yeni bir bağlantı oturdu 🧩',
      'bence burada bir şey netleşti 👀',
      'tamam, bu çıkarım artık sağlam duruyor ✅',
      'şu bağlantı kanıtlarla uyuşuyor gibi 🤔',
    ],
    deductionWithLabel: [
      (label: string) => `hmm, “${label}” artık daha mantıklı duruyor 🧩`,
      (label: string) => `bence “${label}” tarafı oturdu 👀`,
      (label: string) => `şu bağlantı netleşti: “${label}” 🔗`,
      (label: string) => `tamam, “${label}” kanıtlarla uyuşuyor gibi ✅`,
    ],
    evidenceComments: [
      'iyiymiş, bunu zaman çizgisine koyalım 👀',
      'hmm evet, bu detay önemli olabilir 🤔',
      'güzel yakalamışsın, diğer kayıtlarla karşılaştıralım mı?',
      'bence burada bir şey var 🧩',
      'notumu aldım ✍️',
      'dur, bu önceki bilgiyle çelişiyor olabilir 👀',
    ],
    actionComments: [
      'tamamdır, buradan devam 👌',
      'iyi, şimdi tablo biraz daha net',
      'hmm bunu sonraki görüşmede kullanalım 👀',
      'notumu aldım ✍️',
      'mantıklı, bir sonraki adım belli gibi 🤔',
      'evet ya, bu işimize yarar 👍',
    ],
    deductionComments: [
      'evet ya, bence de 🧩',
      'hmm bu bağlantı oturdu gibi',
      'aynen, kanıtlar da oraya gidiyor 👀',
      'bunu panoya sabitleyelim 📌',
      'mantıklı geldi bana 🤔',
      'tamamdır, bu artık sağlam duruyor ✅',
    ],
    hints: [
      (label: string) => `bence sırada “${label}” var 👀`,
      (label: string) => `bu arada “${label}” işine de baksak mı? 🤔`,
      (label: string) => `hmm, belki “${label}” ile devam etmelisin`,
      (label: string) => `şunu da unutma: “${label}” 📌`,
      (label: string) => `ben olsam şimdi “${label}” tarafına geçerdim`,
      (label: string) => `hâlâ açık: “${label}”, bi’ bak istersen 👀`,
    ],
  },
  en: {
    detective: 'Detective',
    detectiveRole: 'Lead investigator',
    evidenceWithoutTitle: [
      'hmm, checked the new evidence 👀',
      'just opened a new record 🕵️',
      'wait, there’s something here 🧐',
      'ok, checked the new evidence 🔎',
    ],
    evidenceWithTitle: [
      (title: string) => `hmm, checked “${title}” 👀`,
      (title: string) => `just opened “${title}” 🕵️`,
      (title: string) => `wait, “${title}” may matter 🧐`,
      (title: string) => `ok, looked through “${title}” 🔎`,
    ],
    completedWithoutLabel: [
      'ok, that step is done ✅',
      'handled that one 👌',
      'one more step done 🫡',
      'yep, finished that 👍',
    ],
    completedWithLabel: [
      (label: string) => `ok, “${label}” is done ✅`,
      (label: string) => `just completed “${label}” 👀`,
      (label: string) => `yep, “${label}” is done 👌`,
      (label: string) => `finished “${label}”, result below 👇`,
    ],
    deductionWithoutLabel: [
      'hmm, a new connection just clicked 🧩',
      'i think something is clearer now 👀',
      'ok, this theory looks solid now ✅',
      'this seems to match the evidence 🤔',
    ],
    deductionWithLabel: [
      (label: string) => `hmm, “${label}” makes more sense now 🧩`,
      (label: string) => `i think “${label}” just clicked 👀`,
      (label: string) => `this connection looks clearer: “${label}” 🔗`,
      (label: string) => `ok, “${label}” matches the evidence ✅`,
    ],
    evidenceComments: [
      'nice, adding this to the timeline 👀',
      'hmm yeah, that detail may matter 🤔',
      'good catch, should we compare the other records?',
      'i think there’s something here 🧩',
      'noted ✍️',
      'wait, this may clash with the earlier info 👀',
    ],
    actionComments: [
      'nice, let’s keep going 👌',
      'good, the picture is a bit clearer now',
      'hmm let’s use this in the next call 👀',
      'noted ✍️',
      'makes sense, next move looks clearer 🤔',
      'yeah, this helps 👍',
    ],
    deductionComments: [
      'yeah, i think so too 🧩',
      'hmm, that connection just clicked',
      'yep, the evidence points there too 👀',
      'pinning this to the board 📌',
      'makes sense to me 🤔',
      'ok, this looks solid now ✅',
    ],
    hints: [
      (label: string) => `i’d check “${label}” next 👀`,
      (label: string) => `btw, maybe look at “${label}” 🤔`,
      (label: string) => `hmm, “${label}” might be the next move`,
      (label: string) => `don’t forget “${label}” 📌`,
      (label: string) => `i’d probably go with “${label}” now`,
      (label: string) => `still open: “${label}”, maybe take a look 👀`,
    ],
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

function stablePick<T>(choices: readonly T[], seed: string): T {
  let hash = stableHash(seed)
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb352d)
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x846ca68b)
  hash ^= hash >>> 16
  return choices[(hash >>> 0) % choices.length]!
}

function normalizeOpening(
  opening: InboxMessageViewModel | readonly InboxMessageViewModel[],
): readonly InboxMessageViewModel[] {
  return Array.isArray(opening) ? opening : [opening as InboxMessageViewModel]
}

function officeMember(seed: string): OfficeMember {
  return stablePick(OFFICE_ROSTER, `${seed}:member`)
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
  return details.length > 0 ? `${opening}\n↳ ${details.join(' ')}` : opening
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
  seed: string,
): { readonly body: string; readonly commentKind: 'evidence' | 'action' | 'deduction' } {
  if (activity.kind === 'evidence-observed') {
    const evidence = runtime.evidence.find(({ id }) => id === activity.evidenceId)
    const title = evidence?.title?.trim()
    const details = uniquePublicDetails([
      evidence?.description,
      ...(evidence?.findings.map(({ text }) => text) ?? []),
    ])
    const opening = title
      ? stablePick(copy.evidenceWithTitle, `${seed}:detective:evidence:title`)(title)
      : stablePick(copy.evidenceWithoutTitle, `${seed}:detective:evidence`)
    return {
      body: joinSummary(opening, details),
      commentKind: 'evidence',
    }
  }

  const completed = completedForActivity(runtime, activity, fallbackOccurrence)
  const label = completed?.label?.trim()
  const result = completed?.result?.trim()
  const isDeduction = completed?.intent.kind === 'deduce'
  const opening = isDeduction
    ? label
      ? stablePick(copy.deductionWithLabel, `${seed}:detective:deduction:label`)(label)
      : stablePick(copy.deductionWithoutLabel, `${seed}:detective:deduction`)
    : label
      ? stablePick(copy.completedWithLabel, `${seed}:detective:action:label`)(label)
      : stablePick(copy.completedWithoutLabel, `${seed}:detective:action`)
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
  return stablePick(choices, `${seed}:comment`)
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
    const summary = detectiveSummary(activity, runtime, copy, fallbackOccurrence, seed)
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
        body: stablePick(copy.hints, `${hintSeed}:copy`)(hintLabel),
        timestampLabel: formatTimestamp(runtime.clocks.caseTimeMs),
        direction: 'incoming',
      }]
    : []

  return [...normalizeOpening(opening), ...activityMessages, ...hintMessage]
}
