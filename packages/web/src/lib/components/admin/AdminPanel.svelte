<script lang="ts">
/**
 * AdminPanel - Admin control panel for managing rooms, connections, and audit log
 *
 * Uses RBAC from profile store for permission checking.
 * Makes authenticated API calls to /_debug endpoints.
 *
 * Permissions:
 * - moderator: View rooms, close individual rooms
 * - admin: All moderator permissions + clear all rooms, view audit
 * - super_admin: All permissions
 */
import { auth } from '$lib/stores/auth.svelte';
import { profileStore } from '$lib/stores/profile.svelte';

interface Props {
	/** Whether the panel is open */
	open: boolean;
	/** Callback to close the panel */
	onClose: () => void;
}

let { open, onClose }: Props = $props();

// Tab state
type TabId = 'rooms' | 'connections' | 'audit';
let activeTab = $state<TabId>('rooms');

// Data state
let rooms = $state<RoomInfo[]>([]);
let connections = $state<ConnectionInfo[]>([]);
let auditLog = $state<AuditEntry[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);

// Permission-based derived state
const canClearAll = $derived(profileStore.hasPermission('rooms:clear_all'));
const canViewAudit = $derived(profileStore.hasPermission('audit:view'));
const canViewConnections = $derived(profileStore.hasPermission('users:view'));

interface RoomInfo {
	code: string;
	hostId: string;
	hostName: string;
	isPublic: boolean;
	playerCount: number;
	maxPlayers: number;
	status: string;
	createdAt: number;
}

interface ConnectionInfo {
	userId: string | null;
	displayName: string | null;
	connectedAt: number | null;
	lastSeen: number | null;
	currentRoomCode: string | null;
}

interface AuditEntry {
	id: string;
	adminId: string;
	action: string;
	targetType?: string;
	targetId?: string;
	metadata: Record<string, unknown>;
	createdAt: string;
}

async function loadRooms() {
	loading = true;
	error = null;
	try {
		const response = await fetch('/_debug/rooms');
		if (!response.ok) throw new Error('Failed to load rooms');
		const data = await response.json();
		rooms = data.rooms || [];
	} catch (e) {
		error = e instanceof Error ? e.message : 'Unknown error';
	} finally {
		loading = false;
	}
}

async function loadConnections() {
	loading = true;
	error = null;
	try {
		const response = await fetch('/_debug/connections');
		if (!response.ok) throw new Error('Failed to load connections');
		const data = await response.json();
		connections = data.connections || [];
	} catch (e) {
		error = e instanceof Error ? e.message : 'Unknown error';
	} finally {
		loading = false;
	}
}

async function loadAuditLog() {
	// Audit log would come from Supabase admin_audit_log table
	// For now, this is a placeholder
	loading = true;
	error = null;
	try {
		// TODO: Implement Supabase audit log query
		auditLog = [];
	} finally {
		loading = false;
	}
}

async function closeRoom(code: string) {
	if (!confirm(`Close room ${code}?`)) return;

	loading = true;
	error = null;
	try {
		const response = await fetch(`/_debug/rooms/${code}`, { method: 'DELETE' });
		if (!response.ok) throw new Error('Failed to close room');
		await loadRooms();
	} catch (e) {
		error = e instanceof Error ? e.message : 'Unknown error';
	} finally {
		loading = false;
	}
}

async function clearAllRooms() {
	if (!confirm('Clear ALL rooms? This cannot be undone.')) return;

	loading = true;
	error = null;
	try {
		const response = await fetch('/_debug/rooms/all', { method: 'DELETE' });
		if (!response.ok) throw new Error('Failed to clear rooms');
		await loadRooms();
	} catch (e) {
		error = e instanceof Error ? e.message : 'Unknown error';
	} finally {
		loading = false;
	}
}

function handleTabChange(tab: TabId) {
	activeTab = tab;
	if (tab === 'rooms') loadRooms();
	else if (tab === 'connections') loadConnections();
	else if (tab === 'audit') loadAuditLog();
}

function handleBackdropClick(event: MouseEvent) {
	if (event.target === event.currentTarget) {
		onClose();
	}
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === 'Escape') {
		onClose();
	}
}

function formatTime(timestamp: number | null): string {
	if (!timestamp) return 'N/A';
	return new Date(timestamp).toLocaleTimeString();
}

function formatDate(timestamp: number | string | null): string {
	if (!timestamp) return 'N/A';
	const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
	return date.toLocaleString();
}

// Load initial data when panel opens
$effect(() => {
	if (open) {
		handleTabChange(activeTab);
	}
});
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="admin-backdrop"
		role="dialog"
		aria-modal="true"
		aria-labelledby="admin-panel-title"
		tabindex="-1"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
	>
		<div class="admin-panel">
			<header class="panel-header">
				<div class="header-left">
					<h2 id="admin-panel-title" class="panel-title">Admin Panel</h2>
					<span class="role-badge role-badge--{profileStore.role}">{profileStore.role}</span>
				</div>
				<button type="button" class="panel-close" onclick={onClose} aria-label="Close">
					✕
				</button>
			</header>

			<nav class="panel-tabs">
				<button
					type="button"
					class="tab-btn"
					class:active={activeTab === 'rooms'}
					onclick={() => handleTabChange('rooms')}
				>
					Rooms ({rooms.length})
				</button>
				{#if canViewConnections}
					<button
						type="button"
						class="tab-btn"
						class:active={activeTab === 'connections'}
						onclick={() => handleTabChange('connections')}
					>
						Connections ({connections.length})
					</button>
				{/if}
				{#if canViewAudit}
					<button
						type="button"
						class="tab-btn"
						class:active={activeTab === 'audit'}
						onclick={() => handleTabChange('audit')}
					>
						Audit Log
					</button>
				{/if}
			</nav>

			<div class="panel-body">
				{#if error}
					<div class="error-message">{error}</div>
				{/if}

				{#if loading}
					<div class="loading">Loading...</div>
				{:else if activeTab === 'rooms'}
					<section class="rooms-section">
						{#if canClearAll && rooms.length > 0}
							<div class="section-actions">
								<button
									type="button"
									class="action-btn action-btn--danger"
									onclick={clearAllRooms}
								>
									Clear All Rooms
								</button>
							</div>
						{/if}

						{#if rooms.length === 0}
							<div class="empty-state">No active rooms</div>
						{:else}
							<div class="table-container">
								<table class="data-table">
									<thead>
										<tr>
											<th>Code</th>
											<th>Host</th>
											<th>Players</th>
											<th>Status</th>
											<th>Created</th>
											<th>Actions</th>
										</tr>
									</thead>
									<tbody>
										{#each rooms as room}
											<tr>
												<td class="mono">{room.code}</td>
												<td>{room.hostName}</td>
												<td>{room.playerCount}/{room.maxPlayers}</td>
												<td>
													<span class="status-badge status-badge--{room.status}">
														{room.status}
													</span>
												</td>
												<td class="mono">{formatTime(room.createdAt)}</td>
												<td>
													<button
														type="button"
														class="action-btn action-btn--small"
														onclick={() => closeRoom(room.code)}
													>
														Close
													</button>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</section>
				{:else if activeTab === 'connections'}
					<section class="connections-section">
						{#if connections.length === 0}
							<div class="empty-state">No active connections</div>
						{:else}
							<div class="table-container">
								<table class="data-table">
									<thead>
										<tr>
											<th>User</th>
											<th>Display Name</th>
											<th>Connected</th>
											<th>Last Seen</th>
											<th>Room</th>
										</tr>
									</thead>
									<tbody>
										{#each connections as conn}
											<tr>
												<td class="mono">{conn.userId?.slice(0, 8) ?? 'N/A'}...</td>
												<td>{conn.displayName ?? 'Unknown'}</td>
												<td class="mono">{formatTime(conn.connectedAt)}</td>
												<td class="mono">{formatTime(conn.lastSeen)}</td>
												<td class="mono">{conn.currentRoomCode ?? '-'}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</section>
				{:else if activeTab === 'audit'}
					<section class="audit-section">
						{#if auditLog.length === 0}
							<div class="empty-state">No audit entries</div>
						{:else}
							<div class="table-container">
								<table class="data-table">
									<thead>
										<tr>
											<th>Action</th>
											<th>Target</th>
											<th>Admin</th>
											<th>Time</th>
										</tr>
									</thead>
									<tbody>
										{#each auditLog as entry}
											<tr>
												<td>{entry.action}</td>
												<td>{entry.targetType ?? '-'}: {entry.targetId ?? '-'}</td>
												<td class="mono">{entry.adminId.slice(0, 8)}...</td>
												<td class="mono">{formatDate(entry.createdAt)}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</section>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.admin-backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-3);
		background: rgba(0, 0, 0, 0.8);
	}

	.admin-panel {
		width: 100%;
		max-width: 800px;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		background: var(--color-background);
		border: var(--border-thick);
		box-shadow: 8px 8px 0 var(--color-border);
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		border-bottom: var(--border-medium);
		background: var(--color-surface);
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.panel-title {
		font-size: var(--text-h3);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
		margin: 0;
	}

	.role-badge {
		font-family: var(--font-mono);
		font-size: var(--text-tiny);
		font-weight: var(--weight-semibold);
		text-transform: uppercase;
		padding: var(--space-0) var(--space-1);
		border: var(--border-thin);
	}

	.role-badge--moderator {
		background: var(--color-info);
		color: var(--color-info-contrast);
	}

	.role-badge--admin {
		background: var(--color-warning);
		color: var(--color-warning-contrast);
	}

	.role-badge--super_admin {
		background: var(--color-error);
		color: var(--color-error-contrast);
	}

	.panel-close {
		appearance: none;
		background: none;
		border: var(--border-thin);
		padding: var(--space-1);
		font-size: var(--text-body);
		cursor: pointer;
		line-height: 1;
	}

	.panel-close:hover {
		background: var(--color-surface-alt);
	}

	.panel-tabs {
		display: flex;
		gap: 0;
		border-bottom: var(--border-thin);
		background: var(--color-surface-alt);
	}

	.tab-btn {
		flex: 1;
		padding: var(--space-2) var(--space-3);
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-weight: var(--weight-semibold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
		background: transparent;
		border: none;
		border-bottom: 3px solid transparent;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.tab-btn:hover {
		background: var(--color-surface);
	}

	.tab-btn.active {
		background: var(--color-background);
		border-bottom-color: var(--color-primary);
	}

	.panel-body {
		flex: 1;
		overflow: auto;
		padding: var(--space-3);
	}

	.error-message {
		padding: var(--space-2);
		background: var(--color-error);
		color: var(--color-error-contrast);
		font-size: var(--text-small);
		margin-bottom: var(--space-2);
	}

	.loading,
	.empty-state {
		text-align: center;
		padding: var(--space-4);
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-small);
	}

	.section-actions {
		display: flex;
		justify-content: flex-end;
		margin-bottom: var(--space-2);
	}

	.action-btn {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-weight: var(--weight-semibold);
		text-transform: uppercase;
		padding: var(--space-1) var(--space-2);
		border: var(--border-thin);
		cursor: pointer;
		background: var(--color-surface);
		transition: all var(--transition-fast);
	}

	.action-btn:hover {
		background: var(--color-surface-alt);
	}

	.action-btn--danger {
		background: var(--color-error);
		color: var(--color-error-contrast);
	}

	.action-btn--danger:hover {
		opacity: 0.9;
	}

	.action-btn--small {
		font-size: var(--text-tiny);
		padding: var(--space-0) var(--space-1);
	}

	.table-container {
		overflow-x: auto;
	}

	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-family: var(--font-mono);
		font-size: var(--text-small);
	}

	.data-table th,
	.data-table td {
		padding: var(--space-1) var(--space-2);
		text-align: left;
		border-bottom: var(--border-thin);
	}

	.data-table th {
		font-size: var(--text-tiny);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
		background: var(--color-surface);
		color: var(--color-text-muted);
	}

	.data-table tr:hover {
		background: var(--color-surface-alt);
	}

	.mono {
		font-family: var(--font-mono);
	}

	.status-badge {
		font-size: var(--text-tiny);
		font-weight: var(--weight-semibold);
		text-transform: uppercase;
		padding: var(--space-0) var(--space-1);
		border: var(--border-thin);
	}

	.status-badge--waiting {
		background: var(--color-info);
		color: var(--color-info-contrast);
	}

	.status-badge--playing {
		background: var(--color-success);
		color: var(--color-success-contrast);
	}

	.status-badge--completed,
	.status-badge--abandoned {
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
	}
</style>
