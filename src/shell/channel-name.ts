/** Creates a player-facing channel name from localized display text. */
export function kebabCaseChannelName(value: string, locale?: string): string {
  const normalized = value.trim().normalize('NFC')
  const lowered = locale
    ? normalized.toLocaleLowerCase(locale)
    : normalized.toLocaleLowerCase()
  return lowered.match(/[\p{Letter}\p{Mark}\p{Number}]+/gu)?.join('-') || 'vaka'
}
