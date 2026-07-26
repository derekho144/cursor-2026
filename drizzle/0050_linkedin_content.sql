CREATE TABLE `linkedin_content_posts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`week_key` varchar(16) NOT NULL,
	`li_content_type` enum('case_study','outsource_vs_inhire','industry_insight') NOT NULL,
	`li_content_status` enum('draft','pending_review','approved','scheduled','published','rejected') NOT NULL DEFAULT 'pending_review',
	`title` varchar(512) NOT NULL,
	`body` mediumtext NOT NULL,
	`media_hint` text,
	`scheduled_for` timestamp,
	`published_at` timestamp,
	`approved_at` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `linkedin_content_posts_id` PRIMARY KEY(`id`)
);
