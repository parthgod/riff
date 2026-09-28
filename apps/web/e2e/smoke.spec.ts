import { expect, test } from '@playwright/test';
import { audioTime, search, signUp } from './helpers';

test('sign up, search, play, like, and find it in Liked Songs @live', async ({ page }) => {
  await signUp(page);
  const results = await search(page, 'lofi');
  await results
    .getByRole('listitem')
    .first()
    .getByRole('button', { name: /^Play / })
    .click();

  // Audio actually plays. A dead stream is skipped, so whichever track plays is the one liked.
  await expect.poll(() => audioTime(page), { timeout: 45_000 }).toBeGreaterThan(2);

  const player = page.getByRole('region', { name: 'Player' });
  const like = player.getByRole('button', { name: /^Save .* to Liked Songs$/ });
  const title = (await like.getAttribute('aria-label'))?.replace(
    /^Save (.*) to Liked Songs$/,
    '$1',
  );
  expect(title).toBeTruthy();
  await like.click();
  await expect(
    player.getByRole('button', { name: `Remove ${title} from Liked Songs` }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Liked Songs' }).first().click();
  await expect(
    page.getByRole('list', { name: 'Liked Songs' }).getByText(title as string),
  ).toBeVisible();
});
