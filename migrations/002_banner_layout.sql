-- Flexible banner placement/size/shape and per-section product card size
ALTER TABLE banners ADD COLUMN zone TEXT NOT NULL DEFAULT '';
ALTER TABLE banners ADD COLUMN after_section_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE banners ADD COLUMN category_id INTEGER;
ALTER TABLE banners ADD COLUMN width TEXT NOT NULL DEFAULT 'full';
ALTER TABLE banners ADD COLUMN height_px INTEGER NOT NULL DEFAULT 220;
ALTER TABLE banners ADD COLUMN shape TEXT NOT NULL DEFAULT 'rounded';
ALTER TABLE banners ADD COLUMN fit TEXT NOT NULL DEFAULT 'cover';
ALTER TABLE banners ADD COLUMN text_align TEXT NOT NULL DEFAULT 'left';
ALTER TABLE home_sections ADD COLUMN card_size TEXT NOT NULL DEFAULT 'default';
