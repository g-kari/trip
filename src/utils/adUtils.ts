// Ad display conditions
export function shouldShowAd(options: {
  isLoggedIn: boolean
  isPremium?: boolean
  isSharedPage?: boolean
  isEmbedPage?: boolean
}): boolean {
  const { isLoggedIn, isPremium = false, isSharedPage = false, isEmbedPage = false } = options

  // Never show ads on shared/embed pages (concept protection)
  if (isSharedPage || isEmbedPage) {
    return false
  }

  // Don't show ads to premium users
  if (isPremium) {
    return false
  }

  // Show ads to logged-in free users on their own pages
  return isLoggedIn
}

// Native ad content (for affiliate/promotional content)
export type NativeAdContent = {
  id: string
  title: string
  description: string
  imageUrl?: string
  linkUrl: string
  sponsor: string
  category: 'travel' | 'hotel' | 'activity' | 'general'
}

// Affiliate configuration
// Replace YOUR_AFFILIATE_ID with actual affiliate IDs when registered
export const AFFILIATE_CONFIG = {
  rakutenTravel: {
    enabled: false,
    affiliateId: 'YOUR_RAKUTEN_AFFILIATE_ID',
    baseUrl: 'https://hb.afl.rakuten.co.jp/hgc/',
  },
  jalan: {
    enabled: false,
    affiliateId: 'YOUR_JALAN_AFFILIATE_ID',
    baseUrl: 'https://www.jalan.net/',
  },
  jtb: {
    enabled: false,
    affiliateId: 'YOUR_JTB_AFFILIATE_ID',
    baseUrl: 'https://www.jtb.co.jp/',
  },
}

// Native ad content with affiliate links
// When affiliate is enabled, replace linkUrl with actual affiliate URLs
export const SAMPLE_ADS: NativeAdContent[] = [
  {
    id: 'ad-rakuten-hotel',
    title: '楽天トラベルでお得に宿泊',
    description: '全国のホテル・旅館をポイント還元で予約',
    linkUrl: AFFILIATE_CONFIG.rakutenTravel.enabled
      ? `${AFFILIATE_CONFIG.rakutenTravel.baseUrl}${AFFILIATE_CONFIG.rakutenTravel.affiliateId}`
      : 'https://travel.rakuten.co.jp/',
    sponsor: '楽天トラベル',
    category: 'hotel',
  },
  {
    id: 'ad-jalan-hotel',
    title: 'じゃらんでホテル予約',
    description: 'クーポン利用でさらにお得に',
    linkUrl: AFFILIATE_CONFIG.jalan.enabled
      ? `${AFFILIATE_CONFIG.jalan.baseUrl}?affiliate=${AFFILIATE_CONFIG.jalan.affiliateId}`
      : 'https://www.jalan.net/',
    sponsor: 'じゃらん',
    category: 'hotel',
  },
  {
    id: 'ad-activity',
    title: '現地アクティビティを探す',
    description: '観光・体験ツアーをお得に予約',
    linkUrl: 'https://www.veltra.com/',
    sponsor: 'VELTRA',
    category: 'activity',
  },
  {
    id: 'ad-jtb',
    title: 'JTBで旅行を計画',
    description: '国内・海外ツアーを豊富にご用意',
    linkUrl: AFFILIATE_CONFIG.jtb.enabled
      ? `${AFFILIATE_CONFIG.jtb.baseUrl}?affiliate=${AFFILIATE_CONFIG.jtb.affiliateId}`
      : 'https://www.jtb.co.jp/',
    sponsor: 'JTB',
    category: 'travel',
  },
]

// Get random ad
export function getRandomAd(): NativeAdContent {
  return SAMPLE_ADS[Math.floor(Math.random() * SAMPLE_ADS.length)]
}
