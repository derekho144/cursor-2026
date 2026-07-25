CREATE TABLE `whatsapp_click_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`inquiry_id` int,
	`fh_job_id` int,
	`quote_id` int,
	`source` enum('fh_first_email','fh_follow_up','quote_email','review_invite','other') NOT NULL DEFAULT 'other',
	`ip` varchar(64),
	`user_agent` varchar(512),
	`clicked_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `whatsapp_click_events_id` PRIMARY KEY(`id`)
);
