import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

test('signed-out visitors are sent to sign-in and brought back after', async ({ page }) => {
  await page.goto('/library');
  await expect(page).toHaveURL('/sign-in?next=%2Flibrary');
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL('/sign-up?next=%2Flibrary');
});

test('pages fit a 360 px phone without sideways scrolling, and hydrate cleanly', async ({
  page,
}) => {
  const hydrationErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydrat/i.test(message.text())) {
      hydrationErrors.push(message.text());
    }
  });
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/sign-in');
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  expect(await overflow()).toBe(0);

  await signUp(page);
  for (const path of ['/library', '/liked', '/search']) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Main' }).last()).toBeVisible();
    expect(await overflow(), path).toBe(0);
  }
  expect(hydrationErrors).toEqual([]);
});
