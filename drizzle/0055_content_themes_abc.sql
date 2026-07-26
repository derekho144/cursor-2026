-- Content factory themes → research Type A/B/C
-- project_bts | photo_education | data_viz
-- Asset preferredFor: carousel/debate/contrarian → project/education/data

ALTER TABLE `linkedin_content_posts` MODIFY COLUMN `li_content_type` ENUM(
  'carousel_case_study',
  'outsource_vs_inhire',
  'contrarian_take',
  'case_study',
  'industry_insight',
  'project_bts',
  'photo_education',
  'data_viz'
) NOT NULL;

UPDATE `linkedin_content_posts` SET `li_content_type` = 'project_bts'
  WHERE `li_content_type` IN ('carousel_case_study', 'case_study');
UPDATE `linkedin_content_posts` SET `li_content_type` = 'photo_education'
  WHERE `li_content_type` IN ('outsource_vs_inhire', 'industry_insight');
UPDATE `linkedin_content_posts` SET `li_content_type` = 'data_viz'
  WHERE `li_content_type` = 'contrarian_take';

ALTER TABLE `linkedin_content_posts` MODIFY COLUMN `li_content_type` ENUM(
  'project_bts',
  'photo_education',
  'data_viz'
) NOT NULL;

ALTER TABLE `linkedin_content_assets` MODIFY COLUMN `li_asset_preferred_for` ENUM(
  'any',
  'carousel',
  'debate',
  'contrarian',
  'project',
  'education',
  'data'
) NOT NULL DEFAULT 'any';

UPDATE `linkedin_content_assets` SET `li_asset_preferred_for` = 'project'
  WHERE `li_asset_preferred_for` = 'carousel';
UPDATE `linkedin_content_assets` SET `li_asset_preferred_for` = 'education'
  WHERE `li_asset_preferred_for` = 'debate';
UPDATE `linkedin_content_assets` SET `li_asset_preferred_for` = 'data'
  WHERE `li_asset_preferred_for` = 'contrarian';

ALTER TABLE `linkedin_content_assets` MODIFY COLUMN `li_asset_preferred_for` ENUM(
  'any',
  'project',
  'education',
  'data'
) NOT NULL DEFAULT 'any';
