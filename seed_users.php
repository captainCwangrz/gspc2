<?php
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/config/constants.php';
require_once __DIR__ . '/config/helpers.php';

try {
    // 1. Clean Database (TRUNCATE causes implicit commit, so we do this BEFORE starting the transaction)
    $pdo->exec('SET FOREIGN_KEY_CHECKS=0');
    $pdo->exec('TRUNCATE TABLE requests');
    $pdo->exec('TRUNCATE TABLE messages');
    $pdo->exec('TRUNCATE TABLE read_receipts');
    $pdo->exec('TRUNCATE TABLE relationships');
    $pdo->exec('TRUNCATE TABLE users');
    $pdo->exec('SET FOREIGN_KEY_CHECKS=1');
    
    echo "Tables truncated.\n";

    // 2. Start Transaction for Inserts
    $pdo->beginTransaction();

    // 3. Generate Users
    $totalUsers = 200;
    $firstNames = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Nancy', 'Daniel', 'Lisa', 'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra'];
    $lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'];
    
    $userClusters = []; // Map ID -> Cluster ID (0, 1, 2)
    $clusterNames = ['Alpha', 'Beta', 'Gamma'];
    $passwordHash = password_hash('password', PASSWORD_DEFAULT);

    $insertUser = $pdo->prepare('INSERT INTO users (username, real_name, dob, password_hash, avatar, signature) VALUES (?, ?, ?, ?, ?, ?)');

    echo "Seeding $totalUsers users...\n";

    for ($i = 1; $i <= $totalUsers; $i++) {
        // Assign to a cluster (0, 1, or 2)
        $cluster = ($i % 3); 
        $userClusters[$i] = $cluster;

        $fname = $firstNames[array_rand($firstNames)];
        $lname = $lastNames[array_rand($lastNames)];
        
        // Ensure unique username by appending ID
        $username = strtolower($fname) . $i; 
        $realName = "$fname $lname";
        
        // Random DOB between 1990 and 2005
        $timestamp = rand(631152000, 1104537600); 
        $dob = date('Y-m-d', $timestamp);
        
        $avatar = AVATARS[array_rand(AVATARS)];
        $signature = "Initializing profile for Cluster " . $clusterNames[$cluster] . "...";

        $insertUser->execute([$username, $realName, $dob, $passwordHash, $avatar, $signature]);
    }

    // 4. Generate Relationships
    echo "Generating relationships (Clusters: Alpha, Beta, Gamma)...\n";
    
    $relationships = [];
    
    // Probabilities
    $pSameCluster = 0.08; // 8% chance if in same cluster
    $pDiffCluster = 0.003; // 0.3% chance if in different cluster

    for ($i = 1; $i <= $totalUsers; $i++) {
        for ($j = $i + 1; $j <= $totalUsers; $j++) {
            $clusterA = $userClusters[$i];
            $clusterB = $userClusters[$j];
            
            $threshold = ($clusterA === $clusterB) ? $pSameCluster : $pDiffCluster;
            
            if ((mt_rand() / mt_getrandmax()) < $threshold) {
                $type = RELATION_TYPES[array_rand(RELATION_TYPES)];
                
                if ($type === 'CRUSH') {
                    // Directed Type: CRUSH
                    // Decide if mutual (small chance)
                    $isMutual = ((mt_rand() / mt_getrandmax()) < 0.25);
                    
                    if ($isMutual) {
                        // A -> B
                        $relationships[] = ['from' => $i, 'to' => $j, 'type' => 'CRUSH'];
                        // B -> A
                        $relationships[] = ['from' => $j, 'to' => $i, 'type' => 'CRUSH'];
                    } else {
                        // Single direction (Randomly A->B or B->A)
                        if (rand(0, 1)) {
                            $relationships[] = ['from' => $i, 'to' => $j, 'type' => 'CRUSH'];
                        } else {
                            $relationships[] = ['from' => $j, 'to' => $i, 'type' => 'CRUSH'];
                        }
                    }
                } else {
                    // Undirected Types (DATING, BEST_FRIEND, etc.)
                    // Normalize to prevent duplicates
                    [$u, $v] = normalizeFromTo($type, $i, $j);
                    $relationships[] = ['from' => $u, 'to' => $v, 'type' => $type];
                }
            }
        }
    }

    $insertRel = $pdo->prepare('INSERT INTO relationships (from_id, to_id, type, last_msg_id, last_msg_time, deleted_at) VALUES (?, ?, ?, 0, NULL, NULL)');
    $insertReq = $pdo->prepare('INSERT INTO requests (from_id, to_id, type, status) VALUES (?, ?, ?, "ACCEPTED")');

    foreach ($relationships as $rel) {
        $insertRel->execute([$rel['from'], $rel['to'], $rel['type']]);
        $insertReq->execute([$rel['from'], $rel['to'], $rel['type']]);
    }

    echo "Inserted " . count($relationships) . " relationship edges.\n";

    // 5. Update Signatures with Stats
    echo "Updating signatures...\n";

    $stats = []; 
    // Init stats for all users
    for ($i = 1; $i <= $totalUsers; $i++) {
        $stats[$i] = [
            'dating' => 0, 
            'friends' => 0, 
            'crush_out' => 0, 
            'mutual_crush' => 0
        ];
    }

    // Fetch back confirmed relationships to calculate stats accurately
    // Note: We are inside a transaction, so we can see our own inserts
    $activeRels = $pdo->query('SELECT from_id, to_id, type FROM relationships WHERE deleted_at IS NULL')->fetchAll();
    
    $crushEdges = [];

    foreach ($activeRels as $row) {
        $u = (int)$row['from_id'];
        $v = (int)$row['to_id'];
        $type = $row['type'];

        if ($type === 'DATING') {
            $stats[$u]['dating']++;
            $stats[$v]['dating']++;
        } elseif ($type === 'CRUSH') {
            $stats[$u]['crush_out']++;
            // Track edges to find mutuals
            $key = min($u, $v) . '-' . max($u, $v);
            if (!isset($crushEdges[$key])) $crushEdges[$key] = 0;
            $crushEdges[$key]++;
        } else {
            $stats[$u]['friends']++;
            $stats[$v]['friends']++;
        }
    }

    // Process Mutual Crushes
    foreach ($crushEdges as $key => $count) {
        if ($count >= 2) {
            [$u, $v] = explode('-', $key);
            $stats[(int)$u]['mutual_crush']++;
            $stats[(int)$v]['mutual_crush']++;
        }
    }

    $updateSig = $pdo->prepare('UPDATE users SET signature = ? WHERE id = ?');

    foreach ($stats as $id => $s) {
        $clusterName = $clusterNames[$userClusters[$id]];
        
        $sigParts = [];
        $sigParts[] = "[$clusterName]";
        
        if ($s['dating'] > 0) $sigParts[] = "💍 " . $s['dating'];
        if ($s['mutual_crush'] > 0) $sigParts[] = "💞 " . $s['mutual_crush'];
        if ($s['crush_out'] > 0) $sigParts[] = "👀 " . $s['crush_out'];
        $sigParts[] = "🤝 " . $s['friends'];

        $finalSig = implode(' | ', $sigParts);
        $updateSig->execute([$finalSig, $id]);
    }

    $pdo->commit();
    echo "Seed completed successfully!\n";

} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    echo "Seed failed: " . $e->getMessage() . "\n";
    // echo $e->getTraceAsString(); 
}
?>
