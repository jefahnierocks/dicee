/**
 * Persistence Module Exports
 *
 * DO→Supabase persistence bridge for game data.
 */

// Migrations and helpers
export {
	clearGameMetadata,
	clearPendingEvents,
	getEventSequence,
	getPendingEvents,
	getSupabaseGameId,
	initPersistenceTables,
	setEventSequence,
	setSupabaseGameId,
} from './migrations';
// Queue
export {
	PERSISTENCE_TASK_TYPES,
	PersistenceQueue,
	type PersistenceTask,
	type PersistenceTaskType,
	type QueuedRanking,
} from './persistence-queue';
// Schema validation (compile-time only, ensures no schema drift)
export { SCHEMA_MAPPINGS } from './schema-validation';
// Schemas and types
export {
	DOMAIN_EVENT_TYPES,
	type DomainEvent,
	DomainEventSchema,
	type DomainEventType,
	GAME_MODES,
	GAME_STATUSES,
	type GameMode,
	type GamePlayerRecord,
	GamePlayerRecordSchema,
	type GameRecord,
	GameRecordSchema,
	type GameStatus,
	type PersistenceResult,
	PersistenceResultSchema,
} from './schemas';
// RPC Client
export {
	type DomainEventInput,
	type GamePlayerInput,
	type OperationResult,
	OperationResultSchema,
	type PlayerRanking,
	type RpcResult,
	type StatsUpdateResult,
	StatsUpdateResultSchema,
	SupabaseRpcClient,
} from './supabase-rpc';
