-- Add post_production (後期製作) to expenses.category
ALTER TABLE `expenses`
  MODIFY COLUMN `category` ENUM(
    'transport',
    'equipment_rent',
    'equipment_buy',
    'staff',
    'post_production',
    'software',
    'marketing',
    'office',
    'other'
  ) NOT NULL;
