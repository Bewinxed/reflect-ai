import type { BaseEvent, SSEEvent } from "./claudeSSE";

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

interface Attachment {
	id: string;
	message_uuid: string;
	file_name: string;
	file_size: number;
	file_type: string;
	extracted_content: string;
	created_at: string;
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

export type Language = string;

export type InputType = "application/vnd.ant.code";

export type Name = "artifacts";

export type Sender = "human" | "assistant";

export enum StopReason {
	StopSequence = "stop_sequence",
}

export interface ContentContent {
	type: ContentType;
	text: string;
}

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
	| (
			| ConversationsEvent
			| ConversationDetailEvent
			| ConversationLatestEvent
			| ConversationTitleEvent
			| ChatMessageWarningEvent
	  );
