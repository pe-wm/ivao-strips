<?php
defined('ABSPATH') || exit;

if (!function_exists('ivaope_strips_atc_shortcode')) {
  function ivaope_strips_atc_shortcode($atts = []) {
    if (session_status() === PHP_SESSION_NONE) { @session_start(); }

    $ivao_user = ivaope_get_current_ivao_user();
    $ivao_id   = isset($ivao_user['id']) ? (int)$ivao_user['id'] : 0;

    if (!$ivao_id) {
      return '<div style="text-align:center;margin:40px auto;font:700 18px/1.5 system-ui,-apple-system,Segoe UI,Roboto;color:#b00020;">
        ⚠️ Debes iniciar sesión en IVAO para acceder a esta página.
      </div>';
    }

    // Encolar assets base + ATC
    ivaope_enqueue_assets();
    ivaope_enqueue_assets_atc();

    $a = shortcode_atts([
      'id'           => 'utc-clock-atc',
      'titulo'       => 'HORA:',
      'clock_color'  => '#ff2b2b',
      'show_seconds' => '1',
      'arr_x' => '20', 'arr_y' => '20',
      'dep_x' => '20', 'dep_y' => '20',
      'save_key'     => 'ivaoPeruATC',
    ], $atts, 'strips_atc');

    $uid          = uniqid('satc_');
    $img_llegadas = IVAO_STRIPS_URL . 'assets/Strip_llegadas.png';
    $img_salidas  = IVAO_STRIPS_URL . 'assets/Strip_salidas.png';
    $default_key  = 'post_' . ( get_the_ID() ?: 'global' );
    $save_key     = empty($atts['save_key']) ? $default_key : sanitize_key($atts['save_key']);

    // Coordenadas (mismas del otro shortcode)
    $arr_coords = [ [8,5],[8,45],[8,90],[128,100],[194,15],[254,8],[365,45],[365,8],[521,5],[550,33],
                    [592,3],[664,3],[735,3],[521,80],[592,80],[664,80],[735,80],[826,3],[826,45],[800,100],[365,90],[320,8],[320,90],[194,8] ];
    $dep_coords = [ [675,85],[10,10],[10,50],[10,100],[260,90],[220,90],[200,10],[380,90],
                    [620,10],[680,10],[720,5],[780,5],[720,42],[780,42],[780,95],
                    [230,40],[320,10],[450,10],[720,70],[780,70],[720,95],[320,30],[480,30] ];

    $config = [
      'uid'         => $uid,
      'clockId'     => $a['id'],
      'title'       => $a['titulo'],
      'clockColor'  => $a['clock_color'],
      'showSeconds' => (int)!!$a['show_seconds'] === 1,
      'arr' => ['x'=>(int)$a['arr_x'], 'y'=>(int)$a['arr_y'], 'coords'=>$arr_coords, 'img'=>$img_llegadas],
      'dep' => ['x'=>(int)$a['dep_x'], 'y'=>(int)$a['dep_y'], 'coords'=>$dep_coords, 'img'=>$img_salidas],
      'storageKey'  => 'se_state_'.$save_key,
    ];

    ob_start(); ?>
    <div class="se-wrap" id="<?php echo esc_attr($uid); ?>"
     data-ivao-strips-atc="1"
     data-config="<?php echo esc_attr( wp_json_encode($config) ); ?>"
	 data-ivao-id="<?php echo (int) $ivao_id; ?>"
     data-endpoints="<?php echo esc_attr( wp_json_encode([
        'me'        => rest_url('ivaope/v1/me'),
        'metar'     => rest_url('ivaope/v1/metar'),
        'stripsave' => rest_url('ivaope/v1/stripsave'),
        'atcActive' => rest_url('ivaope/v1/atc-active'),
        'atcMessage'=> rest_url('ivaope/v1/atc-message'),
		'presets'   => rest_url('ivaope/v1/presets'),
     ]) ); ?>"
     data-fra="<?php echo esc_attr( IVAO_STRIPS_URL.'assets/FRAs.txt' ); ?>">


      <div class="se-header">
        <h2 class="se-title"><?php echo esc_html($a['titulo']); ?></h2>
        <div class="se-clock" id="<?php echo esc_attr($a['id']); ?>" aria-label="Hora UTC" title="Hora UTC">00:00:00Z</div>
      </div>

      <!-- Selector de Posición (obligatorio) -->
      <div class="se-toolbar" style="flex-wrap:wrap">
        <label for="<?php echo esc_attr($uid); ?>_pos" style="font-weight:600">Posición:</label>
        <select id="<?php echo esc_attr($uid); ?>_pos" class="se-select" required>
          <option value="">— Selecciona tu posición —</option>
        </select>

        <button type="button" class="se-btn add-arr" disabled>Agregar Llegada</button>
        <button type="button" class="se-btn add-dep" disabled>Agregar Salida</button>
      </div>

      <!-- METAR -->
      <div class="se-metar">
        <label for="<?php echo esc_attr($uid); ?>_metar_in" class="se-metar-label">METAR:</label>
        <input id="<?php echo esc_attr($uid); ?>_metar_in" class="se-metar-input" type="text"
               inputmode="latin" placeholder="" maxlength="4" pattern="[A-Za-z]{4}"
               aria-label="Código ICAO (4 letras)" />
        <button type="button" class="se-metar-btn" disabled>Obtener METAR</button>
        <div class="se-metar-msg" aria-live="polite"></div>
      </div>

      <div class="se-transfer-status" style="text-align:center;font:600 14px/1.3 system-ui,-apple-system,Segoe UI,Roboto;margin-top:6px;min-height:1.4em;"></div>

      <div class="se-stage" aria-disabled="true" style="opacity:.5; pointer-events:none;"></div>
    </div>
    <?php
    return ob_get_clean();
  }

  add_shortcode('strips_atc', 'ivaope_strips_atc_shortcode');
}
