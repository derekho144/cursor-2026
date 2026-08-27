-- Quote line item category for photographer vs other service split
ALTER TABLE `quote_items`
  ADD COLUMN `category` ENUM(
    'photographer_crew',
    'photobooth',
    'video',
    'transport',
    'included_meta',
    'other'
  ) NULL;
