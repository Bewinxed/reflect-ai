// Base event type that all events extend
export interface BaseEvent {
	type: string;
}

// Message related types
export interface Message {
	id: string;
	type: "message";
	role: "assistant" | "user";
	model: string;
	parent_uuid: string;
	uuid: string;
	content: any[];
	stop_reason: string | null;
	stop_sequence: string | null;
}

export interface MessageStartEvent extends BaseEvent {
	type: "message_start" & {};
	message: Message;
}

export interface MessageDelta extends BaseEvent {
	type: "message_delta" & {};
	delta: {
		stop_reason: string | null;
		stop_sequence: string | null;
	};
}

// Content block related types
export interface ContentBlock {
	type: ("text" | "tool_use" | "tool_result") & {};
	text?: string;
	name?: string;
	input?: Record<string, any>;
	id?: string;
	content?: any[];
	is_error?: boolean;
	tool_use_id?: string;
}

export interface ContentBlockStartEvent extends BaseEvent {
	type: "content_block_start" & {};
	index: number;
	content_block: ContentBlock;
}

export interface TextDelta {
	type: "text_delta" & {};
	text: string;
}

export interface InputJsonDelta {
	type: "input_json_delta" & {};
	partial_json: string;
}

type DeltaType = TextDelta | InputJsonDelta;

export interface ContentBlockDeltaEvent extends BaseEvent {
	type: "content_block_delta" & {};
	index: number;
	delta: DeltaType;
}

export interface ContentBlockStopEvent extends BaseEvent {
	type: "content_block_stop" & {};
	index: number;
}

// Message limit related types
export interface MessageLimitInfo {
	type: ("within_limit" | "exceeded_limit") & {};
	resetsAt: string | null;
	remaining: number | null;
	perModelLimit: number | null;
}

export interface MessageLimitEvent extends BaseEvent {
	type: "message_limit" & {};
	message_limit: MessageLimitInfo;
}

// Message stop event
export interface MessageStopEvent extends BaseEvent {
	type: "message_stop" & {};
	stop_reason: string;
}

// Union type of all possible events
export type SSEEvent =
	| MessageStartEvent
	| MessageDelta
	| ContentBlockStartEvent
	| ContentBlockDeltaEvent
	| ContentBlockStopEvent
	| MessageLimitEvent
	| MessageStopEvent;

// Helper type for parsing SSE data
export interface SSEMessage {
	event: string;
	data: string; // JSON string that parses to one of the event types
}
