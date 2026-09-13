/** Privacy-bounded telemetry ingestion. */

import { json, type RequestHandler } from '@sveltejs/kit';
import type { Json } from '$lib/types/database';
import { parseTelemetryEvent, type TelemetryEvent } from '$lib/types/telemetry';

const MAX_EVENTS_PER_REQUEST = 50;
const MAX_REQUEST_BYTES = 64 * 1024;

function sameOriginPath(value: string | null | undefined, origin: string): string | null {
	if (!value) return null;
	try {
		const parsed = new URL(value, origin);
		if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) return null;
		return parsed.pathname.slice(0, 512);
	} catch {
		return null;
	}
}

function normalizedPayload(event: TelemetryEvent, origin: string): Json {
	// Only the URL-bearing fields defined by each event schema are normalized.
	switch (event.event_type) {
		case 'session_start':
			return {
				...event.payload,
				entry_page: sameOriginPath(event.payload.entry_page, origin),
				referrer: sameOriginPath(event.payload.referrer, origin),
			};
		case 'page_view':
			return {
				...event.payload,
				page: sameOriginPath(event.payload.page, origin),
				previous_page: sameOriginPath(event.payload.previous_page, origin),
			};
		default:
			return event.payload;
	}
}

function boundedTimestamp(timestamp: string): string {
	const value = Date.parse(timestamp);
	const now = Date.now();
	return Number.isFinite(value) &&
		value >= now - 24 * 60 * 60 * 1000 &&
		value <= now + 5 * 60 * 1000
		? new Date(value).toISOString()
		: new Date(now).toISOString();
}

export const POST: RequestHandler = async ({ request, locals, url }) => {
	const declaredLength = Number(request.headers.get('Content-Length') ?? 0);
	if (declaredLength > MAX_REQUEST_BYTES)
		return json({ error: 'Request too large' }, { status: 413 });

	try {
		const rawBody = await request.text();
		if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
			return json({ error: 'Request too large' }, { status: 413 });
		}
		const body = JSON.parse(rawBody) as { events?: unknown };
		if (!Array.isArray(body.events))
			return json({ error: 'Missing events array' }, { status: 400 });
		if (body.events.length === 0) return json({ success: true, count: 0 });
		if (body.events.length > MAX_EVENTS_PER_REQUEST) {
			return json({ error: `Too many events (max ${MAX_EVENTS_PER_REQUEST})` }, { status: 400 });
		}

		const validEvents: TelemetryEvent[] = [];
		for (const input of body.events) {
			const result = parseTelemetryEvent(input);
			if (!result.success) return json({ error: 'Invalid telemetry event' }, { status: 400 });
			validEvents.push(result.data);
		}

		const { user } = await locals.safeGetSession();
		const requestUserAgent = request.headers.get('User-Agent')?.slice(0, 256) ?? null;
		const eventsToInsert = validEvents.map((event) => ({
			session_id: event.session_id,
			// Never trust a client-supplied user identifier.
			user_id: user?.id ?? null,
			event_type: event.event_type,
			payload: normalizedPayload(event, url.origin),
			page_url: sameOriginPath(event.page_url, url.origin),
			referrer: sameOriginPath(event.referrer, url.origin),
			user_agent: requestUserAgent,
			timestamp: boundedTimestamp(event.timestamp),
		}));

		const { error } = await locals.supabase.from('telemetry_events').insert(eventsToInsert);
		if (error) {
			console.error('Telemetry insert failed');
			return json({ error: 'Failed to store events' }, { status: 500 });
		}
		return json({ success: true, count: eventsToInsert.length });
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
};
