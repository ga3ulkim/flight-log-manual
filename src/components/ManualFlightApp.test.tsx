import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ManualFlightApp from './ManualFlightApp';

describe('manual flight app session startup', () => {
  it('renders the empty Entry hub immediately without a persistence-loading phase', () => {
    const markup = renderToStaticMarkup(<ManualFlightApp />);

    expect(markup).toContain('비행 기록을 추가해보세요.');
    expect(markup).toContain('+ 첫 비행 기록 추가');
    expect(markup).toContain('0편');
    expect(markup).not.toContain('내 비행 기록 보기');
    expect(markup).not.toContain('비행 기록을 불러오는 중입니다');
  });

  it('creates another empty Entry hub when the application is reinitialized', () => {
    const firstPage = renderToStaticMarkup(<ManualFlightApp />);
    const refreshedPage = renderToStaticMarkup(<ManualFlightApp />);

    expect(firstPage).toBe(refreshedPage);
    expect(refreshedPage).toContain('새로고침하면 초기화됩니다.');
    expect(refreshedPage).not.toContain('IndexedDB');
  });
});
