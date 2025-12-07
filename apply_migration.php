<?php
require_once 'config/db.php';

try {
    $sql = file_get_contents('manual_migration.sql');
    $pdo->exec($sql);
    echo "Migration applied successfully.\n";
} catch (PDOException $e) {
    echo "Migration failed: " . $e->getMessage() . "\n";
}
