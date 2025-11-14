<?php
defined('ABSPATH') || exit;

/** Proxy METAR: GET /wp-json/ivaope/v1/metar?icao=LEBB */
add_action('rest_api_init', function () {
  register_rest_route('ivaope/v1', '/metar', [
    'methods'  => 'GET',
    'callback' => 'ivaope_metar_proxy',
    'permission_callback' => '__return_true',
    'args' => [
      'icao' => [
        'required' => true,
        'validate_callback' => function($v){
          return is_string($v) && preg_match('/^[A-Za-z]{4}$/', $v);
        }
      ],
    ],
  ]);
});

function ivaope_metar_proxy( WP_REST_Request $req ){
  $icao = strtoupper( $req->get_param('icao') );

  $tkey = 'ivaope_metar_' . $icao;
  $cached = get_transient($tkey);
  if ($cached) {
    return new WP_REST_Response($cached, 200, ['Content-Type' => 'text/plain; charset=utf-8']);
  }

  $url = 'https://aviationweather.gov/api/data/metar?ids=' . rawurlencode($icao) . '&format=raw&taf=false&hours=0';
  $res = wp_remote_get($url, [
    'timeout' => 8,
    'headers' => ['Accept' => 'text/plain'],
    'sslverify' => true,
  ]);

  if (is_wp_error($res)) {
    return new WP_Error('metar_err', 'No se pudo conectar a aviationweather.gov', ['status' => 502]);
  }
  $code = wp_remote_retrieve_response_code($res);
  $body = wp_remote_retrieve_body($res);
  if ($code !== 200 || !is_string($body) || $body === '') {
    return new WP_Error('metar_bad', 'Respuesta inválida del proveedor', ['status' => 502]);
  }

  $line = '';
  foreach (preg_split('/\R/', trim($body)) as $l) {
    $l = trim($l);
    if ($l !== '') { $line = $l; break; }
  }
  if ($line === '') {
    return new WP_Error('metar_empty', 'Sin datos METAR para ' . $icao, ['status' => 404]);
  }

  set_transient($tkey, $line, 120);
  return new WP_REST_Response($line, 200, ['Content-Type' => 'text/plain; charset=utf-8']);
}
