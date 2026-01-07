<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/lib.php';

$dataPath = require_session_file();

$payload = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($payload)) {
    respond_json(['ok' => false, 'message' => 'Nieprawidłowe dane wejściowe.'], 400);
}

$report = $payload['data'] ?? null;
$changes = $payload['changes'] ?? null;

if (!is_array($report)) {
    respond_json(['ok' => false, 'message' => 'Brak danych do zapisu.'], 400);
}

if (!is_array($changes)) {
    $changes = [];
}

try {
    save_json_file($dataPath, $report);

    $entry = [
        'timestamp' => date('Y-m-d H:i:s'),
        'changes' => array_values($changes),
    ];

    $history = append_history_entry($dataPath, $entry);

    respond_json([
        'ok' => true,
        'history' => $history,
    ]);
} catch (Throwable $e) {
    respond_json(['ok' => false, 'message' => $e->getMessage()], 500);
}
