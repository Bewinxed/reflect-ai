import type { SSEEvent } from "./claudeSSE";
import type { ClaudeEvent } from "./claude";

export type Payload = {
	type: SSEEvent["type"] | ClaudeEvent["type"];
	content: SSEEvent | ClaudeEvent;
	conversation_uuid: string;
	endpoint: string;
	url: string;
};
