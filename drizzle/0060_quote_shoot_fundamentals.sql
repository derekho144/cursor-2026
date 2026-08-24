-- Structured shoot fundamentals for pricing learning accuracy
ALTER TABLE `quotes` ADD COLUMN `shootHours` decimal(6,2) NULL;
ALTER TABLE `quotes` ADD COLUMN `crewPhotographers` int NOT NULL DEFAULT 0;
ALTER TABLE `quotes` ADD COLUMN `crewAssistants` int NOT NULL DEFAULT 0;
ALTER TABLE `quotes` ADD COLUMN `crewVideographers` int NOT NULL DEFAULT 0;
ALTER TABLE `quotes` ADD COLUMN `crewOthers` int NOT NULL DEFAULT 0;
