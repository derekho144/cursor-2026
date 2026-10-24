-- Split site WA traffic: organic (SEO/GEO) + ai (AEO) vs google_ads / website
ALTER TABLE `whatsapp_click_events` MODIFY COLUMN `source` ENUM(
  'fh_first_email',
  'fh_follow_up',
  'quote_email',
  'review_invite',
  'google_ads',
  'organic',
  'ai',
  'website',
  'other'
) NOT NULL DEFAULT 'other';
ALTER TABLE `whatsapp_click_events` ADD `page_referrer` text;
