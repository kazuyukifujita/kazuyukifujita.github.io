<?php
// save_plan.php
// 設置場所: index.html と同じフォルダ
// 役割: 受信した間取りデータを plans.json の先頭に追記して保存します。

header('Content-Type: application/json');

// POSTデータを取得
$json_input = file_get_contents('php://input');
$new_plan = json_decode($json_input, true);

if (!$new_plan) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid data']);
    exit;
}

$file_name = 'plans.json';

// 既存のデータを読み込む
if (file_exists($file_name)) {
    $current_data = json_decode(file_get_contents($file_name), true);
} else {
    $current_data = [];
}

if (!is_array($current_data)) {
    $current_data = [];
}

// 新しいプランを先頭に追加
array_unshift($current_data, $new_plan);

// 最大保存件数を制限（例: 100件）
if (count($current_data) > 100) {
    $current_data = array_slice($current_data, 0, 100);
}

// 保存を実行
if (file_put_contents($file_name, json_encode($current_data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT))) {
    echo json_encode(['success' => true]);
} else {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to save to plans.json. Check file permissions.']);
}
?>