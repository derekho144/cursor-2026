ALTER TABLE `quotes` ADD `bankTransferPayee` varchar(255);--> statement-breakpoint
ALTER TABLE `quotes` ADD `bankTransferBank` varchar(255);--> statement-breakpoint
ALTER TABLE `quotes` ADD `bankTransferAccount` varchar(64);--> statement-breakpoint
ALTER TABLE `quotes` ADD `bankTransferRef` varchar(64);--> statement-breakpoint
ALTER TABLE `quotes` ADD `fpsPayee` varchar(255);--> statement-breakpoint
ALTER TABLE `quotes` ADD `fpsPhone` varchar(20);--> statement-breakpoint
ALTER TABLE `quotes` ADD `fpsRef` varchar(64);