CREATE TABLE `deliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`token` varchar(64) NOT NULL,
	`quoteId` int,
	`clientName` varchar(255) NOT NULL,
	`title` varchar(512) NOT NULL,
	`googleDriveUrl` text NOT NULL,
	`message` text,
	`status` enum('active','expired','archived') NOT NULL DEFAULT 'active',
	`downloadCount` int NOT NULL DEFAULT 0,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `deliveries_token_unique` UNIQUE(`token`)
);
