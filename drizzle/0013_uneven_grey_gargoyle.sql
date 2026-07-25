CREATE TABLE `email_inquiries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gmail_message_id` varchar(512) NOT NULL,
	`gmail_thread_id` varchar(512),
	`from_email` varchar(320) NOT NULL,
	`from_name` varchar(255),
	`subject` varchar(512),
	`body_text` text,
	`received_at` timestamp NOT NULL,
	`ai_parsed` text,
	`ai_confidence` varchar(16),
	`quote_id` int,
	`status` enum('pending','approved','rejected','ignored') NOT NULL DEFAULT 'pending',
	`inq_rejected_reason` varchar(255),
	`processed_at` timestamp,
	`auto_replied_at` timestamp,
	`external_link` varchar(1024),
	`inq_created_at` timestamp NOT NULL DEFAULT (now()),
	`inq_updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_inquiries_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_inquiries_gmail_message_id_unique` UNIQUE(`gmail_message_id`)
);
--> statement-breakpoint
ALTER TABLE `platform_credentials` ADD `accessToken` text;--> statement-breakpoint
ALTER TABLE `platform_credentials` ADD `refreshToken` text;--> statement-breakpoint
ALTER TABLE `platform_credentials` ADD `tokenExpiresAt` bigint;--> statement-breakpoint
ALTER TABLE `platform_credentials` ADD `firebaseUid` varchar(128);--> statement-breakpoint
ALTER TABLE `quotes` ADD `signToken` varchar(128);--> statement-breakpoint
ALTER TABLE `quotes` ADD `signedAt` timestamp;--> statement-breakpoint
ALTER TABLE `quotes` ADD `signedByName` varchar(255);--> statement-breakpoint
ALTER TABLE `quotes` ADD `signatureData` text;--> statement-breakpoint
ALTER TABLE `quotes` ADD `signAttachments` text;--> statement-breakpoint
ALTER TABLE `quotes` ADD `rejected_reason` varchar(255);--> statement-breakpoint
ALTER TABLE `quotes` ADD CONSTRAINT `quotes_signToken_unique` UNIQUE(`signToken`);