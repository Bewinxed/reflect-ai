PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	FOREIGN KEY (`project_uuid`) REFERENCES `projects`(`uuid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_conversations`("uuid", "name", "summary", "model", "created_at", "updated_at", "settings", "is_starred", "current_leaf_message_uuid", "project_uuid") SELECT "uuid", "name", "summary", "model", "created_at", "updated_at", "settings", "is_starred", "current_leaf_message_uuid", "project_uuid" FROM `conversations`;--> statement-breakpoint
DROP TABLE `conversations`;--> statement-breakpoint
ALTER TABLE `__new_conversations` RENAME TO `conversations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `starred_idx` ON `conversations` (`is_starred`);--> statement-breakpoint
CREATE UNIQUE INDEX `unique_convo` ON `conversations` (`name`,`model`);--> statement-breakpoint
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
	FOREIGN KEY (`conversation_uuid`) REFERENCES `conversations`(`uuid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_messages`("uuid", "conversation_uuid", "text", "content", "sender", "index", "created_at", "updated_at", "truncated", "stop_reason", "parent_message_uuid", "model") SELECT "uuid", "conversation_uuid", "text", "content", "sender", "index", "created_at", "updated_at", "truncated", "stop_reason", "parent_message_uuid", "model" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
CREATE INDEX `parent_idx` ON `messages` (`parent_message_uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_order` ON `messages` (`conversation_uuid`,`index`);