/**
 * State Snapshot Service
 *
 * Captures serializable application state for bug reports.
 * UPDATED based on Investigation 2 findings (Jan 4, 2026):
 * - Uses existing dice.toJSON() method
 * - Uses correct store access patterns
 * - Uses validated property names
 */

import { browser } from '$app/environment';
import { roomService } from '$lib/services/roomService.svelte';
import { auth } from '$lib/stores/auth.svelte';
import { game } from '$lib/stores/game.svelte';

export interface GameStateSnapshot {
	// From game store (class-based singleton)
	status: 'idle' | 'rolling' | 'keeping' | 'scoring' | 'completed';
	turnNumber: number;
	rollNumber: number;
	phase: 'pre_roll' | 'rolling' | 'deciding' | 'scored';
	rollsRemaining: number;
	isGameActive: boolean;
	isGameOver: boolean;
	canRoll: boolean;
	canScore: boolean;

	// From dice store - REUSE existing toJSON()!
	dice: {
		values: [number, number, number, number, number];
		kept: [boolean, boolean, boolean, boolean, boolean];
	};

	// From scorecard (via game.scorecard)
	scorecardComplete: boolean;
	grandTotal: number;
	categoriesRemaining: string[];
}

export interface ConnectionStateSnapshot {
	// Room store is context-based, may not be available
	roomConnected: boolean;
	roomCode: string | null;
	isHost: boolean;
	playerCount: number;
}

export interface UIStateSnapshot {
	activeRoute: string;
	viewportWidth: number;
	viewportHeight: number;
	devicePixelRatio: number;
	// Keyboard detection (mobile)
	keyboardVisible: boolean;
}

export interface UserContextSnapshot {
	isAuthenticated: boolean;
	isAnonymous: boolean;
}

export interface FullStateSnapshot {
	game: GameStateSnapshot;
	connection: ConnectionStateSnapshot;
	ui: UIStateSnapshot;
	user: UserContextSnapshot;
	timestamp: string;
}

export function captureStateSnapshot(): FullStateSnapshot {
	// Use roomService singleton directly (doesn't require Svelte context)
	// This allows bug reports to be submitted from any context, not just component initialization

	return {
		game: {
			status: game.status,
			turnNumber: game.turnNumber,
			rollNumber: game.rollNumber,
			phase: game.phase,
			rollsRemaining: game.rollsRemaining,
			isGameActive: game.isGameActive,
			isGameOver: game.isGameOver,
			canRoll: game.canRoll,
			canScore: game.canScore,
			// REUSE existing serialization!
			dice: game.dice.toJSON(),
			scorecardComplete: game.scorecard.isComplete,
			grandTotal: game.scorecard.grandTotal,
			categoriesRemaining: game.scorecard.categoriesRemaining,
		},
		connection: {
			roomConnected: roomService.isConnected,
			roomCode: roomService.roomCode,
			isHost: roomService.room?.hostId === auth.userId,
			playerCount:
				(roomService.room?.players.length ?? 0) + (roomService.room?.aiPlayers?.length ?? 0),
		},
		ui: {
			activeRoute: browser ? window.location.pathname : '',
			viewportWidth: browser ? window.innerWidth : 0,
			viewportHeight: browser ? window.innerHeight : 0,
			devicePixelRatio: browser ? window.devicePixelRatio : 1,
			// Heuristic: if viewport height < 50% of screen, keyboard likely visible
			keyboardVisible: browser ? window.innerHeight < window.screen.height * 0.5 : false,
		},
		user: {
			isAuthenticated: auth.isAuthenticated,
			isAnonymous: auth.isAnonymous,
		},
		timestamp: new Date().toISOString(),
	};
}
