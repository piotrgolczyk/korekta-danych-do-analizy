<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/lib.php';

$dataPath = require_session_file();

try {
    $data = read_json_file($dataPath);
    if (!isset($data['people']) && isset($data['users']) && is_array($data['users'])) {
        $data['people'] = $data['users'];
        unset($data['users']);
    }

    $history = load_history($dataPath);

    respond_json([
        'ok' => true,
        'data' => $data,
        'history' => $history,
        'file' => basename($dataPath),
    ]);
} catch (Throwable $e) {
    respond_json(['ok' => false, 'message' => $e->getMessage()], 500);
}
