-- Airwallex Payment Links for quote online payments
CREATE TABLE IF NOT EXISTS `airwallex_payment_links` (
  `id` int AUTO_INCREMENT NOT NULL,
  `quote_id` int NOT NULL,
  `kind` enum('deposit','balance','full') NOT NULL,
  `airwallex_id` varchar(64) NOT NULL,
  `url` varchar(1024) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'HKD',
  `status` varchar(32) NOT NULL DEFAULT 'UNPAID',
  `payment_intent_id` varchar(64) NULL,
  `paid_at` timestamp NULL,
  `expires_at` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `airwallex_payment_links_id` PRIMARY KEY(`id`),
  CONSTRAINT `airwallex_payment_links_airwallex_id` UNIQUE(`airwallex_id`)
);

CREATE INDEX `airwallex_payment_links_quote_id` ON `airwallex_payment_links` (`quote_id`);
