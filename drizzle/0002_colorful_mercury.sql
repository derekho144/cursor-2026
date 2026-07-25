CREATE TABLE `platform_credentials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform` enum('hellotoby','360pro','freehunter','google_ads') NOT NULL,
	`loginEmail` varchar(320),
	`loginPassword` text,
	`isActive` int NOT NULL DEFAULT 1,
	`lastVerifiedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `platform_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `platform_credentials_platform_unique` UNIQUE(`platform`)
);
