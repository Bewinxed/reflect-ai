import { Subject, fromEvent } from "rxjs";
import { debounceTime, filter, distinctUntilChanged } from "rxjs/operators";

type MessageUpdate = {
	type: "full" | "diff";
	content: string;
};

let ws: WebSocket;
let retryCount = 0;
const maxRetries = 5;

const textDeltaSubject = new Subject<{
	type: "content_block_delta";
	content: {
		index: number;
		text: string;
	};
}>();
const stopEventSubject = new Subject<{
	type: "content_block_stop";
	content: {
		index: number;
	};
}>();
const startEventSubject = new Subject<{
	type: "content_block_start";
	content: {
		id: string;
		type: string;
		role: string;
		model: string;
		index: number;
	};
}>();

function setupWebSocket() {
	ws = new WebSocket("ws://localhost:3000");

	ws.onopen = () => {
		console.log("Connected to WebSocket");
		retryCount = 0; // Reset retry count on successful connection
		injectInterceptorScript();
		setupRxHandlers(); // Set up RxJS handlers
	};

	ws.onclose = () => {
		console.log("Connection lost, retrying...");
		if (retryCount < maxRetries) {
			retryCount++;
			setTimeout(setupWebSocket, 1000);
		} else {
			console.error("Max retry attempts reached. WebSocket not reconnecting.");
		}
	};

	ws.onerror = (error) => {
		console.error("WebSocket error:", error);
	};
}

function injectInterceptorScript() {
	const script = document.createElement("script");
	script.src = chrome.runtime.getURL("interceptor.js"); // Path to the external script
	script.type = "text/javascript";
	script.onload = () => script.remove(); // Clean up after injection
	document.documentElement.appendChild(script);

	// Listen for custom events from the injected script
	window.addEventListener("TextDeltaEvent", (event) => {
		const deltaText = (event as CustomEvent).detail;
		if (deltaText) {
			textDeltaSubject.next(deltaText);
		} else {
			console.warn("Received TextDeltaEvent with no content.");
		}
	});

	window.addEventListener("ContentBlockStopEvent", (event) => {
		stopEventSubject.next((event as CustomEvent).detail);
	});

	window.addEventListener("MessageStartEvent", (event) => {
		const blockData = (event as CustomEvent).detail;
		if (blockData) {
			startEventSubject.next(blockData);
		} else {
			console.warn("Received MessageStartEvent with no content.");
		}
	});
}

function setupRxHandlers() {
	// Handle text deltas with debounce and distinct checks
	textDeltaSubject
		.pipe(
			debounceTime(100), // Reduce redundant updates
			distinctUntilChanged() // Avoid sending duplicates
		)
		.subscribe((deltaText) => {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(
					JSON.stringify(deltaText)
				);
				console.log("Debounced update sent:", deltaText);
			} else {
				console.log("WebSocket not ready, skipping update.");
			}
		});

	// Handle stop events with a simple subscription
	stopEventSubject.subscribe(() => {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(
				JSON.stringify({
					type: "content_block_stop",
				})
			);
			console.log("Stop event sent to backend.");
		} else {
			console.log("WebSocket not ready, skipping stop event.");
		}
	});

	// Handle start events with a simple subscription
	startEventSubject.subscribe((blockData) => {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(
				JSON.stringify({
					type: "message_start",
					content: blockData,
				})
			);
			console.log("Start event sent to backend:", blockData);
		} else {
			console.log("WebSocket not ready, skipping start event.");
		}
	});
}

export default defineContentScript({
	matches: ["*://*.claude.ai/*"],
	main() {
		setupWebSocket();
	},
});
