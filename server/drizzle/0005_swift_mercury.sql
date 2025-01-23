PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_message_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`message_uuid` text NOT NULL,
	`block_index` integer NOT NULL,
	`content_type` text NOT NULL,
	`text_content` text,
	`tool_name` text,
	`tool_input` blob,
	`tool_result` text,
	`fragment_sequence` integer,
	`is_complete` integer DEFAULT false,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`is_active` integer DEFAULT true,
	`tool_use_id` text,
	FOREIGN KEY (`message_uuid`) REFERENCES `messages`(`uuid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_message_contents`("id", "message_uuid", "block_index", "content_type", "text_content", "tool_name", "tool_input", "tool_result", "fragment_sequence", "is_complete", "created_at", "updated_at", "is_active", "tool_use_id") SELECT "id", "message_uuid", "block_index", "content_type", "text_content", "tool_name", "tool_input", "tool_result", "fragment_sequence", "is_complete", "created_at", "updated_at", "is_active", "tool_use_id" FROM `message_contents`;--> statement-breakpoint
DROP TABLE `message_contents`;--> statement-breakpoint
ALTER TABLE `__new_message_contents` RENAME TO `message_contents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `content_type_idx` ON `message_contents` (`content_type`);--> statement-breakpoint
CREATE INDEX `fragment_seq_idx` ON `message_contents` (`message_uuid`,`block_index`,`fragment_sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `unique_block` ON `message_contents` (`message_uuid`,`block_index`);--> statement-breakpoint
ALTER TABLE `messages` DROP COLUMN `content`;