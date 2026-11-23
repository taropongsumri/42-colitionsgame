declare global {
	namespace App {
		interface Platform {
			server?: import('bun').Server<any>;
			request?: Request;
		}
	}
}

export {};
