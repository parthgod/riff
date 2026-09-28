import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { SourceNotice } from './source-notice';

test('names the sources that failed or timed out', () => {
  render(<SourceNotice sources={{ audius: 'ok', jamendo: 'timeout', radio: 'error' }} />);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Jamendo and Radio Browser are unavailable right now',
  );
});

test('says nothing when every source answered or is switched off', () => {
  const { container } = render(
    <SourceNotice sources={{ audius: 'ok', jamendo: 'disabled', radio: 'ok' }} />,
  );
  expect(container).toBeEmptyDOMElement();
});
