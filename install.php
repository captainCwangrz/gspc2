<?php
// install.php
require_once __DIR__ . '/config/db.php';

// Establish connection
$pdo = Database::connect();

// Run schema migrations previously handled automatically
Database::ensureSchema($pdo);

// Create system_state table for global cache invalidation
$pdo->exec(<<<SQL
CREATE TABLE IF NOT EXISTS system_state (
    id INT PRIMARY KEY,
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
INSERT IGNORE INTO system_state (id, last_update) VALUES (1, NOW());
SQL);

echo "Installation and migrations completed.\n";
