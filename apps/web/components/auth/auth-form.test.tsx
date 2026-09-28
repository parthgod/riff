import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AuthForm } from './auth-form';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const auth = vi.hoisted(() => ({ signIn: vi.fn(), signUp: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { signIn: { email: auth.signIn }, signUp: { email: auth.signUp } },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuthForm', () => {
  test('signs in and goes to the page the user came from', async () => {
    auth.signIn.mockResolvedValue({ data: {}, error: null });
    render(<AuthForm mode="sign-in" next="/liked" />);
    await userEvent.type(screen.getByLabelText('Email'), 'me@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'longenough1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.signIn).toHaveBeenCalledWith({ email: 'me@example.com', password: 'longenough1' });
    expect(router.replace).toHaveBeenCalledWith('/liked');
  });

  test('signs up with a name', async () => {
    auth.signUp.mockResolvedValue({ data: {}, error: null });
    render(<AuthForm mode="sign-up" next="/" />);
    await userEvent.type(screen.getByLabelText('Name'), 'Ada');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'longenough1');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(auth.signUp).toHaveBeenCalledWith({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'longenough1',
    });
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  test.each([
    ['INVALID_EMAIL_OR_PASSWORD', 'Wrong email or password.'],
    ['EMAIL_PASSWORD_SIGN_UP_DISABLED', 'Sign-ups are closed on this server.'],
    ['USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'An account with this email already exists.'],
  ])('explains %s and stays on the page', async (code, message) => {
    auth.signIn.mockResolvedValue({ data: null, error: { code, message: 'raw', status: 400 } });
    render(<AuthForm mode="sign-in" next="/" />);
    await userEvent.type(screen.getByLabelText('Email'), 'me@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'longenough1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(router.replace).not.toHaveBeenCalled();
  });

  test('reports a network failure instead of hanging', async () => {
    auth.signIn.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<AuthForm mode="sign-in" next="/" />);
    await userEvent.type(screen.getByLabelText('Email'), 'me@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'longenough1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  test('links to the other form, keeping the destination', () => {
    render(<AuthForm mode="sign-in" next="/liked" />);
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/sign-up?next=%2Fliked',
    );
  });
});
