CREATE TABLE `pitch_leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`company_name` varchar(255) NOT NULL,
	`company_website` varchar(512),
	`industry` varchar(128),
	`job_title` varchar(255) NOT NULL,
	`job_url` varchar(1024) NOT NULL,
	`job_description` mediumtext,
	`source` enum('jobsdb','linkedin','indeed','ctgoodjobs') NOT NULL,
	`job_posted_at` timestamp,
	`contact_email` varchar(320),
	`contact_name` varchar(255),
	`email_found_via` enum('job_ad','company_website','hunter_io','manual'),
	`ai_pitch_subject` varchar(512),
	`ai_pitch_body` mediumtext,
	`status` enum('pending_email','pending_review','approved','sent','skipped','bounced','replied') NOT NULL DEFAULT 'pending_email',
	`pitch_sent_at` timestamp,
	`gmail_message_id` varchar(512),
	`company_domain` varchar(255),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pitch_leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pitch_send_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`lead_id` int NOT NULL,
	`sent_at` timestamp NOT NULL DEFAULT (now()),
	`email_subject` varchar(512),
	`email_body` mediumtext,
	`to_email` varchar(320),
	`result` enum('success','failed','bounced') NOT NULL,
	`error_message` text,
	`gmail_message_id` varchar(512),
	CONSTRAINT `pitch_send_log_id` PRIMARY KEY(`id`)
);
