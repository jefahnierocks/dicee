/**
 * NDJSON Streaming Writer
 *
 * Writes game results as newline-delimited JSON for efficient streaming.
 * Each line is a complete JSON object - allows resuming and partial reads.
 *
 * @example
 * const writer = new NdjsonWriter('results/games.ndjson');
 * await writer.open();
 * await writer.write(gameResult);
 * await writer.close();
 */

import type { WriteStream } from 'node:fs';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DecisionResult, GameResult, TurnResult } from '../schemas/index.js';

/**
 * NDJSON writer for streaming results to disk
 */
export class NdjsonWriter<T> {
	private stream: WriteStream | null = null;
	private lineCount = 0;
	private bytesWritten = 0;

	constructor(private filePath: string) {}

	/**
	 * Open the file for writing
	 */
	async open(): Promise<void> {
		// Ensure directory exists
		const dir = dirname(this.filePath);
		await mkdir(dir, { recursive: true });

		this.stream = createWriteStream(this.filePath, {
			flags: 'a', // Append mode for resume support
			encoding: 'utf8',
		});

		// Wait for stream to be ready
		await new Promise<void>((resolve, reject) => {
			this.stream!.once('ready', resolve);
			this.stream!.once('error', reject);
		});
	}

	/**
	 * Write a single record
	 */
	async write(record: T): Promise<void> {
		if (!this.stream) {
			throw new Error('Writer not opened');
		}

		const line = JSON.stringify(record) + '\n';
		const written = await new Promise<boolean>((resolve) => {
			const ok = this.stream!.write(line, 'utf8');
			if (ok) {
				resolve(true);
			} else {
				this.stream!.once('drain', () => resolve(true));
			}
		});

		if (written) {
			this.lineCount++;
			this.bytesWritten += line.length;
		}
	}

	/**
	 * Write multiple records
	 */
	async writeAll(records: T[]): Promise<void> {
		for (const record of records) {
			await this.write(record);
		}
	}

	/**
	 * Flush and close the stream
	 */
	async close(): Promise<void> {
		if (!this.stream) return;

		await new Promise<void>((resolve, reject) => {
			this.stream!.end((err: Error | null) => {
				if (err) reject(err);
				else resolve();
			});
		});

		this.stream = null;
	}

	/**
	 * Get statistics
	 */
	getStats(): { lineCount: number; bytesWritten: number } {
		return {
			lineCount: this.lineCount,
			bytesWritten: this.bytesWritten,
		};
	}
}

/**
 * NDJSON reader for streaming results from disk
 */
export class NdjsonReader<T> {
	constructor(private filePath: string) {}

	/**
	 * Check if file exists
	 */
	exists(): boolean {
		return existsSync(this.filePath);
	}

	/**
	 * Count lines in file (for resume detection)
	 */
	countLines(): number {
		if (!this.exists()) return 0;

		const content = readFileSync(this.filePath, 'utf8');
		return content.split('\n').filter((line) => line.trim()).length;
	}

	/**
	 * Read all records
	 */
	readAll(): T[] {
		if (!this.exists()) return [];

		const content = readFileSync(this.filePath, 'utf8');
		return content
			.split('\n')
			.filter((line) => line.trim())
			.map((line) => JSON.parse(line) as T);
	}

	/**
	 * Read records with generator (memory efficient)
	 */
	*read(): Generator<T> {
		if (!this.exists()) return;

		const content = readFileSync(this.filePath, 'utf8');
		for (const line of content.split('\n')) {
			if (line.trim()) {
				yield JSON.parse(line) as T;
			}
		}
	}

	/**
	 * Get set of processed game IDs (for resume)
	 */
	getProcessedIds(idField = 'gameId'): Set<string> {
		const ids = new Set<string>();
		for (const record of this.read()) {
			const id = (record as Record<string, unknown>)[idField];
			if (typeof id === 'string') {
				ids.add(id);
			}
		}
		return ids;
	}
}

/**
 * Multi-file NDJSON writer for games, turns, and decisions
 */
export class SimulationOutputWriter {
	private gamesWriter: NdjsonWriter<GameResult>;
	private turnsWriter: NdjsonWriter<TurnResult> | null = null;
	private decisionsWriter: NdjsonWriter<DecisionResult> | null = null;

	constructor(
		outputDir: string,
		options: {
			writeTurns?: boolean;
			writeDecisions?: boolean;
		} = {},
	) {
		this.gamesWriter = new NdjsonWriter(`${outputDir}/games.ndjson`);

		if (options.writeTurns) {
			this.turnsWriter = new NdjsonWriter(`${outputDir}/turns.ndjson`);
		}
		if (options.writeDecisions) {
			this.decisionsWriter = new NdjsonWriter(`${outputDir}/decisions.ndjson`);
		}
	}

	/**
	 * Open all writers
	 */
	async open(): Promise<void> {
		await this.gamesWriter.open();
		await this.turnsWriter?.open();
		await this.decisionsWriter?.open();
	}

	/**
	 * Write a game result
	 */
	async writeGame(result: GameResult): Promise<void> {
		await this.gamesWriter.write(result);
	}

	/**
	 * Write turn results
	 */
	async writeTurns(turns: TurnResult[]): Promise<void> {
		if (this.turnsWriter) {
			await this.turnsWriter.writeAll(turns);
		}
	}

	/**
	 * Write decision results
	 */
	async writeDecisions(decisions: DecisionResult[]): Promise<void> {
		if (this.decisionsWriter) {
			await this.decisionsWriter.writeAll(decisions);
		}
	}

	/**
	 * Close all writers
	 */
	async close(): Promise<void> {
		await this.gamesWriter.close();
		await this.turnsWriter?.close();
		await this.decisionsWriter?.close();
	}

	/**
	 * Get statistics
	 */
	getStats(): {
		games: { lineCount: number; bytesWritten: number };
		turns?: { lineCount: number; bytesWritten: number };
		decisions?: { lineCount: number; bytesWritten: number };
	} {
		return {
			games: this.gamesWriter.getStats(),
			turns: this.turnsWriter?.getStats(),
			decisions: this.decisionsWriter?.getStats(),
		};
	}
}

/**
 * Get count of already-processed games (for resume)
 */
export function getProcessedGameCount(outputDir: string): number {
	const reader = new NdjsonReader<GameResult>(`${outputDir}/games.ndjson`);
	return reader.countLines();
}

/**
 * Get set of processed seeds (for resume)
 */
export function getProcessedSeeds(outputDir: string): Set<number> {
	const reader = new NdjsonReader<GameResult>(`${outputDir}/games.ndjson`);
	const seeds = new Set<number>();
	for (const game of reader.read()) {
		seeds.add(game.seed);
	}
	return seeds;
}
