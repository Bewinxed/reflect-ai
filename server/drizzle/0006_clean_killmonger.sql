PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_message_contents` (
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
INSERT INTO `__new_message_contents`("id", "message_uuid", "block_index", "fragment_sequence", "content_type", "text_content", "tool_input", "tool_result", "tool_use_id", "is_complete", "created_at", "updated_at") SELECT "id", "message_uuid", "block_index", "fragment_sequence", "content_type", "text_content", "tool_input", "tool_result", "tool_use_id", "is_complete", "created_at", "updated_at" FROM `message_contents`;--> statement-breakpoint
DROP TABLE `message_contents`;--> statement-breakpoint
ALTER TABLE `__new_message_contents` RENAME TO `message_contents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `unique_fragment` ON `message_contents` (`message_uuid`,`block_index`,`fragment_sequence`);