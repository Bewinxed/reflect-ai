// src/content.ts
import { defineContentScript } from "wxt/sandbox";
import "../assets/interceptor.js";

export default defineContentScript({
	matches: ["*://*.claude.ai/*"],
	world: "MAIN",
	main() {
		// Create script element

		return {
			onUnmount() {
				// Cleanup if needed
			},
		};
	},
});
