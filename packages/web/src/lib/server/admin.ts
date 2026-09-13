import { json } from '@sveltejs/kit';

export interface AuthorizedAdmin {
	userId: string;
}

/**
 * Authenticate the current request and enforce one database-backed RBAC
 * permission. UI visibility is never treated as authorization.
 */
export async function requireAdminPermission(
	locals: App.Locals,
	permission: string,
): Promise<AuthorizedAdmin | Response> {
	const { user } = await locals.safeGetSession();
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { data, error } = await locals.supabase.rpc('has_admin_permission', {
		user_id: user.id,
		perm: permission,
	});

	if (error) {
		console.error('[admin] Permission lookup failed');
		return json({ error: 'Authorization unavailable' }, { status: 503 });
	}

	if (data !== true) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	return { userId: user.id };
}
