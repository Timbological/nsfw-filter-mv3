import { test, expect, getDocumentImageAttributes } from './fixtures'

const NSFWUrls = [
  'https://i.imghippo.com/files/5C44l1716344862.jpg',
  'https://i.imghippo.com/files/3KtEY1716344936.jpg',
]

for (const url of NSFWUrls) {
  test(`Should filter NSFW image: ${url}`, async ({ page }) => {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    const data = await getDocumentImageAttributes(page)
    data.forEach(status => expect(status).toBe('nsfw'))
  })
}
