-- Track Google Ads offline conversion uploads for quotes (GCLID / gbraid / wbraid).
ALTER TABLE `quotes` ADD `ads_offline_inquiry_uploaded_at` timestamp NULL;
ALTER TABLE `quotes` ADD `ads_offline_accepted_uploaded_at` timestamp NULL;
ALTER TABLE `quotes` ADD `ads_offline_last_error` varchar(512);
