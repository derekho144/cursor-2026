CREATE TABLE `linkedin_contacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pitch_lead_id` int,
	`company_name` varchar(255) NOT NULL,
	`person_name` varchar(255),
	`person_title` varchar(255),
	`linkedin_profile_url` varchar(1024),
	`linkedin_search_url` varchar(1024),
	`job_title` varchar(255),
	`job_url` varchar(1024),
	`li_stage` enum('new','warm_view','warm_like','connected','dm_sent','replied','meeting','won','paused','skipped') NOT NULL DEFAULT 'new',
	`li_playbook` enum('hire_signal','winback','general') NOT NULL DEFAULT 'hire_signal',
	`dm_draft` mediumtext,
	`next_action_at` timestamp,
	`last_action_at` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `linkedin_contacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `linkedin_actions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contact_id` int NOT NULL,
	`li_action_type` enum('viewed','liked','commented','connected','dm_sent','follow_up','replied','meeting','won','note') NOT NULL,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `linkedin_actions_id` PRIMARY KEY(`id`)
);
