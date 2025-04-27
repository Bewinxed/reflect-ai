// types/common.ts
import type { ClaudeEvent } from "./claude";

/**
 * Represents the overall structure of the WebSocket message payload
 * received from the Chrome extension.
 */
export type Payload = {
	/**
	 * The type of the event contained within the 'content' field.
	 */
	type: ClaudeEvent["type"];

	/** The actual event data, conforming to one of the ClaudeEvent types. */
	content: ClaudeEvent;

	/** The UUID of the conversation this payload relates to. */
	conversation_uuid: string;

	/** The API endpoint the extension intercepted (informational). */
	endpoint: string;

	/** The full URL the extension intercepted (informational). */
	url: string;
};