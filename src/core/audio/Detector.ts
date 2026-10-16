/**
 * 소음/음성 감지기 인터페이스 (확장 지점)
 * 추후 음성 대역(300~3400Hz) 필터 감지기 및 VAD(@ricky0123/vad-web) 감지기를 장착할 수 있도록 추상화.
 */
export interface Detector {
  /**
   * 시간영역 오디오 샘플 버퍼를 전달받아 dBFS 수치를 계산하여 반환
   * @param buffer 시간영역 오디오 Float32Array 데이터 (-1.0 ~ 1.0)
   * @returns dBFS 수치 (보통 -100 ~ 0 dBFS)
   */
  process(buffer: Float32Array): number;

  /**
   * 감지기 리셋 (필요 시 내부 버퍼 초기화)
   */
  reset?(): void;
}
