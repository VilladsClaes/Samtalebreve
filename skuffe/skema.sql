-- Skuffen: tre små tabeller.
-- Kan køres her i phpMyAdmin — eller lade opsaet.php gøre det med ét tryk.

CREATE TABLE IF NOT EXISTS skuffe (
  id INTEGER PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  -- tidsstempel i millisekunder; en almindelig INT ville løbe over
  rettet BIGINT NOT NULL DEFAULT 0,
  data MEDIUMTEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skuffe_indstillinger (
  navn VARCHAR(32) PRIMARY KEY,
  vaerdi MEDIUMTEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skuffe_forsoeg (
  ip VARCHAR(45) PRIMARY KEY,
  antal INTEGER NOT NULL,
  sidst INTEGER NOT NULL
);
