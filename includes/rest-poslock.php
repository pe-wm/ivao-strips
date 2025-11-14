<?php
defined('ABSPATH') || exit;

add_action('rest_api_init', function () {
  register_rest_route('ivaope/v1', '/poslock', [
    'methods'  => ['GET', 'POST', 'PUT','DELETE'],
    'permission_callback' => '__return_true', // pon tu check cuando pases a prod
    'callback' => function( WP_REST_Request $request ) {

      // ---- Helpers para leer params desde JSON, form o query ----
      $param = function($key) use ($request) {
        // WP mezcla JSON y query/form en get_param, pero por si acaso:
        $v = $request->get_param($key);
        if ($v === null) {
          $json = (array) $request->get_json_params();
          $v = $json[$key] ?? null;
        }
        if (is_array($v)) $v = reset($v); // <-- evita "Array"
        return is_string($v) ? trim($v) : ($v === null ? null : strval($v));
      };

      $method = strtoupper($request->get_method());
      $op     = strtoupper($param('op') ?: ($method === 'GET' ? 'GET' : 'LOCK'));
      $pos    = $param('pos');
      $owner  = $param('owner'); // solo requerido para LOCK

      // ---- Validaciones básicas ----
      if (!$pos) {
        return new WP_Error('missing_pos', 'Falta parámetro pos', ['status'=>400]);
      }
      // Normaliza POSICION: mayúsculas y solo A-Z 0-9 _
      $pos_norm = preg_replace('/[^A-Z0-9_]/', '_', strtoupper($pos));
      if ($pos_norm === '' || $pos_norm === 'ARRAY') {
        return new WP_Error('bad_pos', 'pos inválido', ['status'=>400]);
      }

      // Carpeta stripsaves dentro de uploads
      $up = wp_upload_dir();
      $dir = trailingslashit($up['basedir']) . 'stripsaves';
      if (!is_dir($dir)) {
        wp_mkdir_p($dir);
      }
      $lock_path = $dir . '/' . $pos_norm . '.lock';

		// ---- UNLOCK: DELETE o POST op=unlock ----
		$wants_unlock = ($method === 'DELETE') || ($op === 'UNLOCK') || ($op === 'UNLOCK' || $op === 'RELEASE');
		if ($wants_unlock) {
		  if (!file_exists($lock_path)) {
			// Idempotente: responder OK aunque no exista
			return rest_ensure_response([
			  'ok'   => true,
			  'op'   => 'UNLOCK',
			  'pos'  => $pos_norm,
			  'done' => 'not_exists'
			]);
		  }
		  if (@unlink($lock_path)) {
			return rest_ensure_response([
			  'ok'   => true,
			  'op'   => 'UNLOCK',
			  'pos'  => $pos_norm,
			  'done' => 'deleted'
			]);
		  }
		  return new WP_Error('unlink_failed', 'No se pudo eliminar el lock', ['status'=>500]);
		}


      // ---- GET: consultar lock ----
      if ($method === 'GET' || $op === 'GET') {
        if (!file_exists($lock_path)) {
          return new WP_Error('not_found', 'Lock no existe', ['status'=>404, 'pos'=>$pos_norm]);
        }
        $content = file_get_contents($lock_path);
        $owner_id = $content === false ? null : trim($content);
        return rest_ensure_response([
          'ok'     => true,
          'pos'    => $pos_norm,
          'exists' => true,
          'owner'  => ($owner_id === '' ? null : $owner_id),
          'empty'  => ($owner_id === ''),
          'mtime'  => filemtime($lock_path) * 1000,
		  'age'    => time() - filemtime($lock_path),
        ]);
      }

      // ---- LOCK/PUT/POST: escribir/renovar lock ----
      if (!$owner) {
        return new WP_Error('missing_owner', 'Falta parámetro owner', ['status'=>400]);
      }
      // deja solo dígitos en owner (IVAO ID)
      $owner_norm = preg_replace('/\D+/', '', $owner);
      if ($owner_norm === '') {
        return new WP_Error('bad_owner', 'owner inválido', ['status'=>400]);
      }

      // Escribe SOLO el ID y salto de línea
      $bytes = @file_put_contents($lock_path, $owner_norm . "\n", LOCK_EX);
      if ($bytes === false) {
        return new WP_Error('write_failed', 'No se pudo escribir el lock', ['status'=>500]);
      }

      @chmod($lock_path, 0644);

      return rest_ensure_response([
        'ok'    => true,
        'op'    => 'LOCK',
        'pos'   => $pos_norm,
        'owner' => $owner_norm,
        'mtime' => filemtime($lock_path) * 1000,
        'file'  => basename($lock_path),
		'age'    => time() - filemtime($lock_path),
      ]);
    }
  ]);
});
