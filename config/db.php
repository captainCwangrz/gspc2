<?php
// config/db.php
session_start();
require_once __DIR__ . '/constants.php';

class Database {
    private static $host = 'localhost';
    private static $db   = 'social_demo';
    private static $user = 'root';
    private static $pass = 'root';
    public static $pdo;

    public static function connect() {
        if (!self::$pdo) {
            try {
                $dsn = "mysql:host=" . self::$host . ";dbname=" . self::$db . ";charset=utf8mb4";
                self::$pdo = new PDO($dsn, self::$user, self::$pass, [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                ]);

                // Ensure schema is up to date (Migration logic)
                self::ensureSchema(self::$pdo);

            } catch (PDOException $e) {
                // If database doesn't exist, try to init
                if ($e->getCode() == 1049) {
                    self::initSystem();
                } else {
                    die("Database Connection Error: " . $e->getMessage());
                }
            }
        }
        return self::$pdo;
    }

    public static function ensureSchema($pdo) {
        try {
            // Check if updated_at exists in users
            $stmt = $pdo->query("SHOW COLUMNS FROM users LIKE 'updated_at'");
            if (!$stmt->fetch()) {
                $pdo->exec("ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
            }

            // Check if updated_at exists in relationships
            $stmt = $pdo->query("SHOW COLUMNS FROM relationships LIKE 'updated_at'");
            if (!$stmt->fetch()) {
                $pdo->exec("ALTER TABLE relationships ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
            }

            // Check if unique index exists in relationships
            // Note: 'SHOW INDEX' returns multiple rows for one index, we just check if the key_name exists
            $stmt = $pdo->query("SHOW INDEX FROM relationships WHERE Key_name = 'idx_rel_from_to'");
            if (!$stmt->fetch()) {
                // Ignore errors if data already violates unique constraint?
                // For safety, we use IGNORE or try catch. But ALTER IGNORE is deprecated.
                // We will wrap in try-catch
                try {
                    $pdo->exec("ALTER TABLE relationships ADD UNIQUE INDEX idx_rel_from_to (from_id, to_id)");
                } catch (Exception $e) {
                    // Index creation might fail if duplicates exist.
                    // In a real scenario, we would need to clean up duplicates first.
                    // For now we log/ignore or assume user handles it manually if it fails.
                    error_log("Migration Warning: Could not create unique index: " . $e->getMessage());
                }
            }

            // Check if pagination index exists in messages
            $stmt = $pdo->query("SHOW INDEX FROM messages WHERE Key_name = 'idx_msg_pagination'");
            if (!$stmt->fetch()) {
                $pdo->exec("ALTER TABLE messages ADD INDEX idx_msg_pagination (from_id, to_id, id)");
            }

        } catch (Exception $e) {
            // Suppress migration errors to avoid breaking the app if something weird happens,
            // but log them.
            error_log("Schema Check Error: " . $e->getMessage());
        }
    }

    // Initialize System: Create DB and Tables
    public static function initSystem() {
        try {
            $pdo = new PDO("mysql:host=".self::$host, self::$user, self::$pass);
            $pdo->exec("CREATE DATABASE IF NOT EXISTS `" . self::$db . "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

            $dsn = "mysql:host=" . self::$host . ";dbname=" . self::$db . ";charset=utf8mb4";
            self::$pdo = new PDO($dsn, self::$user, self::$pass);

            $sql = <<<SQL
                CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(50) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    x_pos DOUBLE NOT NULL, y_pos DOUBLE NOT NULL,
                    avatar VARCHAR(50) NOT NULL,
                    signature VARCHAR(160) DEFAULT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY coord (x_pos, y_pos)
                ) ENGINE=InnoDB;

                CREATE TABLE IF NOT EXISTS relationships (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    from_id INT NOT NULL, to_id INT NOT NULL,
                    type ENUM('DATING', 'BEST_FRIEND', 'BROTHER', 'SISTER', 'BEEFING', 'CRUSH') NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    FOREIGN KEY (from_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (to_id) REFERENCES users(id) ON DELETE CASCADE,
                    UNIQUE KEY idx_rel_from_to (from_id, to_id)
                ) ENGINE=InnoDB;

                CREATE TABLE IF NOT EXISTS requests (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    from_id INT NOT NULL, to_id INT NOT NULL,
                    type VARCHAR(20) NOT NULL,
                    status ENUM('ACCEPTED', 'PENDING', 'REJECTED') DEFAULT 'PENDING',
                    FOREIGN KEY (from_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (to_id) REFERENCES users(id) ON DELETE CASCADE
                ) ENGINE=InnoDB;

                CREATE TABLE IF NOT EXISTS messages (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    from_id INT NOT NULL, to_id INT NOT NULL,
                    message TEXT NOT NULL,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (from_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (to_id) REFERENCES users(id) ON DELETE CASCADE,
                    INDEX idx_msg_pagination (from_id, to_id, id)
                ) ENGINE=InnoDB;
            SQL;
            self::$pdo->exec($sql);

            // Re-run ensure schema just in case logic differs
            self::ensureSchema(self::$pdo);

        } catch (PDOException $e) {
            die("Init Error: " . $e->getMessage());
        }
    }
}

// Helper constants
const AVATARS = ['1.png', '2.png', '3.png'];
const FALLBACK_AVATAR = '0.png';

// Get connection instance
$pdo = Database::connect();
