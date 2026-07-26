-- Content Factory image library + selected media on posts
CREATE TABLE IF NOT EXISTS `linkedin_content_assets` (
  `id` int AUTO_INCREMENT NOT NULL,
  `url` varchar(1024) NOT NULL,
  `storage_key` varchar(512) NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `mime_type` varchar(128) NOT NULL,
  `li_asset_category` enum('food','jewellery','product','fashion','commercial','before_after','other') NOT NULL DEFAULT 'other',
  `li_asset_preferred_for` enum('any','carousel','debate','contrarian') NOT NULL DEFAULT 'any',
  `caption` text,
  `ai_description` text,
  `times_used` int NOT NULL DEFAULT 0,
  `last_used_at` timestamp NULL,
  `active` int NOT NULL DEFAULT 1,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `linkedin_content_assets_id` PRIMARY KEY(`id`)
);

-- selected_media added at runtime via ensureContentPostsTable if missing
