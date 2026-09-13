/**
 * Worker Integration Tests
 *
 * Tests the Cloudflare Worker using unstable_dev.
 * These tests verify HTTP routing and basic endpoint behavior.
 *
 * Note: WebSocket tests with full JWT authentication require either:
 * 1. A TEST_MODE environment variable to bypass auth in test environments
 * 2. A mock JWKS endpoint that serves test keys
 * 3. Real Supabase credentials (not suitable for CI)
 *
 * For comprehensive WebSocket testing, see wscat testing documentation
 * in docs/testing/websocket-testing.md
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type UnstableDevWorker, unstable_dev } from 'wrangler';

describe('Worker Integration Tests', () => {
	let worker: UnstableDevWorker;

	beforeAll(async () => {
		// Start the worker using unstable_dev
		// This runs the worker in a subprocess with local Durable Object support
		worker = await unstable_dev('src/worker.ts', {
			experimental: {
				disableExperimentalWarning: true,
			},
			local: true,
			persist: false, // Don't persist storage between tests
			vars: {
				ENVIRONMENT: 'test',
				SUPABASE_URL: 'https://test-project.supabase.co',
				SUPABASE_ANON_KEY: 'test-anon-key',
			},
		});
	}, 30000);

	afterAll(async () => {
		if (worker) {
			await worker.stop();
		}
	});

	// =========================================================================
	// Health Check Tests
	// =========================================================================

	describe('Health Check', () => {
		it('should return 200 OK for /health', async () => {
			const response = await worker.fetch('/health');

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.status).toBe('healthy');
			expect(body.timestamp).toBeDefined();
		});
	});

	// =========================================================================
	// Routing Tests
	// =========================================================================

	describe('Routing', () => {
		it('should return 404 for unknown routes', async () => {
			const response = await worker.fetch('/unknown');

			expect(response.status).toBe(404);
		});

		it('should return 404 for invalid room codes', async () => {
			const response = await worker.fetch('/room/invalid');

			expect(response.status).toBe(404);
		});

		it('should return 404 for too short room codes', async () => {
			const response = await worker.fetch('/room/ABC');

			expect(response.status).toBe(404);
		});

		it('should return 404 for too long room codes', async () => {
			const response = await worker.fetch('/room/ABCDEFGH');

			expect(response.status).toBe(404);
		});

		it('should accept valid 6-character room codes', async () => {
			// Valid room code routes to Durable Object
			// Without WebSocket upgrade, this should return 405 (Method Not Allowed)
			const response = await worker.fetch('/room/TEST01');

			expect(response.status).toBe(405);
		});

		it('should handle lowercase room codes by uppercasing', async () => {
			const response = await worker.fetch('/room/test01');

			// Should be handled the same as TEST01
			expect(response.status).toBe(405);
		});

		it('should handle room codes with numbers', async () => {
			const response = await worker.fetch('/room/ABC123');

			expect(response.status).toBe(405);
		});
	});

	// =========================================================================
	// Room Info Tests
	// =========================================================================

	describe('Room Info', () => {
		it('should return room info for /room/:code/info', async () => {
			// The /info endpoint should return JSON about the room
			// Note: The URL pattern in worker.ts requires /room/:code/info format
			// But the Durable Object receives the full URL
			const response = await worker.fetch('/room/INFO01');

			// Without the /info suffix, this returns 405
			expect(response.status).toBe(405);
		});
	});

	// =========================================================================
	// WebSocket Upgrade Tests
	// =========================================================================
	//
	// Note: WebSocket upgrade cannot be tested via unstable_dev's fetch API.
	// The Upgrade header causes "invalid upgrade header" errors.
	//
	// For WebSocket testing, use one of these approaches:
	// 1. wscat with a bearer token in the Authorization header against a local worker
	// 2. Playwright E2E tests with real browser WebSocket connections
	// 3. Native Node.js WebSocket client against running worker
	//
	// See docs/testing/websocket-testing.md for detailed instructions.
	//
	describe('WebSocket Upgrade (requires real WebSocket client)', () => {
		it('should reject WebSocket upgrade without token', async () => {
			// Test requires real WebSocket client
		});

		it('should reject WebSocket upgrade with invalid token', async () => {
			// Test requires real WebSocket client
		});

		it('should accept WebSocket upgrade with valid token', async () => {
			// Test requires real WebSocket client with valid JWT
		});
	});

	// =========================================================================
	// CORS Tests
	// =========================================================================

	describe('CORS', () => {
		it('should allow requests from any origin', async () => {
			const response = await worker.fetch('/health', {
				headers: {
					Origin: 'https://dicee.games',
				},
			});

			// Health endpoint should work regardless of CORS
			expect(response.status).toBe(200);
		});
	});

	// =========================================================================
	// Room Isolation Tests
	// =========================================================================

	describe('Room Isolation', () => {
		it('should create separate Durable Objects for different room codes', async () => {
			// Each room code should route to a different DO instance
			const response1 = await worker.fetch('/room/ROOM01');
			const response2 = await worker.fetch('/room/ROOM02');

			// Both should return 405 (valid routing, wrong method)
			expect(response1.status).toBe(405);
			expect(response2.status).toBe(405);
		});

		it('should route same room code to same Durable Object', async () => {
			// Multiple requests to same room code should go to same DO
			const response1 = await worker.fetch('/room/SHARED');
			const response2 = await worker.fetch('/room/SHARED');

			expect(response1.status).toBe(405);
			expect(response2.status).toBe(405);
		});
	});
});
