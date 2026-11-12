USE callmanagerai;

INSERT INTO contacts (name, company, phone, email, status)
SELECT 'María Gómez', 'Fintech Partners', '+56912345678', 'maria@fintechpartners.cl', 'active'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM contacts WHERE email = 'maria@fintechpartners.cl'
);

INSERT INTO contacts (name, company, phone, email, status)
SELECT 'Carlos Rojas', 'Nexa Energy', '+56987654321', 'carlos@nexaenergy.cl', 'active'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM contacts WHERE email = 'carlos@nexaenergy.cl'
);

INSERT INTO contacts (name, company, phone, email, status)
SELECT 'Lucía Pérez', 'Blue Ocean', '+56945612378', 'lucia@blueocean.cl', 'inactive'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM contacts WHERE email = 'lucia@blueocean.cl'
);
