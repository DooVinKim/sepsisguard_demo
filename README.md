# SepsisGuard 시연 대시보드 (정적 페이지)

> **가상 환자 · 미리 계산된 결과 · 연구용 (진단 대체 불가)** · 점수는 보정 전 상대 위험 점수

SepsisGuard 가 **어떻게 판단하는지** (바이탈 에이전트 · EMR 에이전트 → 합동 심문 → 책임 의사 모듈 → 판정) 와
**의료진이 어떤 리포트를 받는지** 를 보여주는 시연 페이지입니다. 모든 환자는 가상 환자이며, 결과는 작성자가 실제 엔진으로 미리 계산해 `data/data.js` 에 넣은 값입니다. 이 페이지는 그 값을 조회해 보여주기만 합니다.

- 🔗 라이브 데모: https://doovinkim.github.io/sepsisguard_demo/
- 📁 모델·전처리 코드: https://github.com/DooVinKim/sepsisguard_code

## 팀

고려대학교 캡스톤 프로젝트 · **패혈증 골든타임 방어를 위한 합동 심문 멀티 에이전트 시스템**

| 이름 | GitHub |
|---|---|
| 김두빈 | [@DooVinKim](https://github.com/DooVinKim) |
| 노민 |  |
| 남건우 | [@Dingul1](https://github.com/Dingul1) |

최종 성능 (test 70,476 시점): 바이탈 0.726 · EMR 0.752 → **합동 심문 AUROC 0.815**

## 화면

| 탭 | 내용 |
|---|---|
| 🏥 병동 현황 | 가상 환자 8명 카드 (등급 · 위험 점수 · 추이) |
| 🔍 판단 과정 | ① 시점 T 의 입력 → ② 바이탈 에이전트 → ③ EMR 에이전트 → ④ 합동 심문 → ⑤ 책임 의사 모듈 → ⑥ 판정. 시점 슬라이더로 시간에 따른 변화 |
| 📋 의료진 리포트 | 판정 배너 · 근거 위젯 · 리포트 원문 · 확인/관찰/기각 버튼 (브라우저 메모리에만 유지) |
| ℹ️ 시스템 소개 | 구조 · 작동 원리 · 등급 기준 · 한계 |

## 실행

- `index.html` 을 더블클릭하면 인터넷 없이도 열립니다 (데이터가 `data.js` 라서 file:// 에서도 동작).
- 서버로 확인할 때: `python -m http.server 8000` → `http://localhost:8000`

## 구성

```
index.html
assets/css/style.css        화면 스타일 (기존 책임의사 대시보드 색상·카드 이식)
assets/js/app.js            탭 · 슬라이더 · 그래프(SVG) · 리포트 렌더링
assets/vendor/marked.min.js marked v12.0.2 (MIT) — 리포트 마크다운 표시, 버전 고정 사본
data/data.js                window.DEMO_DATA (작성자가 생성 — 직접 수정 금지)
data/meta.json              data.js 의 meta (사람이 읽는 용도)
```

외부 CDN · 외부 글꼴을 쓰지 않습니다 (시스템 글꼴). 그래프는 라이브러리 없이 SVG 로 그립니다.

## 데이터 갱신

새 가상 환자 · 시점 · 필드가 필요하면 작성자에게 요청 → 새 `data/data.js` 로 교체 → 공개 전 점검 후 push.
화면 코드는 모르는 필드를 무시하므로 같은 `schema_version` 안에서 필드가 추가되어도 그대로 동작합니다.

이 저장소에는 모델 가중치 · 학습 데이터 · 실제 환자 데이터가 없습니다.
