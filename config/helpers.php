<?php
require_once __DIR__ . '/constants.php';

function isDirectedType(string $type): bool {
    return in_array($type, DIRECTED_RELATION_TYPES, true);
}

function normalizeFromTo(string $type, int $from, int $to): array {
    if (isDirectedType($type)) {
        return [$from, $to];
    }
    return [$from < $to ? $from : $to, $from < $to ? $to : $from];
}
