PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_uuid` text,
	`file_name` text,
	`file_size` integer,
	`file_type` text,
	`extracted_content` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`message_uuid`) REFERENCES `messages`(`uuid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_attachments`("id", "message_uuid", "file_name", "file_size", "file_type", "extracted_content", "created_at") SELECT "id", "message_uuid", "file_name", "file_size", "file_type", "extracted_content", "created_at" FROM `attachments`;--> statement-breakpoint
DROP TABLE `attachments`;--> statement-breakpoint
ALTER TABLE `__new_attachments` RENAME TO `attachments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `unique_attachment` ON `attachments` (`message_uuid`,`file_name`);--> statement-breakpoint
CREATE TABLE `__new_conversations` (
	`uuid` text PRIMARY KEY NOT NULL,
	`name` text,
	`summary` text,
	`model` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`settings` blob,
	`is_starred` integer,
	`current_leaf_message_uuid` text,
	`project_uuid` text,
	FOREIGN KEY (`current_leaf_message_uuid`) REFERENCES `messages`(`uuid`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_uuid`) REFERENCES `projects`(`uuid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_conversations`("uuid", "name", "summary", "model", "created_at", "updated_at", "settings", "is_starred", "current_leaf_message_uuid", "project_uuid") SELECT "uuid", "name", "summary", "model", "created_at", "updated_at", "settings", "is_starred", "current_leaf_message_uuid", "project_uuid" FROM `conversations`;--> statement-breakpoint
DROP TABLE `conversations`;--> statement-breakpoint
ALTER TABLE `__new_conversations` RENAME TO `conversations`;--> statement-breakpoint
CREATE INDEX `starred_idx` ON `conversations` (`is_starred`);--> statement-breakpoint
CREATE UNIQUE INDEX `unique_convo` ON `conversations` (`name`,`model`);--> statement-breakpoint
CREATE TABLE `__new_message_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`message_uuid` text,
	`block_index` integer,
	`type` text,
	`text_content` text,
	`tool_name` text,
	`tool_input` text,
	`tool_result` text,
	`is_error` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`message_uuid`) REFERENCES `messages`(`uuid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_message_contents`("id", "message_uuid", "block_index", "type", "text_content", "tool_name", "tool_input", "tool_result", "is_error", "created_at", "updated_at") SELECT "id", "message_uuid", "block_index", "type", "text_content", "tool_name", "tool_input", "tool_result", "is_error", "created_at", "updated_at" FROM `message_contents`;--> statement-breakpoint
DROP TABLE `message_contents`;--> statement-breakpoint
ALTER TABLE `__new_message_contents` RENAME TO `message_contents`;--> statement-breakpoint
CREATE UNIQUE INDEX `unique_block` ON `message_contents` (`message_uuid`,`block_index`);--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`uuid` text PRIMARY KEY NOT NULL,
	`conversation_uuid` text,
	`text` text,
	`content` blob,
	`sender` text,
	`index` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`truncated` integer,
	`stop_reason` text,
	`parent_message_uuid` text,
	`model` text,
	FOREIGN KEY (`conversation_uuid`) REFERENCES `conversations`(`uuid`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_message_uuid`) REFERENCES `messages`(`uuid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_messages`("uuid", "conversation_uuid", "text", "content", "sender", "index", "created_at", "updated_at", "truncated", "stop_reason", "parent_message_uuid", "model") SELECT "uuid", "conversation_uuid", "text", "content", "sender", "index", "created_at", "updated_at", "truncated", "stop_reason", "parent_message_uuid", "model" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
CREATE INDEX `parent_idx` ON `messages` (`parent_message_uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_order` ON `messages` (`conversation_uuid`,`index`);--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`uuid` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_projects`("uuid", "name") SELECT "uuid", "name" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_name_unique` ON `projects` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `tool_use_ref` ON `artifacts` (`tool_use_id`);