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

            } catch (PDOException $e) {
                // If database doesn't exist, try to init
                if ($e->getCode() == 1049) {
                    self::initSystem();
                } else {
                    error_log('Database Connection Error: ' . $e->getMessage());
                    http_response_code(500);
                    exit('Internal Server Error');
                }
            }

        }
        return self::$pdo;
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
                  real_name VARCHAR(100) NOT NULL,
                  dob DATE NOT NULL,
                  password_hash VARCHAR(255) NOT NULL,
                  avatar VARCHAR(50) NOT NULL,
                  signature VARCHAR(160) DEFAULT NULL,
                  updated_at TIMESTAMP(6) NOT NULL
                    DEFAULT CURRENT_TIMESTAMP(6)
                    ON UPDATE CURRENT_TIMESTAMP(6),
                  INDEX idx_users_updated_at (updated_at)
                ) ENGINE=InnoDB;

                CREATE TABLE IF NOT EXISTS relationships (
                  id INT AUTO_INCREMENT PRIMARY KEY,
                  from_id INT NOT NULL,
                  to_id   INT NOT NULL,
                  type ENUM('DATING','BEST_FRIEND','BROTHER','SISTER','BEEFING','CRUSH') NOT NULL,
                  last_msg_id INT NOT NULL DEFAULT 0,
                  last_msg_time TIMESTAMP(6) NULL DEFAULT NULL,
                  deleted_at TIMESTAMP(6) NULL DEFAULT NULL,
                  updated_at TIMESTAMP(6) NOT NULL
                    DEFAULT CURRENT_TIMESTAMP(6)
                    ON UPDATE CURRENT_TIMESTAMP(6),

                  FOREIGN KEY (from_id) REFERENCES users(id) ON DELETE CASCADE,
                  FOREIGN KEY (to_id)   REFERENCES users(id) ON DELETE CASCADE,

                  UNIQUE KEY idx_rel_pair (from_id, to_id),
                  INDEX idx_rel_updated_at (updated_at),
                  INDEX idx_rel_deleted_at (deleted_at),
                  INDEX idx_rel_from (from_id),
                  INDEX idx_rel_to (to_id)
                ) ENGINE=InnoDB;

                CREATE TABLE IF NOT EXISTS requests (
                  id INT AUTO_INCREMENT PRIMARY KEY,
                  from_id INT NOT NULL,
                  to_id   INT NOT NULL,
                  type VARCHAR(20) NOT NULL,
                  status ENUM('ACCEPTED','PENDING','REJECTED') DEFAULT 'PENDING',

                  FOREIGN KEY (from_id) REFERENCES users(id) ON DELETE CASCADE,
                  FOREIGN KEY (to_id)   REFERENCES users(id) ON DELETE CASCADE,

                  INDEX idx_requests_to_status_id (to_id, status, id)
                ) ENGINE=InnoDB;

                CREATE TABLE IF NOT EXISTS messages (
                  id INT AUTO_INCREMENT PRIMARY KEY,
                  from_id INT NOT NULL,
                  to_id   INT NOT NULL,
                  message TEXT NOT NULL,
                  timestamp TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

                  FOREIGN KEY (from_id) REFERENCES users(id) ON DELETE CASCADE,
                  FOREIGN KEY (to_id)   REFERENCES users(id) ON DELETE CASCADE,

                  INDEX idx_timestamp (timestamp),
                  INDEX idx_chat_history (from_id, to_id, id)
                ) ENGINE=InnoDB;

                CREATE TABLE IF NOT EXISTS read_receipts (
                  user_id INT NOT NULL,
                  peer_id INT NOT NULL,
                  last_read_msg_id INT NOT NULL DEFAULT 0,
                  updated_at TIMESTAMP(6) NOT NULL
                    DEFAULT CURRENT_TIMESTAMP(6)
                    ON UPDATE CURRENT_TIMESTAMP(6),

                  PRIMARY KEY (user_id, peer_id),
                  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                  FOREIGN KEY (peer_id) REFERENCES users(id) ON DELETE CASCADE
                ) ENGINE=InnoDB;
            SQL;
            self::$pdo->exec($sql);

        } catch (PDOException $e) {
            error_log('Init Error: ' . $e->getMessage());
            http_response_code(500);
            exit('Internal Server Error');
        }
    }
}

// Helper constants
const AVATARS = ['1.png', '2.png', '3.png'];
const FALLBACK_AVATAR = '0.png';

// Get connection instance
$pdo = Database::connect();
