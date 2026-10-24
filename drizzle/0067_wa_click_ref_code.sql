-- Short ref code in WA prefill so staff can match Ads clicks without reading chat APIs
ALTER TABLE `whatsapp_click_events` ADD `ref_code` varchar(16);
CREATE UNIQUE INDEX `whatsapp_click_events_ref_code_uidx` ON `whatsapp_click_events` (`ref_code`);
