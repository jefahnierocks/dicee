/**
 * AuthHeader Component Tests
 *
 * Tests for the auth header display component.
 * Note: Renamed from AuthStatus to avoid conflict with Hub's AuthStatusCard.
 */

import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import AuthHeader from '../AuthHeader.svelte';

// Create a mock auth state that can be controlled
const createMockAuth = (overrides = {}) => ({
	isAuthenticated: false,
	isAnonymous: false,
	user: null,
	email: null,
	loading: false,
	signOut: vi.fn().mockResolvedValue(undefined),
	...overrides,
});

let mockAuth = createMockAuth();

vi.mock('$lib/stores/auth.svelte', () => ({
	get auth() {
		return mockAuth;
	},
}));

describe('AuthHeader', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuth = createMockAuth();
	});

	it('does not render when not authenticated', () => {
		mockAuth = createMockAuth({ isAuthenticated: false });
		const { container } = render(AuthHeader);

		expect(container.querySelector('.auth-status')).not.toBeInTheDocument();
	});

	it('renders when authenticated', () => {
		mockAuth = createMockAuth({
			isAuthenticated: true,
			user: { id: '123' },
		});
		render(AuthHeader);

		expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
	});

	it('shows Guest badge for anonymous users', () => {
		mockAuth = createMockAuth({
			isAuthenticated: true,
			isAnonymous: true,
			user: { id: '123', is_anonymous: true },
		});
		render(AuthHeader);

		expect(screen.getByText('Guest')).toBeInTheDocument();
	});

	it('does not expose an email prefix for authenticated users', () => {
		mockAuth = createMockAuth({
			isAuthenticated: true,
			isAnonymous: false,
			user: { id: '123', email: 'user@example.com' },
			email: 'user@example.com',
		});
		render(AuthHeader);

		expect(screen.getByText('Player-123')).toBeInTheDocument();
	});

	it('shows a neutral fallback when no display name is set', () => {
		mockAuth = createMockAuth({
			isAuthenticated: true,
			isAnonymous: false,
			user: { id: '123' },
			email: null,
		});
		render(AuthHeader);

		expect(screen.getByText('Player-123')).toBeInTheDocument();
	});
});

describe('AuthHeader: Sign Out', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('calls signOut on button click', async () => {
		mockAuth = createMockAuth({
			isAuthenticated: true,
			user: { id: '123' },
		});
		render(AuthHeader);

		const button = screen.getByRole('button', { name: 'Sign Out' });
		await fireEvent.click(button);

		expect(mockAuth.signOut).toHaveBeenCalledOnce();
	});

	it('shows loading state during sign out', async () => {
		mockAuth = createMockAuth({
			isAuthenticated: true,
			user: { id: '123' },
			signOut: vi.fn().mockImplementation(
				() =>
					new Promise((resolve) => {
						setTimeout(resolve, 100);
					}),
			),
		});
		render(AuthHeader);

		const button = screen.getByRole('button', { name: 'Sign Out' });
		fireEvent.click(button);

		await vi.waitFor(() => {
			expect(screen.getByRole('button')).toHaveTextContent('...');
			expect(screen.getByRole('button')).toBeDisabled();
			expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
		});
	});

	it('handles sign out error gracefully', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
			/* Suppress console output in tests */
		});
		mockAuth = createMockAuth({
			isAuthenticated: true,
			user: { id: '123' },
			signOut: vi.fn().mockRejectedValue(new Error('Network error')),
		});
		render(AuthHeader);

		const button = screen.getByRole('button', { name: 'Sign Out' });
		await fireEvent.click(button);

		await vi.waitFor(() => {
			expect(consoleError).toHaveBeenCalled();
		});

		// Button should recover from loading state
		expect(screen.getByRole('button', { name: 'Sign Out' })).not.toBeDisabled();

		consoleError.mockRestore();
	});
});

describe('AuthHeader: Styling', () => {
	beforeEach(() => {
		mockAuth = createMockAuth({
			isAuthenticated: true,
			user: { id: '123' },
		});
	});

	it('applies custom class', () => {
		const { container } = render(AuthHeader, { props: { class: 'header-auth' } });

		const status = container.querySelector('.auth-status');
		expect(status).toHaveClass('header-auth');
	});

	it('guest badge has appropriate styling class', () => {
		mockAuth = createMockAuth({
			isAuthenticated: true,
			isAnonymous: true,
			user: { id: '123', is_anonymous: true },
		});
		const { container } = render(AuthHeader);

		expect(container.querySelector('.guest-badge')).toBeInTheDocument();
	});

	it('user name has appropriate styling class', () => {
		mockAuth = createMockAuth({
			isAuthenticated: true,
			isAnonymous: false,
			user: { id: '123', email: 'user@example.com' },
			email: 'user@example.com',
		});
		const { container } = render(AuthHeader);

		expect(container.querySelector('.user-name')).toBeInTheDocument();
	});
});

describe('AuthHeader: Accessibility', () => {
	beforeEach(() => {
		mockAuth = createMockAuth({
			isAuthenticated: true,
			user: { id: '123' },
		});
	});

	it('has no accessibility violations', async () => {
		const { container } = render(AuthHeader);

		const results = await axe(container);
		expect(results).toHaveNoViolations();
	});

	it('sign out button is keyboard accessible', () => {
		render(AuthHeader);

		const button = screen.getByRole('button', { name: 'Sign Out' });
		button.focus();
		expect(document.activeElement).toBe(button);
	});

	it('aria-busy is false when not signing out', () => {
		render(AuthHeader);

		const button = screen.getByRole('button');
		expect(button).toHaveAttribute('aria-busy', 'false');
	});
});

describe('AuthHeader: Display Name Derivation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('ignores an email when deriving the public display name', () => {
		mockAuth = createMockAuth({
			isAuthenticated: true,
			isAnonymous: false,
			user: { id: '123', email: 'user@example.com' },
			email: 'user@example.com',
		});
		render(AuthHeader);

		expect(screen.getByText('Player-123')).toBeInTheDocument();
	});

	it('ignores malformed email identity data', () => {
		mockAuth = createMockAuth({
			isAuthenticated: true,
			isAnonymous: false,
			user: { id: '123', email: 'weird@@example.com' },
			email: 'weird@@example.com',
		});
		render(AuthHeader);

		expect(screen.getByText('Player-123')).toBeInTheDocument();
	});
});
