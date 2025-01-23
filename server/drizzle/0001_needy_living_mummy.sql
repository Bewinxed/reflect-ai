CREATE TABLE `message_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`message_uuid` text,
	`block_index` integer,
	`type` text,
	`text_content` text,
	`tool_name` text,
	`tool_input` text,
	`tool_result` text,
	`is_error` integer,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`message_uuid`) REFERENCES `messages`(`uuid`) ON UPDATE no action ON DELETE no action
);
