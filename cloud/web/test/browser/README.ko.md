# 브라우저 목록 회귀 테스트

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

이 테스트 페이지는 실제 React 목록 화면을 마운트하고, 현재 소스를 목록 메모이제이션 변경 직전의 Git 리비전 `95eed448dd80ca49de0de2703d1db1f7e78e8e94`와 비교합니다. 정렬／필터 결과, 재생 콜백, 즐겨찾기 순서 변경, 쿼리 작업량 및 트랙 행 렌더링 횟수가 유지되는지 확인합니다. 이 리비전 이후 최근 추가순 동작은 의도적으로 변경되었으므로, 현재 화면 전용 사례로 Library, Artists, Import의 최초 추가 시각, 평점／제목 편집, 새로 고침 순서, 새 가져오기, 동일한 타임스탬프, 알 수 없는 날짜 및 숨겨진 앨범을 검증합니다.

저장소 루트에서 Web 의존성을 설치하고 테스트 페이지를 빌드하세요.

```sh
npm --prefix cloud/web ci
node cloud/web/tools/build-performance-browser.mjs
python -m http.server 8766 --bind 127.0.0.1 --directory backups/web-perf-browser
```

표시 영역이 있는 데스크톱 브라우저에서 `http://127.0.0.1:8766`을 열고 **Run all tests**를 누르세요. 페이지에 각 사례와 최종 성공／실패 수가 표시됩니다. 브라우저 자동화에서는 `await window.runPerformanceTests()`를 호출하고 `window.performanceTestResults`를 읽을 수 있습니다. 포인터 순서 변경 테스트는 뷰포트 적중 검사를 사용하므로 크기가 0인 뷰포트는 지원하지 않습니다.

빌드는 Git에서 기준 파일을 직접 읽으므로 비공개 `backups/web-perf-baseline` 디렉터리가 필요하지 않습니다. 고정 리비전이 Git 기록에 포함된 클론을 사용하세요. 전체 클론에는 포함되지만 소스 ZIP만으로는 부족합니다. 얕은 클론은 빌드 전에 고정 리비전을 가져오거나 `git fetch --unshallow`로 전체 기록을 가져오세요.

```sh
git fetch origin 95eed448dd80ca49de0de2703d1db1f7e78e8e94
```

생성 파일은 Git에서 제외된 `backups/web-perf-browser` 디렉터리에 저장되며, `manifest.json`은 기준 리비전과 소스 해시를 기록합니다. API 응답과 표지에는 로컬 테스트 데이터를 사용하고 페이지는 외부 연결을 차단합니다. 실제 라이브러리에 쓰지 않습니다. 이 브라우저 검사는 `npm test`와 별개이며, 테스트 페이지 빌드 성공만으로 브라우저 사례가 통과했다고 볼 수는 없습니다.
