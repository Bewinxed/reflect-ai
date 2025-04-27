// wxt.config.ts
import { defineConfig } from 'wxt';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

export default defineConfig({
	entrypointsDir: 'src/entrypoints',
	manifestVersion: 3,
	runner: {
		binaries: {
			"chrome": "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
		},

	},
	// vite: (env) => ({
	// 	server: {
	// 		port: 3001,
	// 	},
	// }),
	dev: {
		server: {
			port: 3001,
		},
	},
	manifest: {
		manifest_version: 3,
		name: 'Claude Sync',
		version: '1.0',
		permissions: ['scripting', 'activeTab'],
		host_permissions: ['*://*.claude.ai/*'],
		web_accessible_resources: [
			{
				resources: ['interceptor.js'],
				matches: ['*://*.claude.ai/*'],
			},
		],
	},
});
