<?php
defined('ABSPATH') || exit;

add_action('rest_api_init', function () {
  register_rest_route('ivaope/v1', '/presets', [
    [
      'methods'  => 'GET',
      'callback' => 'ivaope_presets_get',
      'permission_callback' => '__return_true', // ajusta si restringes por login
    ],
    [
      'methods'  => 'POST',
      'callback' => 'ivaope_presets_post',
      'permission_callback' => '__return_true',
    ],
  ]);
});

function ivaope_presets_base_dir(){
  $up = wp_upload_dir();
  $base = trailingslashit($up['basedir']) . 'stripsaves/presets';
  // Asegura la carpeta base
  if ( ! is_dir($base) ) wp_mkdir_p($base);
  return $base;
}

function ivaope_presets_scope_dir($scope){
  $scope = preg_replace('~[^A-Za-z0-9_\-]~', '', strtoupper($scope ?: 'GLOBAL'));
  $dir = trailingslashit(ivaope_presets_base_dir()) . $scope;
  if ( ! is_dir($dir) ) wp_mkdir_p($dir);     // crea si no existe
  return $dir;
}

function ivaope_presets_get(WP_REST_Request $req){
  $op    = $req->get_param('op') ?: 'list';
  $scope = $req->get_param('scope') ?: 'GLOBAL';
  $dir   = ivaope_presets_scope_dir($scope);

  if ($op === 'list'){
    $out = [];
    foreach (glob($dir . '/*.preset.json') ?: [] as $f){
      $out[] = [
        'name'  => basename($f),
        'mtime' => filemtime($f),
        'size'  => filesize($f),
      ];
    }
    return rest_ensure_response([ 'scope' => $scope, 'files' => $out ]);
  }

  if ($op === 'load'){
    $name = $req->get_param('name');
    if (!$name) return new WP_REST_Response('missing name', 400);
    $safe = sanitize_file_name($name);
    $file = $dir . '/' . $safe;
    if (!is_file($file)) return new WP_REST_Response('not found', 404);
    $json = file_get_contents($file);
    $data = json_decode($json, true);
    if (!is_array($data)) return new WP_REST_Response('bad json', 422);
    return rest_ensure_response($data);
  }

  return new WP_REST_Response('bad op', 400);
}

function ivaope_presets_post(WP_REST_Request $req){

  // --- NUEVO: detectar borrado ---
  $op = $req->get_param('op');
  if ($op === 'delete') {
	// --- SOLO STAFF ---
  // --- SOLO STAFF (robusto): acepta isStaff del helper o 'staff' en sesión ---
  $u = function_exists('ivaope_get_current_ivao_user') ? ivaope_get_current_ivao_user() : null;
  $role = isset($_SESSION['user_role']) ? $_SESSION['user_role'] : null;

  $isStaff = false;
  if (is_array($u)) {
    // En tu /me lo expones como 'isStaff' (true/1); en tu cambio lo devuelves también como 'staff'
    $isStaff = !empty($u['isStaff']) || (!empty($u['staff']) && $u['staff']); 
  }
  if ($role === 'staff') $isStaff = true;

  if (!$isStaff) {
    return new WP_REST_Response('forbidden', 403);
  }
    $scope = $req->get_param('scope');
    $name  = $req->get_param('name');

    if (!$scope || !$name) {
      return new WP_REST_Response('missing scope or name', 400);
    }

    // Normaliza nombre: añade sufijo si falta
    if (!preg_match('/\.preset\.json$/i', $name)) {
      $name .= '.preset.json';
    }

    // Ruta de la carpeta donde se guardan los presets
    $dir = ivaope_presets_scope_dir($scope);
    $file = trailingslashit($dir) . basename($name);

    if (!file_exists($file)) {
      return new WP_REST_Response('file not found', 404);
    }

    $ok = @unlink($file);
    if (!$ok) {
      return new WP_REST_Response('unlink failed', 500);
    }

    return rest_ensure_response([
      'ok'      => true,
      'deleted' => basename($file),
      'scope'   => strtoupper($scope),
    ]);
  }
  // --- FIN bloque nuevo ---

  // === rama original de guardado ===
  $name   = $req->get_param('name');
  $strips = $req->get_param('strips');
  $scope  = $req->get_param('scope') ?: 'GLOBAL';

  if (!$name)   return new WP_REST_Response('missing name', 400);
  if (!is_array($strips)) return new WP_REST_Response('missing strips', 400);

  $dir   = ivaope_presets_scope_dir($scope);           // crea carpeta si no existe
  $safe  = sanitize_file_name($name) . '.preset.json'; // fuerza sufijo
  $file  = $dir . '/' . $safe;

  $payload = [
    'version' => 1,
    'scope'   => strtoupper($scope),
    'count'   => count($strips),
    'strips'  => array_values($strips),
  ];

  $ok = file_put_contents($file, wp_json_encode($payload, JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES));
  if ($ok === false) return new WP_REST_Response('write error', 500);

  return rest_ensure_response([
    'scope' => strtoupper($scope),
    'file'  => basename($file),
    'count' => count($strips),
  ]);
}

