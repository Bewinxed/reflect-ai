// types/claude.ts
// Combined Claude API type definitions

// Base event interface
export interface BaseEvent {
	type: string;
}

// SSE Event Types
export interface MessageStartEvent extends BaseEvent {
	type: "message_start";
	message: {
		id: string;
		type: string;
		role: string;
		model: string;
		parent_uuid: string;
		uuid: string;
		content: any[];
		stop_reason: string | null;
		stop_sequence: string | null;
	};
}

export interface ContentBlockStartEvent extends BaseEvent {
	type: "content_block_start";
	index: number;
	content_block: {
		start_timestamp: string;
		stop_timestamp: string | null;
		type: string;
		text?: string;
		name?: string;
		input?: Record<string, any>;
		message?: string;
		integration_name?: string | null;
		integration_icon_url?: string | null;
		context?: string | null;
		display_content?: string | null;
		id?: string;
		citations?: any[];
		is_error?: boolean;
		tool_use_id?: string;
	};
}

export interface ContentBlockDeltaEvent extends BaseEvent {
	type: "content_block_delta";
	index: number;
	delta: {
		type: "text_delta" | "input_json_delta";
		text?: string;
		partial_json?: string;
	};
}

export interface ContentBlockStopEvent extends BaseEvent {
	type: "content_block_stop";
	index: number;
	stop_timestamp: string;
}

export interface MessageDeltaEvent extends BaseEvent {
	type: "message_delta";
	delta: {
		stop_reason: string | null;
		stop_sequence: string | null;
	};
}

export interface MessageLimitEvent extends BaseEvent {
	type: "message_limit";
	message_limit: {
		type: "within_limit" | "approaching_limit" | "reached_limit";
		resetsAt: string | null;
		remaining: number | null;
		perModelLimit: number | null;
	};
}

export interface MessageStopEvent extends BaseEvent {
	type: "message_stop";
	stop_reason?: string;
}

export interface PingEvent extends BaseEvent {
	type: "ping";
}

export type SSEEvent =
	| MessageStartEvent
	| ContentBlockStartEvent
	| ContentBlockDeltaEvent
	| ContentBlockStopEvent
	| MessageDeltaEvent
	| MessageLimitEvent
	| MessageStopEvent
	| PingEvent;

// Claude API Model Types
export interface ChatConversation {
	uuid: string;
	name: string;
	summary: string;
	model: string | null;
	created_at: Date;
	updated_at: Date;
	settings: Settings;
	is_starred: boolean;
	current_leaf_message_uuid: string | null;
	project_uuid?: string | null;
	chat_messages?: ChatMessage[];
	project?: Project | null;
}

export interface Project {
	uuid: string;
	name: string;
}

export interface Settings {
	preview_feature_uses_artifacts: boolean | null;
	preview_feature_uses_latex: boolean | null;
	preview_feature_uses_citations: null;
	enabled_artifacts_attachments: boolean | null;
	enabled_turmeric: null;
	paprika_mode: null;
}

export interface ChatMessage {
	uuid: string;
	text: string;
	content: ChatMessageContent[];
	sender: Sender;
	index: number;
	created_at: Date;
	updated_at: Date;
	truncated: boolean;
	attachments: Attachment[];
	files: any[];
	files_v2: any[];
	sync_sources: any[];
	parent_message_uuid: string;
	stop_reason?: string;
}

export interface Attachment {
	id: string;
	message_uuid: string;
	file_name: string;
	file_size: number;
	file_type: string;
	extracted_content: string;
	created_at: string;
}

export interface Artifact {
	id: string;
	version_uuid: string;
	conversation_uuid?: string | null;
	type?: string | null;
	title?: string | null;
	content: string;
	language?: string | null;
	status: "draft" | "valid" | "invalid" | "final";
	tool_use_id?: string | null;
	message_uuid?: string | null;
	created_at?: string;
	updated_at?: string;
}

export interface ChatMessageContent {
	type: ContentType;
	text?: string;
	name?: string;
	input?: Input;
	content?: ContentContent[];
	is_error?: boolean;
}

export interface Input {
	id: string;
	type?: string;
	title?: string;
	command?: string;
	content?: string;
	language?: Language;
	version_uuid: string;
	new_str?: string;
	old_str?: string;
}

export enum ContentType {
	Text = "text",
	ToolResult = "tool_result",
	ToolUse = "tool_use",
}

export interface ContentContent {
	type: ContentType;
	text: string;
}

export type Language = string;

export type InputType = "application/vnd.ant.code";

export type Name = "artifacts";

export type Sender = "human" | "assistant";

export enum StopReason {
	StopSequence = "stop_sequence",
	MaxTokens = "max_tokens"
}

// Other Claude Events
export interface ConversationsEvent extends BaseEvent {
	type: "conversations_list" & {};
	data: ChatConversation[];
}

export interface ConversationDetailEvent extends BaseEvent {
	type: "conversation_detail" & {};
	data: ChatConversation;
}

export interface ConversationLatestEvent extends BaseEvent {
	type: "conversation_latest" & {};
	data: ChatMessage[];
}

export interface ConversationTitleEvent extends BaseEvent {
	type: "conversation_title" & {};
	title: string;
}

export interface ChatMessageWarningEvent extends BaseEvent {
	type: "chat_message_warning" & {};
	data: string;
}

export type ClaudeEvent =
	| SSEEvent
	| ConversationsEvent
	| ConversationDetailEvent
	| ConversationLatestEvent
	| ConversationTitleEvent
	| ChatMessageWarningEvent;