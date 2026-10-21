import type { Dialect } from '@sql-compare/core';

export interface Sample {
  left: string;
  right: string;
}

const POSTGRESQL: Sample = {
  left: `-- Active users and their order totals
SELECT u.id, u.name, SUM(o.total) AS total
FROM users u
INNER JOIN orders o ON o.user_id = u.id
WHERE u.active = 1
  AND o.created_at >= '2024-01-01'
GROUP BY u.id, u.name
ORDER BY total DESC
LIMIT 50;
`,
  right: `-- Active users and their order totals
select u.id, u.name, u.email, sum(o.total) as total
from "users" u
left join orders o on o.user_id = u.id
where u.active = true
  and o.created_at >= '2024-01-01'
group by u.id, u.name, u.email
order by total desc
limit 50;
`,
};

const MYSQL: Sample = {
  left: `SELECT p.sku, p.name, c.title AS category
FROM products p
INNER JOIN categories c ON c.id = p.category_id
WHERE p.price > 10.0
  AND p.deleted_at IS NULL
ORDER BY p.name;
`,
  right: `SELECT p.sku, p.name, c.title AS category
FROM \`products\` p
JOIN categories c ON c.id = p.category_id
WHERE p.price >= 10.00
  AND p.deleted_at IS NULL
ORDER BY p.name, p.sku;
`,
};

export function sampleFor(dialect: Dialect): Sample {
  return dialect === 'mysql' ? MYSQL : POSTGRESQL;
}
