# SciSlide 0.2.1 — Linux x64

이 폴더의 `scislide` 실행 파일을 실행하세요. 폴더 안의 런타임 파일은 함께 유지해야 합니다. Node.js나 개발 서버 없이 실행할 수 있습니다.

```sh
./scislide
```

**Open**으로 `examples/electron-local-latex.scislide`를 열면 로컬 LaTeX 결과가 저장된 예제를 확인할 수 있습니다. **Save**는 선택한 원본 파일을 저장하고, **Export**는 PDF 또는 현재 슬라이드 SVG를 별도로 저장합니다.

**New slide** 또는 슬라이드 목록의 **+**를 눌러 Scientific 템플릿을 고르세요. 제목, 핵심 결과, 수식과 해석, 두 그림 비교 레이아웃과 **Blank**를 제공합니다. 현재 슬라이드 다음에 추가되며 모든 텍스트·수식·도형을 직접 편집할 수 있습니다. 그림 자리는 안내용 도형입니다. **Figure**로 실제 그림을 넣고 안내 객체를 삭제하세요.

수식의 **MathJax** 모드는 TeX 설치 없이 작동합니다. **Local LaTeX** 모드는 Linux 시스템에 설치된 `latex` 또는 `xelatex`, `dvisvgm`, `bubblewrap`, `prlimit`을 사용합니다. 패키지·글꼴 설정은 **PREAMBLE**, 수식은 **LATEX SOURCE**에 입력하고 **Compile with LaTeX → Apply equation** 순서로 반영하세요. 크기나 색상을 바꾸면 다시 컴파일해야 합니다.

로컬 컴파일은 지원되는 시스템 TeX·글꼴 경로를 사용합니다. 사용자 홈의 `~/texmf` 및 개인 글꼴 폴더는 현재 연결하지 않습니다. 유효한 수식 결과가 저장된 문서는 TeX 없이도 보기·발표·출력할 수 있습니다.

현재는 프로토타입입니다. 한글 본문 편집과 원본 저장은 가능하지만 한글 본문의 PDF 출력은 아직 지원하지 않습니다. 그림 crop, 애니메이션, PPTX 변환, 서명된 설치 프로그램과 자동 업데이트는 후속 작업입니다.

Electron/Chromium 고지는 이 폴더의 `LICENSE`, `LICENSES.chromium.html`에 있습니다. 앱 의존성의 고지는 `resources/app.asar` 안의 `third-party-licenses/`에 포함됩니다. 새 SciSlide 프로젝트 소스의 라이선스는 아직 선택하지 않았습니다.
