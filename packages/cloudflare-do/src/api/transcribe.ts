/** Authenticated audio transcription through Workers AI. */

import { verifySupabaseJWT } from '../auth';
import type { Env } from '../types';

export interface TranscriptionRequest {
	audio: string;
	mimeType: string;
}

export interface TranscriptionResponse {
	text: string;
	confidence?: number;
	duration?: number;
	error?: string;
}

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 7 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = new Set([
	'audio/mp4',
	'audio/mpeg',
	'audio/ogg',
	'audio/wav',
	'audio/webm',
]);

function jsonError(error: string, status: number): Response {
	return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function bearerToken(request: Request): string | null {
	const authorization = request.headers.get('Authorization');
	if (!authorization?.startsWith('Bearer ')) return null;
	const token = authorization.slice('Bearer '.length).trim();
	return token.length > 0 ? token : null;
}

export async function handleTranscribe(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
	if (request.headers.get('Content-Type')?.split(';', 1)[0] !== 'application/json') {
		return jsonError('Content-Type must be application/json', 415);
	}

	const token = bearerToken(request);
	if (!token) return jsonError('Authentication required', 401);
	const authentication = await verifySupabaseJWT(token, env.SUPABASE_URL, env.SUPABASE_JWT_SECRET);
	if (!authentication.success) return jsonError('Authentication failed', 401);

	const declaredLength = Number(request.headers.get('Content-Length') ?? 0);
	if (declaredLength > MAX_REQUEST_BYTES) return jsonError('Request too large', 413);

	try {
		const rawBody = await request.text();
		if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
			return jsonError('Request too large', 413);
		}
		const body = JSON.parse(rawBody) as Partial<TranscriptionRequest>;
		if (typeof body.audio !== 'string' || typeof body.mimeType !== 'string') {
			return jsonError('Invalid transcription request', 400);
		}

		const mimeType = body.mimeType.split(';', 1)[0].toLowerCase();
		if (!ALLOWED_AUDIO_TYPES.has(mimeType)) return jsonError('Unsupported audio type', 415);

		const audioBuffer = base64ToArrayBuffer(body.audio);
		if (audioBuffer.byteLength === 0) return jsonError('Audio data is empty', 400);
		if (!validateAudioSize(audioBuffer)) return jsonError('Audio data is too large', 413);

		const response = await env.AI.run('@cf/openai/whisper-tiny-en', {
			audio: [...new Uint8Array(audioBuffer)],
		});
		return Response.json(
			{ text: typeof response.text === 'string' ? response.text : '' },
			{ headers: { 'Cache-Control': 'no-store' } },
		);
	} catch {
		return jsonError('Transcription failed', 400);
	}
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
	const base64Data = value.replace(/^data:audio\/[a-zA-Z0-9.+-]+(?:;[^,]*)?;base64,/, '');
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data) || base64Data.length % 4 !== 0) {
		throw new Error('Invalid base64');
	}
	const binaryString = atob(base64Data);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
	return bytes.buffer;
}

export function validateAudioSize(audioBuffer: ArrayBuffer): boolean {
	return audioBuffer.byteLength <= MAX_AUDIO_BYTES;
}

export function estimateAudioDuration(audioBuffer: ArrayBuffer, _mimeType: string): number {
	return Math.round(audioBuffer.byteLength / 2000);
}
