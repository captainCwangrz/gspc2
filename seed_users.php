<?php
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/config/constants.php';

function isDirectedType(string $type): bool {
    return in_array($type, DIRECTED_RELATION_TYPES, true);
}

function normalizePair(string $type, int $fromId, int $toId): array {
    if (isDirectedType($type)) {
        return [$fromId, $toId];
    }

    return [$fromId < $toId ? $fromId : $toId, $fromId < $toId ? $toId : $fromId];
}

try {
    $pdo->beginTransaction();
    $pdo->exec('SET FOREIGN_KEY_CHECKS=0');
    $pdo->exec('TRUNCATE TABLE requests');
    $pdo->exec('TRUNCATE TABLE messages');
    $pdo->exec('TRUNCATE TABLE read_receipts');
    $pdo->exec('TRUNCATE TABLE relationships');
    $pdo->exec('TRUNCATE TABLE users');
    $pdo->exec('SET FOREIGN_KEY_CHECKS=1');

    $users = [
        ['username' => 'alice', 'real_name' => 'Alice', 'dob' => '1997-01-01', 'avatar' => '1.png'],
        ['username' => 'bob', 'real_name' => 'Bob', 'dob' => '1996-02-02', 'avatar' => '2.png'],
        ['username' => 'carol', 'real_name' => 'Carol', 'dob' => '1995-03-03', 'avatar' => '3.png'],
        ['username' => 'dave', 'real_name' => 'Dave', 'dob' => '1994-04-04', 'avatar' => '1.png'],
        ['username' => 'eve', 'real_name' => 'Eve', 'dob' => '1993-05-05', 'avatar' => '2.png'],
    ];

    $insertUser = $pdo->prepare('INSERT INTO users (username, real_name, dob, password_hash, avatar, signature) VALUES (?, ?, ?, ?, ?, NULL)');
    $userIds = [];
    foreach ($users as $user) {
        $insertUser->execute([
            $user['username'],
            $user['real_name'],
            $user['dob'],
            password_hash('password', PASSWORD_DEFAULT),
            $user['avatar']
        ]);
        $userIds[$user['username']] = (int)$pdo->lastInsertId();
    }

    $now = (new DateTime())->format('Y-m-d H:i:s.u');
    $relations = [
        ['from' => 'alice', 'to' => 'bob', 'type' => 'CRUSH'],            // Single crush
        ['from' => 'carol', 'to' => 'dave', 'type' => 'CRUSH'],            // Mutual crush (A)
        ['from' => 'dave', 'to' => 'carol', 'type' => 'CRUSH'],
        ['from' => 'bob', 'to' => 'eve', 'type' => 'CRUSH'],               // Mutual crush upgraded to dating
        ['from' => 'eve', 'to' => 'bob', 'type' => 'CRUSH'],
        ['from' => 'alice', 'to' => 'eve', 'type' => 'DATING'],            // Existing dating example
    ];

    // Normalize undirected pairs and prepare upgrade paths
    foreach ($relations as &$rel) {
        $rel['from_id'] = $userIds[$rel['from']];
        $rel['to_id'] = $userIds[$rel['to']];
        [$rel['from_id'], $rel['to_id']] = normalizePair($rel['type'], $rel['from_id'], $rel['to_id']);
        $rel['deleted_at'] = null;
    }
    unset($rel);

    // Upgrade one mutual crush into dating while respecting UNIQUE(from_id,to_id)
    $pairBuckets = [];
    foreach ($relations as $idx => $rel) {
        if ($rel['type'] !== 'CRUSH') continue;
        $key = $rel['from_id'] < $rel['to_id'] ? $rel['from_id'] . '-' . $rel['to_id'] : $rel['to_id'] . '-' . $rel['from_id'];
        $pairBuckets[$key][] = $idx;
    }

    foreach ($pairBuckets as $indices) {
        if (count($indices) < 2) continue;
        $forwardIdx = null;
        $reverseIdx = null;
        foreach ($indices as $idx) {
            $rel = $relations[$idx];
            if ($rel['from_id'] < $rel['to_id']) {
                $forwardIdx = $idx;
            } else {
                $reverseIdx = $idx;
            }
        }
        if ($forwardIdx !== null && $reverseIdx !== null) {
            // Convert forward to dating, soft delete reverse
            $relations[$forwardIdx]['type'] = 'DATING';
            [$relations[$forwardIdx]['from_id'], $relations[$forwardIdx]['to_id']] = normalizePair('DATING', $relations[$forwardIdx]['from_id'], $relations[$forwardIdx]['to_id']);
            $relations[$reverseIdx]['deleted_at'] = $now;
        }
    }

    $insertRel = $pdo->prepare('INSERT INTO relationships (from_id, to_id, type, last_msg_id, last_msg_time, deleted_at) VALUES (?, ?, ?, 0, NULL, ?)');
    $insertReq = $pdo->prepare('INSERT INTO requests (from_id, to_id, type, status) VALUES (?, ?, ?, "ACCEPTED")');

    foreach ($relations as $rel) {
        $insertRel->execute([
            $rel['from_id'],
            $rel['to_id'],
            $rel['type'],
            $rel['deleted_at']
        ]);

        $insertReq->execute([
            $rel['from_id'],
            $rel['to_id'],
            $rel['type']
        ]);
    }

    // Build signature stats
    $activeRels = $pdo->query('SELECT from_id, to_id, type, deleted_at FROM relationships')->fetchAll(PDO::FETCH_ASSOC);
    $stats = [];
    foreach ($userIds as $id) {
        $stats[$id] = [
            'crush_out' => 0,
            'crush_in' => 0,
            'mutual' => 0,
            'dating' => 0
        ];
    }

    $crushPairs = [];
    foreach ($activeRels as $rel) {
        $from = (int)$rel['from_id'];
        $to = (int)$rel['to_id'];
        $type = $rel['type'];
        $isDeleted = $rel['deleted_at'] !== null;

        if ($type === 'DATING' && !$isDeleted) {
            $stats[$from]['dating']++;
            $stats[$to]['dating']++;
        }

        if ($type === 'CRUSH' && !$isDeleted) {
            $stats[$from]['crush_out']++;
            $stats[$to]['crush_in']++;
            $key = $from < $to ? $from . '-' . $to : $to . '-' . $from;
            if (!isset($crushPairs[$key])) {
                $crushPairs[$key] = [];
            }
            $crushPairs[$key][] = [$from, $to];
        }
    }

    foreach ($crushPairs as $pair) {
        if (count($pair) >= 2) {
            foreach ($pair as [$from, $to]) {
                $stats[$from]['mutual']++;
                $stats[$to]['mutual']++;
            }
        }
    }

    $updateSig = $pdo->prepare('UPDATE users SET signature = ? WHERE id = ?');
    foreach ($stats as $userId => $row) {
        $signature = sprintf(
            'SIG: crush_out=%d crush_in=%d mutual=%d dating=%d',
            $row['crush_out'],
            $row['crush_in'],
            $row['mutual'],
            $row['dating']
        );
        $updateSig->execute([$signature, $userId]);
    }

    $pdo->commit();
    echo "Seed data inserted successfully\n";
} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    echo 'Seed failed: ' . $e->getMessage() . "\n";
    http_response_code(500);
}
