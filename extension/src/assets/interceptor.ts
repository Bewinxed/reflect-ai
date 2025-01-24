import type { SSEEvent, SSEMessage } from "../../../types/claudeSSE";
import type { Payload } from "../../../types/common";
// Types for debug messages
interface DebugMessage {
	type: string;
	message: string;
	data?: unknown;
}

// Types for WebSocket messages
interface WebSocketMessage {
	type: string;
	data: unknown;
	conversation_uuid: string | null;
	endpoint: string | undefined;
	url: string;
}

declare global {
	interface Window {
		debug$: {
			next: (data: DebugMessage) => void;
		};
	}
}

window.debug$ = {
	next: (data) =>
		console.log(
			`%c[Debug ${data.type}]%c ${data.message}`,
			"color: blue; font-weight: bold",
			"color: black",
			data.data || ""
		),
};

let isInitialized = false;
let ws: WebSocket | null = null;

// WebSocket Management
function setupWebSocket() {
	if (ws?.readyState === WebSocket.OPEN) return;

	ws = new WebSocket("ws://localhost:3000");

	ws.onopen = () => {
		window.debug$.next({ type: "WS", message: "WebSocket connected" });
	};

	ws.onerror = (error) => {
		window.debug$.next({
			type: "WS-ERROR",
			message: "WebSocket error",
			data: error,
		});
	};

	ws.onclose = () => {
		window.debug$.next({
			type: "WS",
			message: "WebSocket closed, reconnecting...",
		});
		setTimeout(setupWebSocket, 1000);
	};
}

function sendToWebSocket(event: Payload) {
	if (ws?.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(event));
		window.debug$.next({
			type: "WS-SEND",
			message: `Forwarded ${event.type}`,
			data: event.content,
		});
	}
}

// SSE Stream Processing
async function processStream(response: Response, url: string) {
	const reader = response.body?.getReader();
	if (!reader) return;

	const urlObj = new URL(url);
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });

		while (buffer.includes("\n\n")) {
			const eventEnd = buffer.indexOf("\n\n");
			const eventData = buffer.slice(0, eventEnd);
			buffer = buffer.slice(eventEnd + 2);

			let eventType: Payload["type"] = "message_start";
			let data = "";

			// Parse SSE message
			const sseMessage: Partial<SSEMessage> = {};
			for (const line of eventData.split("\n")) {
				if (line.startsWith("event:")) {
					sseMessage.event = line.slice(6).trim();
					eventType = sseMessage.event as Payload["type"];
				}
				if (line.startsWith("data:")) {
					data += line.slice(5).trim();
					sseMessage.data = data;
				}
			}

			const pathSegments = urlObj.pathname.split("/");
			const chatConversationsSegment = pathSegments.findIndex(
				(segment) => segment === "chat_conversations"
			);
			const conversation_uuid = pathSegments.at(chatConversationsSegment + 1);

			if (!conversation_uuid) {
				console.error("No conversation UUID found in URL:", url);
				return;
			}

			if (data) {
				try {
					const parsedData = JSON.parse(data) as SSEEvent;
					sendToWebSocket({
						type: eventType,
						content: parsedData,
						conversation_uuid,
						endpoint: pathSegments.at(-1)!,
						url,
					});
				} catch (error) {
					console.error("SSE parse error:", {
						eventType,
						data: data.slice(0, 100),
					});
				}
			}
		}
	}
}

// API Request Interception
function initializeInterceptors() {
	if (isInitialized) return;

	const originalFetch = window.fetch;
	window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			input instanceof URL
				? input
				: new URL(
						typeof input === "string" ? input : input.url,
						window.location.origin
				  );

		if (
			url.pathname.includes("/api/organizations/") &&
			url.pathname.includes("/chat_conversations")
		) {
			const response = await originalFetch(input, init);
			const clonedResponse = response.clone();

			// Handle SSE streams
			if (
				url.pathname.endsWith("/completion") ||
				url.pathname.endsWith("/retry_completion")
			) {
				processStream(clonedResponse, url.href).catch(console.error);
				return response;
			}

			// Handle JSON responses
			try {
				const contentType = response.headers.get("content-type");
				if (contentType?.includes("application/json")) {
					const data = await clonedResponse.json();
					const pathSegments = url.pathname.split("/");

					const chatConversationsSegment = pathSegments.findIndex(
						(segment) => segment === "chat_conversations"
					);
					const conversationId = pathSegments.at(chatConversationsSegment + 1);

					// Determine event type
					let eventType: Payload["type"] = "conversations_list";
					if (
						url.pathname.includes("/chat_conversations") &&
						conversationId &&
						url.pathname.endsWith(conversationId)
					) {
						eventType = "conversation_detail";
					} else if (pathSegments.at(-1) === "latest") {
						eventType = "conversation_latest";
						return originalFetch(input, init);
					} else if (pathSegments.at(-1) === "chat_message_warning") {
						eventType = "chat_message_warning";
						return originalFetch(input, init);
					} else if (url.pathname.endsWith("title")) {
						eventType = "conversation_title";
					} else {
						console.log("Unknown event type:", url.href);
					}

					const convIndex = pathSegments.indexOf("chat_conversations");
					const conversationUUID =
						convIndex !== -1 && convIndex < pathSegments.length - 1
							? pathSegments[convIndex + 1]
							: null;

					sendToWebSocket({
						type: eventType,
						content: {
							type: eventType,
							data: Array.isArray(data) ? data.slice(1, 10) : data,
						},
						conversation_uuid: conversationUUID!,
						endpoint: pathSegments.at(-1)!,
						url: url.href,
					});
				}
			} catch (error) {
				console.error("Conversation data handling failed:", error);
			}
			return response;
		}
		return originalFetch(input, init);
	};

	setupWebSocket();
	isInitialized = true;
	window.debug$.next({ type: "INIT", message: "Interceptors ready" });
}

// Start interception
initializeInterceptors();
