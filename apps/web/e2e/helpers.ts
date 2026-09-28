import { expect, type Page } from '@playwright/test';

/** Signs up a fresh user and lands on Home. */
export async function signUp(page: Page): Promise<string> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('E2E Listener');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/');
  return email;
}

/** Seconds of audio the player's element has played. */
export const audioTime = (page: Page) =>
  page.evaluate(
    () => (document.getElementById('riff-audio') as HTMLAudioElement | null)?.currentTime ?? 0,
  );

/** Searches from the top bar and waits for track results. */
export async function search(page: Page, q: string) {
  await page.getByRole('searchbox', { name: 'Search' }).fill(q);
  await expect(page).toHaveURL(new RegExp(`/search\\?q=${q}`));
  const list = page.getByRole('list', { name: `Search: ${q}` });
  await expect(list.getByRole('listitem').first()).toBeVisible();
  return list;
}
