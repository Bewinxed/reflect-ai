PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_artifacts` (
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
INSERT INTO `__new_artifacts`("id", "version_uuid", "conversation_uuid", "type", "title", "content", "language", "message_uuid", "status", "tool_use_id", "created_at", "updated_at") SELECT "id", "version_uuid", "conversation_uuid", "type", "title", "content", "language", "message_uuid", "status", "tool_use_id", "created_at", "updated_at" FROM `artifacts`;--> statement-breakpoint
DROP TABLE `artifacts`;--> statement-breakpoint
ALTER TABLE `__new_artifacts` RENAME TO `artifacts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;