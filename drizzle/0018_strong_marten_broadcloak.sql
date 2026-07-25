CREATE TABLE `expenses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` timestamp NOT NULL,
	`category` enum('transport','equipment_rent','equipment_buy','staff','software','marketing','office','other') NOT NULL,
	`description` varchar(512) NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`payee` varchar(255),
	`receipt_url` varchar(1024),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `expenses_id` PRIMARY KEY(`id`)
);
