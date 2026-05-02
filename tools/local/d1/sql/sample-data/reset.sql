PRAGMA foreign_keys = OFF;

DELETE FROM contributions;
DELETE FROM contributors;
DELETE FROM settings;
DELETE FROM sqlite_sequence
WHERE name IN ("contributors", "contributions");

PRAGMA foreign_keys = ON;
