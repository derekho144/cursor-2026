CREATE TABLE `ad_expenses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform` enum('hellotoby','360pro','freehunter','google_ads') NOT NULL,
	`year` int NOT NULL,
	`month` int NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'HKD',
	`impressions` int,
	`clicks` int,
	`conversions` int,
	`notes` text,
	`isAutoSynced` int NOT NULL DEFAULT 0,
	`rawData` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ad_expenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ad_platform_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform` enum('hellotoby','360pro','freehunter','google_ads') NOT NULL,
	`isEnabled` int NOT NULL DEFAULT 0,
	`apiKey` text,
	`apiSecret` text,
	`accountId` varchar(255),
	`lastSyncAt` timestamp,
	`syncStatus` enum('idle','syncing','success','error') DEFAULT 'idle',
	`syncError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ad_platform_configs_id` PRIMARY KEY(`id`),
	CONSTRAINT `ad_platform_configs_platform_unique` UNIQUE(`platform`)
);
--> statement-breakpoint
CREATE TABLE `ad_sync_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform` enum('hellotoby','360pro','freehunter','google_ads') NOT NULL,
	`status` enum('success','error') NOT NULL,
	`message` text,
	`recordsUpdated` int DEFAULT 0,
	`syncedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ad_sync_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quote_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quoteId` int NOT NULL,
	`description` text NOT NULL,
	`quantity` decimal(8,2) NOT NULL DEFAULT '1',
	`unit` varchar(32) DEFAULT '次',
	`unitPrice` decimal(10,2) NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `quote_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quoteNumber` varchar(32) NOT NULL,
	`clientName` varchar(255) NOT NULL,
	`clientEmail` varchar(320),
	`clientPhone` varchar(64),
	`clientCompany` varchar(255),
	`serviceType` enum('corporate_event','product','food_beverage','jewelry','artwork','interior','video_production','other') NOT NULL,
	`shootingDate` varchar(32),
	`shootingLocation` text,
	`notes` text,
	`subtotal` decimal(10,2) NOT NULL DEFAULT '0',
	`discountAmount` decimal(10,2) NOT NULL DEFAULT '0',
	`total` decimal(10,2) NOT NULL DEFAULT '0',
	`currency` varchar(8) NOT NULL DEFAULT 'HKD',
	`status` enum('draft','sent','accepted','rejected','expired') NOT NULL DEFAULT 'draft',
	`pdfUrl` text,
	`pdfKey` varchar(512),
	`llmDescription` text,
	`validUntil` varchar(32),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quotes_id` PRIMARY KEY(`id`),
	CONSTRAINT `quotes_quoteNumber_unique` UNIQUE(`quoteNumber`)
);
