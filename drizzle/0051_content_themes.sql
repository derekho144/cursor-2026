-- Migrate LinkedIn content factory themes
-- case_study → carousel_case_study
-- industry_insight → contrarian_take
-- outsource_vs_inhire kept (label: 外包 vs 自聘辯論)

ALTER TABLE `linkedin_content_posts` MODIFY COLUMN `li_content_type` ENUM(
  'case_study',
  'outsource_vs_inhire',
  'industry_insight',
  'carousel_case_study',
  'contrarian_take'
) NOT NULL;
--> statement-breakpoint
UPDATE `linkedin_content_posts` SET `li_content_type` = 'carousel_case_study' WHERE `li_content_type` = 'case_study';
--> statement-breakpoint
UPDATE `linkedin_content_posts` SET `li_content_type` = 'contrarian_take' WHERE `li_content_type` = 'industry_insight';
--> statement-breakpoint
ALTER TABLE `linkedin_content_posts` MODIFY COLUMN `li_content_type` ENUM(
  'carousel_case_study',
  'outsource_vs_inhire',
  'contrarian_take'
) NOT NULL;
