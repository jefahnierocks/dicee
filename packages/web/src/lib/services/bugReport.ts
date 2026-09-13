/**
 * Bug Report Service
 *
 * Handles submitting and managing bug reports with state snapshots,
 * voice recordings, and transcriptions.
 */

import { createSupabaseBrowserClient } from '$lib/supabase/client';
import { clearBreadcrumbs, getBreadcrumbs } from './breadcrumbs';
import { captureStateSnapshot } from './stateSnapshot';

export interface BugReportSubmission {
	severity: 'blocking' | 'annoying' | 'noticed';
	title: string;
	description?: string;
	audioBlob?: Blob;
	audioTranscription?: string;
}

export interface BugReport {
	id: string;
	user_id: string;
	severity: 'blocking' | 'annoying' | 'noticed';
	title: string;
	description?: string;
	game_state?: any;
	connection_state?: any;
	ui_state?: any;
	breadcrumbs?: any[];
	audio_transcription?: string;
	audio_file_path?: string;
	audio_duration_ms?: number;
	created_at: string;
	updated_at: string;
	resolved_at?: string;
	status: 'open' | 'in_progress' | 'resolved' | 'closed';
	resolution_notes?: string;
	resolved_by?: string;
}

export class BugReportService {
	private supabase = createSupabaseBrowserClient();

	/**
	 * Submit a new bug report with captured state
	 */
	async submitBugReport(submission: BugReportSubmission): Promise<BugReport> {
		try {
			// Capture current application state
			const stateSnapshot = captureStateSnapshot();
			const breadcrumbs = getBreadcrumbs();

			// Get user info from auth
			const {
				data: { user },
			} = await this.supabase.auth.getUser();

			if (!user) {
				throw new Error('User must be authenticated to submit bug reports');
			}

			// Upload audio file if provided
			let audioFilePath: string | undefined;
			let audioDuration: number | undefined;

			if (submission.audioBlob) {
				const uploadResult = await this.uploadAudioFile(user.id, submission.audioBlob);
				audioFilePath = uploadResult.filePath;
				audioDuration = uploadResult.duration;
			}

			// Create bug report record
			const { data, error } = await (this.supabase as any)
				.from('bug_reports')
				.insert({
					user_id: user.id,
					severity: submission.severity,
					title: submission.title,
					description: submission.description,
					game_state: stateSnapshot.game,
					connection_state: stateSnapshot.connection,
					ui_state: stateSnapshot.ui,
					breadcrumbs,
					audio_transcription: submission.audioTranscription,
					audio_file_path: audioFilePath,
					audio_duration_ms: audioDuration,
				})
				.select()
				.single();

			if (error) {
				throw new Error(`Failed to create bug report: ${error.message}`);
			}

			// Clear captured data after successful submission
			this.clearCapturedData();

			return data;
		} catch (error) {
			console.error('Bug report submission failed');
			throw error;
		}
	}

	/**
	 * Upload audio file to Supabase storage
	 */
	private async uploadAudioFile(
		userId: string,
		audioBlob: Blob,
	): Promise<{ filePath: string; duration: number }> {
		const timestamp = Date.now();
		const fileName = `${timestamp}.webm`;
		const filePath = `${userId}/${fileName}`;

		const { error } = await this.supabase.storage.from('bug-audio').upload(filePath, audioBlob, {
			contentType: audioBlob.type,
			upsert: true,
		});

		if (error) {
			throw new Error(`Failed to upload audio: ${error.message}`);
		}

		// Estimate duration from blob size (rough approximation)
		const duration = Math.round(audioBlob.size / 2000); // ~2KB per second

		return { filePath, duration };
	}

	/**
	 * Get bug reports for the current user
	 */
	async getUserBugReports(): Promise<BugReport[]> {
		try {
			const {
				data: { user },
			} = await this.supabase.auth.getUser();

			if (!user) {
				throw new Error('User must be authenticated');
			}

			const { data, error } = await (this.supabase as any)
				.from('bug_reports')
				.select('*')
				.eq('user_id', user.id)
				.order('created_at', { ascending: false });

			if (error) {
				throw new Error(`Failed to fetch bug reports: ${error.message}`);
			}

			return data || [];
		} catch (error) {
			console.error('Failed to fetch bug reports:', error);
			throw error;
		}
	}

	/**
	 * Get a specific bug report by ID
	 */
	async getBugReport(id: string): Promise<BugReport | null> {
		try {
			const { data, error } = await (this.supabase as any)
				.from('bug_reports')
				.select('*')
				.eq('id', id)
				.single();

			if (error) {
				if (error.code === 'PGRST116') {
					return null; // Not found
				}
				throw new Error(`Failed to fetch bug report: ${error.message}`);
			}

			return data;
		} catch (error) {
			console.error('Failed to fetch bug report:', error);
			throw error;
		}
	}

	/**
	 * Update bug report status
	 */
	async updateBugReportStatus(
		id: string,
		status: 'open' | 'in_progress' | 'resolved' | 'closed',
		resolutionNotes?: string,
	): Promise<BugReport> {
		try {
			const updateData: any = { status };

			if (status === 'resolved' || status === 'closed') {
				updateData.resolved_at = new Date().toISOString();
			}

			if (resolutionNotes) {
				updateData.resolution_notes = resolutionNotes;
			}

			const { data, error } = await (this.supabase as any)
				.from('bug_reports')
				.update(updateData)
				.eq('id', id)
				.select()
				.single();

			if (error) {
				throw new Error(`Failed to update bug report: ${error.message}`);
			}

			return data;
		} catch (error) {
			console.error('Failed to update bug report:', error);
			throw error;
		}
	}

	/**
	 * Delete a bug report and its audio file
	 */
	async deleteBugReport(id: string): Promise<void> {
		try {
			// Get the bug report to find audio file path
			const bugReport = await this.getBugReport(id);

			if (!bugReport) {
				throw new Error('Bug report not found');
			}

			// Delete audio file if it exists
			if (bugReport.audio_file_path) {
				await this.supabase.storage.from('bug-audio').remove([bugReport.audio_file_path]);
			}

			// Delete the bug report record
			const { error } = await (this.supabase as any).from('bug_reports').delete().eq('id', id);

			if (error) {
				throw new Error(`Failed to delete bug report: ${error.message}`);
			}
		} catch (error) {
			console.error('Failed to delete bug report:', error);
			throw error;
		}
	}

	/**
	 * Clear captured data after successful submission
	 */
	private clearCapturedData(): void {
		clearBreadcrumbs();
	}

	/**
	 * Get audio download URL for a bug report
	 */
	async getAudioDownloadUrl(filePath: string): Promise<string> {
		try {
			const { data, error } = await this.supabase.storage
				.from('bug-audio')
				.createSignedUrl(filePath, 60 * 60); // 1 hour expiry

			if (error) {
				throw new Error(`Failed to create download URL: ${error.message}`);
			}

			return data.signedUrl;
		} catch (error) {
			console.error('Failed to create download URL:', error);
			throw error;
		}
	}
}

// Singleton instance
export const bugReportService = new BugReportService();
