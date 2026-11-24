import { expect, test } from '@playwright/test';

// Та же сборка из корня сервера: относительные пути должны работать в обоих вариантах.
test('сборка открывается из корня сервера, все ресурсы загружаются', async ({ page }) => {
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  await page.goto('./');
  await expect(page.getByText('Сравнение размерных сеток').first()).toBeVisible();
  await page.getByRole('button', { name: 'Загрузить демо' }).click();
  await page.goto('./#compare');
  await expect(page.locator('[data-testid="cmp"][data-cmp="M Грудь"]').getByTestId('spread')).toHaveText('4,0 — больше порога');
  expect(failed).toEqual([]);
});
