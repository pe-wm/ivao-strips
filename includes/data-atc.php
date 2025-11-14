<?php
defined('ABSPATH') || exit;

/**
 * Devuelve la lista de posiciones ATC activas en Perú (callsign empieza por 'SP').
 * Ignora cualquier prefijo recibido y fuerza 'SP'.
 *
 * @param array $args { @type int $timeout=10  @type int $ttl=15 }
 * @return string[] lista de callsigns (ej. ['SPIM_TWR','SPJC_APP', ...])
 */
function ivaope_atc_active_positions(array $args = []): array {
  $a = wp_parse_args($args, [
    'timeout' => 10,
    'ttl'     => 15,
  ]);

  // Forzamos prefijo 'SP'
  $tkey = 'ivaope_atc_active_SP';
  if (is_array($cached = get_transient($tkey))) return $cached;

  // ✅ Usamos el endpoint público sin seguridad
  $url = 'https://api.ivao.aero/v2/tracker/whazzup';

  $headers = ['Accept' => 'application/json'];

  $res = wp_remote_get($url, [
    'headers' => $headers,
    'timeout' => (int) $a['timeout'],
  ]);
  if (is_wp_error($res)) return [];

  $body = wp_remote_retrieve_body($res);
  $data = json_decode($body, true);

  if (json_last_error() !== JSON_ERROR_NONE || !is_array($data)) return [];

  // En whazzup, los ATC están en $data['clients']['atcs']
  if (!isset($data['clients']['atcs']) || !is_array($data['clients']['atcs'])) return [];

  $callsigns = [];
  foreach ($data['clients']['atcs'] as $atc) {
    $cs = isset($atc['callsign']) ? strtoupper(trim((string) $atc['callsign'])) : '';
    if ($cs === '') continue;
    if (strpos($cs, 'SP') !== 0) continue; // empieza por SP
    $callsigns[$cs] = true; // evita duplicados
  }

  $out = array_keys($callsigns);
  sort($out, SORT_NATURAL | SORT_FLAG_CASE);

  set_transient($tkey, $out, (int) $a['ttl']);
  return $out;
}

add_action('rest_api_init', function () {
  register_rest_route('ivaope/v1', '/atc-active', [
    'methods'  => 'GET',
    'permission_callback' => '__return_true',
    'callback' => function( WP_REST_Request $req ) {
      // Ignoramos cualquier parámetro y forzamos Perú (SP)
      $list = ivaope_atc_active_positions(); // siempre SP
      return rest_ensure_response($list);
    },
  ]);
});
