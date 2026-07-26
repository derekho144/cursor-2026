-- Buffer publish tracking on content factory posts
ALTER TABLE `linkedin_content_posts`
  ADD COLUMN `buffer_post_id` varchar(64) NULL,
  ADD COLUMN `buffer_status` varchar(32) NULL,
  ADD COLUMN `buffer_error` text NULL;
