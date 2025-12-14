<?php
// Application versioning and environment configuration
if (!defined('APP_ENV')) {
    define('APP_ENV', 'dev');
}

if (!function_exists('app_version')) {
    function app_version() {
        return APP_ENV === 'dev' ? (string) time() : '2.0.0';
    }
}
