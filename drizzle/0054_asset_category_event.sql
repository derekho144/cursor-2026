-- Add event photography category to content image library
ALTER TABLE `linkedin_content_assets`
  MODIFY COLUMN `li_asset_category` ENUM(
    'food','jewellery','product','fashion','commercial','before_after','event','other'
  ) NOT NULL DEFAULT 'other';
