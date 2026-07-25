CREATE TABLE `client_memberships` (
	`id` int AUTO_INCREMENT NOT NULL,
	`client_id` int NOT NULL,
	`tier` enum('silver','golden','diamond') NOT NULL DEFAULT 'silver',
	`total_spend` decimal(10,2) NOT NULL DEFAULT '0',
	`joined_at` timestamp NOT NULL DEFAULT (now()),
	`tier_upgraded_at` timestamp NOT NULL DEFAULT (now()),
	`notes` text,
	CONSTRAINT `client_memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `client_memberships_client_id_unique` UNIQUE(`client_id`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_emails_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`client_id` int NOT NULL,
	`email_type` enum('welcome','day30','day90','day180','birthday','tier_upgrade','referral_reward') NOT NULL,
	`quote_id` int,
	`discount_code` varchar(32),
	`sent_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `loyalty_emails_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `referral_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(16) NOT NULL,
	`referrer_id` int NOT NULL,
	`used_by_client_id` int,
	`reward_amount` decimal(10,2) NOT NULL DEFAULT '200',
	`status` enum('active','used','expired') NOT NULL DEFAULT 'active',
	`used_at` timestamp,
	`expires_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `referral_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `referral_codes_code_unique` UNIQUE(`code`)
);
