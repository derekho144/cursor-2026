ALTER TABLE `quotes` ADD `depositMode` varchar(16) DEFAULT 'percent' NOT NULL;--> statement-breakpoint
ALTER TABLE `quotes` ADD `depositFixedAmount` decimal(10,2);