import pg from 'pg';
const { Client } = pg;

const DB = {
  host: '192.168.2.71',
  port: 5432,
  user: 'luffy',
  password: 'almaatalin',
  database: 'strawdmin_db',
};

const client = new Client(DB);
await client.connect();

// ── Schema ────────────────────────────────────────────────────────────────────

await client.query(`
  CREATE TABLE IF NOT EXISTS countries (
    id    SERIAL PRIMARY KEY,
    code  CHAR(2)      NOT NULL UNIQUE,
    name  VARCHAR(100) NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id    SERIAL PRIMARY KEY,
    slug  VARCHAR(60)  NOT NULL UNIQUE,
    label VARCHAR(100) NOT NULL
  );

  CREATE TABLE IF NOT EXISTS customers (
    id         SERIAL PRIMARY KEY,
    first_name VARCHAR(80)  NOT NULL,
    last_name  VARCHAR(80)  NOT NULL,
    email      VARCHAR(200) NOT NULL UNIQUE,
    country_id INTEGER      NOT NULL REFERENCES countries(id),
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS products (
    id          SERIAL PRIMARY KEY,
    sku         VARCHAR(40)   NOT NULL UNIQUE,
    name        VARCHAR(200)  NOT NULL,
    category_id INTEGER       NOT NULL REFERENCES categories(id),
    price       NUMERIC(10,2) NOT NULL,
    stock       INTEGER       NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id          SERIAL PRIMARY KEY,
    customer_id INTEGER       NOT NULL REFERENCES customers(id),
    status      VARCHAR(20)   NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','processing','shipped','delivered','cancelled')),
    total       NUMERIC(10,2),
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id         SERIAL PRIMARY KEY,
    order_id   INTEGER       NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER       NOT NULL REFERENCES products(id),
    quantity   INTEGER       NOT NULL DEFAULT 1,
    unit_price NUMERIC(10,2) NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id          SERIAL PRIMARY KEY,
    product_id  INTEGER  NOT NULL REFERENCES products(id),
    customer_id INTEGER  NOT NULL REFERENCES customers(id),
    rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`);
console.log('Schema ready.');

// ── Seed ──────────────────────────────────────────────────────────────────────

await client.query(`
  INSERT INTO countries (code, name) VALUES
    ('US','United States'),('GB','United Kingdom'),('DE','Germany'),
    ('FR','France'),('JP','Japan'),('CA','Canada'),('AU','Australia'),
    ('BR','Brazil'),('GR','Greece'),('NL','Netherlands')
  ON CONFLICT (code) DO NOTHING;
`);

await client.query(`
  INSERT INTO categories (slug, label) VALUES
    ('electronics','Electronics'),('clothing','Clothing'),
    ('books','Books'),('home-garden','Home & Garden'),
    ('sports','Sports & Outdoors'),('toys','Toys & Games')
  ON CONFLICT (slug) DO NOTHING;
`);

await client.query(`
  INSERT INTO customers (first_name, last_name, email, country_id) VALUES
    ('Alice','Smith',       'alice@example.com',    (SELECT id FROM countries WHERE code='US')),
    ('Bob',  'Johnson',     'bob@example.com',      (SELECT id FROM countries WHERE code='GB')),
    ('Clara','Muller',      'clara@example.de',     (SELECT id FROM countries WHERE code='DE')),
    ('David','Dupont',      'david@example.fr',     (SELECT id FROM countries WHERE code='FR')),
    ('Emi',  'Tanaka',      'emi@example.jp',       (SELECT id FROM countries WHERE code='JP')),
    ('Frank','Brown',       'frank@example.ca',     (SELECT id FROM countries WHERE code='CA')),
    ('Grace','Williams',    'grace@example.au',     (SELECT id FROM countries WHERE code='AU')),
    ('Hiro', 'Nakamura',    'hiro@example.jp',      (SELECT id FROM countries WHERE code='JP')),
    ('Irina','Petrov',      'irina@example.com',    (SELECT id FROM countries WHERE code='US')),
    ('Giorgos','Fountopoulos','gfoun@example.gr',   (SELECT id FROM countries WHERE code='GR'))
  ON CONFLICT (email) DO NOTHING;
`);

await client.query(`
  INSERT INTO products (sku, name, category_id, price, stock) VALUES
    ('ELEC-001','4K Smart TV 55"',                      (SELECT id FROM categories WHERE slug='electronics'), 699.99,  42),
    ('ELEC-002','Wireless Noise-Cancelling Headphones', (SELECT id FROM categories WHERE slug='electronics'), 249.99, 130),
    ('ELEC-003','Mechanical Keyboard',                  (SELECT id FROM categories WHERE slug='electronics'), 119.99,  75),
    ('CLOT-001','Merino Wool Sweater',                  (SELECT id FROM categories WHERE slug='clothing'),     89.95, 200),
    ('CLOT-002','Slim-Fit Chinos',                      (SELECT id FROM categories WHERE slug='clothing'),     59.95, 340),
    ('BOOK-001','Clean Code',                           (SELECT id FROM categories WHERE slug='books'),        35.00,  88),
    ('BOOK-002','Designing Data-Intensive Applications',(SELECT id FROM categories WHERE slug='books'),        49.99,  55),
    ('HOME-001','Bamboo Cutting Board Set',             (SELECT id FROM categories WHERE slug='home-garden'),  34.99, 180),
    ('SPRT-001','Adjustable Dumbbell Pair',             (SELECT id FROM categories WHERE slug='sports'),      149.00,  60),
    ('TOYS-001','LEGO Architecture Set',                (SELECT id FROM categories WHERE slug='toys'),         79.99, 115)
  ON CONFLICT (sku) DO NOTHING;
`);

// Orders — one per customer (plus a second for alice)
await client.query(`
  INSERT INTO orders (customer_id, status, total, created_at) VALUES
    ((SELECT id FROM customers WHERE email='alice@example.com'),    'delivered',  949.98, now() - interval '30 days'),
    ((SELECT id FROM customers WHERE email='bob@example.com'),      'shipped',    249.99, now() - interval '10 days'),
    ((SELECT id FROM customers WHERE email='clara@example.de'),     'processing', 179.90, now() - interval '3 days'),
    ((SELECT id FROM customers WHERE email='david@example.fr'),     'pending',     49.99, now() - interval '1 day'),
    ((SELECT id FROM customers WHERE email='emi@example.jp'),       'delivered',  119.99, now() - interval '60 days'),
    ((SELECT id FROM customers WHERE email='frank@example.ca'),     'cancelled',   89.95, now() - interval '5 days'),
    ((SELECT id FROM customers WHERE email='gfoun@example.gr'),     'delivered',  284.99, now() - interval '15 days'),
    ((SELECT id FROM customers WHERE email='hiro@example.jp'),      'processing',  34.99, now() - interval '2 days'),
    ((SELECT id FROM customers WHERE email='irina@example.com'),    'shipped',    199.98, now() - interval '7 days'),
    ((SELECT id FROM customers WHERE email='alice@example.com'),    'pending',    149.00, now() - interval '1 hour')
  ON CONFLICT DO NOTHING;
`);

// Order items — match each order to sensible products
await client.query(`
  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  SELECT o.id, p.id, 1, p.price
  FROM   orders o
  JOIN   customers c ON c.id = o.customer_id
  JOIN   products  p ON TRUE
  WHERE  (c.email, p.sku) IN (
    ('alice@example.com', 'ELEC-001'),
    ('alice@example.com', 'ELEC-002'),
    ('bob@example.com',   'ELEC-002'),
    ('clara@example.de',  'CLOT-001'),
    ('clara@example.de',  'CLOT-002'),
    ('david@example.fr',  'BOOK-002'),
    ('emi@example.jp',    'ELEC-003'),
    ('frank@example.ca',  'CLOT-001'),
    ('gfoun@example.gr',  'ELEC-002'),
    ('gfoun@example.gr',  'HOME-001'),
    ('hiro@example.jp',   'HOME-001'),
    ('irina@example.com', 'BOOK-001'),
    ('irina@example.com', 'BOOK-002'),
    ('alice@example.com', 'SPRT-001')
  )
  ON CONFLICT DO NOTHING;
`);

await client.query(`
  INSERT INTO reviews (product_id, customer_id, rating, body)
  SELECT p.id, c.id, v.rating::smallint, v.body
  FROM (VALUES
    ('alice@example.com',  'ELEC-001', '5', 'Incredible picture quality, highly recommended!'),
    ('alice@example.com',  'ELEC-002', '4', 'Great sound, slightly uncomfortable after long sessions.'),
    ('bob@example.com',    'ELEC-002', '5', 'Best headphones I have ever owned.'),
    ('emi@example.jp',     'ELEC-003', '5', 'Tactile feedback is satisfying, very accurate.'),
    ('clara@example.de',   'CLOT-001', '4', 'Warm and soft, runs slightly small.'),
    ('david@example.fr',   'BOOK-002', '5', 'Essential reading for any backend engineer.'),
    ('gfoun@example.gr',   'ELEC-002', '5', 'Worth every cent, amazing noise cancellation.'),
    ('hiro@example.jp',    'HOME-001', '3', 'Good quality but smaller than expected.'),
    ('irina@example.com',  'BOOK-001', '5', 'Changed the way I write code entirely.')
  ) AS v(email, sku, rating, body)
  JOIN customers c ON c.email = v.email
  JOIN products  p ON p.sku   = v.sku
  ON CONFLICT DO NOTHING;
`);

// ── Demo users table (for showcasing write-time hashing) ─────────────────────

await client.query(`
  CREATE TABLE IF NOT EXISTS app_users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(80)  NOT NULL UNIQUE,
    email         VARCHAR(200) NOT NULL UNIQUE,
    password_hash VARCHAR(256) NOT NULL,
    salt          VARCHAR(64)  NOT NULL,
    role          VARCHAR(20)  NOT NULL DEFAULT 'user'
                               CHECK (role IN ('admin','moderator','user')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
  );
`);

await client.query(`
  INSERT INTO app_users (username, email, password_hash, salt, role) VALUES
    ('admin',      'admin@example.com',        'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3', 'f4c3e1a9b2d05678', 'admin'),
    ('gfoun',      'gfoun@example.gr',          'b3a8e0e1f9b2d05e088778c24033d45d74cb14a580ec3dab343b2f2a77fc6d17', 'a1b2c3d4e5f60718', 'admin'),
    ('alice',      'alice@example.com',         '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', '9d8c7b6a5e4f3201', 'user'),
    ('bob',        'bob@example.com',           '82a5e5b1f8d2d3e7c90b4661e9e3b567d11298bb1b0e6b2c3aa7d45f8c2e1093', '1f2e3d4c5b6a7089', 'user'),
    ('clara',      'clara@example.de',          '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', '0a1b2c3d4e5f6789', 'moderator'),
    ('moderator1', 'mod@example.com',           '5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5', 'deadbeefcafe0123', 'moderator')
  ON CONFLICT (username) DO NOTHING;
`);

console.log('Seed data inserted.');
await client.end();
