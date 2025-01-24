// src/content.ts
import { defineContentScript } from "wxt/sandbox";
import "../assets/interceptor.js";

export default defineContentScript({
	matches: ["*://*.claude.ai/*"],
	world: "MAIN",
	main() {
		// Create script element
		disableConciseMode();
		return {
			onUnmount() {
				// Cleanup if needed
			},
		};
	},
});

function disableConciseMode() {
	const handleElementInteractions = () => {
		// Find the span containing "concise"
		const conciseSpan = Array.from(document.querySelectorAll("span"))
			.filter((s) => s.textContent?.toLowerCase().includes("concise"))
			.at(-1);

		if (conciseSpan) {
			// Find and trigger the button
			const button = conciseSpan.closest("button");
			if (button) {
				button.dispatchEvent(
					new KeyboardEvent("keydown", {
						bubbles: true,
						cancelable: true,
						key: "Enter",
						keyCode: 13,
					})
				);

				// Wait a brief moment before clicking the "normal" element
				setTimeout(() => {
					const normalDiv = Array.from(document.querySelectorAll("div"))
						.filter((s) => s.textContent?.toLowerCase().includes("normal"))
						.at(-1);

					if (normalDiv) {
						normalDiv.click();
					}
				}, 100); // Small delay to ensure the UI has updated
			}
		}
	};

	// Create a MutationObserver to watch for DOM changes
	window.addEventListener("load", handleElementInteractions);

	return {
		onUnmount() {
			// Cleanup: disconnect the observer when the script is unmounted
			window.removeEventListener("load", handleElementInteractions);
		},
	};
}
