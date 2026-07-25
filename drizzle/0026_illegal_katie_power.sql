CREATE TABLE `ai_analysis_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`year` int NOT NULL,
	`month` int NOT NULL,
	`analysis` text NOT NULL,
	`data_snapshot` json,
	`generatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_analysis_reports_id` PRIMARY KEY(`id`)
);
