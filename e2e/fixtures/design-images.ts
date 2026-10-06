import type { Page } from '@playwright/test';

/** Synthetic, self-contained image fixtures; no external stock service is involved. */
export async function designImage(page: Page, logo = false): Promise<Buffer> {
  const data = await page.evaluate((isLogo) => {
    const canvas = document.createElement('canvas');
    canvas.width = isLogo ? 240 : 1200; canvas.height = isLogo ? 120 : 500;
    const ctx = canvas.getContext('2d')!;
    if (isLogo) {
      ctx.fillStyle = '#205E96'; ctx.fillRect(0, 0, 240, 120);
      ctx.font = 'bold 70px sans-serif'; ctx.fillStyle = '#FFFFFF'; ctx.fillText('OR', 60, 84);
    } else {
      const gradient = ctx.createLinearGradient(0, 0, 1200, 500);
      gradient.addColorStop(0, '#204E78'); gradient.addColorStop(1, '#E5A85E');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 500);
      ctx.fillStyle = '#527D81'; ctx.beginPath(); ctx.arc(240, 220, 170, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#BE7948'; ctx.fillRect(850, 150, 200, 400);
    }
    return canvas.toDataURL('image/png').split(',')[1]!;
  }, logo);
  return Buffer.from(data, 'base64');
}
