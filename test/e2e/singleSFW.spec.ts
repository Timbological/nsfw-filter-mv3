import { test, expect, getDocumentImageAttributes } from './fixtures'

const SFWUrls = [
  'https://i.imghippo.com/files/AFVXO1716345018.jpg',
  'https://i.imghippo.com/files/A4ybw1716345074.jpg',
]

for (const url of SFWUrls) {
  test(`Should not filter SFW image: ${url}`, async ({ page }) => {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    const data = await getDocumentImageAttributes(page)
    data.forEach(status => expect(status).toBe('sfw'))
  })
}
