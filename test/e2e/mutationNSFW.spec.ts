import { test, expect, getDocumentImageAttributes } from './fixtures'

const nsfwCriteria = ['Hentai', 'Sexy', 'Porn']
const sfwCriteria = ['Nature']

// @TODO stable
test.describe.skip('Should filter NSFW lazy loaded images', () => {
  for (const criteria of nsfwCriteria) {
    test(`search for ${criteria} should block at least one NSFW image`, async ({ context }) => {
      const page = await context.newPage()
      await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Linux; Android 9; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Mobile Safari/537.36' })

      const startUrl = 'https://duckduckgo.com/?q=1&ia=images&iax=images'
      await page.goto(startUrl, { waitUntil: 'domcontentloaded' })
      await page.locator('.dropdown--safe-search').click()
      await page.getByRole('link', { name: 'Off' }).click()

      await page.goto(`https://duckduckgo.com/?q=${criteria}&ia=images&iax=images`, { waitUntil: 'domcontentloaded' })
      await page.evaluate(() => {
        document.head.insertAdjacentHTML('beforeend', '<style>.tile { filter: blur(15px) }</style>')
      })

      const data = await getDocumentImageAttributes(page)
      const blockedImages = data.filter(v => v === 'nsfw').length
      console.log(`blocked ${blockedImages} from ${data.length} results for ${criteria}`)

      expect(data.length).toBeGreaterThan(0)
      expect(blockedImages).toBeGreaterThan(0)
    })
  }

  for (const criteria of sfwCriteria) {
    test(`search for ${criteria} should show at least one SFW image`, async ({ context }) => {
      const page = await context.newPage()
      await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Linux; Android 9; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Mobile Safari/537.36' })

      await page.goto(`https://duckduckgo.com/?q=${criteria}&ia=images&iax=images`, { waitUntil: 'domcontentloaded' })
      const data = await getDocumentImageAttributes(page)
      const visibleImages = data.filter(v => v === 'sfw').length
      console.log(`blocked ${data.filter(v => v === 'nsfw').length} from ${data.length} results for ${criteria}`)

      expect(data.length).toBeGreaterThan(0)
      expect(visibleImages).toBeGreaterThan(0)
    })
  }
})
