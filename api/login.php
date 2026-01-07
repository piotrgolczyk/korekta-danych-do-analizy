<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/lib.php';

session_start();

$payload = json_decode(file_get_contents('php://input') ?: '', true);
$password = is_array($payload) ? (string)($payload['password'] ?? '') : '';

[$file, $error] = find_file_by_password($password);
if ($error !== null) {
    respond_json(['ok' => false, 'message' => $error], 403);
}

$_SESSION['data_file'] = $file;
$_SESSION['login_at'] = time();

respond_json([
    'ok' => true,
    'file' => basename($file),
]);
