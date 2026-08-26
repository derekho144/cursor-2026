-- Link expenses auto-created from quote project costs
ALTER TABLE `expenses` ADD COLUMN `quote_cost_id` int NULL;
CREATE UNIQUE INDEX `expenses_quote_cost_id_unique` ON `expenses` (`quote_cost_id`);
