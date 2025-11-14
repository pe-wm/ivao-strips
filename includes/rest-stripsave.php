<?php
defined('ABSPATH') || exit;

/**
 * Endpoint: /wp-json/ivaope/v1/stripsave
 * - GET  ?pos=SPJC_TWR[&only=1]   -> devuelve el contenido de SPJC_TWR.save (si existe)
 * - POST { pos:"SPJC_TWR", strips:[...] } -> guarda SPJC_TWR.save
 *
 * Nota: permiso abierto para evitar 401 durante desarrollo. Ajusta permission_callback si necesitas restringir.
 */
add_action('rest_api_init', function () {
  register_rest_route('ivaope/v1', '/stripsave', [
    [
      'methods'             => 'GET',
      'callback'            => 'ivaope_stripsave_get',
      'permission_callback' => '__return_true',
    ],
    [
      'methods'             => 'POST',
      'callback'            => 'ivaope_stripsave_post',
      'permission_callback' => '__return_true',
    ],
  ]);
});



function ivaope_sanitize_pos($pos): string {
  $pos = strtoupper((string)$pos);
  // Permitir solo A-Z, 0-9 y _
  return preg_replace('/[^A-Z0-9_]/', '', $pos) ?: '';
}

function ivaope_file_for_pos(string $pos): string {
  return trailingslashit(ivaope_strips_dir()) . $pos . '.save';
}

function ivaope_safe_write(string $path, string $contents): bool {
  $tmp = $path . '.' . wp_generate_password(6, false) . '.tmp';
  if (file_put_contents($tmp, $contents, LOCK_EX) === false) return false;
  return @rename($tmp, $path);
}

/** GET /stripsave?pos=SPJC_TWR[&only=1] */
function ivaope_stripsave_get(WP_REST_Request $req) {
  $pos = ivaope_sanitize_pos($req->get_param('pos'));
  if (!$pos) {
    return new WP_REST_Response(['error' => 'missing pos'], 400);
  }

  $file = ivaope_file_for_pos($pos);
  if (!file_exists($file)) {
    // Estructura vacía coherente si no hay archivo
    return new WP_REST_Response([
      'pos'     => $pos,
      'exists'  => false,
      'strips'  => [],
      'updated' => null,
      'file'    => basename($file),
    ], 200);
  }

  $raw = file_get_contents($file);
  $json = json_decode($raw, true);

  // Compatibilidad: si el archivo no es JSON válido, intenta envolverlo
  if (!is_array($json)) {
    $json = [
      'pos'     => $pos,
      'strips'  => [],
      'raw'     => $raw,
      'version' => 1,
    ];
  }

  // Normaliza salida
  $out = [
    'pos'     => $json['pos']     ?? $pos,
    'strips'  => $json['strips']  ?? [],
    'version' => $json['version'] ?? 1,
    'updated' => $json['saved_at'] ?? (filemtime($file) ? gmdate('c', filemtime($file)) : null),
    'file'    => basename($file),
  ];

  return new WP_REST_Response($out, 200);
}

/** POST /stripsave  Body JSON: { pos:"SPJC_TWR", strips:[ ... ] } */
function ivaope_stripsave_post(WP_REST_Request $req) {
  $data = $req->get_json_params();
  if (!is_array($data)) $data = [];

  $pos = ivaope_sanitize_pos($data['pos'] ?? '');
  if (!$pos) {
    return new WP_REST_Response(['error' => 'missing pos'], 400);
  }

  // Acepta 'strips' o 'payload' (por compatibilidad)
  $strips = $data['strips'] ?? $data['payload'] ?? [];
  if (!is_array($strips)) $strips = [];

  $record = [
    'pos'      => $pos,
    'version'  => 1,
    'saved_at' => gmdate('c'),
    'strips'   => array_values($strips),
  ];

  $json = wp_json_encode($record, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
  if ($json === false) {
    return new WP_REST_Response(['error' => 'json_encode_failed'], 500);
  }

  $file = ivaope_file_for_pos($pos);
  if (!ivaope_safe_write($file, $json)) {
    return new WP_REST_Response(['error' => 'write_failed'], 500);
  }

  return new WP_REST_Response([
    'ok'      => true,
    'pos'     => $pos,
    'file'    => basename($file),
    'count'   => count($record['strips']),
    'saved_at'=> $record['saved_at'],
  ], 200);
}
