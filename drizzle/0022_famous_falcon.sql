ALTER TABLE `email_inquiries` ADD `reply_resend_message_id` varchar(128);--> statement-breakpoint
ALTER TABLE `email_logs` ADD `resend_message_id` varchar(128);--> statement-breakpoint
ALTER TABLE `email_logs` ADD `opened_at` timestamp;--> statement-breakpoint
ALTER TABLE `email_logs` ADD `open_count` int DEFAULT 0 NOT NULL;