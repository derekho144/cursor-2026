CREATE TABLE `quote_costs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quote_id` int NOT NULL,
	`category` enum('freelancer','venue','post_production','transport','equipment_rent','equipment_buy','staff','other') NOT NULL,
	`description` varchar(512) NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`payee` varchar(255),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quote_costs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `platform_credentials` MODIFY COLUMN `accessToken` mediumtext;