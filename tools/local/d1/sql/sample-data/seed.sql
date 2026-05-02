INSERT INTO settings (
  key,
  value,
  created_at,
  created_by,
  updated_at,
  updated_by
) VALUES (
  "monthly_amount_cents",
  "3200",
  datetime("now"),
  "system:seed",
  datetime("now"),
  "system:seed"
)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at,
  updated_by = excluded.updated_by;

INSERT INTO contributors (
  name,
  email,
  status,
  created_at,
  created_by,
  updated_at,
  updated_by
)
SELECT
  "Alex Test JCM",
  "alex.superadmin@example.com",
  1,
  datetime("now"),
  "system:seed",
  datetime("now"),
  "system:seed"
WHERE NOT EXISTS (
  SELECT 1 FROM contributors WHERE email = "alex.superadmin@example.com"
);

INSERT INTO contributors (
  name,
  email,
  status,
  created_at,
  created_by,
  updated_at,
  updated_by
)
SELECT
  "Andrea Ortega",
  "andrea.ortega@example.com",
  1,
  datetime("now"),
  "system:seed",
  datetime("now"),
  "system:seed"
WHERE NOT EXISTS (
  SELECT 1 FROM contributors WHERE email = "andrea.ortega@example.com"
);

INSERT INTO contributors (
  name,
  email,
  status,
  created_at,
  created_by,
  updated_at,
  updated_by
)
SELECT
  "Carlos Munoz",
  "carlos.munoz@example.com",
  1,
  datetime("now"),
  "system:seed",
  datetime("now"),
  "system:seed"
WHERE NOT EXISTS (
  SELECT 1 FROM contributors WHERE email = "carlos.munoz@example.com"
);

UPDATE contributors
SET
  name = "Alex Test JCM",
  status = 1,
  updated_at = datetime("now"),
  updated_by = "system:seed"
WHERE email = "alex.superadmin@example.com";

UPDATE contributors
SET
  name = "Andrea Ortega",
  status = 1,
  updated_at = datetime("now"),
  updated_by = "system:seed"
WHERE email = "andrea.ortega@example.com";

UPDATE contributors
SET
  name = "Carlos Munoz",
  status = 1,
  updated_at = datetime("now"),
  updated_by = "system:seed"
WHERE email = "carlos.munoz@example.com";

WITH seed_rows(year, email, month, amount_cents) AS (
  VALUES
    (2024, "alex.superadmin@example.com", 1, 3200),
    (2024, "alex.superadmin@example.com", 2, 3200),
    (2024, "alex.superadmin@example.com", 3, 3200),
    (2024, "alex.superadmin@example.com", 4, 3200),
    (2024, "andrea.ortega@example.com", 1, 3200),
    (2024, "andrea.ortega@example.com", 2, 1600),
    (2024, "andrea.ortega@example.com", 3, 3200),
    (2024, "andrea.ortega@example.com", 4, 3200),
    (2024, "carlos.munoz@example.com", 1, 3200),
    (2024, "carlos.munoz@example.com", 2, 3200),
    (2024, "carlos.munoz@example.com", 3, 2400),
    (2024, "carlos.munoz@example.com", 4, 3200),
    (2025, "alex.superadmin@example.com", 1, 3200),
    (2025, "alex.superadmin@example.com", 2, 3200),
    (2025, "alex.superadmin@example.com", 3, 3200),
    (2025, "alex.superadmin@example.com", 4, 3200),
    (2025, "alex.superadmin@example.com", 5, 3200),
    (2025, "alex.superadmin@example.com", 6, 3200),
    (2025, "andrea.ortega@example.com", 1, 3200),
    (2025, "andrea.ortega@example.com", 2, 3200),
    (2025, "andrea.ortega@example.com", 3, 3200),
    (2025, "andrea.ortega@example.com", 4, 1600),
    (2025, "andrea.ortega@example.com", 5, 3200),
    (2025, "andrea.ortega@example.com", 6, 3200),
    (2025, "carlos.munoz@example.com", 1, 3200),
    (2025, "carlos.munoz@example.com", 2, 3200),
    (2025, "carlos.munoz@example.com", 3, 3200),
    (2025, "carlos.munoz@example.com", 4, 3200),
    (2025, "carlos.munoz@example.com", 5, 3200),
    (2025, "carlos.munoz@example.com", 6, 2800)
)
INSERT INTO contributions (
  contributor_id,
  year,
  month,
  amount_cents,
  status,
  created_at,
  created_by,
  updated_at,
  updated_by
)
SELECT
  c.id,
  s.year,
  s.month,
  s.amount_cents,
  1,
  datetime("now"),
  "system:seed",
  datetime("now"),
  "system:seed"
FROM seed_rows s
JOIN contributors c ON c.email = s.email
WHERE NOT EXISTS (
  SELECT 1
  FROM contributions x
  WHERE x.contributor_id = c.id
    AND x.year = s.year
    AND x.month = s.month
    AND x.status = 1
);
