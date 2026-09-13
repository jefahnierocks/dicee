<!-- Bug Report Dashboard Component -->
<script lang="ts">
import { onMount } from 'svelte';
import { type BugReport, bugReportService } from '$lib/services/bugReport';

// Props
interface Props {
	open: boolean;
	onClose: () => void;
}
let { open, onClose }: Props = $props();

// State
let loading = $state(true);
let bugReports = $state<BugReport[]>([]);
let error = $state('');
let selectedReport = $state<BugReport | null>(null);

// Load bug reports
async function loadBugReports() {
	try {
		loading = true;
		error = '';
		bugReports = await bugReportService.getUserBugReports();
	} catch (err) {
		error = err instanceof Error ? err.message : 'Failed to load bug reports';
	} finally {
		loading = false;
	}
}

// Load data when component opens
onMount(() => {
	if (open) {
		loadBugReports();
	}
});

// Reload when open changes
$effect(() => {
	if (open) {
		loadBugReports();
	}
});

// Format date
function formatDate(dateString: string): string {
	return new Date(dateString).toLocaleString();
}

// Get severity color
function getSeverityColor(severity: string): string {
	switch (severity) {
		case 'blocking':
			return 'bg-red-100 text-red-800 border-red-200';
		case 'annoying':
			return 'bg-yellow-100 text-yellow-800 border-yellow-200';
		case 'noticed':
			return 'bg-blue-100 text-blue-800 border-blue-200';
		default:
			return 'bg-gray-100 text-gray-800 border-gray-200';
	}
}

// Get status color
function getStatusColor(status: string): string {
	switch (status) {
		case 'open':
			return 'bg-gray-100 text-gray-800 border-gray-200';
		case 'in_progress':
			return 'bg-blue-100 text-blue-800 border-blue-200';
		case 'resolved':
			return 'bg-green-100 text-green-800 border-green-200';
		case 'closed':
			return 'bg-gray-100 text-gray-600 border-gray-200';
		default:
			return 'bg-gray-100 text-gray-800 border-gray-200';
	}
}

// Update bug report status
async function updateStatus(id: string, status: 'open' | 'in_progress' | 'resolved' | 'closed') {
	try {
		await bugReportService.updateBugReportStatus(id, status);
		await loadBugReports(); // Reload data
	} catch (err) {
		error = err instanceof Error ? err.message : 'Failed to update status';
	}
}

// Delete bug report
async function deleteReport(id: string) {
	if (!confirm('Are you sure you want to delete this bug report?')) {
		return;
	}

	try {
		await bugReportService.deleteBugReport(id);
		await loadBugReports(); // Reload data
		selectedReport = null; // Clear selection if deleted
	} catch (err) {
		error = err instanceof Error ? err.message : 'Failed to delete bug report';
	}
}
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
		<div class="w-full max-w-6xl max-h-[90vh] overflow-y-auto bg-white rounded-lg shadow-xl">
			<div class="p-6 border-b border-gray-200">
				<div class="flex items-center justify-between">
					<div>
						<h2 class="text-xl font-semibold text-gray-900 flex items-center gap-2">
							<span>📊</span>
							Bug Report Dashboard
						</h2>
						<p class="text-gray-600 mt-1">
							View and manage reported bugs
						</p>
					</div>
					<button
						type="button"
						class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
						onclick={onClose}
					>
						Close
					</button>
				</div>
			</div>
			
			<div class="p-6">
				{#if error}
					<div class="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
						<div class="flex">
							<span class="text-red-500">❌</span>
							<p class="ml-3 text-red-700">{error}</p>
						</div>
					</div>
				{/if}
				
				{#if loading}
					<div class="flex items-center justify-center py-12">
						<span class="animate-spin text-2xl">⏳</span>
						<span class="ml-3 text-gray-600">Loading bug reports...</span>
					</div>
				{:else if bugReports.length === 0}
					<div class="text-center py-12">
						<span class="text-4xl">🐛</span>
						<p class="mt-4 text-gray-600">No bug reports found</p>
					</div>
				{:else}
					<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
						<!-- Bug Report List -->
						<div class="space-y-4">
							<h3 class="text-lg font-medium text-gray-900">Reports ({bugReports.length})</h3>
							<div class="space-y-3 max-h-96 overflow-y-auto">
								{#each bugReports as report}
									<div
										role="button"
										tabindex="0"
										class="p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
										class:bg-blue-50={selectedReport?.id === report.id}
										class:border-blue-300={selectedReport?.id === report.id}
										onclick={() => (selectedReport = report)}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												selectedReport = report;
											}
										}}
									>
										<div class="flex items-start justify-between">
											<div class="flex-1 min-w-0">
												<h4 class="text-sm font-medium text-gray-900 truncate">
													{report.title}
												</h4>
												<p class="text-sm text-gray-600 mt-1">
													{formatDate(report.created_at)}
												</p>
											</div>
											<div class="flex flex-col gap-2 ml-3">
												<span class="px-2 py-1 text-xs font-medium rounded-full border {getSeverityColor(report.severity)}">
													{report.severity}
												</span>
												<span class="px-2 py-1 text-xs font-medium rounded-full border {getStatusColor(report.status)}">
													{report.status}
												</span>
											</div>
										</div>
									</div>
								{/each}
							</div>
						</div>
						
						<!-- Bug Report Details -->
						<div class="space-y-4">
							{#if selectedReport}
								<div class="flex items-center justify-between">
									<h3 class="text-lg font-medium text-gray-900">Report Details</h3>
									<div class="flex gap-2">
										<!-- Status Update -->
										<select
											class="px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
											value={selectedReport?.status}
											onchange={(e) => {
												const target = e.target as HTMLSelectElement;
												if (selectedReport && target.value) {
													updateStatus(selectedReport.id, target.value as any);
												}
											}}
										>
											<option value="open">Open</option>
											<option value="in_progress">In Progress</option>
											<option value="resolved">Resolved</option>
											<option value="closed">Closed</option>
										</select>
										
										<!-- Delete Button -->
										<button
											type="button"
											class="px-3 py-1 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
											onclick={() => {
												if (selectedReport) {
													deleteReport(selectedReport.id);
												}
											}}
										>
											Delete
										</button>
									</div>
								</div>
								
								<div class="bg-gray-50 rounded-lg p-4 space-y-4">
									<!-- Title and Severity -->
									<div>
										<h4 class="text-lg font-medium text-gray-900">{selectedReport.title}</h4>
										<div class="flex gap-2 mt-2">
											<span class="px-2 py-1 text-xs font-medium rounded-full border {getSeverityColor(selectedReport.severity)}">
												{selectedReport.severity}
											</span>
											<span class="text-sm text-gray-600">
												{formatDate(selectedReport.created_at)}
											</span>
										</div>
									</div>
									
									<!-- Description -->
									{#if selectedReport.description}
										<div>
											<h5 class="text-sm font-medium text-gray-700 mb-2">Description</h5>
											<p class="text-sm text-gray-600 whitespace-pre-wrap">
												{selectedReport.description}
											</p>
										</div>
									{/if}
									
									<!-- Voice Transcription -->
									{#if selectedReport.audio_transcription}
										<div>
											<h5 class="text-sm font-medium text-gray-700 mb-2">Voice Recording</h5>
											<div class="bg-white p-3 rounded border border-gray-200">
												<p class="text-sm text-gray-600 italic">
													"{selectedReport.audio_transcription}"
												</p>
											</div>
										</div>
									{/if}
									
									<!-- Reporter Info -->
									<div>
										<h5 class="text-sm font-medium text-gray-700 mb-2">Reporter</h5>
										<p class="text-sm text-gray-600">
											Authenticated reporter
										</p>
									</div>
									
									<!-- Timestamps -->
									<div class="text-xs text-gray-500 pt-2 border-t border-gray-200">
										Created: {formatDate(selectedReport.created_at)}
										{#if selectedReport.updated_at !== selectedReport.created_at}
											• Updated: {formatDate(selectedReport.updated_at)}
										{/if}
									</div>
								</div>
							{:else}
								<div class="text-center py-12 text-gray-500">
									<span class="text-2xl">📋</span>
									<p class="mt-4">Select a bug report to view details</p>
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
