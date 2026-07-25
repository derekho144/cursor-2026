ALTER TABLE `quotes` ADD `depositPaidAmount` decimal(10,2);--> statement-breakpoint
ALTER TABLE `quotes` ADD `depositPaidAt` timestamp;--> statement-breakpoint
ALTER TABLE `quotes` ADD `balancePaidAmount` decimal(10,2);--> statement-breakpoint
ALTER TABLE `quotes` ADD `balancePaidAt` timestamp;--> statement-breakpoint
ALTER TABLE `quotes` ADD `paymentStatus` enum('unpaid','deposit_paid','fully_paid') DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE `quotes` ADD `paymentNotes` text;