/**
 * UpdateRequiredBanner Component Tests
 */

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import UpdateRequiredBanner from '../UpdateRequiredBanner.svelte';

describe('UpdateRequiredBanner', () => {
	it('announces the reload without a retry action', () => {
		render(UpdateRequiredBanner, { props: { status: 'reloading', onRetry: vi.fn() } });

		expect(screen.getByRole('alert')).toHaveTextContent('Dicee was updated. Reloading…');
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	it('offers a retry while the update is still rolling out', async () => {
		const onRetry = vi.fn();
		render(UpdateRequiredBanner, { props: { status: 'updating', onRetry } });

		expect(screen.getByRole('alert')).toHaveTextContent(
			'Dicee is updating. Try again in a minute.',
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

		expect(onRetry).toHaveBeenCalledTimes(1);
	});
});
