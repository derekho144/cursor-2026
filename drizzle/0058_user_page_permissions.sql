-- Employee page permissions
ALTER TABLE `users` ADD COLUMN `is_active` boolean NOT NULL DEFAULT true;
ALTER TABLE `users` ADD COLUMN `allowed_pages` json NULL;
