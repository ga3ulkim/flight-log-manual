import { describe, expect, it } from 'vitest';
import {
  MANUAL_CLEAR_ALL_CONFIRMATION,
  MANUAL_SESSION_DATA_COPY,
} from './DataManagementDialog';

describe('session data management messaging and safeguards', () => {
  it('explains that records and local-file imports last only for the current session', () => {
    expect(MANUAL_SESSION_DATA_COPY.privacy).toContain('현재 페이지가 열려 있는 동안만');
    expect(MANUAL_SESSION_DATA_COPY.privacy).toContain('새로고침하거나 페이지를 다시 열면 초기화');
    expect(MANUAL_SESSION_DATA_COPY.privacy).toContain('JSON 백업 또는 CSV 내보내기');
    expect(MANUAL_SESSION_DATA_COPY.restore).toContain('현재 세션에만 불러옵니다.');
    expect(MANUAL_SESSION_DATA_COPY.legacyImport).toContain('현재 세션에만 추가합니다.');
    expect(Object.values(MANUAL_SESSION_DATA_COPY).join(' ')).not.toContain('IndexedDB');
  });

  it('retains an explicit typed confirmation for the bulk clear action', () => {
    expect(MANUAL_CLEAR_ALL_CONFIRMATION).toMatchObject({
      title: '모든 비행 기록을 삭제할까요?',
      confirmLabel: '현재 기록 삭제',
      requiredText: '모두 삭제',
    });
  });
});
