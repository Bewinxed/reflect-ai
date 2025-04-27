CREATE TABLE `artifacts` (
	`id` text NOT NULL,
	`version_uuid` text NOT NULL,
	`conversation_uuid` text,
	`type` text,
	`title` text,
	`content` text NOT NULL,
	`language` text,
	`message_uuid` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`tool_use_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`id`, `version_uuid`),
	FOREIGN KEY (`conversation_uuid`) REFERENCES `conversations`(`uuid`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_uuid`) REFERENCES `messages`(`uuid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tool_use_ref` ON `artifacts` (`tool_use_id`);--> statement-breakpoint
CREATE TABLE `attachments` (
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
CREATE UNIQUE INDEX `unique_attachment` ON `attachments` (`message_uuid`,`file_name`);--> statement-breakpoint
CREATE TABLE `conversations` (
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
CREATE INDEX `starred_idx` ON `conversations` (`is_starred`);--> statement-breakpoint
CREATE TABLE `message_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`message_uuid` text NOT NULL,
	`block_index` integer NOT NULL,
	`fragment_sequence` integer NOT NULL,
	`content_type` text NOT NULL,
	`text_content` text,
	`tool_input` text,
	`tool_result` text,
	`tool_use_id` text,
	`is_complete` integer DEFAULT false,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`message_uuid`) REFERENCES `messages`(`uuid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_fragment` ON `message_contents` (`message_uuid`,`block_index`,`fragment_sequence`);--> statement-breakpoint
CREATE TABLE `messages` (
	`uuid` text PRIMARY KEY NOT NULL,
	`conversation_uuid` text,
	`text` text,
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
CREATE INDEX `parent_idx` ON `messages` (`parent_message_uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_order` ON `messages` (`conversation_uuid`,`index`);--> statement-breakpoint
CREATE TABLE `projects` (
	`uuid` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_name_unique` ON `projects` (`name`);