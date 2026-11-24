import { expect, test } from '@playwright/test';
import { freshApp, loadDemo } from './helpers';

test('строки вводятся с клавиатуры подряд: после добавления фокус на размере, модель и замер сохраняются', async ({ page }) => {
  await freshApp(page);
  await page.getByLabel('Новый поставщик').fill('Ателье');
  await page.keyboard.press('Enter');
  await page.getByLabel('Модель', { exact: true }).last().fill('Платье');
  await page.getByLabel('Размер', { exact: true }).fill('42');
  await page.getByLabel('Замер у поставщика', { exact: true }).fill('Талия');
  await page.getByLabel('Значение', { exact: true }).fill('68');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Размер', { exact: true })).toBeFocused();
  await page.keyboard.type('44');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.type('72');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('notice')).toHaveText('Строка добавлена: Платье · 44 · Талия · 72');
  await expect(page.getByTestId('row')).toHaveCount(2);
  await page.getByLabel('Размер', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Добавить строку' }).click();
  await expect(page.getByLabel('Размер', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Размер', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Укажите размер')).toBeVisible();
});

for (const width of [360, 320]) {
  test(`узкий экран ${width} px: без горизонтальной прокрутки во всех разделах`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await loadDemo(page);
    for (const hash of ['#data', '#map', '#compare', '#card']) {
      await page.goto(`./${hash}`);
      await expect(page.locator('main')).toBeVisible();
      await page.waitForTimeout(100);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, hash).toBeLessThanOrEqual(0);
      // таблицы тоже не прокручиваются вбок: значения и разброс видны без прокрутки
      const inner = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('.table-wrap')].map((w) => w.scrollWidth - w.clientWidth)));
      expect(inner, `${hash} table`).toBeLessThanOrEqual(0);
    }
  });
}

test('поля подписаны, кнопки не меньше 40 px', async ({ page }) => {
  await loadDemo(page);
  for (const hash of ['#data', '#map', '#compare', '#card']) {
    await page.goto(`./${hash}`);
    for (const b of await page.locator('main button, main select, main summary').all()) {
      if (!(await b.isVisible())) continue;
      expect((await b.boundingBox())!.height, hash).toBeGreaterThanOrEqual(40);
    }
  }
  await page.goto('./#compare');
  for (const l of ['Порог расхождения', 'Единица порога', 'Округление до целых мм', 'Показывать в', 'Модель']) await expect(page.getByLabel(l, { exact: true })).toBeVisible();
});
