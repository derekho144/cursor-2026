CREATE TABLE `ad_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform` enum('hellotoby','360pro','freehunter','google_ads') NOT NULL,
	`transId` varchar(64) NOT NULL,
	`transDate` varchar(32) NOT NULL,
	`year` int NOT NULL,
	`month` int NOT NULL,
	`description` text,
	`coins` decimal(10,2),
	`hkdAmount` decimal(10,2) NOT NULL,
	`exchangeRate` decimal(8,4),
	`type` enum('expense','refund','topup') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ad_transactions_id` PRIMARY KEY(`id`)
);
