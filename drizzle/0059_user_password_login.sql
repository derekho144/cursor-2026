-- Local username/password login for employees
ALTER TABLE `users` ADD COLUMN `username` varchar(64) NULL;
ALTER TABLE `users` ADD COLUMN `password_hash` varchar(255) NULL;
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);
