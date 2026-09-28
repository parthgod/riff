import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import { ErrorState } from './page-state';

test('upstream failures explain and offer a retry', async () => {
  const onRetry = vi.fn();
  render(<ErrorState error={new ApiRequestError(502, 'UPSTREAM_ERROR', 'x')} onRetry={onRetry} />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The music source is having trouble right now.',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(onRetry).toHaveBeenCalledOnce();
});

test('a missing page links home instead', () => {
  render(<ErrorState error={new ApiRequestError(404, 'NOT_FOUND', 'x')} onRetry={vi.fn()} />);
  expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});

test('network failures say so', () => {
  render(<ErrorState error={new TypeError('Failed to fetch')} onRetry={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Could not reach Riff.');
});
