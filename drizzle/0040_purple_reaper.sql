CREATE TABLE `scheduler_locks` (
	`lock_key` varchar(128) NOT NULL,
	`locked_at` timestamp NOT NULL DEFAULT (now()),
	`locked_until` timestamp NOT NULL,
	`locked_by` varchar(64) NOT NULL DEFAULT 'scheduler',
	CONSTRAINT `scheduler_locks_lock_key` PRIMARY KEY(`lock_key`)
);
