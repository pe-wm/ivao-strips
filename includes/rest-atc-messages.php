<?php
defined('ABSPATH') || exit;

// Carpeta atc
function ivaope_atc_dir(): string {
  $base = ivaope_strips_dir(); // ya la tienes creada en filesystem.php (uploads/stripsaves)
  $dir = trailingslashit($base).'atc';
  if (!is_dir($dir)) {
    wp_mkdir_p($dir);
    @file_put_contents(trailingslashit($dir).'.htaccess', "Options -Indexes\n");
    @file_put_contents(trailingslashit($dir).'index.html', '');
  }
  return $dir;
}
function ivaope_atc_file_for(string $pos): string {
  // POSICIONES en mayúsculas A-Z0-9 y _
  $safe = strtoupper(preg_replace('/[^A-Z0-9_]/', '', $pos));
  return trailingslashit(ivaope_atc_dir()) . $safe . '.save';
}

// Seguridad mínima: sesión IVAO requerida
function ivaope_require_ivao_session(): bool {
  return ivaope_get_current_ivao_id() !== null;
}

add_action('rest_api_init', function () {

  // PUSH: POST /ivaope/v1/atc-message
  register_rest_route('ivaope/v1', '/atc-message', [
    'methods'  => 'POST',
    'permission_callback' => function(){ return ivaope_require_ivao_session(); },
    'callback' => function( WP_REST_Request $req ){
      $json = $req->get_json_params();
      if (!is_array($json)) {
        $raw = $req->get_param('data');
        if (is_string($raw)) $json = json_decode($raw, true);
      }
      if (!is_array($json)) return new WP_Error('bad_payload', 'Se esperaba JSON', ['status'=>400]);

      $to   = isset($json['to']) ? strtoupper(trim((string)$json['to'])) : '';
      $body = $json['payload'] ?? null; // libre: puede ser 1 strip o {v, strips:[]}

      if ($to === '' || !preg_match('/^[A-Z0-9_]+$/', $to)) {
        return new WP_Error('bad_to', 'Parámetro "to" inválido', ['status'=>400]);
      }
      if ($body === null) {
        return new WP_Error('bad_body', 'Falta "payload"', ['status'=>400]);
      }

      $file = ivaope_atc_file_for($to);
      $contentToAppend = wp_json_encode($body, JSON_UNESCAPED_UNICODE);

      // Si existe, acumulamos en un array JSON por líneas
      $ok = false;
      if (file_exists($file)) {
        // Añadimos una línea por mensaje (newline-delimited JSON)
        $ok = (bool)file_put_contents($file, "\n".$contentToAppend, FILE_APPEND | LOCK_EX);
      } else {
        $ok = (bool)file_put_contents($file, $contentToAppend, LOCK_EX);
      }
      if (!$ok) return new WP_Error('fs_error', 'No se pudo escribir el buzón', ['status'=>500]);

      return new WP_REST_Response(['ok'=>true, 'to'=>$to], 200);
    }
  ]);

  // POP: GET /ivaope/v1/atc-message?pos=SPJC_TWR
  register_rest_route('ivaope/v1', '/atc-message', [
    'methods'  => 'GET',
    'permission_callback' => function(){ return ivaope_require_ivao_session(); },
    'callback' => function( WP_REST_Request $req ){
      $pos = strtoupper(trim((string)$req->get_param('pos')));
      if ($pos === '' || !preg_match('/^[A-Z0-9_]+$/', $pos)) {
        return new WP_Error('bad_pos', 'Parámetro "pos" inválido', ['status'=>400]);
      }
      $file = ivaope_atc_file_for($pos);
      if (!file_exists($file)) {
        return new WP_REST_Response(['messages'=>[]], 200);
      }

      // Leemos todo y borramos (lectura destructiva)
      $raw = file_get_contents($file);
      @unlink($file);

      // Interpretamos como NDJSON (una o varias líneas JSON)
      $msgs = [];
      foreach (preg_split('/\R/', (string)$raw) as $line) {
        $line = trim($line);
        if ($line === '') continue;
        $obj = json_decode($line, true);
        if ($obj !== null) $msgs[] = $obj;
      }
      return new WP_REST_Response(['messages'=>$msgs], 200);
    }
  ]);

});
