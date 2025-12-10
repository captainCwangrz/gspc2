<?php
// config/constants.php

// Define relationship types
const RELATION_TYPES = [
    'DATING',
    'BEST_FRIEND',
    'BROTHER',
    'SISTER',
    'BEEFING',
    'CRUSH'
];

// Define configuration for relationship styles (used in frontend)
// This mirrors the structure expected by the frontend
const RELATION_STYLES = [
    'DATING'      => ['color' => '#ec4899', 'particle' => true,  'label' => '❤️ Dating'],
    'BEST_FRIEND' => ['color' => '#3b82f6', 'particle' => true,  'label' => '💎 Bestie'],
    'BROTHER'     => ['color' => '#10b981', 'particle' => true,  'label' => '👊 Bro'],
    'SISTER'      => ['color' => '#10b981', 'particle' => true,  'label' => '🌸 Sis'],
    'BEEFING'     => ['color' => '#ef4444', 'particle' => true,  'label' => '💀 Beefing'],
    'CRUSH'       => ['color' => '#a855f7', 'particle' => true,  'label' => '✨ Crush']
];
