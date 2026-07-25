ALTER TABLE `quotes` ADD `depositPercent` decimal(5,2) DEFAULT '50' NOT NULL;--> statement-breakpoint
ALTER TABLE `quotes` ADD `paymentNetDays` int;