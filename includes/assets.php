<?php
defined('ABSPATH') || exit;

function ivaope_enqueue_assets() {
  $css = IVAO_STRIPS_PATH.'assets/strips.css';
  $js  = IVAO_STRIPS_PATH.'assets/strips.js';

  if (file_exists($css)) {
    wp_enqueue_style('ivaope-strips', IVAO_STRIPS_URL.'assets/strips.css', [], filemtime($css));
  }
  if (file_exists($js)) {
    wp_enqueue_script('ivaope-strips', IVAO_STRIPS_URL.'assets/strips.js', [], filemtime($js), true);
    wp_localize_script('ivaope-strips', 'IVAOPE', [
      'rest' => [
        'me'        => esc_url_raw(rest_url('ivaope/v1/me')),
        'metar'     => esc_url_raw(rest_url('ivaope/v1/metar')),
        'stripsave' => esc_url_raw(rest_url('ivaope/v1/stripsave')),
        'atcActive' => esc_url_raw(rest_url('ivaope/v1/atc-active')),   // ← activos
        'atcMessage'=> esc_url_raw(rest_url('ivaope/v1/atc-message')), // ← push/pop {POS}.save
		'presets'   => esc_url_raw(rest_url('ivaope/v1/presets')),
      ],
      'images' => [
        'arrival'   => IVAO_STRIPS_URL.'assets/Strip_llegadas.png',
        'departure' => IVAO_STRIPS_URL.'assets/Strip_salidas.png',
      ],
      'fraUrl' => IVAO_STRIPS_URL.'assets/FRAs.txt',  // ← para cargar el select
    ]);
  }
}

function ivaope_enqueue_assets_atc() {
  $js_atc = IVAO_STRIPS_PATH.'assets/strips-atc.js';
  if (file_exists($js_atc)) {
    wp_enqueue_script(
      'ivaope-strips-atc',
      IVAO_STRIPS_URL.'assets/strips-atc.js',
      ['ivaope-strips'],              // sigue dependiendo del base (CSS/JS comunes)
      filemtime($js_atc),
      true
    );
  }
}

