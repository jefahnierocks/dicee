/**
 * Profile API Unit Tests
 *
 * Tests for profiles.ts - Profile CRUD operations
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '$lib/types/database';
import {
	createProfile,
	getProfile,
	getProfiles,
	type Profile,
	updateLastSeen,
	updateProfile,
} from '../profiles';

// =============================================================================
// Mock Data
// =============================================================================

const mockProfile: Profile = {
	id: 'test-user-id',
	username: 'testuser',
	display_name: 'Test User',
	bio: 'Test bio',
	avatar_seed: 'test-seed-123',
	avatar_style: 'identicon',
	skill_rating: 1500.0,
	rating_deviation: 350.0,
	rating_volatility: 0.06,
	badges: [],
	is_anonymous: false,
	is_public: true,
	preferences: null,
	role: 'user',
	created_at: '2024-01-01T00:00:00Z',
	updated_at: '2024-01-01T00:00:00Z',
	last_seen_at: '2024-01-01T00:00:00Z',
};

const mockProfiles: Profile[] = [
	mockProfile,
	{
		...mockProfile,
		id: 'test-user-id-2',
		username: 'testuser2',
		display_name: 'Test User 2',
	},
];

// =============================================================================
// Mock Supabase Client
// =============================================================================

function createMockSupabase() {
	const mockSelect = vi.fn().mockReturnThis();
	const mockEq = vi.fn().mockReturnThis();
	const mockIn = vi.fn().mockReturnThis();
	const mockSingle = vi.fn();
	const mockUpdate = vi.fn().mockReturnThis();
	const mockUpsert = vi.fn().mockReturnThis();
	const mockFrom = vi.fn().mockReturnValue({
		select: mockSelect,
		update: mockUpdate,
		upsert: mockUpsert,
	});

	return {
		from: mockFrom,
		__mocks: {
			from: mockFrom,
			select: mockSelect,
			eq: mockEq,
			in: mockIn,
			single: mockSingle,
			update: mockUpdate,
			upsert: mockUpsert,
		},
	} as unknown as SupabaseClient<Database> & {
		__mocks: {
			from: ReturnType<typeof vi.fn>;
			select: ReturnType<typeof vi.fn>;
			eq: ReturnType<typeof vi.fn>;
			in: ReturnType<typeof vi.fn>;
			single: ReturnType<typeof vi.fn>;
			update: ReturnType<typeof vi.fn>;
			upsert: ReturnType<typeof vi.fn>;
		};
	};
}

// =============================================================================
// getProfile Tests
// =============================================================================

describe('getProfile', () => {
	let mockSupabase: ReturnType<typeof createMockSupabase>;

	beforeEach(() => {
		mockSupabase = createMockSupabase();
	});

	it('fetches a profile successfully', async () => {
		mockSupabase.__mocks.select.mockReturnValue({
			eq: mockSupabase.__mocks.eq.mockReturnValue({
				single: mockSupabase.__mocks.single.mockResolvedValue({
					data: mockProfile,
					error: null,
				}),
			}),
		});

		const result = await getProfile(mockSupabase, 'test-user-id');

		expect(result.data).toEqual(mockProfile);
		expect(result.error).toBeNull();
		expect(mockSupabase.__mocks.from).toHaveBeenCalledWith('profiles');
		expect(mockSupabase.__mocks.select).toHaveBeenCalledWith('*');
		expect(mockSupabase.__mocks.eq).toHaveBeenCalledWith('id', 'test-user-id');
	});

	it('handles profile not found (PGRST116) - returns null without error', async () => {
		// PGRST116 = "No rows returned" - treated as "profile doesn't exist yet"
		// This supports the ProfileAutoCreationPattern where missing profiles are created on-demand
		const mockError = { message: 'Profile not found', code: 'PGRST116' };
		mockSupabase.__mocks.select.mockReturnValue({
			eq: mockSupabase.__mocks.eq.mockReturnValue({
				single: mockSupabase.__mocks.single.mockResolvedValue({
					data: null,
					error: mockError,
				}),
			}),
		});

		const result = await getProfile(mockSupabase, 'nonexistent-id');

		// PGRST116 is not treated as an error - just means profile doesn't exist
		expect(result.data).toBeNull();
		expect(result.error).toBeNull();
	});

	it('handles database errors', async () => {
		const mockError = { message: 'Database connection failed', code: 'CONNECTION_ERROR' };
		mockSupabase.__mocks.select.mockReturnValue({
			eq: mockSupabase.__mocks.eq.mockReturnValue({
				single: mockSupabase.__mocks.single.mockResolvedValue({
					data: null,
					error: mockError,
				}),
			}),
		});

		const result = await getProfile(mockSupabase, 'test-user-id');

		expect(result.data).toBeNull();
		expect(result.error).toBeInstanceOf(Error);
	});
});

// =============================================================================
// updateProfile Tests
// =============================================================================

describe('updateProfile', () => {
	let mockSupabase: ReturnType<typeof createMockSupabase>;

	beforeEach(() => {
		mockSupabase = createMockSupabase();
	});

	it('updates a profile successfully', async () => {
		const updates = { display_name: 'Updated Name', bio: 'Updated bio' };
		const updatedProfile = { ...mockProfile, ...updates };

		mockSupabase.__mocks.update.mockReturnValue({
			eq: mockSupabase.__mocks.eq.mockReturnValue({
				select: mockSupabase.__mocks.select.mockReturnValue({
					single: mockSupabase.__mocks.single.mockResolvedValue({
						data: updatedProfile,
						error: null,
					}),
				}),
			}),
		});

		const result = await updateProfile(mockSupabase, 'test-user-id', updates);

		expect(result.data).toEqual(updatedProfile);
		expect(result.error).toBeNull();
		expect(mockSupabase.__mocks.from).toHaveBeenCalledWith('profiles');
		expect(mockSupabase.__mocks.update).toHaveBeenCalledWith(updates);
		expect(mockSupabase.__mocks.eq).toHaveBeenCalledWith('id', 'test-user-id');
	});

	it('handles RLS policy violations', async () => {
		const mockError = { message: 'RLS policy violation', code: '42501' };
		mockSupabase.__mocks.update.mockReturnValue({
			eq: mockSupabase.__mocks.eq.mockReturnValue({
				select: mockSupabase.__mocks.select.mockReturnValue({
					single: mockSupabase.__mocks.single.mockResolvedValue({
						data: null,
						error: mockError,
					}),
				}),
			}),
		});

		const result = await updateProfile(mockSupabase, 'other-user-id', {
			display_name: 'Hacked',
		});

		expect(result.data).toBeNull();
		expect(result.error).toBeInstanceOf(Error);
		expect(result.error?.message).toBe('RLS policy violation');
	});

	it('allows partial updates', async () => {
		const updates = { bio: 'Just the bio' };
		const updatedProfile = { ...mockProfile, ...updates };

		mockSupabase.__mocks.update.mockReturnValue({
			eq: mockSupabase.__mocks.eq.mockReturnValue({
				select: mockSupabase.__mocks.select.mockReturnValue({
					single: mockSupabase.__mocks.single.mockResolvedValue({
						data: updatedProfile,
						error: null,
					}),
				}),
			}),
		});

		const result = await updateProfile(mockSupabase, 'test-user-id', updates);

		expect(result.data?.bio).toBe('Just the bio');
		expect(result.error).toBeNull();
	});
});

// =============================================================================
// createProfile Tests
// =============================================================================

describe('createProfile', () => {
	let mockSupabase: ReturnType<typeof createMockSupabase>;

	beforeEach(() => {
		mockSupabase = createMockSupabase();
	});

	function mockInsertResult(result: { data: Profile | null; error: unknown }) {
		const maybeSingle = vi.fn().mockResolvedValue(result);
		mockSupabase.__mocks.upsert.mockReturnValue({
			select: vi.fn().mockReturnValue({ maybeSingle }),
		});
		return maybeSingle;
	}

	it('inserts a new profile without overwriting existing rows', async () => {
		const maybeSingle = mockInsertResult({ data: mockProfile, error: null });

		const result = await createProfile(mockSupabase, 'test-user-id', {
			display_name: 'Test User',
		});

		expect(result.data).toEqual(mockProfile);
		expect(result.error).toBeNull();
		expect(mockSupabase.__mocks.from).toHaveBeenCalledWith('profiles');
		expect(mockSupabase.__mocks.upsert).toHaveBeenCalledWith(
			{ id: 'test-user-id', display_name: 'Test User' },
			{ onConflict: 'id', ignoreDuplicates: true },
		);
		expect(maybeSingle).toHaveBeenCalledOnce();
	});

	it('never sends server-managed columns', async () => {
		mockInsertResult({ data: mockProfile, error: null });

		await createProfile(mockSupabase, 'test-user-id', {
			id: 'someone-else',
			display_name: null,
			is_anonymous: false,
			is_public: false,
			role: 'super_admin',
			skill_rating: 9999,
			badges: ['forged'],
		});

		expect(mockSupabase.__mocks.upsert).toHaveBeenCalledWith(
			{ id: 'test-user-id', display_name: null, is_public: false },
			{ onConflict: 'id', ignoreDuplicates: true },
		);
	});

	it('returns the existing profile unchanged when the insert is ignored', async () => {
		mockInsertResult({ data: null, error: null });
		mockSupabase.__mocks.select.mockReturnValue({
			eq: mockSupabase.__mocks.eq.mockReturnValue({
				single: mockSupabase.__mocks.single.mockResolvedValue({
					data: mockProfile,
					error: null,
				}),
			}),
		});

		const result = await createProfile(mockSupabase, 'test-user-id', {
			display_name: 'Ignored Name',
		});

		expect(result.data).toEqual(mockProfile);
		expect(result.error).toBeNull();
		expect(mockSupabase.__mocks.select).toHaveBeenCalledWith('*');
		expect(mockSupabase.__mocks.eq).toHaveBeenCalledWith('id', 'test-user-id');
		expect(mockSupabase.__mocks.update).not.toHaveBeenCalled();
	});

	it('creates profile with minimal data', async () => {
		const minimalProfile = {
			...mockProfile,
			display_name: null,
			bio: null,
			username: null,
		};
		mockInsertResult({ data: minimalProfile, error: null });

		const result = await createProfile(mockSupabase, 'test-user-id');

		expect(result.data).toEqual(minimalProfile);
		expect(result.error).toBeNull();
		expect(mockSupabase.__mocks.upsert).toHaveBeenCalledWith(
			{ id: 'test-user-id' },
			{ onConflict: 'id', ignoreDuplicates: true },
		);
	});

	it('returns insert errors', async () => {
		mockInsertResult({
			data: null,
			error: { message: 'permission denied for table profiles', code: '42501' },
		});

		const result = await createProfile(mockSupabase, 'test-user-id');

		expect(result.data).toBeNull();
		expect(result.error).toBeInstanceOf(Error);
		expect(result.error?.message).toBe('permission denied for table profiles');
	});
});

// =============================================================================
// getProfiles Tests
// =============================================================================

describe('getProfiles', () => {
	let mockSupabase: ReturnType<typeof createMockSupabase>;

	beforeEach(() => {
		mockSupabase = createMockSupabase();
	});

	it('fetches multiple profiles', async () => {
		mockSupabase.__mocks.select.mockReturnValue({
			in: mockSupabase.__mocks.in.mockResolvedValue({
				data: mockProfiles,
				error: null,
			}),
		});

		const result = await getProfiles(mockSupabase, ['test-user-id', 'test-user-id-2']);

		expect(result.data).toEqual(mockProfiles);
		expect(result.error).toBeNull();
		expect(mockSupabase.__mocks.from).toHaveBeenCalledWith('profiles');
		expect(mockSupabase.__mocks.select).toHaveBeenCalledWith('*');
		expect(mockSupabase.__mocks.in).toHaveBeenCalledWith('id', ['test-user-id', 'test-user-id-2']);
	});

	it('returns empty array for no matches', async () => {
		mockSupabase.__mocks.select.mockReturnValue({
			in: mockSupabase.__mocks.in.mockResolvedValue({
				data: [],
				error: null,
			}),
		});

		const result = await getProfiles(mockSupabase, ['nonexistent-1', 'nonexistent-2']);

		expect(result.data).toEqual([]);
		expect(result.error).toBeNull();
	});

	it('handles database errors', async () => {
		const mockError = { message: 'Database error', code: 'ERROR' };
		mockSupabase.__mocks.select.mockReturnValue({
			in: mockSupabase.__mocks.in.mockResolvedValue({
				data: null,
				error: mockError,
			}),
		});

		const result = await getProfiles(mockSupabase, ['test-user-id']);

		expect(result.data).toBeNull();
		expect(result.error).toBeInstanceOf(Error);
	});
});

// =============================================================================
// updateLastSeen Tests
// =============================================================================

describe('updateLastSeen', () => {
	let mockSupabase: ReturnType<typeof createMockSupabase>;

	beforeEach(() => {
		mockSupabase = createMockSupabase();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('updates last_seen_at timestamp', async () => {
		const now = new Date('2024-01-15T12:00:00Z');
		vi.setSystemTime(now);

		mockSupabase.__mocks.update.mockReturnValue({
			eq: mockSupabase.__mocks.eq.mockResolvedValue({
				error: null,
			}),
		});

		const result = await updateLastSeen(mockSupabase, 'test-user-id');

		expect(result.error).toBeNull();
		expect(mockSupabase.__mocks.from).toHaveBeenCalledWith('profiles');
		expect(mockSupabase.__mocks.update).toHaveBeenCalledWith({
			last_seen_at: now.toISOString(),
		});
		expect(mockSupabase.__mocks.eq).toHaveBeenCalledWith('id', 'test-user-id');
	});

	it('handles update errors', async () => {
		const mockError = { message: 'Update failed', code: 'ERROR' };
		mockSupabase.__mocks.update.mockReturnValue({
			eq: mockSupabase.__mocks.eq.mockResolvedValue({
				error: mockError,
			}),
		});

		const result = await updateLastSeen(mockSupabase, 'test-user-id');

		expect(result.error).toBeInstanceOf(Error);
		expect(result.error?.message).toBe('Update failed');
	});
});
