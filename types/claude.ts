// types/claude.ts
// Combined Claude API type definitions

/**
 * Base interface for all Claude API events
 * All events in the Claude API extend this interface
 */
export interface BaseEvent {
  /** Identifies the type of event */
  type: string;
}

/**
 * Base interface for client-server messages
 * Extends the BaseEvent with client information
 */
export interface ClientMessage extends BaseEvent {
  /** Tab ID of the sender */
  tab_id?: string;
  /** Whether the tab is on /new page */
  is_new_tab?: boolean;
  /** Current conversation UUID if available */
  conversation_uuid?: string | null;
  /** API endpoint that was called (if applicable) */
  endpoint?: string;
  /** URL of the tab */
  url?: string;
}

/**
 * Event sent at the beginning of a streaming response
 * Contains the initial message object with empty content
 */
export interface MessageStartEvent extends BaseEvent {
  type: 'message_start';
  /** Initial message object with metadata but empty content */
  message: {
    /** Unique identifier for the message */
    id: string;
    /** Always "message" for message events */
    type: string;
    /** Either "assistant" or "human" */
    role: string;
    /** Model identifier (e.g., "claude-3-7-sonnet-20250219") */
    model: string;
    /** UUID of the parent message */
    parent_uuid: string;
    /** UUID of this message */
    uuid: string;
    /** Empty array that will be populated with content blocks */
    content: any[];
    /** Reason the message stopped generating (null when streaming begins) */
    stop_reason: string | null;
    /** Sequence that caused the model to stop generating (null when streaming begins) */
    stop_sequence: string | null;
    /** Conversation UUID this message belongs to */
    conversation_uuid?: string;
  };
}

/**
 * Event for requesting a new chat conversation
 */
export interface NewChatRequest extends ClientMessage {
  type: 'new_chat_request' & {};
  /** Partial chat conversation data */
  data: Partial<ChatConversation>;
}

/**
 * Event signaling the start of a content block in a streaming response
 */
export interface ContentBlockStartEvent extends BaseEvent {
  type: 'content_block_start' & {};
  /** Index of the content block in the message.content array */
  index: number;
  /** Initial content block with metadata */
  content_block: {
    /** ISO timestamp when this content block started */
    start_timestamp: string;
    /** ISO timestamp when this content block stopped (null when block starts) */
    stop_timestamp: string | null;
    /** Type of content block: "text", "tool_use", "tool_result", or "thinking" */
    type: string;
    /** Initial text content (for "text" blocks) */
    text?: string;
    /** Tool name (for tool_use blocks) */
    name?: string;
    /** Input data (for tool_use blocks) */
    input?: Record<string, any>;
    /** Message content (for various blocks) */
    message?: string;
    /** Tool integration name */
    integration_name?: string | null;
    /** URL for tool integration icon */
    integration_icon_url?: string | null;
    /** Additional context */
    context?: string | null;
    /** Content to display */
    display_content?: string | null;
    /** Unique identifier for the content block */
    id?: string;
    /** Citations for the content */
    citations?: any[];
    /** Whether the result is an error */
    is_error?: boolean;
    /** ID of the associated tool use (for tool_result blocks) */
    tool_use_id?: string;
  };
}

/**
 * Event containing a delta update to a content block
 */
export interface ContentBlockDeltaEvent extends BaseEvent {
  type: 'content_block_delta' & {};
  /** Index of the content block being updated */
  index: number;
  /** The delta update to apply */
  delta: {
    /** Type of delta: "text_delta" for text blocks, "input_json_delta" for tool_use blocks, or "thinking_delta" for thinking blocks */
    type:
      | 'text_delta'
      | 'input_json_delta'
      | 'thinking_delta'
      | 'signature_delta';
    /** Text to append (for text_delta) */
    text?: string;
    /** Partial JSON to append (for input_json_delta) */
    partial_json?: string;
    /** Thinking content to append (for thinking_delta) */
    thinking?: string;
    /** Signature for verifying thinking content (for signature_delta) */
    signature?: string;
  };
}

/**
 * Event signaling the end of a content block
 */
export interface ContentBlockStopEvent extends BaseEvent {
  type: 'content_block_stop' & {};
  /** Index of the content block that has stopped */
  index: number;
  /** ISO timestamp when the content block stopped */
  stop_timestamp: string;
}

/**
 * Event containing updates to the message's metadata
 */
export interface MessageDeltaEvent extends BaseEvent {
  type: 'message_delta' & {};
  /** Updates to the message object */
  delta: {
    /** Reason the message stopped generating (e.g., "end_turn", "stop_sequence", "max_tokens", "tool_use") */
    stop_reason: string | null;
    /** Sequence that caused the model to stop generating */
    stop_sequence: string | null;
  };
  /** Cumulative token usage information (may be present) */
  usage?: {
    /** Cumulative count of output tokens generated */
    output_tokens: number;
  };
}

/**
 * Event providing information about API usage limits
 */
export interface MessageLimitEvent extends BaseEvent {
  type: 'message_limit' & {};
  /** Information about API usage limits */
  message_limit: {
    /** Status of the limit: "within_limit", "approaching_limit", or "reached_limit" */
    type: 'within_limit' | 'approaching_limit' | ('reached_limit' & {});
    /** ISO timestamp when the limit resets */
    resetsAt: string | null;
    /** Number of remaining requests allowed */
    remaining: number | null;
    /** Total limit per model */
    perModelLimit: number | null;
  };
}

/**
 * Event signaling the end of the message stream
 */
export interface MessageStopEvent extends BaseEvent {
  type: 'message_stop' & {};
  /** Reason the message stopped (may be present) */
  stop_reason?: string;
}

/**
 * Heartbeat event sent periodically during streaming
 * Used to keep connections alive and prevent timeouts
 */
export interface PingEvent extends ClientMessage {
  type: 'ping' & {};
  /** Ping payload */
  content?: {
    type: 'ping' & {};
  };
}

/**
 * Represents a chat conversation with Claude
 */
export interface ChatConversation {
  /** Unique identifier for the conversation */
  uuid: string;
  /** User-provided name for the conversation */
  name: string;
  /** Brief summary of the conversation */
  summary: string;
  /** Model identifier or null if not specified */
  model: string | null;
  /** When the conversation was created */
  created_at: Date;
  /** When the conversation was last updated */
  updated_at: Date;
  /** Feature settings for the conversation */
  settings: Settings;
  /** Whether the conversation is marked as starred */
  is_starred: boolean;
  /** UUID of the most recent message in the conversation tree */
  current_leaf_message_uuid: string | null;
  /** UUID of the project this conversation belongs to (if any) */
  project_uuid?: string | null;
  /** Messages in the conversation */
  chat_messages?: ChatMessage[] | Pick<ChatMessage, 'text'>[];
  /** Project this conversation belongs to (if any) */
  project?: Project | null;
}

/**
 * Represents a project that can contain multiple conversations
 */
export interface Project {
  /** Unique identifier for the project */
  uuid: string;
  /** Name of the project */
  name: string;
}

/**
 * Feature settings for a conversation
 */
export interface Settings {
  /** Whether artifacts feature is enabled */
  preview_feature_uses_artifacts: boolean | null;
  /** Whether LaTeX rendering is enabled */
  preview_feature_uses_latex: boolean | null;
  /** Whether citations feature is enabled */
  preview_feature_uses_citations: null;
  /** Whether artifacts attachments are enabled */
  enabled_artifacts_attachments: boolean | null;
  /** Whether Turmeric feature is enabled */
  enabled_turmeric: null;
  /** Whether Paprika mode is enabled */
  paprika_mode: null;
}

/**
 * Represents a message in a chat conversation
 */
export interface ChatMessage {
  /** Unique identifier for the message */
  uuid: string;
  /** Plain text representation of the message */
  text: string;
  /** Structured content of the message */
  content: ChatMessageContent[];
  /** Role of the message sender: "human" or "assistant" */
  sender: Sender;
  /** Position of the message in the conversation */
  index: number;
  /** When the message was created */
  created_at: Date;
  /** When the message was last updated */
  updated_at: Date;
  /** Whether the message was truncated */
  truncated: boolean;
  /** Files attached to the message */
  attachments: Attachment[];
  /** Legacy file attachments */
  files: any[];
  /** Version 2 file attachments */
  files_v2: any[];
  /** Sources synced with this message */
  sync_sources: any[];
  /** UUID of the parent message */
  parent_message_uuid: string;
  /** Reason the message stopped generating (if applicable) */
  stop_reason?: string;
}

/**
 * Represents a file attachment on a message
 */
export interface Attachment {
  /** Unique identifier for the attachment */
  id: string;
  /** UUID of the message the attachment belongs to */
  message_uuid: string;
  /** Name of the attached file */
  file_name: string;
  /** Size of the file in bytes */
  file_size: number;
  /** MIME type of the file */
  file_type: string;
  /** Text content extracted from the file */
  extracted_content: string;
  /** When the attachment was created */
  created_at: string;
}

/**
 * Represents a structured content artifact created or updated during a conversation
 */
export interface Artifact {
  /** Unique identifier for the artifact */
  id: string;
  /** UUID of the artifact version */
  version_uuid: string;
  /** UUID of the conversation the artifact belongs to */
  conversation_uuid?: string | null;
  /** MIME type of the artifact (e.g., "application/vnd.ant.code") */
  type?: string | null;
  /** User-friendly title of the artifact */
  title?: string | null;
  /** Content of the artifact */
  content: string;
  /** Programming language (for code artifacts) */
  language?: string | null;
  /** Current status of the artifact */
  status: 'draft' | 'valid' | 'invalid' | 'final';
  /** ID of the tool use that created this artifact */
  tool_use_id?: string | null;
  /** UUID of the message that created this artifact */
  message_uuid?: string | null;
  /** When the artifact was created */
  created_at?: string;
  /** When the artifact was last updated */
  updated_at?: string;
}

/**
 * Represents a structured content block within a message
 */
export interface ChatMessageContent {
  /** Type of content: "text", "tool_use", or "tool_result" */
  type: ContentType;
  /** Text content (for "text" blocks) */
  text?: string;
  /** Tool name (for "tool_use" blocks) */
  name?: string;
  /** Input for the tool (for "tool_use" blocks) */
  input?: Input;
  /** Nested content (for compound blocks) */
  content?: ContentContent[];
  /** Whether the result is an error */
  is_error?: boolean;
}

/**
 * Input data for a tool use
 */
export interface Input {
  /** Unique identifier for the input */
  id: string;
  /** MIME type of the input */
  type?: string;
  /** Title of the input */
  title?: string;
  /** Command to execute */
  command?: string;
  /** Content of the input */
  content?: string;
  /** Programming language (for code inputs) */
  language?: Language;
  /** UUID of the version */
  version_uuid: string;
  /** New string for update operations */
  new_str?: string;
  /** Old string for update operations */
  old_str?: string;
}

/**
 * Types of content blocks in messages
 */
export enum ContentType {
  /** Plain text content */
  Text = 'text',
  /** Result from a tool execution */
  ToolResult = 'tool_result',
  /** Request to use a tool */
  ToolUse = 'tool_use',
  /** Thinking/reasoning content (extended thinking) */
  Thinking = 'thinking'
}

/**
 * Nested content within a content block
 */
export interface ContentContent {
  /** Type of the nested content */
  type: ContentType;
  /** Text of the nested content */
  text: string;
}

/**
 * Programming language for code content
 */
export type Language = string;

/**
 * MIME type for inputs
 */
export type InputType = 'application/vnd.ant.code';

/**
 * Name of a tool
 */
export type Name = 'artifacts';

/**
 * Role of a message sender
 */
export type Sender = 'human' | 'assistant';

/**
 * Reasons why a message might stop generating
 */
export enum StopReason {
  /** A stop sequence was reached */
  StopSequence = 'stop_sequence',
  /** Maximum tokens were reached */
  MaxTokens = 'max_tokens',
  /** The model decided to end its turn */
  EndTurn = 'end_turn',
  /** The model is using a tool */
  ToolUse = 'tool_use'
}

/**
 * Event containing a list of conversations
 */
export interface ConversationsEvent extends ClientMessage {
  type: 'conversations_list' & {};
  /** List of conversation data */
  content: {
    type: 'conversations_list' & {};
    data: ChatConversation[];
  };
}

/**
 * Event containing details of a single conversation
 */
export interface ConversationDetailEvent extends ClientMessage {
  type: 'conversation_detail' & {};
  /** Conversation data */
  content: {
    type: 'conversation_detail' & {};
    data: ChatConversation;
  };
}

/**
 * Event containing the latest messages in a conversation
 */
export interface ConversationLatestEvent extends ClientMessage {
  type: 'conversation_latest' & {};
  /** Latest messages */
  content: {
    type: 'conversation_latest' & {};
    data: ChatMessage[];
  };
}

/**
 * Event containing a conversation title update
 */
export interface ConversationTitleEvent extends ClientMessage {
  type: 'conversation_title' & {};
  /** New title */
  content: {
    type: 'conversation_title' & {};
    title: string;
  };
}

/**
 * Event containing a warning about a chat message
 */
export interface ChatMessageWarningEvent extends ClientMessage {
  type: 'chat_message_warning' & {};
  /** Warning message */
  content: {
    type: 'chat_message_warning' & {};
    data: string;
  };
}

/**
 * Event signaling a new conversation
 */
export interface NewConversationEvent extends ClientMessage {
  type: 'new_conversation' & {};
  /** New conversation data */
  content: {
    type: 'new_conversation' & {};
    data: ChatConversation;
  };
}

/**
 * Tab focus event - sent when a tab receives or loses focus
 */
export interface TabFocusEvent extends ClientMessage {
  type: 'tab_focus' & {};
  /** Focus information */
  content: {
    active: boolean;
  };
}

/**
 * Worker registration event - sent when a tab initializes
 */
export interface WorkerRegisterEvent extends ClientMessage {
  type: 'worker_register' & {};
  /** Registration information */
  content: {
    type: 'worker_register' & {};
    clientId: string;
    tabId: string;
    isWorker: boolean; // Indicates if this is a /new tab
    pathname: string;
  };
}

/**
 * Event sent when a tab updates its active conversation
 */
export interface WorkerUpdateActiveConversationEvent extends ClientMessage {
  type: 'worker_update_active_conversation' & {};
  /** Conversation update information */
  content: {
    type: 'worker_update_active_conversation' & {};
    clientId: string;
    tabId: string;
    conversationId: string;
  };
}

/**
 * Union type of all possible Claude API events
 */
export type ClaudeEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageLimitEvent
  | MessageStopEvent
  | PingEvent
  | ConversationsEvent
  | ConversationDetailEvent
  | ConversationLatestEvent
  | ConversationTitleEvent
  | ChatMessageWarningEvent
  | NewConversationEvent
  | NewChatRequest
  | WorkerRegisterEvent
  | WorkerUpdateActiveConversationEvent
  | TabFocusEvent
  | ErrorEvent;

export interface ErrorEvent extends BaseEvent {
  type: 'error';
  /** Error message */
  content: {
    type: 'error';
    message: string;
  };
}
// Common payload structure for both frontend and backend
export type Payload<T extends ClaudeEvent['type'] = any> = Extract<
  ClaudeEvent,
  { type: T }
> & {
  conversation_uuid?: string | null;
  endpoint?: string;
  url?: string;
  tab_id?: string;
  is_new_tab?: boolean;
};
