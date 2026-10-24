-- Google Ads ↔ WhatsApp ↔ Quote attribution (GCLID / UTM / campaign / landing)
ALTER TABLE `quotes` ADD `gclid` varchar(255);
ALTER TABLE `quotes` ADD `gbraid` varchar(255);
ALTER TABLE `quotes` ADD `wbraid` varchar(255);
ALTER TABLE `quotes` ADD `utm_source` varchar(128);
ALTER TABLE `quotes` ADD `utm_medium` varchar(128);
ALTER TABLE `quotes` ADD `utm_campaign` varchar(255);
ALTER TABLE `quotes` ADD `utm_content` varchar(255);
ALTER TABLE `quotes` ADD `utm_term` varchar(255);
ALTER TABLE `quotes` ADD `ads_campaign_id` varchar(64);
ALTER TABLE `quotes` ADD `ads_campaign_name` varchar(255);
ALTER TABLE `quotes` ADD `landing_page_url` text;
ALTER TABLE `quotes` ADD `whatsapp_click_id` int;

ALTER TABLE `whatsapp_click_events` MODIFY COLUMN `source` ENUM(
  'fh_first_email',
  'fh_follow_up',
  'quote_email',
  'review_invite',
  'google_ads',
  'website',
  'other'
) NOT NULL DEFAULT 'other';

ALTER TABLE `whatsapp_click_events` ADD `gclid` varchar(255);
ALTER TABLE `whatsapp_click_events` ADD `gbraid` varchar(255);
ALTER TABLE `whatsapp_click_events` ADD `wbraid` varchar(255);
ALTER TABLE `whatsapp_click_events` ADD `utm_source` varchar(128);
ALTER TABLE `whatsapp_click_events` ADD `utm_medium` varchar(128);
ALTER TABLE `whatsapp_click_events` ADD `utm_campaign` varchar(255);
ALTER TABLE `whatsapp_click_events` ADD `utm_content` varchar(255);
ALTER TABLE `whatsapp_click_events` ADD `utm_term` varchar(255);
ALTER TABLE `whatsapp_click_events` ADD `ads_campaign_id` varchar(64);
ALTER TABLE `whatsapp_click_events` ADD `ads_campaign_name` varchar(255);
ALTER TABLE `whatsapp_click_events` ADD `landing_page_url` text;
