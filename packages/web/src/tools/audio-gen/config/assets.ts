/**
 * Dicee Audio Asset Registry
 *
 * Complete definition of all audio assets for the Dicee game.
 * @see packages/web/src/tools/audio-gen/README.md#audio-plan
 *
 * Asset ID Format:
 *   MVP-XX  = Phase 1 MVP assets
 *   PHY-XX  = Physical/dice sounds
 *   UI-XX   = UI interaction sounds
 *   SCR-XX  = Score feedback sounds
 *   EVT-XX  = Game event sounds
 *   MUS-XX  = Music layers
 *   AMB-XX  = Ambient sounds
 */

import type { AssetRegistry, AudioAsset } from '../schema/index.js';

// =============================================================================
// Phase 1: MVP Assets ($20 budget)
// =============================================================================

const mvpAssets: AudioAsset[] = [
	{
		id: 'MVP-01',
		filename: 'dice_roll_heavy',
		category: 'dice',
		phase: 'mvp',
		description:
			'5 resin dice shaken in leather cup, spilled onto felt-lined wooden tray. Heavy initial impact, woody clatter, 1.2s settle.',
		prompt:
			'wooden dice rolling on felt table, satisfying clatter, warm tone, 5 dice, leather cup spill, settling sound',
		durationSeconds: 1.5,
		channels: 'mono',
		preload: true,
		defaultVolume: 0.7,
	},
	{
		id: 'MVP-02',
		filename: 'dice_roll_light',
		category: 'dice',
		phase: 'mvp',
		description: '1-2 dice, lighter texture. Single click-clack-stop. Intimate.',
		prompt: 'single wooden die rolling, soft felt surface, brief, intimate, gentle clatter',
		durationSeconds: 0.6,
		channels: 'mono',
		preload: true,
		defaultVolume: 0.6,
	},
	{
		id: 'MVP-03',
		filename: 'dice_select',
		category: 'dice',
		phase: 'mvp',
		description: 'Soft satisfying thock. Mechanical keyboard with O-rings feel. 100ms.',
		// API minimum is 0.5s - the click happens in first ~50ms, rest is silence
		prompt:
			'single soft wooden tap, satisfying click, muted, mechanical keyboard feel, very short, immediate stop',
		durationSeconds: 0.5,
		channels: 'mono',
		preload: true,
		defaultVolume: 0.3,
	},
	{
		id: 'MVP-04',
		filename: 'score_positive',
		category: 'score',
		phase: 'mvp',
		description: 'Two-note ascending arpeggio (C→E). Marimba or Kalimba. Warm, dry.',
		prompt: 'marimba two notes ascending, gentle, warm, C to E, positive feedback',
		durationSeconds: 0.5,
		channels: 'mono',
		preload: true,
		defaultVolume: 0.4,
	},
	{
		id: 'MVP-05',
		filename: 'score_negative',
		category: 'score',
		phase: 'mvp',
		description: 'Descending two-note (E→C#). Not harsh—a musical sigh. Muted.',
		prompt: 'kalimba descending notes, melancholic, soft, E to C sharp, gentle disappointment',
		durationSeconds: 0.5,
		channels: 'mono',
		preload: true,
		defaultVolume: 0.35,
	},
	{
		id: 'MVP-06',
		filename: 'dicee_fanfare',
		category: 'score',
		phase: 'mvp',
		description:
			'THE HERO SOUND. Five-of-a-kind celebration. Harp gliss + shimmering chord. Must cut through everything. 2-3s.',
		prompt:
			'triumphant fanfare, harp glissando, magical shimmer, celebration, five of a kind jackpot, joyful, sparkling',
		durationSeconds: 2.5,
		channels: 'stereo',
		preload: true,
		defaultVolume: 0.8,
		// promptInfluence removed - API expects float, not string
	},
	{
		id: 'MVP-07',
		filename: 'turn_start',
		category: 'ui',
		phase: 'mvp',
		description:
			'Clear gentle chime. Tibetan singing bowl or Rhodes Major 7th. Inviting, not alarming. 1.5s tail.',
		prompt: 'gentle bell chime, tibetan bowl, warm resonance, inviting, major seventh chord',
		durationSeconds: 1.8,
		channels: 'mono',
		preload: true,
		defaultVolume: 0.3,
	},
	{
		id: 'MVP-08',
		filename: 'ambient_base',
		category: 'ambient',
		phase: 'mvp',
		description:
			'Barely-there room warmth. NOT air conditioning hum. Subtle, subliminal. 30s seamless loop.',
		prompt:
			'subtle ambient room tone, warm, barely audible, no hum, cozy atmosphere, soft presence, seamless loop',
		durationSeconds: 30,
		looping: true,
		channels: 'stereo',
		defaultVolume: 0.15,
		postProcessing: 'Ensure seamless loop point, normalize to -12dB',
	},
];

// =============================================================================
// Phase 2: Complete Audio ($30 budget)
// =============================================================================

const phase2Assets: AudioAsset[] = [
	// Dice variations
	{
		id: 'PHY-02',
		filename: 'dice_roll_heavy_alt1',
		category: 'dice',
		phase: 'complete',
		description: 'Variation of MVP-01. Longer settle, one die spins before dropping.',
		prompt:
			'wooden dice rolling on felt, satisfying clatter, one die spinning longer, extended settle, warm tone',
		durationSeconds: 1.8,
		channels: 'mono',
		defaultVolume: 0.7,
	},
	{
		id: 'PHY-03',
		filename: 'dice_roll_heavy_alt2',
		category: 'dice',
		phase: 'complete',
		description: 'Variation of MVP-01. Tighter, quicker throw. More decisive.',
		prompt:
			'wooden dice quick roll on felt, decisive throw, tight clatter, confident, brief settle',
		durationSeconds: 1.0,
		channels: 'mono',
		defaultVolume: 0.7,
	},
	{
		id: 'PHY-04',
		filename: 'dice_roll_medium',
		category: 'dice',
		phase: 'complete',
		description: '2-3 dice throw. Distinct separation between impacts. Less bass than heavy.',
		prompt:
			'two or three wooden dice rolling, distinct impacts, medium weight, felt surface, clear separation',
		durationSeconds: 1.0,
		channels: 'mono',
		defaultVolume: 0.65,
	},
	{
		id: 'PHY-05',
		filename: 'dice_deselect',
		category: 'dice',
		phase: 'complete',
		description: 'Release die. Similar to select but higher pitch, lighter attack.',
		// API minimum is 0.5s - the click happens in first ~50ms, rest is silence
		prompt:
			'soft wooden release tap, higher pitch, light attack, gentle unclick, very short, immediate stop',
		durationSeconds: 0.5,
		channels: 'mono',
		defaultVolume: 0.25,
	},

	// UI sounds
	{
		id: 'UI-01',
		filename: 'btn_hover',
		category: 'ui',
		phase: 'complete',
		description: 'Subtle fabric swoosh. Almost subliminal. -18dB, high-cut filter.',
		// API minimum is 0.5s - the swoosh is instant, rest is silence
		prompt:
			'subtle fabric swoosh, very soft, almost subliminal, gentle brush, very short, immediate stop',
		durationSeconds: 0.5,
		channels: 'mono',
		defaultVolume: 0.15,
		postProcessing: 'Apply high-cut filter at 4kHz, normalize to -18dB',
	},
	{
		id: 'UI-02',
		filename: 'btn_click',
		category: 'ui',
		phase: 'complete',
		description: 'Crisp wooden snap. Like snapping a dry twig or clicking quality pen.',
		// API minimum is 0.5s - the click is instant, rest is silence
		prompt:
			'crisp wooden snap, quality pen click, dry twig snap, satisfying, very short, immediate stop',
		durationSeconds: 0.5,
		channels: 'mono',
		defaultVolume: 0.25,
	},
	{
		id: 'UI-03',
		filename: 'ui_error',
		category: 'ui',
		phase: 'complete',
		description: 'Dull wooden thud. Says "no" without saying "WRONG!" Pitched-down click.',
		// API minimum is 0.5s - the thud is instant, rest is silence
		prompt:
			'dull wooden thud, low pitch, gentle rejection, not harsh, muted bump, very short, immediate stop',
		durationSeconds: 0.5,
		channels: 'mono',
		defaultVolume: 0.3,
	},
	{
		id: 'UI-04',
		filename: 'timer_tick',
		category: 'ui',
		phase: 'complete',
		description: 'Soft wooden clock tick. 60 BPM or 120 BPM synced.',
		// API minimum is 0.5s - the tick is instant, rest is silence
		prompt: 'soft wooden clock tick, gentle, warm, analog clock feel, single tick, immediate stop',
		durationSeconds: 0.5,
		channels: 'mono',
		defaultVolume: 0.2,
	},

	// Score sounds
	{
		id: 'SCR-01',
		filename: 'score_good',
		category: 'score',
		phase: 'complete',
		description: 'Three-note C Major chord. Marimba + light sparkle/glockenspiel.',
		prompt: 'marimba C major chord, three notes, light glockenspiel sparkle, celebratory, warm',
		durationSeconds: 0.8,
		channels: 'mono',
		defaultVolume: 0.5,
	},
	{
		id: 'SCR-02',
		filename: 'score_zero',
		category: 'score',
		phase: 'complete',
		description: 'Hollow wood block + low "wump." Finality without harshness.',
		prompt: 'hollow wood block hit, low wump, finality, not harsh, muted, accepting',
		durationSeconds: 0.4,
		channels: 'mono',
		defaultVolume: 0.35,
	},
	{
		id: 'SCR-03',
		filename: 'upper_bonus',
		category: 'score',
		phase: 'complete',
		description: 'Warm enveloping wash. Acoustic guitar G Major strum + synth swell. 3s.',
		prompt:
			'acoustic guitar G major strum, warm synth swell, enveloping, achievement unlocked, satisfying, 3 seconds',
		durationSeconds: 3.0,
		channels: 'stereo',
		defaultVolume: 0.5,
	},
	{
		id: 'SCR-04',
		filename: 'bonus_dicee',
		category: 'score',
		phase: 'complete',
		description: '100pt bonus. Callback to main Dicee + extra shimmer layer.',
		prompt:
			'bonus fanfare, extra shimmer layer, magical sparkle, 100 point bonus, builds on main celebration',
		durationSeconds: 2.0,
		channels: 'stereo',
		defaultVolume: 0.7,
	},

	// Game events
	{
		id: 'EVT-01',
		filename: 'game_win',
		category: 'score',
		phase: 'complete',
		description: 'Triumphant 4-6s phrase. Acoustic guitar + piano. Celebratory, not obnoxious.',
		prompt:
			'triumphant victory music, acoustic guitar and piano, celebratory phrase, warm, satisfying conclusion, 5 seconds',
		durationSeconds: 5.0,
		channels: 'stereo',
		defaultVolume: 0.6,
	},
	{
		id: 'EVT-02',
		filename: 'game_loss',
		category: 'score',
		phase: 'complete',
		description: 'Respectful, reflective. Solo piano, slower tempo. "Good game, try again."',
		prompt:
			'respectful game over, solo piano, reflective, slower tempo, encouraging, good game feel, 4 seconds',
		durationSeconds: 4.0,
		channels: 'stereo',
		defaultVolume: 0.5,
	},

	// Music layers
	{
		id: 'MUS-01',
		filename: 'music_layer_calm',
		category: 'music',
		phase: 'complete',
		description:
			'Layer 1: Slow drifting pads. Rhodes chord every 4 bars. 80 BPM, C Major. 60s loop.',
		prompt:
			'lo-fi ambient, slow drifting pads, Rhodes piano chord every 4 bars, 80 BPM, C major, cozy, warm, instrumental, seamless loop',
		durationSeconds: 60,
		looping: true,
		channels: 'stereo',
		defaultVolume: 0.25,
		postProcessing: 'Ensure seamless loop, normalize to -9dB',
	},
	{
		id: 'MUS-02',
		filename: 'music_layer_activity',
		category: 'music',
		phase: 'complete',
		description:
			'Layer 2: Adds brushed snare/shaker + acoustic fingerpicking. Time-aligned to MUS-01.',
		prompt:
			'lo-fi rhythm layer, brushed snare, shaker, acoustic guitar fingerpicking, 80 BPM, C major, cozy, warm, instrumental, seamless loop',
		durationSeconds: 60,
		looping: true,
		channels: 'stereo',
		defaultVolume: 0.2,
		postProcessing: 'Time-align to MUS-01, ensure seamless loop',
	},
	{
		id: 'MUS-03',
		filename: 'music_layer_tension',
		category: 'music',
		phase: 'complete',
		description: 'Layer 3: Pulsing bass synth + urgent xylophone ostinato. Time-aligned to MUS-01.',
		prompt:
			'tension layer, pulsing bass synth, urgent xylophone ostinato, 80 BPM, C major, building intensity, instrumental, seamless loop',
		durationSeconds: 60,
		looping: true,
		channels: 'stereo',
		defaultVolume: 0.2,
		postProcessing: 'Time-align to MUS-01, ensure seamless loop',
	},
];

// =============================================================================
// Asset Registry
// =============================================================================

/**
 * Complete asset registry for Dicee audio
 */
export const assetRegistry: AssetRegistry = {
	version: '1.0.0',
	project: 'dicee',
	assets: [...mvpAssets, ...phase2Assets],
};

/**
 * Get assets by phase
 */
export function getAssetsByPhase(phase: 'mvp' | 'complete' | 'future'): AudioAsset[] {
	return assetRegistry.assets.filter((a) => a.phase === phase);
}

/**
 * Get assets by category
 */
export function getAssetsByCategory(
	category: 'dice' | 'ui' | 'score' | 'music' | 'ambient',
): AudioAsset[] {
	return assetRegistry.assets.filter((a) => a.category === category);
}

/**
 * Get a single asset by ID
 */
export function getAssetById(id: string): AudioAsset | undefined {
	return assetRegistry.assets.find((a) => a.id === id);
}

/**
 * Get MVP assets (Phase 1)
 */
export function getMvpAssets(): AudioAsset[] {
	return mvpAssets;
}

/**
 * Get total count by phase
 */
export function getAssetCounts(): Record<string, number> {
	return {
		mvp: mvpAssets.length,
		complete: phase2Assets.length,
		total: assetRegistry.assets.length,
	};
}
