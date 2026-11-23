import { env } from '../../../config';

export function isAdmin(request: Request): boolean {
	return request.headers.get('x-admin-password') === env.adminPassword;
}
