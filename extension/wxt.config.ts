// wxt.config.ts
import { defineConfig } from "wxt";

export default defineConfig({
	manifestVersion: 3,
	manifest: {
		manifest_version: 3,
		name: "Claude Sync",
		version: "1.0",
		permissions: ["scripting", "activeTab"],
		host_permissions: ["*://*.claude.ai/*"],
		web_accessible_resources: [
			{
				resources: ["interceptor.js"],
				matches: ["*://*.claude.ai/*"],
			},
		],
	},
});
