<?php
// config/db.php
session_start();

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

                // Check if tables exist. If 'users' table is missing, initialize tables.
                // We use a silent query to check existence.
                try {
                    self::$pdo->query("SELECT 1 FROM users LIMIT 1");
                } catch (PDOException $e) {
                    // Table likely doesn't exist, try to initialize tables
                    self::createTables(self::$pdo);
                }

            } catch (PDOException $e) {
                // If database doesn't exist (Error 1049), initialize system
                if ($e->getCode() == 1049) {
                    self::initSystem();
                } else {
                    die("Database Connection Error: " . $e->getMessage());
                }
            }
        }
        return self::$pdo;
    }

    // Initialize Database and Tables
    public static function initSystem() {
        try {
            $pdo = new PDO("mysql:host=".self::$host, self::$user, self::$pass);
            $pdo->exec("CREATE DATABASE IF NOT EXISTS `" . self::$db . "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

            // Reconnect with database selected
            $dsn = "mysql:host=" . self::$host . ";dbname=" . self::$db . ";charset=utf8mb4";
            self::$pdo = new PDO($dsn, self::$user, self::$pass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);

            self::createTables(self::$pdo);

        } catch (PDOException $e) {
            die("Init Error: " . $e->getMessage());
        }
    }

    // Separate method for creating tables
    public static function createTables($pdo) {
        $sql = <<<SQL
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                x_pos DOUBLE NOT NULL, y_pos DOUBLE NOT NULL,
                avatar VARCHAR(50) NOT NULL,
                signature VARCHAR(160) DEFAULT NULL,
                UNIQUE KEY coord (x_pos, y_pos)
            ) ENGINE=InnoDB;
            CREATE TABLE IF NOT EXISTS relationships (
                id INT AUTO_INCREMENT PRIMARY KEY,
                from_id INT NOT NULL, to_id INT NOT NULL,
                type ENUM('DATING', 'BEST_FRIEND', 'BROTHER', 'SISTER', 'BEEFING', 'CRUSH') NOT NULL,
                FOREIGN KEY (from_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (to_id) REFERENCES users(id) ON DELETE CASCADE
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
                FOREIGN KEY (to_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB;
        SQL;
        $pdo->exec($sql);
    }
}

// Helper Constants
const AVATARS = ['1.png', '2.png', '3.png'];
const FALLBACK_AVATAR = '0.png';

// Get Instance
$pdo = Database::connect();
