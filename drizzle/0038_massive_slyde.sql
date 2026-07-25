CREATE TABLE `follow_up_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`days_after_sent` int NOT NULL DEFAULT 3,
	`email_subject_template` varchar(512) NOT NULL DEFAULT 'Re: {{original_subject}}',
	`email_body_template` text NOT NULL DEFAULT ('Hi {{client_name}},

I hope you''re doing well!

I just wanted to check in to see if you had a chance to review the quotation I sent on {{sent_date}}. If you have any questions or need any clarification, I''d be happy to help.

Please feel free to reach out at your convenience — there''s no rush at all.

Looking forward to hearing from you!

Best regards,
JD Studio HK
📧 jdstudiohk@gmail.com
📱 WhatsApp: +852 6416 2572'),
	`send_time_hkt_start` int NOT NULL DEFAULT 10,
	`send_time_hkt_end` int NOT NULL DEFAULT 18,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `follow_up_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quote_follow_ups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gmail_message_id` varchar(255) NOT NULL,
	`gmail_thread_id` varchar(255) NOT NULL,
	`to_email` varchar(255) NOT NULL,
	`to_name` varchar(255),
	`subject` varchar(512) NOT NULL,
	`sent_at` timestamp NOT NULL,
	`status` enum('pending','sent','replied','skipped') NOT NULL DEFAULT 'pending',
	`follow_up_sent_at` timestamp,
	`replied_at` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quote_follow_ups_id` PRIMARY KEY(`id`),
	CONSTRAINT `quote_follow_ups_gmail_message_id_unique` UNIQUE(`gmail_message_id`)
);
--> statement-breakpoint
ALTER TABLE `email_inquiries` ADD `meeting_status` enum('none','pending_meeting','meeting_scheduled','meeting_done') DEFAULT 'none';--> statement-breakpoint
ALTER TABLE `email_inquiries` ADD `estimated_total` int;--> statement-breakpoint
ALTER TABLE `email_inquiries` ADD `meeting_email_draft` text;--> statement-breakpoint
ALTER TABLE `email_inquiries` ADD `meeting_scheduled_at` timestamp;--> statement-breakpoint
ALTER TABLE `email_inquiries` ADD `meeting_notes` text;--> statement-breakpoint
ALTER TABLE `quotes` ADD `email_inquiry_id` int;