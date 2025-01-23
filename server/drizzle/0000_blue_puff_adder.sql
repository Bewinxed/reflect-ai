CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_uuid` text,
	`version_uuid` text,
	`type` text,
	`title` text,
	`content` text,
	`language` text,
	`message_uuid` text,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`conversation_uuid`) REFERENCES `conversations`(`uuid`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_uuid`) REFERENCES `messages`(`uuid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `message_idx` ON `artifacts` (`message_uuid`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_uuid` text,
	`file_name` text,
	`file_size` integer,
	`file_type` text,
	`extracted_content` text,
	`created_at` text,
	FOREIGN KEY (`message_uuid`) REFERENCES `messages`(`uuid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`uuid` text PRIMARY KEY NOT NULL,
	`name` text,
	`summary` text,
	`model` text,
	`created_at` text,
	`updated_at` text,
	`settings` blob,
	`is_starred` integer,
	`current_leaf_message_uuid` text,
	`project_uuid` text
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`uuid` text PRIMARY KEY NOT NULL,
	`conversation_uuid` text,
	`text` text,
	`content` blob,
	`sender` text,
	`index` integer,
	`created_at` text,
	`updated_at` text,
	`truncated` integer,
	`stop_reason` text,
	`parent_message_uuid` text,
	`model` text,
	FOREIGN KEY (`conversation_uuid`) REFERENCES `conversations`(`uuid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`uuid` text PRIMARY KEY NOT NULL,
	`name` text
);
