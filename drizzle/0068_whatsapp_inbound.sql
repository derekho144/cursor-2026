-- WhatsApp Cloud API inbound messages → Ads click auto-match
ALTER TABLE `whatsapp_click_events` ADD `matched_phone` varchar(32);

CREATE TABLE IF NOT EXISTS `whatsapp_inbound_messages` (
  `id` int AUTO_INCREMENT NOT NULL,
  `wa_message_id` varchar(128) NOT NULL,
  `from_phone` varchar(32) NOT NULL,
  `contact_name` varchar(255),
  `body` text,
  `wa_timestamp` timestamp NULL,
  `matched_click_id` int,
  `match_reason` varchar(32),
  `raw_json` mediumtext,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `whatsapp_inbound_messages_id` PRIMARY KEY(`id`),
  CONSTRAINT `whatsapp_inbound_messages_wa_message_id_uidx` UNIQUE(`wa_message_id`)
);

CREATE INDEX `whatsapp_inbound_from_phone_idx` ON `whatsapp_inbound_messages` (`from_phone`);
CREATE INDEX `whatsapp_inbound_matched_click_idx` ON `whatsapp_inbound_messages` (`matched_click_id`);
