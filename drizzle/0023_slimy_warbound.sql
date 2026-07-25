CREATE TABLE `email_open_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`inquiry_id` int NOT NULL,
	`ip` varchar(64),
	`user_agent` varchar(512),
	`is_bot` tinyint NOT NULL DEFAULT 0,
	`bot_reason` varchar(128),
	`opened_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_open_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `email_inquiries` ADD `real_open_count` int DEFAULT 0 NOT NULL;