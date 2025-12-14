<?php
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/config/constants.php';
require_once __DIR__ . '/config/helpers.php';

try {
    echo "Starting isolated seed process...\n";
    
    // Start Transaction
    $pdo->beginTransaction();

    // 1. Generate 100 New Users and capture their IDs
    $countToGenerate = 100;
    $newUserIds = []; // We will store only the IDs we generate here

    $firstNames = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Nancy', 'Daniel', 'Lisa', 'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra'];
    $lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'];

    $passwordHash = password_hash('password', PASSWORD_DEFAULT);
    $insertUser = $pdo->prepare('INSERT INTO users (username, real_name, dob, password_hash, avatar, signature) VALUES (?, ?, ?, ?, ?, ?)');

    echo "Creating $countToGenerate new users...\n";

    for ($i = 0; $i < $countToGenerate; $i++) {
        $fname = $firstNames[array_rand($firstNames)];
        $lname = $lastNames[array_rand($lastNames)];
        
        // Ensure uniqueness
        $username = strtolower($fname) . rand(10000, 99999); 
        $realName = "$fname $lname";
        
        // Random DOB
        $timestamp = rand(631152000, 1104537600); 
        $dob = date('Y-m-d', $timestamp);
        
        $avatar = AVATARS[array_rand(AVATARS)];
        $signature = "Initializing...";

        $insertUser->execute([$username, $realName, $dob, $passwordHash, $avatar, $signature]);
        
        // Capture the new ID specifically
        $newUserIds[] = (int)$pdo->lastInsertId();
    }

    echo "Generated " . count($newUserIds) . " users. (IDs " . min($newUserIds) . " to " . max($newUserIds) . ")\n";

    // 2. Generate Random Relationships (ONLY among new users)
    echo "Generating relationships (Excluding existing users)...\n";
    
    $relationships = [];
    $density = 0.05; // 5% chance of connection

    // Iterate ONLY through the new user IDs
    $count = count($newUserIds);
    for ($i = 0; $i < $count; $i++) {
        for ($j = $i + 1; $j < $count; $j++) {
            
            if ((mt_rand() / mt_getrandmax()) < $density) {
                $u = $newUserIds[$i];
                $v = $newUserIds[$j];
                
                $type = RELATION_TYPES[array_rand(RELATION_TYPES)];
                
                if ($type === 'CRUSH') {
                    // Directed
                    if (mt_rand(0, 100) < 10) { // 10% mutual
                        $relationships[] = ['from' => $u, 'to' => $v, 'type' => 'CRUSH'];
                        $relationships[] = ['from' => $v, 'to' => $u, 'type' => 'CRUSH'];
                    } else {
                        if (mt_rand(0, 1)) {
                            $relationships[] = ['from' => $u, 'to' => $v, 'type' => 'CRUSH'];
                        } else {
                            $relationships[] = ['from' => $v, 'to' => $u, 'type' => 'CRUSH'];
                        }
                    }
                } else {
                    // Undirected
                    [$src, $tgt] = normalizeFromTo($type, $u, $v);
                    $relationships[] = ['from' => $src, 'to' => $tgt, 'type' => $type];
                }
            }
        }
    }

    // Batch Insert Relations
    $insertRel = $pdo->prepare('INSERT INTO relationships (from_id, to_id, type, last_msg_id, deleted_at) VALUES (?, ?, ?, 0, NULL)');
    $insertReq = $pdo->prepare('INSERT INTO requests (from_id, to_id, type, status) VALUES (?, ?, ?, "ACCEPTED")');

    foreach ($relationships as $rel) {
        // Since these are fresh users, conflicts theoretically shouldn't happen, 
        // but we assume standard insertion is fine.
        $insertRel->execute([$rel['from'], $rel['to'], $rel['type']]);
        $insertReq->execute([$rel['from'], $rel['to'], $rel['type']]);
    }

    echo "Inserted " . count($relationships) . " edges between new users.\n";

    // 3. Update Signatures for New Users
    echo "Updating signatures...\n";

    // Calculate stats purely from the relationships we just created
    // (Or fetch from DB filtering by the new IDs to be safe)
    $stats = [];
    foreach ($newUserIds as $id) {
        $stats[$id] = ['dating'=>0, 'friends'=>0, 'crush_sent'=>0, 'crush_received'=>0, 'mutual_crush'=>0];
    }

    // We can iterate the $relationships array directly since it matches DB state
    // but calculating Mutual Crushes is easier if we track edges.
    $crushEdges = [];

    foreach ($relationships as $rel) {
        $u = $rel['from'];
        $v = $rel['to'];
        $type = $rel['type'];

        if ($type === 'DATING') {
            $stats[$u]['dating']++;
            $stats[$v]['dating']++;
        } elseif ($type === 'CRUSH') {
            $stats[$u]['crush_sent']++;
            $stats[$v]['crush_received']++;
            
            $key = min($u, $v) . '-' . max($u, $v);
            if (!isset($crushEdges[$key])) $crushEdges[$key] = 0;
            $crushEdges[$key]++;
        } else {
            $stats[$u]['friends']++;
            $stats[$v]['friends']++;
        }
    }

    // Resolve Mutuals
    foreach ($crushEdges as $key => $cnt) {
        if ($cnt >= 2) {
            [$u, $v] = explode('-', $key);
            $u = (int)$u; $v = (int)$v;
            
            $stats[$u]['mutual_crush']++;
            $stats[$v]['mutual_crush']++;
            
            // Adjust raw counts
            $stats[$u]['crush_sent']--;
            $stats[$v]['crush_received']--;
        }
    }

    $updateSig = $pdo->prepare('UPDATE users SET signature = ? WHERE id = ?');

    foreach ($newUserIds as $id) {
        $s = $stats[$id];
        $sigParts = [];
        
        if ($s['dating'] > 0) $sigParts[] = "❤️ " . $s['dating'];
        if ($s['mutual_crush'] > 0) $sigParts[] = "💞 " . $s['mutual_crush'];
        if ($s['crush_sent'] > 0) $sigParts[] = "👀 " . $s['crush_sent'];
        if ($s['crush_received'] > 0) $sigParts[] = "✨ " . $s['crush_received'];
        $sigParts[] = "🤝 " . $s['friends'];

        $finalSig = implode(' | ', $sigParts);
        if(empty($finalSig)) $finalSig = "Just browsing.";
        
        $updateSig->execute([$finalSig, $id]);
    }

    $pdo->commit();
    echo "Seed completed! Users 201 and 202 were not touched.\n";

} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    echo "Seed failed: " . $e->getMessage() . "\n";
}
?>