<?php
/*
Plugin Name: IVAO Strips
Description: Gestión de Strips online
Version: 1.0
Author: Gorka Santisteban
*/
defined('ABSPATH') || exit;

define('IVAO_STRIPS_PATH', plugin_dir_path(__FILE__));
define('IVAO_STRIPS_URL',  plugin_dir_url(__FILE__));

require_once IVAO_STRIPS_PATH . 'includes/session.php';
require_once IVAO_STRIPS_PATH . 'includes/rest-metar.php';
require_once IVAO_STRIPS_PATH . 'includes/rest-me.php';
require_once IVAO_STRIPS_PATH . 'includes/filesystem.php';
require_once IVAO_STRIPS_PATH . 'includes/rest-stripsave.php';

require_once IVAO_STRIPS_PATH . 'includes/assets.php';
require_once IVAO_STRIPS_PATH . 'includes/rest-atc-messages.php';
require_once IVAO_STRIPS_PATH . 'includes/shortcode-strips-atc.php';
require_once IVAO_STRIPS_PATH . 'includes/rest-preset.php';
require_once IVAO_STRIPS_PATH . 'includes/rest-poslock.php';



