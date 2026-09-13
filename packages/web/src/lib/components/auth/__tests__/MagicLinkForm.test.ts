/**
 * MagicLinkForm Component Tests
 *
 * Tests for the passwordless email sign-in form component.
 */

import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import MagicLinkForm from '../MagicLinkForm.svelte';

// Mock the auth store
vi.mock('$lib/stores/auth.svelte', () => {
	let loading = false;

	return {
		auth: {
			get loading() {
				return loading;
			},
			signInWithEmail: vi.fn().mockResolvedValue(undefined),
			linkEmail: vi.fn().mockResolvedValue(undefined),
			__testing: {
				setLoading: (value: boolean) => {
					loading = value;
				},
			},
		},
	};
});

describe('MagicLinkForm', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		// Reset loading state before each test
		const { auth } = await import('$lib/stores/auth.svelte');
		auth.__testing.setLoading(false);
	});

	it('renders email input and submit button', () => {
		render(MagicLinkForm);

		expect(screen.getByPlaceholderText('Enter your email')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Send Magic Link' })).toBeInTheDocument();
	});

	it('renders with link mode text', () => {
		render(MagicLinkForm, { props: { mode: 'link' } });

		expect(screen.getByPlaceholderText('user@example.com')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Link Email' })).toBeInTheDocument();
	});

	it('has accessible label for email input', () => {
		render(MagicLinkForm);

		const input = screen.getByLabelText('Email address');
		expect(input).toBeInTheDocument();
		expect(input).toHaveAttribute('type', 'email');
		expect(input).toHaveAttribute('autocomplete', 'email');
	});

	it('shows error when submitting empty form', async () => {
		const { container } = render(MagicLinkForm);

		// Use fireEvent.submit on form to bypass native HTML5 validation
		const form = container.querySelector('form');
		await fireEvent.submit(form!);

		await vi.waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent('Please enter your email');
		});
	});

	it('calls signInWithEmail on submit (signin mode)', async () => {
		const { auth } = await import('$lib/stores/auth.svelte');

		render(MagicLinkForm);

		const input = screen.getByPlaceholderText('Enter your email');
		await fireEvent.input(input, { target: { value: 'user@example.com' } });

		const button = screen.getByRole('button', { name: 'Send Magic Link' });
		await fireEvent.click(button);

		expect(auth.signInWithEmail).toHaveBeenCalledWith('user@example.com', undefined);
	});

	it('calls linkEmail on submit (link mode)', async () => {
		const { auth } = await import('$lib/stores/auth.svelte');

		render(MagicLinkForm, { props: { mode: 'link' } });

		const input = screen.getByPlaceholderText('user@example.com');
		await fireEvent.input(input, { target: { value: 'user@example.com' } });

		const button = screen.getByRole('button', { name: 'Link Email' });
		await fireEvent.click(button);

		expect(auth.linkEmail).toHaveBeenCalledWith('user@example.com');
	});

	it('passes redirectTo to signInWithEmail', async () => {
		const { auth } = await import('$lib/stores/auth.svelte');

		render(MagicLinkForm, { props: { redirectTo: '/game' } });

		const input = screen.getByPlaceholderText('Enter your email');
		await fireEvent.input(input, { target: { value: 'user@example.com' } });

		const button = screen.getByRole('button', { name: 'Send Magic Link' });
		await fireEvent.click(button);

		expect(auth.signInWithEmail).toHaveBeenCalledWith('user@example.com', '/game');
	});

	it('shows success message after email sent', async () => {
		render(MagicLinkForm);

		const input = screen.getByPlaceholderText('Enter your email');
		await fireEvent.input(input, { target: { value: 'user@example.com' } });

		const button = screen.getByRole('button', { name: 'Send Magic Link' });
		await fireEvent.click(button);

		await vi.waitFor(() => {
			expect(screen.getByRole('status')).toHaveTextContent('Check your email for a sign-in link!');
		});
	});

	it('hides form after success', async () => {
		render(MagicLinkForm);

		const input = screen.getByPlaceholderText('Enter your email');
		await fireEvent.input(input, { target: { value: 'user@example.com' } });

		const button = screen.getByRole('button', { name: 'Send Magic Link' });
		await fireEvent.click(button);

		await vi.waitFor(() => {
			expect(screen.queryByPlaceholderText('Enter your email')).not.toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Send Magic Link' })).not.toBeInTheDocument();
		});
	});

	it('displays error on failure', async () => {
		const { auth } = await import('$lib/stores/auth.svelte');
		(auth.signInWithEmail as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error('Invalid email format'),
		);

		const { container } = render(MagicLinkForm);

		const input = screen.getByPlaceholderText('Enter your email');
		await fireEvent.input(input, { target: { value: 'user@example.com' } });

		// Submit the form directly to ensure handler runs
		const form = container.querySelector('form');
		await fireEvent.submit(form!);

		await vi.waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent('Invalid email format');
		});
	});

	it('disables input during loading', async () => {
		const { auth } = await import('$lib/stores/auth.svelte');
		auth.__testing.setLoading(true);

		const { rerender } = render(MagicLinkForm);
		await rerender({});

		const input = screen.getByPlaceholderText('Enter your email');
		expect(input).toBeDisabled();
	});

	it('disables button during loading', async () => {
		const { auth } = await import('$lib/stores/auth.svelte');
		auth.__testing.setLoading(true);

		const { rerender } = render(MagicLinkForm);
		await rerender({});

		const button = screen.getByRole('button');
		expect(button).toBeDisabled();
		expect(button).toHaveTextContent('Sending...');
	});

	it('applies custom class', () => {
		const { container } = render(MagicLinkForm, { props: { class: 'custom-form' } });

		const form = container.querySelector('form');
		expect(form).toHaveClass('custom-form');
	});
});

describe('MagicLinkForm: Form Validation', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		const { auth } = await import('$lib/stores/auth.svelte');
		auth.__testing.setLoading(false);
	});

	it('does not call API for whitespace-only email', async () => {
		const { auth } = await import('$lib/stores/auth.svelte');

		const { container } = render(MagicLinkForm);

		const input = screen.getByPlaceholderText('Enter your email');
		await fireEvent.input(input, { target: { value: '   ' } });

		// Submit form directly to bypass HTML5 validation
		const form = container.querySelector('form');
		await fireEvent.submit(form!);

		await vi.waitFor(() => {
			expect(auth.signInWithEmail).not.toHaveBeenCalled();
			expect(screen.getByRole('alert')).toHaveTextContent('Please enter your email');
		});
	});

	it('clears error on new submission attempt', async () => {
		const { auth } = await import('$lib/stores/auth.svelte');
		(auth.signInWithEmail as ReturnType<typeof vi.fn>)
			.mockRejectedValueOnce(new Error('First error'))
			.mockResolvedValueOnce(undefined);

		const { container } = render(MagicLinkForm);

		const input = screen.getByPlaceholderText('Enter your email');
		const form = container.querySelector('form');

		// First submission fails
		await fireEvent.input(input, { target: { value: 'user@example.com' } });
		await fireEvent.submit(form!);

		await vi.waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent('First error');
		});

		// Second submission succeeds - error should be cleared (shows success)
		await fireEvent.submit(form!);

		await vi.waitFor(() => {
			// After success, the form is replaced with success message
			expect(screen.queryByRole('alert')).not.toBeInTheDocument();
		});
	});
});

describe('MagicLinkForm: Accessibility', () => {
	it('has no accessibility violations', async () => {
		const { container } = render(MagicLinkForm);

		const results = await axe(container);
		expect(results).toHaveNoViolations();
	});

	it('email input is required', () => {
		render(MagicLinkForm);

		const input = screen.getByPlaceholderText('Enter your email');
		expect(input).toHaveAttribute('required');
	});

	it('is keyboard navigable', async () => {
		const { auth } = await import('$lib/stores/auth.svelte');
		auth.__testing.setLoading(false);

		render(MagicLinkForm);

		const input = screen.getByPlaceholderText('Enter your email');
		const button = screen.getByRole('button');

		// Both elements should be focusable when not disabled
		expect(input).not.toBeDisabled();
		expect(button).not.toBeDisabled();

		input.focus();
		expect(document.activeElement).toBe(input);

		button.focus();
		expect(document.activeElement).toBe(button);
	});
});
