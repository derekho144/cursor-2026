-- Richer rejection learning fields + event duration packaging
ALTER TABLE `quotes` ADD COLUMN `durationPackage` varchar(16);
ALTER TABLE `quotes` ADD COLUMN `rejectedBudgetMax` int;
ALTER TABLE `quotes` ADD COLUMN `rejectedCompetitorPrice` int;
