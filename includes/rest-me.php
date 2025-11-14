<?php
defined('ABSPATH') || exit;

add_action('rest_api_init', function () {
  register_rest_route('ivaope/v1', '/me', [
    'methods'  => 'GET',
    'permission_callback' => '__return_true',
    'callback' => function () {
      $u = ivaope_get_current_ivao_user();
      if (!$u) return new WP_Error('ivao_not_logged', 'No hay sesión IVAO', ['status' => 401]);
      $resp = [
        'id'       => $u['id']       ?? null,
        'callsign' => $u['callsign'] ?? ($u['username'] ?? null),
        'name'     => $u['name']     ?? ($u['fullname'] ?? null),
        'rating'   => $u['rating']   ?? null,
		'staff'   => $u['isStaff']   ?? null,
      ];
      return rest_ensure_response($resp);
    }
  ]);
});
