<!-- Bug Reporter Component -->
<script lang="ts">
/**
 * Bug Reporter Modal
 *
 * Neo-Brutalist design with full mobile responsiveness.
 * Captures bug reports with voice recording and automatic state capture.
 */

import { type BugReportSubmission, bugReportService } from '$lib/services/bugReport';
import { type VoiceRecording, voiceRecorder } from '$lib/services/voiceRecorder';

// Props
interface Props {
	open: boolean;
	onClose: () => void;
}
let { open, onClose }: Props = $props();

// State
let isSubmitting = $state(false);
let isRecording = $state(false);
let recordingTime = $state(0);
let recording: VoiceRecording | null = $state(null);
let transcription = $state('');
let isTranscribing = $state(false);

// Form data
let severity = $state<'blocking' | 'annoying' | 'noticed'>('annoying');
let title = $state('');
let description = $state('');

// UI state
let error = $state('');
let success = $state(false);
let recordingInterval: number | null = null;

// Start voice recording
async function startRecording() {
	try {
		await voiceRecorder.initialize();
		voiceRecorder.startRecording();
		isRecording = true;
		error = '';

		// Start timer
		recordingInterval = setInterval(() => {
			recordingTime++;
		}, 1000) as unknown as number;
	} catch (err) {
		error = err instanceof Error ? err.message : 'Failed to start recording';
	}
}

// Stop voice recording
async function stopRecording() {
	try {
		recording = await voiceRecorder.stopRecording();
		isRecording = false;

		// Clear timer
		if (recordingInterval) {
			clearInterval(recordingInterval);
			recordingInterval = null;
		}

		// Start transcription
		await transcribeAudio();
	} catch (err) {
		error = err instanceof Error ? err.message : 'Failed to stop recording';
		isRecording = false;
	}
}

// Transcribe audio using Cloudflare Workers AI
async function transcribeAudio() {
	if (!recording) return;

	isTranscribing = true;
	error = '';

	try {
		// Convert audio blob to base64
		const reader = new FileReader();
		const base64Promise = new Promise<string>((resolve) => {
			reader.onload = () => resolve(reader.result as string);
			reader.readAsDataURL(recording!.blob);
		});

		const base64Audio = await base64Promise;

		// Send to transcription endpoint
		const response = await fetch('/api/transcribe', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				audio: base64Audio,
				mimeType: recording.blob.type,
			}),
		});

		if (!response.ok) {
			throw new Error('Transcription failed');
		}

		const result = await response.json();
		transcription = result.text || '';
	} catch (err) {
		error = err instanceof Error ? err.message : 'Transcription failed';
	} finally {
		isTranscribing = false;
	}
}

// Submit bug report
async function submitBugReport() {
	if (!title.trim()) {
		error = 'Please enter a title for the bug report';
		return;
	}

	isSubmitting = true;
	error = '';

	try {
		const submission: BugReportSubmission = {
			severity,
			title: title.trim(),
			description: description.trim() || undefined,
			audioBlob: recording?.blob,
			audioTranscription: transcription || undefined,
		};

		await bugReportService.submitBugReport(submission);

		success = true;

		// Reset form after delay
		setTimeout(() => {
			resetForm();
			onClose();
		}, 2000);
	} catch (err) {
		error = err instanceof Error ? err.message : 'Failed to submit bug report';
	} finally {
		isSubmitting = false;
	}
}

// Reset form
function resetForm() {
	title = '';
	description = '';
	severity = 'annoying';
	recording = null;
	transcription = '';
	recordingTime = 0;
	error = '';
	success = false;

	// Clean up voice recorder
	voiceRecorder.dispose();
}

// Format recording time
function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Severity options with color coding
const severityOptions = [
	{ value: 'blocking', label: '🚨 Blocking', color: 'danger' },
	{ value: 'annoying', label: '😤 Annoying', color: 'warning' },
	{ value: 'noticed', label: '👀 Noticed', color: 'muted' },
] as const;

// Close handler
function handleClose() {
	if (isRecording) {
		stopRecording();
	}
	resetForm();
	onClose();
}

// Handle escape key
function handleKeydown(e: KeyboardEvent) {
	if (e.key === 'Escape' && !isSubmitting) {
		handleClose();
	}
}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- Backdrop -->
	<div class="backdrop" onclick={handleClose} role="presentation"></div>

	<!-- Modal -->
	<div class="modal" role="dialog" aria-modal="true" aria-labelledby="bug-report-title">
		<!-- Header -->
		<header class="modal-header">
			<h2 id="bug-report-title" class="modal-title">
				<span class="title-icon">🐛</span>
				Report a Bug
			</h2>
			<button
				class="close-btn"
				onclick={handleClose}
				aria-label="Close bug report"
				disabled={isSubmitting}
			>
				×
			</button>
		</header>

		<!-- Content -->
		<div class="modal-content">
			{#if error}
				<div class="alert alert-error" role="alert">
					<span class="alert-icon">❌</span>
					<span class="alert-text">{error}</span>
				</div>
			{/if}

			{#if success}
				<div class="alert alert-success" role="alert">
					<span class="alert-icon">✅</span>
					<span class="alert-text">Bug report submitted! Thank you for helping improve Dicee.</span>
				</div>
			{:else}
				<!-- Severity Selection -->
				<div class="form-group">
					<span class="form-label">How bad is it?</span>
					<div class="severity-grid">
						{#each severityOptions as option}
							<button
								type="button"
								class="severity-btn"
								class:selected={severity === option.value}
								class:danger={option.color === 'danger'}
								class:warning={option.color === 'warning'}
								class:muted={option.color === 'muted'}
								onclick={() => (severity = option.value)}
								disabled={isSubmitting}
							>
								{option.label}
							</button>
						{/each}
					</div>
				</div>

				<!-- Title -->
				<div class="form-group">
					<label class="form-label" for="bug-title">
						What happened? <span class="required">*</span>
					</label>
					<input
						id="bug-title"
						type="text"
						class="form-input"
						placeholder="Dice didn't roll correctly..."
						bind:value={title}
						disabled={isSubmitting}
					/>
				</div>

				<!-- Description -->
				<div class="form-group">
					<label class="form-label" for="bug-description">More details (optional)</label>
					<textarea
						id="bug-description"
						class="form-textarea"
						placeholder="I was playing a multiplayer game when..."
						bind:value={description}
						rows={3}
						disabled={isSubmitting}
					></textarea>
				</div>

				<!-- Voice Recording -->
				<div class="form-group">
					<span class="form-label">Or tell us about it</span>

					<div class="voice-section">
						{#if !recording}
							<button
								type="button"
								class="voice-btn"
								class:recording={isRecording}
								onclick={isRecording ? stopRecording : startRecording}
								disabled={isTranscribing || isSubmitting}
							>
								{#if isRecording}
									<span class="pulse">🔴</span>
									<span>Stop Recording</span>
									<span class="timer">{formatTime(recordingTime)}</span>
								{:else}
									<span>🎤</span>
									<span>Record Voice</span>
								{/if}
							</button>
						{/if}

						{#if isTranscribing}
							<div class="transcribing">
								<span class="spinner">⏳</span>
								<span>Transcribing...</span>
							</div>
						{/if}

						{#if transcription}
							<div class="transcription">
								<span class="transcription-label">📝 Transcription</span>
								<p class="transcription-text">"{transcription}"</p>
							</div>
						{/if}
					</div>
				</div>

				<!-- Actions -->
				<div class="modal-actions">
					<button
						type="button"
						class="btn btn-secondary"
						onclick={handleClose}
						disabled={isSubmitting}
					>
						Cancel
					</button>

					<button
						type="button"
						class="btn btn-primary"
						onclick={submitBugReport}
						disabled={isSubmitting || !title.trim()}
					>
						{#if isSubmitting}
							<span class="spinner">⏳</span>
							Sending...
						{:else}
							📤 Submit Report
						{/if}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* ==========================================================================
	 * Modal Backdrop
	 * ========================================================================== */
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		z-index: var(--z-modal);
	}

	/* ==========================================================================
	 * Modal Container
	 * ========================================================================== */
	.modal {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: calc(100% - var(--space-3));
		max-width: 480px;
		max-height: calc(100vh - var(--space-4));
		overflow-y: auto;
		background: var(--color-surface);
		border: var(--border-thick);
		box-shadow: var(--shadow-brutal-lg);
		z-index: calc(var(--z-modal) + 1);
	}

	/* ==========================================================================
	 * Header
	 * ========================================================================== */
	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		border-bottom: var(--border-medium);
		background: var(--color-background);
	}

	.modal-title {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-h3);
		font-weight: var(--weight-black);
		margin: 0;
		letter-spacing: var(--tracking-tight);
	}

	.title-icon {
		font-size: var(--text-h2);
	}

	.close-btn {
		width: var(--touch-target-min);
		height: var(--touch-target-min);
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: var(--border-thin);
		font-size: var(--text-h2);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.close-btn:hover:not(:disabled) {
		background: var(--color-background);
		color: var(--color-text);
		border-color: var(--color-text);
	}

	.close-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ==========================================================================
	 * Content
	 * ========================================================================== */
	.modal-content {
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	/* ==========================================================================
	 * Alerts
	 * ========================================================================== */
	.alert {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2);
		border: var(--border-medium);
	}

	.alert-error {
		background: color-mix(in srgb, var(--color-danger) 10%, transparent);
		border-color: var(--color-danger);
	}

	.alert-success {
		background: color-mix(in srgb, var(--color-success) 10%, transparent);
		border-color: var(--color-success);
	}

	.alert-icon {
		font-size: var(--text-h3);
		flex-shrink: 0;
	}

	.alert-text {
		font-size: var(--text-small);
		font-weight: var(--weight-medium);
		line-height: 1.4;
	}

	/* ==========================================================================
	 * Form Elements
	 * ========================================================================== */
	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.form-label {
		font-size: var(--text-small);
		font-weight: var(--weight-bold);
		color: var(--color-text);
	}

	.required {
		color: var(--color-danger);
	}

	.form-input,
	.form-textarea {
		width: 100%;
		padding: var(--space-2);
		background: var(--color-surface);
		border: var(--border-medium);
		font-family: var(--font-sans);
		font-size: var(--text-body);
		color: var(--color-text);
		transition: border-color var(--transition-fast);
	}

	.form-input:focus,
	.form-textarea:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.form-input:disabled,
	.form-textarea:disabled {
		background: var(--color-background);
		opacity: 0.7;
		cursor: not-allowed;
	}

	.form-textarea {
		resize: vertical;
		min-height: 80px;
	}

	/* ==========================================================================
	 * Severity Grid
	 * ========================================================================== */
	.severity-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-1);
	}

	.severity-btn {
		padding: var(--space-2) var(--space-1);
		background: var(--color-surface);
		border: var(--border-medium);
		font-size: var(--text-small);
		font-weight: var(--weight-bold);
		cursor: pointer;
		transition: all var(--transition-fast);
		text-align: center;
		min-height: var(--touch-target-min);
	}

	.severity-btn:hover:not(:disabled) {
		background: var(--color-background);
	}

	.severity-btn.selected.danger {
		background: color-mix(in srgb, var(--color-danger) 15%, white);
		border-color: var(--color-danger);
	}

	.severity-btn.selected.warning {
		background: color-mix(in srgb, var(--color-warning) 15%, white);
		border-color: var(--color-warning);
	}

	.severity-btn.selected.muted {
		background: var(--color-background);
		border-color: var(--color-text);
	}

	.severity-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ==========================================================================
	 * Voice Recording
	 * ========================================================================== */
	.voice-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.voice-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2);
		background: var(--color-surface);
		border: var(--border-medium);
		font-size: var(--text-body);
		font-weight: var(--weight-bold);
		cursor: pointer;
		transition: all var(--transition-fast);
		min-height: var(--touch-target-comfortable);
	}

	.voice-btn:hover:not(:disabled) {
		background: var(--color-background);
		border-color: var(--color-accent);
	}

	.voice-btn.recording {
		background: color-mix(in srgb, var(--color-danger) 10%, white);
		border-color: var(--color-danger);
	}

	.voice-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.pulse {
		animation: pulse 1s infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	.timer {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--color-text-muted);
	}

	.transcribing {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-small);
		color: var(--color-text-muted);
	}

	.spinner {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.transcription {
		padding: var(--space-2);
		background: var(--color-background);
		border: var(--border-thin);
	}

	.transcription-label {
		display: block;
		font-size: var(--text-tiny);
		font-weight: var(--weight-bold);
		color: var(--color-text-muted);
		margin-bottom: var(--space-1);
	}

	.transcription-text {
		margin: 0;
		font-size: var(--text-small);
		font-style: italic;
		color: var(--color-text);
		line-height: 1.5;
	}

	/* ==========================================================================
	 * Action Buttons
	 * ========================================================================== */
	.modal-actions {
		display: flex;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: var(--border-thin);
	}

	.btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		padding: var(--space-2);
		font-size: var(--text-body);
		font-weight: var(--weight-bold);
		cursor: pointer;
		transition: all var(--transition-fast);
		min-height: var(--touch-target-min);
		border: var(--border-medium);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-secondary {
		background: var(--color-surface);
		color: var(--color-text);
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--color-background);
	}

	.btn-primary {
		background: var(--color-accent);
		color: var(--color-text);
		border-color: var(--color-text);
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--color-accent-dark);
		box-shadow: var(--shadow-brutal-sm);
	}

	.btn-primary:disabled {
		background: var(--color-disabled);
	}

	/* ==========================================================================
	 * Mobile Responsive
	 * ========================================================================== */
	@media (max-width: 480px) {
		.modal {
			width: 100%;
			max-width: none;
			height: 100%;
			max-height: none;
			top: 0;
			left: 0;
			transform: none;
			border: none;
			box-shadow: none;
		}

		.modal-content {
			padding: var(--space-2);
			gap: var(--space-2);
		}

		.severity-grid {
			grid-template-columns: 1fr;
		}

		.severity-btn {
			padding: var(--space-2);
		}

		.modal-actions {
			flex-direction: column-reverse;
		}
	}
</style>
