import { test as base, chromium, BrowserContext } from '@playwright/test'
import path from 'path'

const pathToExtension = path.join(__dirname, '../../dist')

export const test = base.extend<{ context: BrowserContext }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chrome',
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1920,1080',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    })
    // Wait for extension service worker to initialise
    await new Promise(resolve => setTimeout(resolve, 5000))
    await use(context)
    await context.close()
  },
  // Override the default page fixture to use our context
  page: async ({ context }, use) => {
    const page = await context.newPage()
    await use(page)
  },
})

export { expect } from '@playwright/test'

export async function getDocumentImageAttributes (page: import('@playwright/test').Page): Promise<string[]> {
  return await page.evaluate(async () => {
    const result = [...document.images]
      .filter(el => el.getAttribute('data-nsfw-filter-status'))
      .map(el => new Promise<string | undefined>(resolve => {
        let attempt = 0
        const wait = (): void => {
          attempt++
          const status = el.getAttribute('data-nsfw-filter-status')
          if (status === 'processing' && attempt > 60) {
            resolve(undefined)
          } else if (status === 'processing') {
            setTimeout(wait, 500)
          } else {
            resolve(status ?? undefined)
          }
        }
        wait()
      }))
    const statuses = await Promise.all(result)
    return statuses.filter((s): s is string => s != null)
  })
}
