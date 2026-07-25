ALTER TABLE `email_inquiries` ADD `follow_up_retry_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `email_inquiries` ADD `follow_up_last_error` varchar(512);