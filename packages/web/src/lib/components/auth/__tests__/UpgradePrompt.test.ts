/**
 * UpgradePrompt Component Tests
 *
 * Tests for the anonymous user upgrade prompt modal.
 */

import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import UpgradePrompt from '../UpgradePrompt.svelte';

// Mock the auth store
vi.mock('$lib/stores/auth.svelte', () => ({
	auth: {
		loading: false,
		isAnonymous: true,
		signInWithGoogle: vi.fn().mockResolvedValue(undefined),
		linkGoogle: vi.fn().mockResolvedValue(undefined),
		linkEmail: vi.fn().mockResolvedValue(undefined),
	},
}));

describe('UpgradePrompt', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders with default title and message', () => {
		render(UpgradePrompt);

		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByText('Keep Your Progress')).toBeInTheDocument();
		expect(
			screen.getByText('Sign in to save your stats across devices and appear on leaderboards.'),
		).toBeInTheDocument();
	});

	it('renders with custom title and message', () => {
		render(UpgradePrompt, {
			props: {
				title: 'Custom Title',
				message: 'Custom message text',
			},
		});

		expect(screen.getByText('Custom Title')).toBeInTheDocument();
		expect(screen.getByText('Custom message text')).toBeInTheDocument();
	});

	it('has accessible dialog role with labeled title', () => {
		render(UpgradePrompt);

		const dialog = screen.getByRole('dialog');
		expect(dialog).toHaveAttribute('aria-labelledby', 'upgrade-title');
	});

	it('displays Google button in link mode', () => {
		render(UpgradePrompt);

		// GoogleButton should be rendered with mode="link"
		expect(screen.getByText('Link Google Account')).toBeInTheDocument();
	});

	it('shows email option button initially', () => {
		render(UpgradePrompt);

		expect(screen.getByRole('button', { name: 'Use Email Instead' })).toBeInTheDocument();
	});

	it('switches to email form when clicking email option', async () => {
		render(UpgradePrompt);

		const emailOptionButton = screen.getByRole('button', { name: 'Use Email Instead' });
		await fireEvent.click(emailOptionButton);

		// Should now show the MagicLinkForm with link mode
		expect(screen.getByRole('button', { name: 'Link Email' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Back to options' })).toBeInTheDocument();
	});

	it('switches back from email form to options', async () => {
		render(UpgradePrompt);

		// Click to show email form
		const emailOptionButton = screen.getByRole('button', { name: 'Use Email Instead' });
		await fireEvent.click(emailOptionButton);

		// Click back button
		const backButton = screen.getByRole('button', { name: 'Back to options' });
		await fireEvent.click(backButton);

		// Should show email option button again
		expect(screen.getByRole('button', { name: 'Use Email Instead' })).toBeInTheDocument();
	});
});

describe('UpgradePrompt: Close Functionality', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('shows close button when onClose is provided', () => {
		const onClose = vi.fn();
		render(UpgradePrompt, { props: { onClose } });

		expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
	});

	it('does not show close button when onClose is not provided', () => {
		render(UpgradePrompt);

		expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
	});

	it('calls onClose when close button is clicked', async () => {
		const onClose = vi.fn();
		render(UpgradePrompt, { props: { onClose } });

		const closeButton = screen.getByRole('button', { name: 'Close' });
		await fireEvent.click(closeButton);

		expect(onClose).toHaveBeenCalledOnce();
	});

	it('shows Maybe Later button when onClose is provided', () => {
		const onClose = vi.fn();
		render(UpgradePrompt, { props: { onClose } });

		expect(screen.getByRole('button', { name: 'Maybe Later' })).toBeInTheDocument();
	});

	it('does not show Maybe Later button when onClose is not provided', () => {
		render(UpgradePrompt);

		expect(screen.queryByRole('button', { name: 'Maybe Later' })).not.toBeInTheDocument();
	});

	it('calls onClose when Maybe Later is clicked', async () => {
		const onClose = vi.fn();
		render(UpgradePrompt, { props: { onClose } });

		const maybeLaterButton = screen.getByRole('button', { name: 'Maybe Later' });
		await fireEvent.click(maybeLaterButton);

		expect(onClose).toHaveBeenCalledOnce();
	});
});

describe('UpgradePrompt: Email Linking', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('can submit email in link mode', async () => {
		const { auth } = await import('$lib/stores/auth.svelte');

		render(UpgradePrompt);

		// Click to show email form
		const emailOptionButton = screen.getByRole('button', { name: 'Use Email Instead' });
		await fireEvent.click(emailOptionButton);

		// Enter email and submit
		const input = screen.getByPlaceholderText('user@example.com');
		await fireEvent.input(input, { target: { value: 'user@example.com' } });

		const submitButton = screen.getByRole('button', { name: 'Link Email' });
		await fireEvent.click(submitButton);

		expect(auth.linkEmail).toHaveBeenCalledWith('user@example.com');
	});
});

describe('UpgradePrompt: Styling', () => {
	it('applies custom class', () => {
		const { container } = render(UpgradePrompt, { props: { class: 'custom-prompt' } });

		const dialog = container.querySelector('.upgrade-prompt');
		expect(dialog).toHaveClass('custom-prompt');
	});

	it('has divider between Google and email options', () => {
		const { container } = render(UpgradePrompt);

		// Check for divider with "or" text
		expect(screen.getByText('or')).toBeInTheDocument();
		expect(container.querySelector('.divider')).toBeInTheDocument();
	});
});

describe('UpgradePrompt: Accessibility', () => {
	it('has no accessibility violations', async () => {
		const { container } = render(UpgradePrompt, { props: { onClose: vi.fn() } });

		const results = await axe(container);
		expect(results).toHaveNoViolations();
	});

	it('close button has accessible label', () => {
		render(UpgradePrompt, { props: { onClose: vi.fn() } });

		const closeButton = screen.getByRole('button', { name: 'Close' });
		expect(closeButton).toHaveAttribute('aria-label', 'Close');
	});

	it('SVG icons are hidden from accessibility tree', () => {
		render(UpgradePrompt, { props: { onClose: vi.fn() } });

		const closeButton = screen.getByRole('button', { name: 'Close' });
		const svg = closeButton.querySelector('svg');
		expect(svg).toHaveAttribute('aria-hidden', 'true');
	});
});
