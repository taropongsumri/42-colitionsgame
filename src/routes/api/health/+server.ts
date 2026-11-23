import { json } from '@sveltejs/kit';

export function GET() {
	return json({
		ok: true,
		phase: 0,
		name: 'coalition-backrooms',
		time: new Date().toISOString()
	});
}
