export const STORAGE_KEYS = {
  SETTINGS: 'studycalm_settings_v1',
  PIN_HASH: 'studycalm_admin_pin_hash_v1',
  PIN_LOCKOUT: 'studycalm_admin_pin_lockout_v1',
  DAILY_ALERT_COUNT: 'studycalm_daily_alert_count_v1',
  LAST_ALERT_DATE: 'studycalm_last_alert_date_v1',
  REMOTE_ROOM_ID_LEGACY: 'studycalm_remote_room_id_v1',
  TABLET_PAIRING_KEY: 'studycalm_tablet_pairing_key_v2',
  TABLET_NAME: 'studycalm_tablet_name_v2',
  REMOTE_PAIRINGS: 'studycalm_remote_pairings_v2',
  /** 측정 중이었는지 — 재시작/새로고침 후 자동 재개용 */
  MONITORING_DESIRED: 'studycalm_monitoring_desired_v1',
} as const;
