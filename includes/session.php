<?php
defined('ABSPATH') || exit;

if (session_status() === PHP_SESSION_NONE) { @session_start(); }

/** Devuelve array usuario IVAO desde get_user_data() o $_SESSION */
function ivaope_get_current_ivao_user(): array {
  if (function_exists('get_user_data')) {
    $u = (array) get_user_data();
    if (!empty($u)) return $u;
  }
  foreach (['ivao', 'ivao_user', 'user', 'ivaope_user'] as $k) {
    if (!empty($_SESSION[$k]) && is_array($_SESSION[$k])) return $_SESSION[$k];
  }
  return [];
}

/** VID numérico (tu clave correcta era `id`) */
function ivaope_get_current_ivao_id(): ?int {
  $u = ivaope_get_current_ivao_user();
  if (!$u) return null;
  if (isset($u['id']) && is_numeric($u['id'])) return (int)$u['id'];
  if (isset($u['VID']) && is_numeric($u['VID'])) return (int)$u['VID'];
  return null;
}
