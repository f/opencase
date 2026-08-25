import { describe, expect, it } from 'vitest'

import { kebabCaseChannelName } from './channel-name'

describe('kebabCaseChannelName', () => {
  it.each([
    ['Gece Vardiyası', 'gece-vardiyası'],
    ['Sessiz Koridor', 'sessiz-koridor'],
    ['  Çığlık: İkinci Gece!  ', 'çığlık-ikinci-gece'],
    ['Kayıp Şehir / Üçüncü Bölüm', 'kayıp-şehir-üçüncü-bölüm'],
    ['東京 事件', '東京-事件'],
  ])('converts %j into %j', (title, expected) => {
    expect(kebabCaseChannelName(title, 'tr')).toBe(expected)
  })

  it('uses a player-facing fallback for an empty result', () => {
    expect(kebabCaseChannelName('?!')).toBe('vaka')
  })
})
