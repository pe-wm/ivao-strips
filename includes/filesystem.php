<?php
defined('ABSPATH') || exit;

/** Carpeta de guardado */
function ivaope_strips_dir(): string {
  $up = wp_upload_dir();
  $dir = trailingslashit($up['basedir']) . 'stripsaves';
  if (!is_dir($dir)) {
    wp_mkdir_p($dir);
    @file_put_contents(trailingslashit($dir).'.htaccess', "Options -Indexes\n");
    @file_put_contents(trailingslashit($dir).'index.html', '');
  }
  return $dir;
}

/** Fichero fijo del SUPERVISOR (cola de transferencias) */
function ivaope_supervisor_path(): string {
  return trailingslashit(ivaope_strips_dir()) . 'supervisor.json';
}

/** Fichero de sesión por usuario (estado de strips) */
function ivaope_strips_path_for_user(int $user_id): string {
  $id = preg_replace('/\D+/', '', (string)$user_id);
  return trailingslashit(ivaope_strips_dir()) . $id . '.save';
}
/** Carpeta de presets */
function ivaope_presets_dir(): string {
  $dir = trailingslashit(ivaope_strips_dir()) . 'presets';
  if (!is_dir($dir)) {
    wp_mkdir_p($dir);
    @file_put_contents(trailingslashit($dir).'.htaccess', "Options -Indexes\n");
    @file_put_contents(trailingslashit($dir).'index.html', '');
  }
  return $dir;
}

/** Ruta de un preset por nombre "seguro" */
function ivaope_preset_path(string $name): string {
  $safe = preg_replace('~[^a-zA-Z0-9._-]+~', '_', $name);
  if ($safe === '' ) $safe = 'preset';
  // extensión .preset.json para distinguir
  if (!preg_match('~\.preset\.json$~i', $safe)) $safe .= '.preset.json';
  return trailingslashit(ivaope_presets_dir()) . $safe;
}
