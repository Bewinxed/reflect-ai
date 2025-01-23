import {
	sqliteTable,
	text,
	integer,
	blob,
	index,
	primaryKey,
	unique,
	SQLiteColumn,
	type AnySQLiteColumn,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import type {
	ChatMessageContent,
	ContentType,
	Input,
	Sender,
	StopReason,
} from ".";

export const projects = sqliteTable("projects", {
	uuid: text("uuid").primaryKey(),
	name: text("name").notNull().unique(),
});

export const conversations = sqliteTable(
	"conversations",
	{
		uuid: text("uuid").primaryKey(),
		name: text("name"),
		summary: text("summary"),
		model: text("model"),
		created_at: text("created_at")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
		updated_at: text("updated_at")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
		settings: blob("settings", { mode: "json" }).$type<{
			preview_feature_uses_artifacts: boolean | null;
			preview_feature_uses_latex: boolean | null;
			preview_feature_uses_citations: null;
			enabled_artifacts_attachments: boolean | null;
			enabled_turmeric: null;
			paprika_mode: null;
		}>(),
		is_starred: integer("is_starred", { mode: "boolean" }),
		current_leaf_message_uuid: text("current_leaf_message_uuid"), // Remove foreign key

		project_uuid: text("project_uuid").references(() => projects.uuid),
	},
	(t) => [index("starred_idx").on(t.is_starred)]
);

export const messages = sqliteTable(
	"messages",
	{
		uuid: text("uuid").primaryKey(),
		conversation_uuid: text("conversation_uuid").references(
			(): AnySQLiteColumn => conversations.uuid
		),
		text: text("text"),
		sender: text("sender").$type<string>(),
		index: integer("index"),
		created_at: text("created_at")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
		updated_at: text("updated_at")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
		truncated: integer("truncated", { mode: "boolean" }),
		stop_reason: text("stop_reason").$type<string>(),
		parent_message_uuid: text("parent_message_uuid"),
		model: text("model"),
	},
	(t) => [
		unique("message_order").on(t.conversation_uuid, t.index),
		index("parent_idx").on(t.parent_message_uuid),
	]
);

export const attachments = sqliteTable(
	"attachments",
	{
		id: text("id").primaryKey(),
		message_uuid: text("message_uuid").references(() => messages.uuid),
		file_name: text("file_name"),
		file_size: integer("file_size"),
		file_type: text("file_type"),
		extracted_content: text("extracted_content"),
		created_at: text("created_at")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(t) => [unique("unique_attachment").on(t.message_uuid, t.file_name)]
);

export const artifacts = sqliteTable(
	"artifacts",
	{
		id: text("id").notNull(),
		version_uuid: text("version_uuid")
			.notNull()
			.$defaultFn(() => crypto.randomUUID()),
		conversation_uuid: text("conversation_uuid").references(
			() => conversations.uuid
		),
		type: text("type"),
		title: text("title"),
		content: text("content").notNull(),
		language: text("language"),
		message_uuid: text("message_uuid").references(() => messages.uuid),
		status: text("status", { enum: ["draft", "valid", "invalid", "final"] })
			.notNull()
			.default("draft"),
		tool_use_id: text("tool_use_id"),
		created_at: text("created_at")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
		updated_at: text("updated_at")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(table) => [
		primaryKey({ columns: [table.id, table.version_uuid] }),
		unique("tool_use_ref").on(table.tool_use_id),
	]
);

// Schema Definitions (extensions to existing)
export const messageContents = sqliteTable(
	"message_contents",
	{
		id: text("id").primaryKey(),
		messageUuid: text("message_uuid")
			.references(() => messages.uuid)
			.notNull(),
		blockIndex: integer("block_index").notNull(),
		fragmentSequence: integer("fragment_sequence").notNull(),
		contentType: text("content_type", {
			enum: ["text", "tool_use", "tool_result"],
		}).notNull(),
		textContent: text("text_content"),
		toolInput: text("tool_input"),
		toolResult: text("tool_result"),
		toolUseId: text("tool_use_id"),
		isComplete: integer("is_complete", { mode: "boolean" }).default(false),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => ({
		// Composite unique constraint
		uniqueFragment: uniqueIndex("unique_fragment").on(
			table.messageUuid,
			table.blockIndex,
			table.fragmentSequence
		),
	})
);

// Relations
export const conversationsRelations = relations(
	conversations,
	({ many, one }) => ({
		project: one(projects, {
			fields: [conversations.project_uuid],
			references: [projects.uuid],
		}),
		messages: many(messages),
		currentLeaf: one(messages, {
			fields: [conversations.current_leaf_message_uuid],
			references: [messages.uuid],
		}),
	})
);

export const messagesRelations = relations(messages, ({ one, many }) => ({
	conversation: one(conversations, {
		fields: [messages.conversation_uuid],
		references: [conversations.uuid],
	}),
	parent: one(messages, {
		fields: [messages.parent_message_uuid],
		references: [messages.uuid],
	}),
	attachments: many(attachments),
	artifacts: many(artifacts),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
	message: one(messages, {
		fields: [attachments.message_uuid],
		references: [messages.uuid],
	}),
}));

export const artifactsRelations = relations(artifacts, ({ one }) => ({
	conversation: one(conversations, {
		fields: [artifacts.conversation_uuid],
		references: [conversations.uuid],
	}),
	message: one(messages, {
		fields: [artifacts.message_uuid],
		references: [messages.uuid],
	}),
}));

// Types
export type ChatConversation = typeof conversations.$inferSelect;
export type ChatMessage = typeof messages.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type MessageContent = typeof messageContents.$inferSelect;
