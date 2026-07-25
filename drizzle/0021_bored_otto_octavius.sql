ALTER TABLE `email_inquiries` ADD `reply_tracking_id` varchar(64);--> statement-breakpoint
ALTER TABLE `email_inquiries` ADD `reply_opened_at` timestamp;--> statement-breakpoint
ALTER TABLE `email_inquiries` ADD `reply_open_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `email_inquiries` ADD CONSTRAINT `email_inquiries_reply_tracking_id_unique` UNIQUE(`reply_tracking_id`);