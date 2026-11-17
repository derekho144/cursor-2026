ALTER TABLE `deliveries` ADD `receiptEnabled` boolean NOT NULL DEFAULT false;--> statement-breakpoint
UPDATE `deliveries` SET `receiptEnabled` = true WHERE `quoteId` IS NOT NULL;
